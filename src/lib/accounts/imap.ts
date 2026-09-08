import { ImapFlow, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import {
  PROVIDER_TIMEOUT_MS,
  ProviderError,
  type MailMessage,
  type MailParticipant,
  type MailReader,
  type MailSearch,
  type MailThread,
  type MailThreadSummary,
} from "@/lib/accounts/types";
import { clip, mergeParticipants, normalise, stripHtml } from "@/lib/accounts/text";

/**
 * Any mailbox that speaks IMAP: Fastmail, iCloud, Yahoo, a university
 * account, a self-hosted server.
 *
 * Two libraries rather than a hand-rolled client, unlike the OAuth
 * providers: IMAP is a stateful, decades-old protocol with a long tail of
 * server quirks, and imapflow and mailparser are the same maintained pair
 * every serious Node mail client uses. They are the largest dependencies in
 * the app and are loaded only when an IMAP account is read.
 *
 * What a thread is, here: IMAP has no threads. Messages are joined by their
 * Message-ID and In-Reply-To headers, which is what every mail client does
 * under the hood. A reply whose sender's client dropped In-Reply-To lands as
 * a thread of its own; that is the protocol's limit, not a bug to chase.
 *
 * Read-only: every mailbox is opened read-only, so even a flag cannot change.
 * The app password is used to log in and for nothing else.
 */

export type ImapConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  /** The address of the mailbox, for telling "me" from everyone else. */
  accountEmail: string;
};

/** Where mail lives that is worth searching: what came in, and what went out. */
type Mailboxes = { inbox: string; sent: string | null };

async function open(config: ImapConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: { user: config.username, pass: config.password },
    logger: false,
    connectionTimeout: PROVIDER_TIMEOUT_MS,
    greetingTimeout: PROVIDER_TIMEOUT_MS,
    socketTimeout: PROVIDER_TIMEOUT_MS * 3,
  });
  try {
    await client.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const auth = /auth|login|credential|password/i.test(message);
    throw new ProviderError(
      auth
        ? `${config.host} refused the login. Use an app password rather than the account password, and check the username is the full address.`
        : `Could not reach ${config.host}:${config.port}. ${message}`,
      { revoked: auth },
    );
  }
  return client;
}

async function mailboxes(client: ImapFlow): Promise<Mailboxes> {
  const list = await client.list();
  const inbox = list.find((box) => box.path.toUpperCase() === "INBOX")?.path ?? "INBOX";
  const sent =
    list.find((box) => box.specialUse === "\\Sent")?.path ??
    list.find((box) => /^sent( (items|mail|messages))?$/i.test(box.name))?.path ??
    null;
  return { inbox, sent };
}

