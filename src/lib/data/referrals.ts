import type { Prisma, Referral, ReferralStatus, Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { toDate } from "@/lib/time";
import { timeZoneOf } from "@/lib/data/me";

/**
 * Who vouched for you where, and whether it came to anything.
 *
 * A referral is the highest-converting channel most searches have, and until now
 * the app could record that one existed — an `ActivityType.REFERRAL` row with a
 * sentence in it — and nothing else. Two things a timeline entry cannot do:
 *
 * 1. **A status that moves.** Asked, agreed, submitted, declined, never
 *    answered. The current value of a status stored as prose is whatever the
 *    newest note happens to say, which no query can read, so "who have I asked
 *    and not heard back from" was unanswerable.
 * 2. **A join.** One person refers you to three places; one job is referred by
 *    two people. `Contact.applicationId` holds neither, for exactly the reason
 *    `ContactCompany` exists.
 *
 * WHETHER IT CONVERTED IS NOT A COLUMN. It is derived the way listRelationships
 * derives it — did the application ever reach INTERVIEWING or beyond. A stored
 * boolean would be a third place that can disagree with the funnel.
 *
 * ARCHIVING. No `archivedAt`: like an offer, an activity and a task, a referral
 * follows its parents in and out through THEIR columns — and it has three of
 * them, which is one worse than offers.ts. Every read here spells the parent
 * filters itself and nothing in the toolchain catches a miss. There are FOUR,
 * numbered at the line. `updateReferral` and `deleteReferral` deliberately do
 * not filter, for the reason offers.ts gives about repairs.
 */

export const REFERRAL_STATUSES = [
  "ASKED",
  "AGREED",
  "SUBMITTED",
  "DECLINED",
  "NO_ANSWER",
] as const satisfies readonly ReferralStatus[];

export const REFERRAL_LABEL: Record<ReferralStatus, string> = {
  ASKED: "Asked, no answer yet",
  AGREED: "They said yes",
  SUBMITTED: "It went in",
  DECLINED: "They said no",
  NO_ANSWER: "Never answered",
};

/** What each status means for what you do next. Written for a drafter. */
export const REFERRAL_INTENT: Record<ReferralStatus, string> = {
  ASKED: "Waiting. A week is normal, three is a nudge, and a nudge is one line, not a second ask.",
  AGREED: "They said yes and nothing has landed. Give them what they need to act — the link and two lines they can forward without editing.",
  SUBMITTED: "It is in. Nothing to do but tell them what happens next, whichever way it goes.",
  DECLINED: "A no about this job is not a no about them. Thank them anyway.",
  NO_ANSWER: "Silence is not a no. It usually means they never saw it, and a different channel beats a second message on the same one.",
};

/** Stages that mean a referred application actually went somewhere. */
const CONVERTED_STAGES: Stage[] = ["INTERVIEWING", "OFFER", "ACCEPTED"];

const DAY = 86_400_000;

export type ReferralInput = {
  contactId?: string;
  applicationId?: string | null;
  companyId?: string | null;
  status?: ReferralStatus;
  askedOn?: Date | string | null;
  notes?: string;
  /** True stamps thankedAt with now; false clears it. */
  thanked?: boolean;
};

const referralInclude = {
  contact: { select: { id: true, name: true, title: true, archivedAt: true } },
  application: {
    select: {
      id: true,
      roleTitle: true,
      stage: true,
      archivedAt: true,
      activities: { where: { toStage: { not: null } }, select: { toStage: true } },
    },
  },
  company: { select: { id: true, name: true, archivedAt: true } },
} as const;

type RawReferral = Prisma.ReferralGetPayload<{ include: typeof referralInclude }>;

export type ReferralRow = Referral & {
  contact: { id: string; name: string; title: string };
  application: { id: string; roleTitle: string; stage: Stage } | null;
  company: { id: string; name: string } | null;
  /** The referred application reached INTERVIEWING or beyond, ever. Derived. */
  converted: boolean;
  /** Converted, and thankedAt is still null. The unclosed loop this model exists for. */
  thanksOwed: boolean;
  /** Days since the status last moved, for "you asked three weeks ago". */
  waitingDays: number;
};

function shape(row: RawReferral, now: Date): ReferralRow {
  const { contact, application, company, ...rest } = row;
  const converted = application
    ? CONVERTED_STAGES.includes(application.stage) ||
      application.activities.some((a) => a.toStage !== null && CONVERTED_STAGES.includes(a.toStage))
    : false;
  return {
    ...rest,
    contact: { id: contact.id, name: contact.name, title: contact.title },
    application: application
      ? { id: application.id, roleTitle: application.roleTitle, stage: application.stage }
      : null,
    company: company ? { id: company.id, name: company.name } : null,
    converted,
    thanksOwed: converted && rest.thankedAt === null,
    waitingDays: Math.max(0, Math.floor((now.getTime() - rest.statusOn.getTime()) / DAY)),
  };
}

/**
 * Only the parents that are still live.
 *
 * Spelled as a `where` fragment so the four reads below cannot each write a
 * different version of it. A referral whose contact is archived is out; one
 * whose APPLICATION is archived stays, with the application nulled by the filter
 * — because "who has put me forward" is a question about people and survives a
 * job being binned.
 */
const liveParents = {
  contact: { archivedAt: null },
} satisfies Prisma.ReferralWhereInput;

export async function listReferrals(
  userId: string,
  options?: {
    contactId?: string;
    applicationId?: string;
    companyId?: string;
    status?: ReferralStatus;
    thanksOwed?: boolean;
    waitingForDays?: number;
    limit?: number;
  },
): Promise<ReferralRow[]> {
  const now = new Date();
  const rows = await db.referral.findMany({
    where: {
      userId,
      // 1 of 4 — a referral has no archivedAt of its own.
      ...liveParents,
      ...(options?.contactId ? { contactId: options.contactId } : {}),
      ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
      ...(options?.companyId ? { companyId: options.companyId } : {}),
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.waitingForDays !== undefined
        ? {
            status: { in: ["ASKED", "AGREED"] as ReferralStatus[] },
            statusOn: { lte: new Date(now.getTime() - options.waitingForDays * DAY) },
          }
        : {}),
    },
    include: referralInclude,
    orderBy: [{ statusOn: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(options?.limit ?? 100, 1), 500),
  });

  const shaped = rows.map((row) => shape(row, now));
  // Conversion is derived, so it cannot be a where clause. Filtered here, after.
  return options?.thanksOwed ? shaped.filter((row) => row.thanksOwed) : shaped;
}

export async function getReferral(userId: string, id: string): Promise<ReferralRow | null> {
  // 2 of 4.
  const row = await db.referral.findFirst({
    where: { id, userId, ...liveParents },
    include: referralInclude,
  });
  return row ? shape(row, new Date()) : null;
}

async function fieldsFor(userId: string, input: ReferralInput) {
  const zone = await timeZoneOf(userId);
  const data: Prisma.ReferralUncheckedUpdateInput = {};
  if (input.applicationId !== undefined) data.applicationId = input.applicationId || null;
  if (input.companyId !== undefined) data.companyId = input.companyId || null;
  if (input.askedOn !== undefined) data.askedOn = toDate(zone, input.askedOn) ?? new Date();
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.thanked !== undefined) data.thankedAt = input.thanked ? new Date() : null;
  return data;
}

