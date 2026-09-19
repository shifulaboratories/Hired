import type { AccountProvider, OutboundStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { timeZoneOf } from "@/lib/data/me";
import { civilDay, civilInstant } from "@/lib/time";
import * as pipeline from "@/lib/data/pipeline";
import { recordSystemEvent } from "@/lib/data/system";
import { sendViaGoogle, sendViaMicrosoft, type SendOutcome } from "@/lib/accounts/send";
import { accessTokenFor } from "@/lib/data/accounts";
import type { WriteAuthor } from "@/lib/data/revision-store";

/**
 * The one message this app will let out of the building.
 *
 * Two emails have always gone to the account holder and nothing else has ever
 * left. This reverses that for exactly one case — a follow-up to somebody
 * already in the CRM — and the design is mostly the things it will not do:
 *
 * - IT SENDS FROM THE PERSON'S OWN MAILBOX, never as the instance. A follow-up
 *   to a recruiter that arrives from hired@ is worse than no follow-up.
 * - IT CAN ONLY ADDRESS A CONTACT ALREADY ON FILE, by id. The address is read
 *   off the Contact row and there is no argument anywhere that takes one, so an
 *   assistant cannot reach anybody the person has not already written down.
 * - IT DRAFTS FIRST, ALWAYS, and out of the box a draft waits for a click in
 *   the app that NO TOOL CAN MAKE. `approveOutbound` is reachable from a server
 *   action and from nothing else.
 * - IT IS OFF until the person turns it on, and turning it on is also setting a
 *   daily number, because there is no state where sending is on and the cap is
 *   undefined.
 *
 * The sixth ProposalKind was the obvious home for the confirmation and it is
 * wrong: accept_proposal is an MCP tool, so a model could queue a proposal and
 * approve it in the next call. The review queue's own header says to read it
 * before adding a kind; this is what reading it says.
 */

export type OutboundSettings = {
  /** Instance-level. False means nothing anyone sets matters. */
  instanceEnabled: boolean;
  dailyLimit: number;
  approval: "each" | "trusted";
  /** Mailboxes that can actually send: Google or Microsoft, with the scope. */
  accounts: { id: string; email: string; provider: AccountProvider; label: string }[];
  sentToday: number;
  remainingToday: number;
  /** Seconds until the next send is allowed, from the one-a-minute floor. */
  cooldownSeconds: number;
  /** Why sending would refuse right now, in one line. Empty when it would work. */
  blockedBecause: string;
};

export type OutboundRow = {
  id: string;
  status: OutboundStatus;
  subject: string;
  body: string;
  toEmail: string;
  contact: { id: string; name: string } | null;
  application: { id: string; roleTitle: string; company: string } | null;
  letterId: string | null;
  account: { id: string; email: string; provider: AccountProvider } | null;
  error: string;
  providerMessageId: string;
  draftedByName: string;
  sentByName: string;
  approvedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
};

export type DraftInput = {
  contactId: string;
  subject: string;
  body: string;
  accountId?: string;
  applicationId?: string;
  letterId?: string;
};

/** A burst is the shape of a runaway loop. Two a minute is not a person. */
const FLOOR_MS = 60_000;
/** Nobody's follow-up needs more than this, and it bounds a mistake. */
const MAX_DAILY_LIMIT = 50;

const rowInclude = {
  contact: { select: { id: true, name: true } },
  application: { select: { id: true, roleTitle: true, company: { select: { name: true } } } },
  account: { select: { id: true, email: true, provider: true } },
} as const;

type Raw = {
  id: string;
  status: OutboundStatus;
  subject: string;
  body: string;
  toEmail: string;
  letterId: string | null;
  error: string;
  providerMessageId: string;
  draftedByName: string;
  sentByName: string;
  approvedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  contact: { id: string; name: string } | null;
  application: { id: string; roleTitle: string; company: { name: string } } | null;
  account: { id: string; email: string; provider: AccountProvider } | null;
};

function toRow(row: Raw): OutboundRow {
  return {
    id: row.id,
    status: row.status,
    subject: row.subject,
    body: row.body,
    toEmail: row.toEmail,
    contact: row.contact,
    application: row.application
      ? {
          id: row.application.id,
          roleTitle: row.application.roleTitle,
          company: row.application.company.name,
        }
      : null,
    letterId: row.letterId,
    account: row.account,
    error: row.error,
    providerMessageId: row.providerMessageId,
    draftedByName: row.draftedByName,
    sentByName: row.sentByName,
    approvedAt: row.approvedAt,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

/** Mailboxes that can actually send — the OAuth two, with the send grant. */
async function sendingAccounts(userId: string) {
  const rows = await db.linkedAccount.findMany({
    where: { userId, provider: { in: ["GOOGLE", "MICROSOFT"] }, features: { has: "send" } },
    select: { id: true, email: true, provider: true, label: true },
    orderBy: { createdAt: "asc" },
  });
  return rows;
}

/**
 * The start of today where THEY are, in the stored zone verbatim.
 *
 * No `|| "UTC"` fallback: the decision log records that exact expression
 * costing the digest eight wrong hours a day. An empty zone means the app has
 * not been told, and civilInstant answers that the same way everything else
 * here does.
 */
async function startOfTheirDay(userId: string, now: Date): Promise<Date> {
  const zone = await timeZoneOf(userId);
  return civilInstant(zone, civilDay(now, zone)) ?? new Date(now.getTime() - 86_400_000);
}

export async function getOutboundSettings(
  userId: string,
  now = new Date(),
): Promise<OutboundSettings> {
  const [instance, profile, accounts] = await Promise.all([
    getSettings(),
    db.profile.findUnique({
      where: { userId },
      select: { outboundDailyLimit: true, outboundApproval: true },
    }),
    sendingAccounts(userId),
  ]);

  const dailyLimit = profile?.outboundDailyLimit ?? 0;
  const approval = profile?.outboundApproval === "trusted" ? "trusted" : "each";
  const dayStart = await startOfTheirDay(userId, now);

  const [sentToday, newest] = await Promise.all([
    db.outbound.count({ where: { userId, status: "SENT", sentAt: { gte: dayStart } } }),
    db.outbound.findFirst({
      where: { userId, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
  ]);

  const sinceLast = newest?.sentAt ? now.getTime() - newest.sentAt.getTime() : Number.MAX_SAFE_INTEGER;
  const cooldownSeconds = sinceLast < FLOOR_MS ? Math.ceil((FLOOR_MS - sinceLast) / 1000) : 0;

  const blockedBecause = !instance.outboundEnabled
    ? "This instance does not let members send mail. An admin turns it on under Admin → Configuration → Email."
    : dailyLimit === 0
      ? "Sending is off for this workspace. Turn it on under Settings → Account, where you also set how many a day."
      : accounts.length === 0
        ? "No mailbox here can send. Reconnect a Google or Microsoft account and grant the send permission — an IMAP account cannot send at all."
        : sentToday >= dailyLimit
          ? `That is ${sentToday} of ${dailyLimit} sent today. The rest wait until tomorrow.`
          : cooldownSeconds > 0
            ? `One a minute — ${cooldownSeconds}s to go.`
            : "";

  return {
    instanceEnabled: instance.outboundEnabled,
    dailyLimit,
    approval,
    accounts,
    sentToday,
    remainingToday: Math.max(0, dailyLimit - sentToday),
    cooldownSeconds,
    blockedBecause,
  };
}

/**
 * Set by the person, in the app, and by nothing else.
 *
 * No admin can set it and no MCP tool can, which is the point: the number is
 * both the switch and the ceiling.
 */
export async function setOutboundSettings(
  userId: string,
  patch: { dailyLimit?: number; approval?: "each" | "trusted" },
): Promise<OutboundSettings> {
  if (patch.dailyLimit !== undefined) {
    if (!Number.isInteger(patch.dailyLimit) || patch.dailyLimit < 0) {
      throw new Error("A daily limit is a whole number of messages, and cannot be negative.");
    }
    if (patch.dailyLimit > MAX_DAILY_LIMIT) {
      throw new Error(
        `${patch.dailyLimit} a day is not a follow-up habit, it is a mailing list. The most this takes is ${MAX_DAILY_LIMIT}.`,
      );
    }
  }
  await db.profile.upsert({
    where: { userId },
    create: {
      userId,
      outboundDailyLimit: patch.dailyLimit ?? 0,
      outboundApproval: patch.approval ?? "each",
    },
    update: {
      ...(patch.dailyLimit !== undefined ? { outboundDailyLimit: patch.dailyLimit } : {}),
      ...(patch.approval !== undefined ? { outboundApproval: patch.approval } : {}),
    },
  });
  return getOutboundSettings(userId);
}

export async function draftOutbound(
  userId: string,
  input: DraftInput,
  author?: WriteAuthor,
): Promise<{ outbound: OutboundRow; settings: OutboundSettings; needsApproval: boolean }> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) throw new Error("A message needs a subject.");
  if (!body) throw new Error("A message needs something in it.");

  // ARCHIVE FILTER 1 of 3: the address is read off a LIVE contact, and there is
  // no argument anywhere in this file that takes an address instead.
  const contact = await db.contact.findFirst({
    where: { id: input.contactId, userId, archivedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (!contact) throw new Error("No live person with that id.");
  if (!contact.email.trim()) {
    throw new Error(
      `${contact.name} has no email address on file, so there is nowhere to send this. Add one with update_contact first.`,
    );
  }

  const settings = await getOutboundSettings(userId);
  const accountId = input.accountId ?? settings.accounts[0]?.id;
  if (!accountId) {
    throw new Error(
      "No mailbox here can send. Reconnect a Google or Microsoft account and grant the send permission — an IMAP account cannot send at all.",
    );
  }
  if (!settings.accounts.some((account) => account.id === accountId)) {
    throw new Error("That account cannot send. Reconnect it and grant the send permission.");
  }

  if (input.applicationId) {
    // ARCHIVE FILTER 2 of 3.
    const application = await db.application.findFirst({
      where: { id: input.applicationId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!application) throw new Error("No live application with that id.");
  }
  if (input.letterId) {
    const letter = await db.letter.findFirst({
      where: { id: input.letterId, userId },
      select: { id: true },
    });
    if (!letter) throw new Error("No letter with that id.");
  }

  const created = await db.outbound.create({
    data: {
      userId,
      accountId,
      contactId: contact.id,
      // The address as it stands NOW, so a later edit to the contact cannot
      // silently redirect an approved message.
      toEmail: contact.email.trim(),
      subject,
      body,
      applicationId: input.applicationId ?? null,
      letterId: input.letterId ?? null,
      draftedBy: author?.connectionId ?? "",
      draftedByName: author?.connectionName ?? "",
    },
    include: rowInclude,
  });

  return {
    outbound: toRow(created as Raw),
    settings,
    needsApproval: settings.approval === "each",
  };
}

export async function listOutbound(
  userId: string,
  options?: {
    status?: OutboundStatus;
    applicationId?: string;
    contactId?: string;
    limit?: number;
  },
): Promise<OutboundRow[]> {
  const rows = await db.outbound.findMany({
    where: {
      userId,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
      ...(options?.contactId ? { contactId: options.contactId } : {}),
    },
    include: rowInclude,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options?.limit ?? 50, 1), 200),
  });
  return rows.map((row) => toRow(row as Raw));
}

/**
 * The app's button, and the ONLY way a row becomes APPROVED.
 *
 * Not exported through any MCP tool, deliberately and permanently. If this ever
 * grows one, the "each" mode stops meaning anything.
 */
export async function approveOutbound(userId: string, id: string): Promise<OutboundRow> {
  const { count } = await db.outbound.updateMany({
    where: { id, userId, status: "DRAFT" },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  if (count === 0) throw new Error("No draft with that id waiting to be approved.");
  const row = await db.outbound.findFirstOrThrow({ where: { id, userId }, include: rowInclude });
  return toRow(row as Raw);
}

export async function cancelOutbound(userId: string, id: string): Promise<OutboundRow> {
  const { count } = await db.outbound.updateMany({
    where: { id, userId, status: { in: ["DRAFT", "APPROVED", "FAILED"] } },
    data: { status: "CANCELLED" },
  });
  if (count === 0) throw new Error("No message with that id that could still be cancelled.");
  const row = await db.outbound.findFirstOrThrow({ where: { id, userId }, include: rowInclude });
  return toRow(row as Raw);
}

/**
 * Send one. Every refusal in this app lives here, in this order.
 *
 * Refusals come back as a sentence rather than as a throw wherever a person
 * could act on them: "waiting for you to approve it" is something to say, not
 * something that went wrong.
 */
export async function sendOutbound(
  userId: string,
  id: string,
  author?: WriteAuthor,
  now = new Date(),
): Promise<{ sent: boolean; outbound: OutboundRow | null; reason: string }> {
  const settings = await getOutboundSettings(userId, now);

  // 1 and 2 and 3 and 5 and 6 are all in blockedBecause, computed once.
  if (settings.blockedBecause) {
    const row = await db.outbound.findFirst({ where: { id, userId }, include: rowInclude });
    return { sent: false, outbound: row ? toRow(row as Raw) : null, reason: settings.blockedBecause };
  }

  // ARCHIVE FILTER 3 of 3: a message to somebody in the bin, or about a job in
  // the bin, does not go.
  const draft = await db.outbound.findFirst({
    where: {
      id,
      userId,
      status: { in: ["DRAFT", "APPROVED"] },
      contact: { archivedAt: null },
      OR: [{ applicationId: null }, { application: { archivedAt: null } }],
    },
    include: rowInclude,
  });
  if (!draft) {
    return {
      sent: false,
      outbound: null,
      reason:
        "No message with that id is waiting to go. It may already be sent or cancelled, or the person or the job it is about may be in the archive.",
    };
  }

  // 4. The gate a model cannot satisfy.
  if (settings.approval === "each" && draft.status !== "APPROVED") {
    return {
      sent: false,
      outbound: toRow(draft as Raw),
      reason:
        "Waiting for them to approve it — it is on their dashboard. No tool can make that click, which is what \"approve each one\" means. They can change it to \"trusted\" under Settings → Account if they would rather you sent within the daily limit.",
    };
  }

  // 7. Claim the row BEFORE the work. Claim-then-work has the same losing side
  // acceptProposal accepts: a process that dies after the claim records a send
  // that did not happen, which is strictly better than a double click sending
  // twice — an extra email cannot be unsent.
  const claimed = await db.outbound.updateMany({
    where: { id, userId, status: { in: ["DRAFT", "APPROVED"] } },
    data: { status: "SENT", sentAt: now, error: "" },
  });
  if (claimed.count === 0) {
    return { sent: false, outbound: toRow(draft as Raw), reason: "Something else just sent it." };
  }

  // 8. The wire.
  let outcome: SendOutcome;
  try {
    const token = await accessTokenFor(userId, draft.accountId);
    const profile = await db.profile.findUnique({ where: { userId }, select: { fullName: true } });
    const message = {
      fromEmail: draft.account!.email,
      fromName: profile?.fullName ?? "",
      toEmail: draft.toEmail,
      toName: draft.contact?.name ?? "",
      subject: draft.subject,
      text: draft.body,
    };
    outcome =
      draft.account!.provider === "GOOGLE"
        ? await sendViaGoogle(token, message)
        : await sendViaMicrosoft(token, message);
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : "That send failed." };
  }

  if (!outcome.ok) {
    const failed = await db.outbound.update({
      where: { id },
      data: { status: "FAILED", sentAt: null, error: outcome.error.slice(0, 500) },
      include: rowInclude,
    });
    return { sent: false, outbound: toRow(failed as Raw), reason: outcome.error };
  }

  // 9. It went.
  const sent = await db.outbound.update({
    where: { id },
    data: {
      providerMessageId: outcome.messageId,
      sentBy: author?.connectionId ?? "",
      sentByName: author?.connectionName ?? "",
    },
    include: rowInclude,
  });

  if (draft.letterId) {
    await db.letter.updateMany({ where: { id: draft.letterId, userId }, data: { sentAt: now } });
  }

  // On the job's timeline when there is one, on the person's otherwise.
  // addActivity already enforces exactly-one-parent.
  await pipeline
    .addActivity(userId, {
      applicationId: draft.applicationId ?? undefined,
      contactId: draft.applicationId ? undefined : draft.contactId,
      type: "EMAIL_SENT",
      body: `Sent "${draft.subject}" to ${draft.contact?.name ?? draft.toEmail}.`,
      occurredAt: now,
    })
    .catch(() => {});

  // One line in the instance log, and NEVER the recipient, the subject or the
  // body: every admin reads that table, and the model forbids writing an
  // operation's inputs to it.
  await recordSystemEvent({
    level: "INFO",
    source: "outbound.send",
    message: "A member sent a message from their own mailbox",
    detail: draft.account!.provider,
  }).catch(() => {});

  return { sent: true, outbound: toRow(sent as Raw), reason: "" };
}