/** Log in, list mailboxes, log out. The whole test of an IMAP account. */
export async function verifyImap(config: ImapConfig): Promise<{ inbox: string; sent: string | null }> {
  const client = await open(config);
  try {
    return await mailboxes(client);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/**
 * imapflow's `or` takes a list and refuses one entry; a single term is the
 * term itself. Domains work because IMAP's FROM/TO/CC search is a substring
 * match on the address.
 */
function criteria(search: MailSearch): SearchObject | null {
  const terms = [...(search.addresses ?? []), ...(search.domains ?? [])];
  const alternatives: SearchObject[] = terms.flatMap((term) => [{ from: term }, { to: term }, { cc: term }]);
  const base: SearchObject = {};
  if (alternatives.length === 1) Object.assign(base, alternatives[0]);
  else if (alternatives.length > 1) base.or = alternatives;
  if (search.text?.trim()) base.text = search.text.trim();
  if (search.newerThanDays) base.since = new Date(Date.now() - search.newerThanDays * 86_400_000);
  return Object.keys(base).length ? base : null;
}

type Found = {
  mailbox: string;
  uid: number;
  messageId: string;
  inReplyTo: string;
  subject: string;
  date: Date;
  from: MailParticipant | null;
  to: MailParticipant[];
  cc: MailParticipant[];
  unread: boolean;
};

type EnvelopeAddress = { name?: string; address?: string };

function participant(address: EnvelopeAddress | undefined): MailParticipant | null {
  const email = address?.address?.trim().toLowerCase();
  return email ? { name: address?.name ?? "", email } : null;
}

function participants(addresses: EnvelopeAddress[] | undefined): MailParticipant[] {
  return (addresses ?? []).map(participant).filter((p): p is MailParticipant => p !== null);
}

/** A thread id that survives a round trip: which mailbox, which UIDs. */
function encodeThreadId(members: { mailbox: string; uid: number }[]): string {
  return Buffer.from(JSON.stringify(members.map((m) => [m.mailbox, m.uid]))).toString("base64url");
}

function decodeThreadId(id: string): { mailbox: string; uid: number }[] {
  try {
    const raw = JSON.parse(Buffer.from(id, "base64url").toString()) as [string, number][];
    return raw.map(([mailbox, uid]) => ({ mailbox: String(mailbox), uid: Number(uid) }));
  } catch {
    throw new ProviderError("That is not a thread id from this account.");
  }
}

/** Join messages into threads by Message-ID and In-Reply-To. */
function threadsOf(found: Found[]): Found[][] {
  const byId = new Map<string, Found>();
  for (const message of found) if (message.messageId) byId.set(message.messageId, message);

  const parent = new Map<Found, Found>();
  const root = (message: Found): Found => {
    let current = message;
    while (parent.get(current) && parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  for (const message of found) {
    const replyTo = message.inReplyTo ? byId.get(message.inReplyTo) : undefined;
    if (replyTo && replyTo !== message) {
      const a = root(message);
      const b = root(replyTo);
      if (a !== b) parent.set(a, b);
    }
  }

  const groups = new Map<Found, Found[]>();
  for (const message of found) {
    const key = root(message);
    const bucket = groups.get(key);
    if (bucket) bucket.push(message);
    else groups.set(key, [message]);
  }
  return [...groups.values()].map((group) => group.sort((a, b) => a.date.getTime() - b.date.getTime()));
}

export function imapMailReader(config: ImapConfig): MailReader {
  return {
    async searchThreads(search) {
      const query = criteria(search);
      if (!query) return [];
      const client = await open(config);
      try {
        const boxes = await mailboxes(client);
        const found: Found[] = [];
        for (const path of [boxes.inbox, boxes.sent].filter((p): p is string => Boolean(p))) {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          try {
            const uids = ((await client.search(query, { uid: true })) || []) as number[];
            // Newest first, and a bound: a recruiter domain that matches a
            // year of newsletters must not fetch a year of envelopes.
            const recent = uids.sort((a, b) => b - a).slice(0, 200);
            if (recent.length === 0) continue;
            const messages = await client.fetchAll(
              recent,
              { uid: true, envelope: true, flags: true, internalDate: true },
              { uid: true },
            );
            for (const message of messages) {
              const envelope = message.envelope;
              if (!envelope) continue;
              const date = message.internalDate ? new Date(message.internalDate) : (envelope.date ?? new Date(0));
              found.push({
                mailbox: path,
                uid: message.uid,
                messageId: envelope.messageId ?? "",
                inReplyTo: envelope.inReplyTo ?? "",
                subject: envelope.subject ?? "",
                date: date instanceof Date ? date : new Date(date),
                from: participant(envelope.from?.[0]),
                to: participants(envelope.to),
                cc: participants(envelope.cc),
                unread: !(message.flags?.has("\\Seen") ?? false),
              });
            }
          } finally {
            lock.release();
          }
        }

        return threadsOf(found)
          .map((thread): MailThreadSummary => {
            const first = thread[0];
            const last = thread[thread.length - 1];
            return {
              id: encodeThreadId(thread),
              subject: first.subject || last.subject || "(no subject)",
              snippet: "",
              participants: mergeParticipants(
                thread.flatMap((m) => [m.from ? [m.from] : [], m.to, m.cc]),
              ),
              lastFrom: last.from,
              firstMessageAt: first.date,
              lastMessageAt: last.date,
              messageCount: thread.length,
              unread: thread.some((m) => m.unread),
              url: "",
            };
          })
          .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
          .slice(0, search.limit ?? 20);
      } finally {
        await client.logout().catch(() => undefined);
      }
    },

    async getThread(threadId) {
      const members = decodeThreadId(threadId).slice(0, 20);
      const client = await open(config);
      try {
        const messages: MailMessage[] = [];
        const byMailbox = new Map<string, number[]>();
        for (const member of members) {
          const bucket = byMailbox.get(member.mailbox);
          if (bucket) bucket.push(member.uid);
          else byMailbox.set(member.mailbox, [member.uid]);
        }
        for (const [path, uids] of byMailbox) {
          const lock = await client.getMailboxLock(path, { readOnly: true });
          try {
            for (const uid of uids) {
              const fetched = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
              if (!fetched || !fetched.source) continue;
              const parsed = await simpleParser(fetched.source, { skipImageLinks: true, skipTextLinks: true });
              const from = parsed.from?.value?.[0];
              const addresses = (value: typeof parsed.to) =>
                (Array.isArray(value) ? value : value ? [value] : [])
                  .flatMap((list) => list.value)
                  .map((a) => participant({ name: a.name, address: a.address }))
                  .filter((p): p is MailParticipant => p !== null);
              messages.push({
                id: `${path}:${uid}`,
                from: participant({ name: from?.name, address: from?.address }),
                to: addresses(parsed.to),
                cc: addresses(parsed.cc),
                date: parsed.date ?? new Date(0),
                subject: parsed.subject ?? "",
                body: clip(
                  normalise(parsed.text || (parsed.html ? stripHtml(String(parsed.html)) : "")),
                  6000,
                ),
              });
            }
          } finally {
            lock.release();
          }
        }
        messages.sort((a, b) => a.date.getTime() - b.date.getTime());
        return {
          id: threadId,
          subject: messages[0]?.subject || "(no subject)",
          url: "",
          messages,
        } satisfies MailThread;
      } finally {
        await client.logout().catch(() => undefined);
      }
    },
  };
}