export async function createReferral(userId: string, input: ReferralInput): Promise<ReferralRow> {
  const contactId = input.contactId?.trim();
  if (!contactId) throw new Error("A referral needs the person who vouched for you.");
  const contact = await db.contact.findFirst({
    // A referral from somebody you archived is almost certainly a mistake.
    where: { id: contactId, userId, archivedAt: null },
    select: { id: true },
  });
  if (!contact) throw new Error("No such contact");

  // The company is filled in from the application when only one was given, so
  // "who has put me forward at Stripe" works without anybody passing both.
  let companyId = input.companyId ?? null;
  if (input.applicationId) {
    const application = await db.application.findFirst({
      where: { id: input.applicationId, userId, archivedAt: null },
      select: { companyId: true },
    });
    if (!application) throw new Error("No such application");
    companyId = companyId ?? application.companyId;
  }

  const base = await fieldsFor(userId, input);
  const created = await db.referral.create({
    data: {
      ...(base as Prisma.ReferralUncheckedCreateInput),
      userId,
      contactId,
      companyId,
      status: input.status ?? "ASKED",
      statusOn: new Date(),
    },
    include: referralInclude,
  });
  return shape(created, new Date());
}

/**
 * Patch a referral. Deliberately does NOT filter on the archive; see the header.
 *
 * `statusOn` moves only when the STATUS moves — fixing a typo in the notes is
 * not news, and "waiting three weeks" has to count from the last real change.
 */
