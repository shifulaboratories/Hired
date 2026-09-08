import type { AccountProvider, LinkedAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  ProviderError,
  type AccountFeature,
  type CalendarEvent,
  type MailThread,
  type MailThreadSummary,
} from "@/lib/accounts/types";
import { domainOf } from "@/lib/accounts/text";
import { refreshAccessToken, revokeToken } from "@/lib/accounts/google";
import { refreshMicrosoftToken } from "@/lib/accounts/microsoft";
import { verifyImap } from "@/lib/accounts/imap";
import { verifyCaldav } from "@/lib/accounts/caldav";
import { assertReachableHost, caldavHost } from "@/lib/accounts/net";
import {
  PROVIDER_LABEL,
  calendarReaderFor,
  mailReaderFor,
  type ReaderCredentials,
} from "@/lib/accounts";

/**
 * A person's own mail and calendar, read live on their behalf, across every
 * account they have connected: Google, Microsoft 365, or anything that
 * speaks IMAP and CalDAV.
 *
 * Like every file here: userId is the first argument of every function and
 * every query filters on it. The credentials that let this instance read an
 * inbox are the most sensitive thing it holds about anyone, and they never
 * leave this file — callers get what the provider said, never the token or
 * password that asked.
 *
 * Nothing a provider returns is written to the database. A thread list or a
 * meeting is fetched when a screen or a tool asks and shown as it came back,
 * so there is no copy of anyone's mail to leak, to go stale, or to be
 * subpoenaed from a server that only ever needed to *look*. The cost is a
 * round trip on every open, which is why the screens load these panels after
 * the page rather than blocking on them.
 *
 * Several accounts merge: a thread list is every account's threads sorted
 * together, and one account failing — a revoked token, a server down — is a
 * warning on the result, never a reason to hide the others.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Domains that say nothing about who somebody works for. Never matched as a company. */
const FREEMAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "hey.com",
  "fastmail.com",
]);

export class AccountNotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountNotConnectedError";
  }
}

const CONNECT_HINT = "Connect one under Settings → Connections in the app.";

// ---------------------------------------------------------------------------
// The accounts
// ---------------------------------------------------------------------------

/** An account without its secrets — safe for a tool result and for the browser. */
export type LinkedAccountView = {
  id: string;
  provider: AccountProvider;
  providerLabel: string;
  email: string;
  label: string;
  mail: boolean;
  calendar: boolean;
  /** For IMAP accounts: where mail and calendar are read from, without the passwords. */
  imapHost: string;
  caldavUrl: string;
  connectedAt: Date;
  lastUsedAt: Date | null;
  /** Non-empty when the last read failed and a reconnect is needed. */
  lastError: string;
  lastErrorAt: Date | null;
};

function toView(row: LinkedAccount): LinkedAccountView {
  return {
    id: row.id,
    provider: row.provider,
    providerLabel: PROVIDER_LABEL[row.provider],
    email: row.email,
    label: row.label,
    mail: row.features.includes("mail"),
    calendar: row.features.includes("calendar"),
    imapHost: row.imapHost,
    caldavUrl: row.caldavUrl,
    connectedAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
  };
}

export async function listLinkedAccounts(userId: string): Promise<LinkedAccountView[]> {
  const rows = await db.linkedAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toView);
}

export type AccountAccess = { mail: boolean; calendar: boolean };

/**
 * What the pages need to know before they draw a card: is there anything to
 * read at all, and which halves. Null when nothing is connected.
 */
export async function accountAccess(userId: string): Promise<AccountAccess | null> {
  const rows = await db.linkedAccount.findMany({ where: { userId }, select: { features: true } });
  if (rows.length === 0) return null;
  return {
    mail: rows.some((row) => row.features.includes("mail")),
    calendar: rows.some((row) => row.features.includes("calendar")),
  };
}

export type OAuthConnectInput = {
  provider: "GOOGLE" | "MICROSOFT";
  email: string;
  externalId: string;
  features: AccountFeature[];
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
};

/**
 * Store what a consent screen handed back. One row per provider and
 * address: connecting the same account again replaces its tokens, which is
 * how a person recovers from a revoked one.
 */
