import type { ProposalKind } from "@prisma/client";
import { db } from "@/lib/db";
import { domainOf } from "@/lib/accounts/text";
import * as accounts from "@/lib/data/accounts";
import * as proposals from "@/lib/data/proposals";

/**
 * Reading a person's own mail on a schedule, and proposing what a rule can prove.
 *
 * **The sweep proposes what a rule can prove, and hands the rest to a reading.**
 * Mail arrived, and from whom, is a fact: it becomes a LOG_ACTIVITY proposal.
 * Somebody new wrote from a company on the board is a fact: it becomes a
 * CREATE_CONTACT proposal. A meeting got booked with someone on the pipeline is
 * a fact: it becomes the one stage move this will ever suggest, forwards only,
 * to INTERVIEWING. What a message *means* — a rejection, an offer, a take-home
 * — is a READING, and a regex that read "unfortunately" as a rejection would
 * put "you have been rejected" in a review queue off the back of somebody
 * apologising for being late. Those threads come back on `needsReading`
 * instead, which is what `inbox_review` now starts from.
 *
 * And the rule that outranks all of it: THE SWEEP NEVER WRITES ANYTHING TO THE
 * PIPELINE. Every finding is a Proposal, and acceptProposal is the only thing
 * that writes.
 *
 * It is also off until somebody asks for it, per person, and no admin can turn
 * it on for somebody else — the same promise the three digest switches make.
 */

/** How far back the very first sweep for a person looks. Not their whole mailbox. */
const FIRST_RUN_DAYS = 3;
/** The furthest back a deliberate wider look will go. */
const MAX_DAYS = 90;
/** Once an hour per person, however often the endpoint is hit. */
const RUN_EVERY_MS = 60 * 60 * 1000;
/**
 * gmailSearchThreads clamps maxResults to 50 and MailReader has no cursor, so
 * a page of exactly this many means the window was full and something was
 * missed. That is what mailSweepNote exists to say out loud.
 */
const PAGE_CEILING = 50;
/** How far forward the calendar half looks for a booked meeting. */
const CALENDAR_DAYS = 21;
/** Proposals from one run. A queue nobody can read is a queue nobody uses. */
const MAX_PER_RUN = 25;

export type MailSweepSettings = {
  on: boolean;
  lastSweptAt: Date | null;
  lastRunAt: Date | null;
  note: string;
  /** False when no mailbox is connected, which makes the switch inert. */
  mailConnected: boolean;
  calendarConnected: boolean;
};

async function settingsFor(userId: string): Promise<MailSweepSettings> {
  const [profile, access] = await Promise.all([
    db.profile.findUnique({
      where: { userId },
      select: { mailSweep: true, mailSweptAt: true, mailSweptRunAt: true, mailSweepNote: true },
    }),
    accounts.accountAccess(userId),
  ]);
  return {
    on: profile?.mailSweep ?? false,
    lastSweptAt: profile?.mailSweptAt ?? null,
    lastRunAt: profile?.mailSweptRunAt ?? null,
    note: profile?.mailSweepNote ?? "",
    mailConnected: access?.mail ?? false,
    calendarConnected: access?.calendar ?? false,
  };
}

export async function getMailSweep(userId: string): Promise<MailSweepSettings> {
  return settingsFor(userId);
}

export async function setMailSweep(userId: string, on: boolean): Promise<MailSweepSettings> {
  await db.profile.upsert({
    where: { userId },
    create: { userId, mailSweep: on },
    update: { mailSweep: on, ...(on ? {} : { mailSweepNote: "" }) },
  });
  return settingsFor(userId);
}

export type NeedsReading = {
  threadId: string;
  subject: string;
  from: string;
  at: Date;
  applicationId: string | null;
  company: string | null;
  /** Why a rule would not decide it, in a few words. */
  why: string;
};

export type MailSweepReport = {
  windowFrom: Date;
  windowTo: Date;
  threadsRead: number;
  queued: { kind: ProposalKind; summary: string }[];
  /** Matched threads a rule could not decide about. The inbox_review shortlist. */
  needsReading: NeedsReading[];
  warnings: string[];
  note: string;
};

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/**
 * One person's sweep, now.
 *
 * `days` overrides the watermark for a deliberate wider look, which is what to
 * do the first time somebody asks.
 */