export async function updateReferral(
  userId: string,
  id: string,
  patch: ReferralInput,
): Promise<ReferralRow> {
  const current = await db.referral.findFirst({ where: { id, userId }, select: { status: true } });
  if (!current) throw new Error("No such referral");

  const data = await fieldsFor(userId, patch);
  if (patch.status !== undefined && patch.status !== current.status) {
    data.status = patch.status;
    data.statusOn = new Date();
  }
  if (patch.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: patch.contactId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!contact) throw new Error("No such contact");
    data.contactId = patch.contactId;
  }

  await db.referral.update({ where: { id }, data });
  const row = await db.referral.findFirstOrThrow({ where: { id }, include: referralInclude });
  return shape(row, new Date());
}

export async function deleteReferral(userId: string, id: string) {
  const { count } = await db.referral.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such referral");
  return { id };
}

/**
 * The thank-you nudges a stage move owes.
 *
 * Called from `moveApplicationStage` beside `applyStageTemplates`, and it is the
 * whole point of the model: a referral that converted and was never acknowledged
 * is the most expensive unclosed loop in a search, and it is invisible in every
 * other record this app keeps.
 *
 * `thankTaskId` is the dedupe — a conversion that finds a task already there
 * makes no second one, so bouncing between INTERVIEWING and APPLIED cannot stack
 * up thank-yous. Same shape as the checklist's dedupe on `stageTemplateId`.
 */
export async function applyReferralThanks(
  userId: string,
  applicationId: string,
  stage: Stage,
): Promise<{ created: { id: string; title: string }[] }> {
  if (!CONVERTED_STAGES.includes(stage)) return { created: [] };

  // 3 of 4.
  const owed = await db.referral.findMany({
    where: {
      userId,
      applicationId,
      thankedAt: null,
      thankTaskId: null,
      status: { in: ["AGREED", "SUBMITTED"] as ReferralStatus[] },
      contact: { archivedAt: null },
      application: { archivedAt: null },
    },
    include: { contact: { select: { name: true } }, application: { select: { company: { select: { name: true } } } } },
  });

  const created: { id: string; title: string }[] = [];
  for (const referral of owed) {
    const title = `Thank ${referral.contact.name} — the ${referral.application?.company.name ?? "referral"} referral went somewhere`;
    const task = await db.task.create({
      data: { userId, applicationId, title },
      select: { id: true, title: true },
    });
    await db.referral.update({ where: { id: referral.id }, data: { thankTaskId: task.id } });
    created.push(task);
  }
  return { created };
}

/**
 * Who is owed a thank-you, and who has been waiting too long.
 *
 * The two questions the model was built for, answered in one read so an
 * assistant does not have to know to ask both.
 */
export async function referralReview(
  userId: string,
  options?: { waitingForDays?: number },
): Promise<{
  thanksOwed: ReferralRow[];
  waiting: ReferralRow[];
  byStatus: { status: ReferralStatus; label: string; intent: string; count: number }[];
  total: number;
}> {
  const now = new Date();
  // 4 of 4.
  const rows = await db.referral.findMany({
    where: { userId, ...liveParents },
    include: referralInclude,
  });
  const shaped = rows.map((row) => shape(row, now));
  const waitingFor = options?.waitingForDays ?? 10;

  return {
    thanksOwed: shaped.filter((row) => row.thanksOwed),
    waiting: shaped
      .filter((row) => (row.status === "ASKED" || row.status === "AGREED") && row.waitingDays >= waitingFor)
      .sort((a, b) => b.waitingDays - a.waitingDays),
    byStatus: REFERRAL_STATUSES.map((status) => ({
      status,
      label: REFERRAL_LABEL[status],
      intent: REFERRAL_INTENT[status],
      count: shaped.filter((row) => row.status === status).length,
    })),
    total: shaped.length,
  };
}