export async function connectOAuthAccount(userId: string, input: OAuthConnectInput) {
  if (input.features.length === 0) throw new Error("Neither mail nor calendar was granted.");
  if (!input.refreshToken) throw new Error("The provider did not return a refresh token.");
  const email = input.email.trim().toLowerCase();

  const previous = await db.linkedAccount.findUnique({
    where: { userId_provider_email: { userId, provider: input.provider, email } },
  });
  if (previous && previous.provider === "GOOGLE" && previous.refreshToken !== input.refreshToken) {
    await revokeToken(previous.refreshToken);
  }

  const data = {
    externalId: input.externalId,
    features: input.features,
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.expiresAt,
    lastError: "",
    lastErrorAt: null,
  };
  const row = await db.linkedAccount.upsert({
    where: { userId_provider_email: { userId, provider: input.provider, email } },
    create: { userId, provider: input.provider, email, ...data },
    update: data,
  });
  return toView(row);
}

export type ImapConnectInput = {
  email: string;
  label?: string;
  imapHost?: string;
  imapPort?: number;
  imapUsername?: string;
  imapPassword?: string;
  caldavUrl?: string;
  caldavUsername?: string;
  caldavPassword?: string;
};

/**
 * Connect a mailbox by IMAP and a calendar by CalDAV. Either half may be
 * left out. Both are tried before anything is saved, so a wrong app password
 * is an error now rather than a broken tile later. Connecting the same
 * address again replaces what was stored.
 */
export async function connectImapAccount(userId: string, input: ImapConnectInput) {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Give the address of the mailbox.");

  const imapHost = (input.imapHost ?? "").trim();
  const caldavUrl = (input.caldavUrl ?? "").trim();
  if (!imapHost && !caldavUrl) throw new Error("Give an IMAP server, a CalDAV URL, or both.");

  const imapUsername = (input.imapUsername ?? "").trim() || email;
  const imapPassword = input.imapPassword ?? "";
  const imapPort = input.imapPort && input.imapPort > 0 ? Math.round(input.imapPort) : 993;
  const caldavUsername = (input.caldavUsername ?? "").trim() || imapUsername;
  const caldavPassword = input.caldavPassword || imapPassword;

  const features: AccountFeature[] = [];
  if (imapHost) {
    if (!imapPassword) throw new Error("The IMAP server needs a password — an app password, not the account one.");
    await assertReachableHost(imapHost);
    await verifyImap({ host: imapHost, port: imapPort, username: imapUsername, password: imapPassword, accountEmail: email });
    features.push("mail");
  }
  if (caldavUrl) {
    if (!caldavPassword) throw new Error("The CalDAV server needs a password — an app password, not the account one.");
    await assertReachableHost(caldavHost(caldavUrl));
    await verifyCaldav({ url: caldavUrl, username: caldavUsername, password: caldavPassword });
    features.push("calendar");
  }

  const data = {
    label: (input.label ?? "").trim().slice(0, 60),
    features,
    imapHost,
    imapPort,
    imapUsername: imapHost ? imapUsername : "",
    imapPassword: imapHost ? imapPassword : "",
    caldavUrl,
    caldavUsername: caldavUrl ? caldavUsername : "",
    caldavPassword: caldavUrl ? caldavPassword : "",
    lastError: "",
    lastErrorAt: null,
  };
  const row = await db.linkedAccount.upsert({
    where: { userId_provider_email: { userId, provider: "IMAP", email } },
    create: { userId, provider: "IMAP", email, ...data },
    update: data,
  });
  return toView(row);
}

export async function renameLinkedAccount(userId: string, accountId: string, label: string) {
  const row = await db.linkedAccount.findFirst({ where: { id: accountId, userId } });
  if (!row) throw new Error(`No connected account with id ${accountId}`);
  return toView(
    await db.linkedAccount.update({ where: { id: row.id }, data: { label: label.trim().slice(0, 60) } }),
  );
}

/** Revoke where the provider allows it, and forget everything. */
export async function disconnectAccount(userId: string, accountId: string): Promise<{ ok: true }> {
  const row = await db.linkedAccount.findFirst({ where: { id: accountId, userId } });
  if (!row) return { ok: true };
  if (row.provider === "GOOGLE") await revokeToken(row.refreshToken);
  await db.linkedAccount.delete({ where: { id: row.id } });
  return { ok: true };
}