export async function runMailSweep(
  userId: string,
  options?: { days?: number; now?: Date; includeCalendar?: boolean },
): Promise<MailSweepReport> {
  const now = options?.now ?? new Date();
  const settings = await settingsFor(userId);

  const watermark = settings.lastSweptAt;
  const days = options?.days
    ? Math.min(Math.max(Math.round(options.days), 1), MAX_DAYS)
    : watermark
      ? Math.min(Math.max(Math.ceil((now.getTime() - watermark.getTime()) / 86_400_000), 1), MAX_DAYS)
      : FIRST_RUN_DAYS;
  const windowFrom = options?.days || !watermark ? new Date(now.getTime() - days * 86_400_000) : watermark;

  const report: MailSweepReport = {
    windowFrom,
    windowTo: now,
    threadsRead: 0,
    queued: [],
    needsReading: [],
    warnings: [],
    note: "",
  };

  const index = await accounts.pipelineMatchIndex(userId);
  if (index.terms.addresses.length === 0 && index.terms.domains.length === 0) {
    report.warnings.push(
      "Nothing on the pipeline carries an email address or a company website, so there is nothing to match mail against yet.",
    );
    await stamp(userId, null, now, report.note);
    return report;
  }

  const [mail, mine] = await Promise.all([
    accounts.sweepMailboxes(userId, { ...index.terms, newerThanDays: days, limit: PAGE_CEILING }),
    accounts.ownAddresses(userId),
  ]);
  report.warnings.push(...mail.warnings);
  if (mail.accounts === 0) {
    report.warnings.push("No mailbox is connected, so nothing was read.");
    await stamp(userId, null, now, report.note);
    return report;
  }
  if (mail.threads.length >= PAGE_CEILING) {
    // Said out loud rather than hidden: there is no cursor to page with, so
    // something in this window was not seen.
    report.note = `The window came back full at ${PAGE_CEILING} threads, so some may have been missed. Run it again with a smaller days if you were catching up.`;
  }

  // Newer than the watermark, and not something they wrote themselves — a
  // thread they sent the last message on is not news.
  const fresh = mail.threads
    .filter((thread) => !watermark || options?.days || thread.lastMessageAt > watermark)
    .filter((thread) => {
      const from = thread.lastFrom?.email?.trim().toLowerCase() ?? "";
      return from !== "" && !mine.has(from);
    });
  report.threadsRead = fresh.length;

  // Across runs: a thread already queued and still pending is never queued
  // twice. One indexed read, filtered in JS — there are never many.
  const pending = await proposals.listProposals(userId, { status: "PENDING" });
  const alreadyQueued = new Set(
    pending
      .filter((row) => row.source === "mail_sweep")
      .map((row) => (row.payload as Record<string, unknown> | null)?.threadId)
      .filter((id): id is string => typeof id === "string"),
  );

  const items: proposals.ProposalInput[] = [];
  const seenThisRun = new Set<string>();
  let newest: Date | null = null;

  for (const thread of fresh) {
    if (!newest || thread.lastMessageAt > newest) newest = thread.lastMessageAt;
    if (seenThisRun.has(thread.id) || alreadyQueued.has(thread.id)) continue;
    seenThisRun.add(thread.id);

    const from = thread.lastFrom!;
    const address = from.email.trim().toLowerCase();
    const contact = index.byAddress.get(address);
    const company = index.byDomain.get(domainOf(address));
    if (!contact && !company) continue;

    const evidence = `"${clip(thread.subject || "(no subject)", 160)}" — ${clip(thread.snippet ?? "", 200)}`;
    const who = from.name?.trim() || address;

    // Two live applications at one company is the commonest real ambiguity and
    // the one that produces a proposal that looks right and files a recruiter's
    // mail against the wrong job. It goes to a reading, not a guess.
    if (!contact && company && company.applicationCount > 1) {
      report.needsReading.push({
        threadId: thread.id,
        subject: thread.subject,
        from: address,
        at: thread.lastMessageAt,
        applicationId: null,
        company: company.companyName,
        why: `${company.companyName} has ${company.applicationCount} live applications, so which job this is about is a judgement, not a rule.`,
      });
      continue;
    }

    const applicationId = contact?.applicationId ?? company?.applicationId ?? null;
    if (applicationId) {
      items.push({
        kind: "LOG_ACTIVITY",
        summary: `Log "${clip(thread.subject || "(no subject)", 60)}" from ${who}`,
        evidence,
        source: "mail_sweep",
        applicationId,
        payload: {
          applicationId,
          type: "EMAIL_RECEIVED",
          body: `${thread.subject || "(no subject)"} — from ${who} (${address})`,
          occurredAt: thread.lastMessageAt.toISOString(),
          threadId: thread.id,
        },
      });
    } else if (contact) {
      // A bare contact with no application still has a timeline.
      items.push({
        kind: "LOG_ACTIVITY",
        summary: `Log "${clip(thread.subject || "(no subject)", 60)}" from ${who}`,
        evidence,
        source: "mail_sweep",
        contactId: contact.contactId,
        payload: {
          contactId: contact.contactId,
          type: "EMAIL_RECEIVED",
          body: `${thread.subject || "(no subject)"} — from ${who} (${address})`,
          occurredAt: thread.lastMessageAt.toISOString(),
          threadId: thread.id,
        },
      });
    } else if (company) {
      report.needsReading.push({
        threadId: thread.id,
        subject: thread.subject,
        from: address,
        at: thread.lastMessageAt,
        applicationId: null,
        company: company.companyName,
        why: `${company.companyName} is on file with no live application, so there is nothing to log this against yet.`,
      });
    }

    // Somebody new writing from a tracked company's own domain is a fact.
    // Freemail is already out of byDomain, so this cannot fire on a personal
    // address that happens to be on the pipeline.
    if (!contact && company) {
      items.push({
        kind: "CREATE_CONTACT",
        summary: `Add ${who} at ${company.companyName}`,
        evidence,
        source: "mail_sweep",
        ...(applicationId ? { applicationId } : {}),
        payload: {
          name: from.name?.trim() || address.split("@")[0],
          email: address,
          companyId: company.companyId,
          ...(applicationId ? { applicationId } : {}),
          threadId: `${thread.id}#contact`,
        },
      });
    }
  }

  // The one stage move. Forwards only, to INTERVIEWING, and never any other.
  const wantsCalendar = options?.includeCalendar ?? true;
  if (wantsCalendar && settings.calendarConnected) {
    try {
      const { events, warning } = await accounts.listMatchedEvents(
        userId,
        now,
        new Date(now.getTime() + CALENDAR_DAYS * 86_400_000),
      );
      if (warning) report.warnings.push(warning);
      const ids = [...new Set(events.map((event) => event.applicationId).filter((id): id is string => !!id))];
      if (ids.length > 0) {
        const early = await db.application.findMany({
          // An archive filter and a stage filter: a meeting on a job somebody
          // binned is not a stage move, and this only ever moves forwards.
          where: { userId, id: { in: ids }, archivedAt: null, stage: { in: ["WISHLIST", "APPLIED"] } },
          select: { id: true, roleTitle: true, company: { select: { name: true } } },
        });
        const byId = new Map(early.map((row) => [row.id, row]));
        for (const event of events) {
          const application = event.applicationId ? byId.get(event.applicationId) : undefined;
          if (!application) continue;
          const key = `calendar:${event.id}`;
          if (alreadyQueued.has(key) || seenThisRun.has(key)) continue;
          seenThisRun.add(key);
          items.push({
            kind: "MOVE_STAGE",
            summary: `Move ${application.roleTitle} at ${application.company.name} to interviewing`,
            evidence: `Booked: "${clip(event.title, 120)}", ${event.start.toISOString()}`,
            source: "mail_sweep",
            applicationId: application.id,
            payload: {
              applicationId: application.id,
              stage: "INTERVIEWING",
              note: `Booked: "${clip(event.title, 120)}"`,
              threadId: key,
            },
          });
        }
      }
    } catch (error) {
      report.warnings.push(
        `The calendar half did not run: ${error instanceof Error ? error.message : "it refused"}`,
      );
    }
  }

  const capped = items.slice(0, MAX_PER_RUN);
  if (capped.length < items.length) {
    report.note = `${report.note ? `${report.note} ` : ""}${items.length - capped.length} more findings were held back so the queue stays readable; run it again once you have worked through these.`;
  }
  if (capped.length > 0) {
    const result = await proposals.proposeChanges(userId, capped);
    report.queued = result.queued.map((row) => ({ kind: row.kind, summary: row.summary }));
    for (const refused of result.refused) {
      report.warnings.push(`Not queued — ${refused.reason}: ${refused.summary}`);
    }
  }

  // The watermark moves AFTER proposeChanges returns. Setting it first loses a
  // day of findings to a crash; this way a crash re-reads a window instead,
  // which the dedupe above makes harmless.
  await stamp(userId, newest, now, report.note);
  return report;
}

async function stamp(userId: string, newest: Date | null, now: Date, note: string) {
  await db.profile.upsert({
    where: { userId },
    create: { userId, mailSweptAt: newest, mailSweptRunAt: now, mailSweepNote: note },
    update: { ...(newest ? { mailSweptAt: newest } : {}), mailSweptRunAt: now, mailSweepNote: note },
  });
}

export type MailSweepSweepReport = {
  considered: number;
  swept: number;
  skipped: number;
  failed: number;
  queued: number;
  problems: string[];
};

/** Instance-wide. No userId, same argument as runDigestSweep. */
export async function sweepMailForEveryone(now = new Date()): Promise<MailSweepSweepReport> {
  const profiles = await db.profile.findMany({
    where: { mailSweep: true },
    select: { userId: true, mailSweptRunAt: true, user: { select: { isActive: true } } },
  });

  const report: MailSweepSweepReport = {
    considered: profiles.length,
    swept: 0,
    skipped: 0,
    failed: 0,
    queued: 0,
    problems: [],
  };

  for (const profile of profiles) {
    // Reading a suspended person's mailbox is the worst version of this feature
    // failing, so it is checked before anything else.
    if (!profile.user.isActive) {
      report.skipped += 1;
      continue;
    }
    if (profile.mailSweptRunAt && now.getTime() - profile.mailSweptRunAt.getTime() < RUN_EVERY_MS) {
      report.skipped += 1;
      continue;
    }
    try {
      const run = await runMailSweep(profile.userId, { now });
      report.swept += 1;
      report.queued += run.queued.length;
    } catch (error) {
      report.failed += 1;
      report.problems.push(error instanceof Error ? error.message : "A sweep failed.");
    }
  }
  return report;
}