export type AccountTest = {
  account: LinkedAccountView;
  mail: { ok: boolean; detail: string } | null;
  calendar: { ok: boolean; detail: string } | null;
};

/** Read one thing from each half, and say whether it answered. */
export async function testAccount(userId: string, accountId: string): Promise<AccountTest> {
  const row = await db.linkedAccount.findFirst({ where: { id: accountId, userId } });
  if (!row) throw new Error(`No connected account with id ${accountId}`);

  const result: AccountTest = { account: toView(row), mail: null, calendar: null };
  let credentials: ReaderCredentials;
  try {
    credentials = await credentialsFor(row);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (row.features.includes("mail")) result.mail = { ok: false, detail };
    if (row.features.includes("calendar")) result.calendar = { ok: false, detail };
    return result;
  }

  const mail = mailReaderFor(credentials);
  if (mail) {
    try {
      const threads = await mail.searchThreads({ newerThanDays: 30, limit: 1 });
      result.mail = { ok: true, detail: threads.length ? "Answered with recent mail." : "Answered, nothing in the last 30 days." };
    } catch (error) {
      result.mail = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  const calendar = calendarReaderFor(credentials);
  if (calendar) {
    try {
      const now = Date.now();
      const events = await calendar.listEvents({ from: new Date(now - 7 * DAY), to: new Date(now + 7 * DAY), limit: 1 });
      result.calendar = { ok: true, detail: events.length ? "Answered with events this fortnight." : "Answered, nothing in the fortnight around today." };
    } catch (error) {
      result.calendar = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  const failed = [result.mail, result.calendar].find((half) => half && !half.ok);
  await db.linkedAccount.update({
    where: { id: row.id },
    data: failed
      ? { lastError: failed.detail.slice(0, 500), lastErrorAt: new Date() }
      : { lastError: "", lastErrorAt: null, lastUsedAt: new Date() },
  });
  result.account = toView(await db.linkedAccount.findUniqueOrThrow({ where: { id: row.id } }));
  return result;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function describe(row: LinkedAccount) {
  return `${PROVIDER_LABEL[row.provider]} account ${row.email}`;
}

/**
 * Everything a reader needs, with a live access token for the OAuth
 * providers — refreshed when the stored one is within a minute of expiring,
 * and the refreshed one written back. Every failure is a sentence the person
 * can act on, because "401" on a contact page is not.
 */
async function credentialsFor(row: LinkedAccount): Promise<ReaderCredentials> {
  const base: ReaderCredentials = {
    provider: row.provider,
    email: row.email,
    features: row.features,
    accessToken: row.accessToken,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapUsername: row.imapUsername,
    imapPassword: row.imapPassword,
    caldavUrl: row.caldavUrl,
    caldavUsername: row.caldavUsername,
    caldavPassword: row.caldavPassword,
  };
  if (row.provider === "IMAP") return base;

  const fresh =
    row.accessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - Date.now() > 60_000;
  if (fresh) return base;

  const settings = await getSettings();
  try {
    if (row.provider === "GOOGLE") {
      const refreshed = await refreshAccessToken(settings, row.refreshToken);
      await db.linkedAccount.update({
        where: { id: row.id },
        data: {
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: refreshed.expiresAt,
          lastError: "",
          lastErrorAt: null,
        },
      });
      return { ...base, accessToken: refreshed.accessToken };
    }
    const refreshed = await refreshMicrosoftToken({
      clientId: settings.microsoftClientId,
      clientSecret: settings.microsoftClientSecret,
      refreshToken: row.refreshToken,
    });
    await db.linkedAccount.update({
      where: { id: row.id },
      data: {
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: refreshed.expiresAt,
        // Microsoft rotates refresh tokens; keep the newest one.
        ...(refreshed.refreshToken ? { refreshToken: refreshed.refreshToken } : {}),
        lastError: "",
        lastErrorAt: null,
      },
    });
    return { ...base, accessToken: refreshed.accessToken };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.linkedAccount.update({
      where: { id: row.id },
      data: { lastError: message.slice(0, 500), lastErrorAt: new Date() },
    });
    if (error instanceof ProviderError && error.revoked) {
      throw new AccountNotConnectedError(
        `${PROVIDER_LABEL[row.provider]} has revoked access to ${row.email} — usually because access was removed from the account, or the instance's app registration changed. Reconnect it under Settings → Connections.`,
      );
    }
    throw error;
  }
}

async function touch(accountIds: string[]) {
  if (accountIds.length === 0) return;
  await db.linkedAccount
    .updateMany({ where: { id: { in: accountIds } }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

/** A row's credentials plus its public view, for one kind of reading. */
type Prepared = { row: LinkedAccount; view: LinkedAccountView; credentials: ReaderCredentials };

/** Every account that provides a feature, credentials resolved, failures collected rather than thrown. */
async function prepare(
  userId: string,
  feature: AccountFeature,
  accountId?: string,
): Promise<{ ready: Prepared[]; warnings: string[] }> {
  const rows = await db.linkedAccount.findMany({
    where: { userId, ...(accountId ? { id: accountId } : {}), features: { has: feature } },
    orderBy: { createdAt: "asc" },
  });
  const ready: Prepared[] = [];
  const warnings: string[] = [];
  for (const row of rows) {
    try {
      ready.push({ row, view: toView(row), credentials: await credentialsFor(row) });
    } catch (error) {
      warnings.push(`${describe(row)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ready, warnings };
}

/** Which account a thread or event came from, on every merged result. */
export type AccountRef = { id: string; provider: AccountProvider; email: string };

function ref(view: LinkedAccountView): AccountRef {
  return { id: view.id, provider: view.provider, email: view.email };
}

/** Thread ids travel as `<accountId>.<providerThreadId>` so a read routes back to the right inbox. */
function scopedId(accountId: string, threadId: string) {
  return `${accountId}.${threadId}`;
}

function unscope(id: string): { accountId: string; threadId: string } {
  const dot = id.indexOf(".");
  if (dot <= 0) throw new Error("That thread id did not come from list_correspondence or search_email.");
  return { accountId: id.slice(0, dot), threadId: id.slice(dot + 1) };
}

export type AccountThread = MailThreadSummary & { account: AccountRef };
export type AccountEvent = CalendarEvent & { account: AccountRef };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type MailResult = { threads: AccountThread[]; warnings: string[] };
export type CalendarResult = { events: AccountEvent[]; warnings: string[] };

/** Free text across every mailbox, or one. Gmail's own operators pass through on a Gmail account. */
export async function searchEmail(
  userId: string,
  options: { query: string; limit?: number; accountId?: string },
): Promise<MailResult> {
  const query = options.query.trim();
  if (!query) throw new Error("Say what to search for.");
  const { ready, warnings } = await prepare(userId, "mail", options.accountId);
  if (ready.length === 0 && warnings.length === 0) {
    throw new AccountNotConnectedError(`No mailbox is connected. ${CONNECT_HINT}`);
  }
  const limit = options.limit ?? 20;
  const results = await Promise.all(
    ready.map(async (account) => {
      try {
        const reader = mailReaderFor(account.credentials)!;
        const threads = await reader.searchThreads({ text: query, limit });
        return threads.map((thread) => ({ ...thread, id: scopedId(account.view.id, thread.id), account: ref(account.view) }));
      } catch (error) {
        warnings.push(`${describe(account.row)}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }),
  );
  await touch(ready.map((account) => account.row.id));
  return {
    threads: results.flat().sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()).slice(0, limit),
    warnings,
  };
}

export async function getEmailThread(userId: string, id: string): Promise<MailThread & { account: AccountRef }> {
  const { accountId, threadId } = unscope(id);
  const row = await db.linkedAccount.findFirst({ where: { id: accountId, userId } });
  if (!row) throw new AccountNotConnectedError("The account that thread came from is no longer connected.");
  const reader = mailReaderFor(await credentialsFor(row));
  if (!reader) throw new AccountNotConnectedError(`${describe(row)} no longer provides mail.`);
  const thread = await reader.getThread(threadId);
  await touch([row.id]);
  return { ...thread, id, account: ref(toView(row)) };
}

export async function searchCalendar(
  userId: string,
  options: { query?: string; from?: Date; to?: Date; limit?: number; accountId?: string },
): Promise<CalendarResult> {
  const { ready, warnings } = await prepare(userId, "calendar", options.accountId);
  if (ready.length === 0 && warnings.length === 0) {
    throw new AccountNotConnectedError(`No calendar is connected. ${CONNECT_HINT}`);
  }
  const now = Date.now();
  const window = {
    from: options.from ?? new Date(now - 30 * DAY),
    to: options.to ?? new Date(now + 60 * DAY),
    query: options.query?.trim() || undefined,
    limit: options.limit ?? 100,
  };
  const results = await Promise.all(
    ready.map(async (account) => {
      try {
        const reader = calendarReaderFor(account.credentials)!;
        const events = await reader.listEvents(window);
        return events.map((event) => ({ ...event, account: ref(account.view) }));
      } catch (error) {
        warnings.push(`${describe(account.row)}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }),
  );
  await touch(ready.map((account) => account.row.id));
  return {
    events: results.flat().sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, window.limit),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Matching the pipeline
// ---------------------------------------------------------------------------

/** What a thread or an event is matched on: exact addresses, and company domains. */
export type MatchTerms = { addresses: string[]; domains: string[] };

/** "https://www.acme.com/careers" → "acme.com". Empty for nothing usable. */
export function domainOfWebsite(website: string): string {
  const raw = website.trim().toLowerCase();
  if (!raw) return "";
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    if (!host.includes(".") || FREEMAIL.has(host)) return "";
    return host;
  } catch {
    return "";
  }
}

function cleanEmail(value: string): string {
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Whether an event has anyone matching on it, the account holder aside. */
export function eventMatches(event: CalendarEvent, terms: MatchTerms): boolean {
  const addresses = new Set(terms.addresses);
  const domains = new Set(terms.domains);
  const people = [...event.attendees, ...(event.organizer ? [event.organizer] : [])];
  return people.some((person) => addresses.has(person.email) || domains.has(domainOf(person.email)));
}

export type CorrespondenceSubject =
  | { kind: "contact"; id: string }
  | { kind: "company"; id: string }
  | { kind: "application"; id: string }
  | { kind: "resume"; id: string };

export type Correspondence = {
  subject: CorrespondenceSubject & { name: string };
  terms: MatchTerms;
  /** Why the lists may be short, in sentences: no email on the contact, no website on the company. */
  notes: string[];
  mail: AccountThread[] | null;
  calendar: AccountEvent[] | null;
  /** Why a half is null or an account is missing: not granted, or a provider refused. */
  warnings: string[];
};

/**
 * What the pipeline knows to look for, for one record.
 *
 * A contact is their address. A company is its domain and everyone on file
 * there. An application is its company's domain and the people attached to
 * it — not everyone at the company, because a second application at the same
 * employer has its own recruiter. A resume is every application it was sent
 * with.
 */
async function termsFor(
  userId: string,
  subject: CorrespondenceSubject,
): Promise<{ name: string; terms: MatchTerms; notes: string[] }> {
  const notes: string[] = [];

  if (subject.kind === "contact") {
    const contact = await db.contact.findFirst({
      where: { id: subject.id, userId, archivedAt: null },
      select: { name: true, email: true },
    });
    if (!contact) throw new Error(`No contact with id ${subject.id}`);
    const email = cleanEmail(contact.email);
    if (!email) notes.push(`${contact.name} has no email address on file, so there is nothing to match their mail or meetings on.`);
    return { name: contact.name, terms: { addresses: unique([email]), domains: [] }, notes };
  }

  if (subject.kind === "company") {
    const company = await db.company.findFirst({
      where: { id: subject.id, userId, archivedAt: null },
      select: {
        name: true,
        website: true,
        // Through the join to the person: an archived contact's address must
        // not widen what this company matches on.
        contacts: {
          where: { contact: { archivedAt: null } },
          select: { contact: { select: { email: true } } },
        },
      },
    });
    if (!company) throw new Error(`No company with id ${subject.id}`);
    const domain = domainOfWebsite(company.website);
    const addresses = unique(company.contacts.map((link) => cleanEmail(link.contact.email)));
    if (!domain) {
      notes.push(
        `${company.name} has no website on file. Set it and everything from that domain will match, not only the people you have added.`,
      );
    }
    return { name: company.name, terms: { addresses, domains: unique([domain]) }, notes };
  }

  if (subject.kind === "application") {
    const application = await db.application.findFirst({
      where: { id: subject.id, userId, archivedAt: null },
      select: {
        roleTitle: true,
        company: { select: { name: true, website: true } },
        contacts: { where: { archivedAt: null }, select: { email: true } },
      },
    });
    if (!application) throw new Error(`No application with id ${subject.id}`);
    const domain = domainOfWebsite(application.company.website);
    const addresses = unique(application.contacts.map((contact) => cleanEmail(contact.email)));
    if (!domain) {
      notes.push(
        `${application.company.name} has no website on file, so only the people attached to this application can be matched.`,
      );
    }
    if (addresses.length === 0 && !domain) {
      notes.push("Add the recruiter or hiring manager as a contact with their email, and their threads will appear here.");
    }
    return {
      name: `${application.company.name} — ${application.roleTitle}`,
      terms: { addresses, domains: unique([domain]) },
      notes,
    };
  }

  const resume = await db.resume.findFirst({
    where: { id: subject.id, userId },
    select: {
      name: true,
      applications: {
        where: { archivedAt: null },
        select: {
          company: { select: { website: true } },
          contacts: { where: { archivedAt: null }, select: { email: true } },
        },
      },
    },
  });
  if (!resume) throw new Error(`No resume with id ${subject.id}`);
  if (resume.applications.length === 0) {
    notes.push("This resume is not attached to any application yet, so there is nothing to match on.");
  }
  return {
    name: resume.name,
    terms: {
      addresses: unique(resume.applications.flatMap((a) => a.contacts.map((c) => cleanEmail(c.email)))),
      domains: unique(resume.applications.map((a) => domainOfWebsite(a.company.website))),
    },
    notes,
  };
}

/**
 * Every thread and meeting across the person's accounts that touches one
 * record on the pipeline. Each half, and each account within it, fails
 * independently — a calendar that was never granted must not hide the mail —
 * and says why in `warnings`.
 */
export async function listCorrespondence(
  userId: string,
  subject: CorrespondenceSubject,
  options: { limit?: number; days?: number } = {},
): Promise<Correspondence> {
  const { name, terms, notes } = await termsFor(userId, subject);
  const empty = terms.addresses.length === 0 && terms.domains.length === 0;
  const days = options.days ?? 365;
  const limit = options.limit ?? 20;

  const [mailSide, calendarSide] = await Promise.all([
    (async (): Promise<{ threads: AccountThread[] | null; warnings: string[] }> => {
      if (empty) return { threads: [], warnings: [] };
      const { ready, warnings } = await prepare(userId, "mail");
      if (ready.length === 0) return { threads: warnings.length ? null : [], warnings };
      const results = await Promise.all(
        ready.map(async (account) => {
          try {
            const reader = mailReaderFor(account.credentials)!;
            const threads = await reader.searchThreads({ ...terms, newerThanDays: days, limit });
            return threads.map((thread) => ({ ...thread, id: scopedId(account.view.id, thread.id), account: ref(account.view) }));
          } catch (error) {
            warnings.push(`${describe(account.row)}: ${error instanceof Error ? error.message : String(error)}`);
            return [];
          }
        }),
      );
      await touch(ready.map((account) => account.row.id));
      return {
        threads: results.flat().sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime()).slice(0, limit),
        warnings,
      };
    })(),
    (async (): Promise<{ events: AccountEvent[] | null; warnings: string[] }> => {
      if (empty) return { events: [], warnings: [] };
      const { ready, warnings } = await prepare(userId, "calendar");
      if (ready.length === 0) return { events: warnings.length ? null : [], warnings };
      const now = Date.now();
      const window = { from: new Date(now - days * DAY), to: new Date(now + 120 * DAY), limit: 500 };
      const results = await Promise.all(
        ready.map(async (account) => {
          try {
            const reader = calendarReaderFor(account.credentials)!;
            const events = await reader.listEvents(window);
            return events
              .filter((event) => eventMatches(event, terms))
              .map((event) => ({ ...event, account: ref(account.view) }));
          } catch (error) {
            warnings.push(`${describe(account.row)}: ${error instanceof Error ? error.message : String(error)}`);
            return [];
          }
        }),
      );
      await touch(ready.map((account) => account.row.id));
      return {
        events: results.flat().sort((a, b) => b.start.getTime() - a.start.getTime()),
        warnings,
      };
    })(),
  ]);

  return {
    subject: { ...subject, name },
    terms,
    notes,
    mail: mailSide.threads,
    calendar: calendarSide.events,
    warnings: [
      ...mailSide.warnings.map((w) => `Mail: ${w}`),
      ...calendarSide.warnings.map((w) => `Calendar: ${w}`),
    ],
  };
}

// ---------------------------------------------------------------------------
// The calendar, matched against everything
// ---------------------------------------------------------------------------

export type MatchedEvent = AccountEvent & {
  /** The first record the event was matched to, for a link. */
  applicationId: string | null;
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
};

/**
 * Calendar events in a window, across every connected calendar, that
 * involve anyone on the pipeline: an attendee at a tracked company's domain,
 * or a contact's own address. One request per account, matched here.
 * Returns nothing rather than throwing when nothing is connected — this
 * feeds the calendar view and list_schedule, where an interview a person has
 * not connected yet is not an error.
 */
export async function listMatchedEvents(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ events: MatchedEvent[]; warning: string | null }> {
  const { ready, warnings } = await prepare(userId, "calendar");
  if (ready.length === 0) return { events: [], warning: warnings[0] ?? null };

  const [companies, contacts] = await Promise.all([
    db.company.findMany({
      where: { userId, archivedAt: null },
      select: {
        id: true,
        name: true,
        website: true,
        applications: {
          where: { closedAt: null, archivedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    }),
    db.contact.findMany({
      where: { userId, email: { not: "" }, archivedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        applicationId: true,
        companies: {
          where: { company: { archivedAt: null } },
          take: 1,
          select: { company: { select: { id: true, name: true } } },
        },
      },
    }),
  ]);

  const byDomain = new Map<string, (typeof companies)[number]>();
  for (const company of companies) {
    const domain = domainOfWebsite(company.website);
    if (domain && !byDomain.has(domain)) byDomain.set(domain, company);
  }
  const byAddress = new Map<string, (typeof contacts)[number]>();
  for (const contact of contacts) {
    const email = cleanEmail(contact.email);
    if (email && !byAddress.has(email)) byAddress.set(email, contact);
  }
  if (byDomain.size === 0 && byAddress.size === 0) return { events: [], warning: null };

  const results = await Promise.all(
    ready.map(async (account) => {
      try {
        const reader = calendarReaderFor(account.credentials)!;
        const events = await reader.listEvents({ from, to, limit: 500 });
        return events.map((event) => ({ ...event, account: ref(account.view) }));
      } catch (error) {
        warnings.push(`${describe(account.row)}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }),
  );

  const matched: MatchedEvent[] = [];
  const seen = new Set<string>();
  for (const event of results.flat()) {
    const people = [...event.attendees, ...(event.organizer ? [event.organizer] : [])];
    const contact = people.map((person) => byAddress.get(person.email)).find(Boolean);
    const company = people.map((person) => byDomain.get(domainOf(person.email))).find(Boolean);
    if (!contact && !company) continue;
    // The same interview on a work and a personal calendar is one interview.
    const key = `${event.title}@${event.start.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const linkedCompany = company ?? contact?.companies[0]?.company ?? null;
    matched.push({
      ...event,
      applicationId: contact?.applicationId ?? company?.applications[0]?.id ?? null,
      companyId: linkedCompany?.id ?? null,
      companyName: linkedCompany?.name ?? null,
      contactId: contact?.id ?? null,
      contactName: contact?.name ?? null,
    });
  }
  await touch(ready.map((account) => account.row.id));
  return { events: matched.sort((a, b) => a.start.getTime() - b.start.getTime()), warning: warnings[0] ?? null };
}
