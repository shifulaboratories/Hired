import type {
  Interview,
  InterviewFormat,
  InterviewOutcome,
  Prisma,
  QuestionKind,
  Stage,
} from "@prisma/client";
import { db } from "@/lib/db";
import { toDate } from "@/lib/data/pipeline";
import { timeZoneOf } from "@/lib/data/me";

/**
 * A round of interviews, as a record.
 *
 * Until now an interview was an `Activity` of type INTERVIEW carrying a
 * sentence, plus `Application.interviewRound` counting how many there had been.
 * That answered "how far did this get" and could not answer "what did they ask
 * me at Stripe", which is the question somebody actually has at 9pm the night
 * before the next one.
 *
 * THREE THINGS THIS DOES NOT DO, each on purpose:
 *
 * 1. It does not replace the INTERVIEW activity. `resumes.ts` counts those rows
 *    to prove a resume got somebody into a room and `quick-log.ts` writes them
 *    from one typed line; both would go quiet, silently, the day they stopped
 *    existing. Instead an interview OWNS one, through `activityId`, written when
 *    the outcome is recorded and REWRITTEN rather than duplicated when it
 *    changes. One writer, one row, in one file: the timeline is a rendering of
 *    this record, never a second record.
 * 2. It does not backfill. An old activity body is prose a person typed, and
 *    turning "chat with Priya went well" into a round, a format and a time is
 *    inventing four columns out of one sentence. The first interview somebody
 *    records is the first row they have.
 * 3. It never lowers `Application.interviewRound`. After any write the column
 *    holds the greater of what it held and the deepest round on file, because
 *    how far something got is a fact, and because a person typing "3" into the
 *    details rail is as real a record as a row here. The two writers can
 *    disagree and GREATEST makes that harmless.
 *
 * ARCHIVING. An interview has no `archivedAt`: like an offer, a task and an
 * activity it follows its application in and out through that application's
 * column. Same sharp edge as offers.ts, one level worse — every read here that
 * does not start from an already-filtered application spells
 * `application: { archivedAt: null }` itself, and every read of a question
 * spells `interview: { application: { archivedAt: null } }`. Nothing in the
 * toolchain catches a miss. There are FIVE and each says so at the line.
 * `updateInterview` and `deleteInterview` deliberately do not filter, for the
 * reason offers.ts gives: fixing or removing a row attached to a job you have
 * since binned is a repair, and the id can only have come from somewhere that
 * already showed it to you.
 */

export const INTERVIEW_FORMATS = [
  "PHONE",
  "VIDEO",
  "ONSITE",
  "TAKE_HOME",
  "PAIRING",
  "PANEL",
  "OTHER",
] as const satisfies readonly InterviewFormat[];

export const INTERVIEW_OUTCOMES = [
  "SCHEDULED",
  "HELD",
  "PASSED",
  "REJECTED",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly InterviewOutcome[];

export const QUESTION_KINDS = [
  "BEHAVIOURAL",
  "TECHNICAL",
  "SYSTEM_DESIGN",
  "ROLE",
  "CULTURE",
  "COMPENSATION",
  "MINE",
  "OTHER",
] as const satisfies readonly QuestionKind[];

export const FORMAT_LABEL: Record<InterviewFormat, string> = {
  PHONE: "Phone",
  VIDEO: "Video call",
  ONSITE: "Onsite",
  TAKE_HOME: "Take-home",
  PAIRING: "Pairing",
  PANEL: "Panel",
  OTHER: "Other",
};

export const OUTCOME_LABEL: Record<InterviewOutcome, string> = {
  SCHEDULED: "Scheduled",
  HELD: "Held, no word yet",
  PASSED: "Passed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  NO_SHOW: "They did not show",
};

/** What each format actually costs to prepare for. Written for whoever drafts the prep. */
export const FORMAT_INTENT: Record<InterviewFormat, string> = {
  PHONE: "Short, and usually a screen rather than a test. Have the two-minute version of your story ready.",
  VIDEO: "The default. Assume thirty to forty-five minutes and two or three real questions.",
  ONSITE: "Several rounds in one day. Prepare per round, and prepare for being tired by the last one.",
  TAKE_HOME: "Unsupervised and open-ended, so the risk is spending twelve hours on a four-hour task. Agree a scope.",
  PAIRING: "They are watching you think, not watching you finish. Narrate.",
  PANEL: "Several people with different stakes. Work out what each of them needs to hear.",
  OTHER: "",
};

export const QUESTION_LABEL: Record<QuestionKind, string> = {
  BEHAVIOURAL: "Behavioural",
  TECHNICAL: "Technical",
  SYSTEM_DESIGN: "System design",
  ROLE: "About the role",
  CULTURE: "Culture and ways of working",
  COMPENSATION: "Money",
  MINE: "A question you asked them",
  OTHER: "Other",
};

export const QUESTION_INTENT: Record<QuestionKind, string> = {
  BEHAVIOURAL: "A story about something you did. The answer that works is specific and has a number in it.",
  TECHNICAL: "Something with a right answer, or a close enough one. Worth knowing which ones you fumbled.",
  SYSTEM_DESIGN: "Open-ended, and graded on how you reason rather than what you land on.",
  ROLE: "What the job actually is. Their answer matters as much as yours.",
  CULTURE: "How they work. Usually where the real disqualifiers are, on both sides.",
  COMPENSATION: "Say as little as you can as late as you can, and never a number first.",
  MINE: "What you asked them. Which of your questions landed is worth as much as which answers did.",
  OTHER: "",
};

/** The stages that mean a job went somewhere, for the bank's `ledSomewhere`. */
const GOOD_STAGES: Stage[] = ["OFFER", "ACCEPTED"];

export type InterviewInput = {
  round?: number;
  label?: string;
  format?: InterviewFormat;
  outcome?: InterviewOutcome;
  scheduledAt?: Date | string | null;
  durationMins?: number;
  location?: string;
  prep?: string;
  debrief?: string;
  calendarEventId?: string;
  /** Contact ids. Sending the key REPLACES the set; omitting it leaves it alone. */
  interviewerIds?: string[];
};

export type QuestionInput = {
  kind?: QuestionKind;
  question: string;
  answer?: string;
  confidence?: number;
  better?: string;
};

const interviewInclude = {
  application: {
    select: {
      id: true,
      stage: true,
      roleTitle: true,
      archivedAt: true,
      company: { select: { id: true, name: true } },
    },
  },
  interviewers: {
    select: { contact: { select: { id: true, name: true, title: true, email: true } } },
  },
  _count: { select: { questions: true } },
} as const;

const detailInclude = {
  ...interviewInclude,
  questions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  // No `as const` here, unlike interviewInclude: a readonly orderBy tuple is
  // not assignable to Prisma's mutable array type, and the error it produces
  // names the tuple rather than the const assertion that caused it.
} satisfies Prisma.InterviewInclude;

type RawInterview = Prisma.InterviewGetPayload<{ include: typeof interviewInclude }>;
type RawDetail = Prisma.InterviewGetPayload<{ include: typeof detailInclude }>;

export type InterviewRow = ReturnType<typeof shape>;
export type InterviewDetail = InterviewRow & {
  questions: RawDetail["questions"];
};

/** Flatten the join rows, the same way every other list in this directory does. */
function shape(row: RawInterview) {
  const { interviewers, _count, application, ...rest } = row;
  return {
    ...rest,
    application: {
      id: application.id,
      stage: application.stage,
      roleTitle: application.roleTitle,
      company: application.company,
    },
    interviewers: interviewers.map((link) => link.contact),
    questionCount: _count.questions,
  };
}

function shapeDetail(row: RawDetail): InterviewDetail {
  const { questions, ...rest } = row;
  return { ...shape(rest), questions };
}

/**
 * The grouping key for a question.
 *
 * Case folded, punctuation dropped, whitespace collapsed — the same trick
 * `Tag.key` uses and for the same reason: Postgres can express this as a
 * functional index and Prisma cannot, so the normalised form is a column.
 *
 * It is exact-match grouping, so a paraphrase becomes a second entry. That is a
 * real cost and it is stated in the tool description rather than papered over
 * with fuzzy matching, which would merge two genuinely different questions
 * often enough to be worse.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 1 to 5, or 0 for "nobody said". Anything else is clamped rather than refused. */
function confidenceOf(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return 0;
  return Math.min(5, Math.max(0, Math.trunc(value)));
}

async function rowsFor(userId: string, input: InterviewInput) {
  const zone = await timeZoneOf(userId);
  const data: Prisma.InterviewUncheckedUpdateInput = {};
  if (input.round !== undefined) data.round = Math.max(1, Math.trunc(input.round));
  if (input.label !== undefined) data.label = input.label.trim();
  if (input.format !== undefined) data.format = input.format;
  if (input.outcome !== undefined) data.outcome = input.outcome;
  if (input.scheduledAt !== undefined) data.scheduledAt = toDate(zone, input.scheduledAt);
  if (input.durationMins !== undefined) {
    data.durationMins = Math.max(0, Math.trunc(input.durationMins));
  }
  if (input.location !== undefined) data.location = input.location.trim();
  if (input.prep !== undefined) data.prep = input.prep;
  if (input.debrief !== undefined) data.debrief = input.debrief;
  if (input.calendarEventId !== undefined) data.calendarEventId = input.calendarEventId.trim();
  return data;
}

/** Contact ids that are genuinely theirs and genuinely live. Silently drops the rest. */
async function ownedContacts(userId: string, ids: string[] | undefined) {
  if (!ids) return undefined;
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const rows = await db.contact.findMany({
    // A contact you archived should not be silently re-attached to a room.
    where: { userId, id: { in: unique }, archivedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Put the application's round counter at least as deep as the rounds on file.
 *
 * GREATEST, never an assignment. Somebody may have typed "3" into the details
 * rail before this model existed, and the funnel is built out of that column;
 * lowering it to match one recorded round would rewrite how far an application
 * got, which is a fact rather than a preference.
 *
 * `roundLabel` moves only when this round is strictly deeper than the counter
 * was, so correcting round 1's label three weeks later does not rewrite what
 * the CSV prints for round 4.
 */
async function raiseApplicationRound(
  userId: string,
  applicationId: string,
  label: string,
): Promise<number> {
  const [application, deepest] = await Promise.all([
    db.application.findFirst({
      where: { id: applicationId, userId },
      select: { interviewRound: true },
    }),
    db.interview.aggregate({
      where: { userId, applicationId },
      _max: { round: true },
    }),
  ]);
  if (!application) throw new Error("No such application");

  const target = Math.max(application.interviewRound, deepest._max.round ?? 0);
  if (target === application.interviewRound && !label) return application.interviewRound;

  const data: Prisma.ApplicationUncheckedUpdateInput = { interviewRound: target };
  if (label && target > application.interviewRound) data.roundLabel = label;
  await db.application.updateMany({ where: { id: applicationId, userId }, data });
  return target;
}

/**
 * Record a round that is going to happen, or one that already did.
 *
 * Writes NO activity. The timeline is what happened, and an interview next
 * Tuesday has not happened — it belongs in list_schedule, which is where a date
 * you do not owe anybody lives.
 */
export async function scheduleInterview(
  userId: string,
  applicationId: string,
  input: InterviewInput & { prepTaskDueAt?: Date | string | null; prepTaskTitle?: string },
): Promise<{
  interview: InterviewDetail;
  duplicateOf: InterviewRow | null;
  prepTask: { id: string; title: string; dueAt: Date | null } | null;
  applicationRound: number;
}> {
  const application = await db.application.findFirst({
    // Scheduling a round on an application you binned is almost certainly a
    // mistake, so this one refuses rather than repairing.
    where: { id: applicationId, userId, archivedAt: null },
    select: { id: true, interviewRound: true, roleTitle: true, company: { select: { name: true } } },
  });
  if (!application) throw new Error("No such application");

  const eventId = input.calendarEventId?.trim() ?? "";
  if (eventId) {
    const existing = await db.interview.findFirst({
      where: { userId, calendarEventId: eventId },
      include: interviewInclude,
    });
    // The same meeting, seen twice by a sweep. Hand back what is already there
    // rather than a second row nobody asked for.
    if (existing) {
      return {
        interview: await getInterview(userId, existing.id).then((row) => row!),
        duplicateOf: shape(existing),
        prepTask: null,
        applicationRound: application.interviewRound,
      };
    }
  }

  const deepest = await db.interview.aggregate({
    where: { userId, applicationId },
    _max: { round: true },
  });
  // Seeded from the application's own counter, so somebody who typed "round 3"
  // into the rail before this existed gets round 4 next, not round 1.
  const round =
    input.round !== undefined
      ? Math.max(1, Math.trunc(input.round))
      : Math.max(deepest._max.round ?? 0, application.interviewRound) + 1;

  const interviewerIds = await ownedContacts(userId, input.interviewerIds);
  const zone = await timeZoneOf(userId);
  const base = await rowsFor(userId, input);

  const created = await db.interview.create({
    data: {
      ...(base as Prisma.InterviewUncheckedCreateInput),
      userId,
      applicationId,
      round,
      ...(interviewerIds ? { interviewers: { create: interviewerIds.map((contactId) => ({ contactId })) } } : {}),
    },
    select: { id: true },
  });

  const applicationRound = await raiseApplicationRound(userId, applicationId, input.label?.trim() ?? "");

  let prepTask: { id: string; title: string; dueAt: Date | null } | null = null;
  if (input.prepTaskDueAt !== undefined && input.prepTaskDueAt !== null) {
    const task = await db.task.create({
      data: {
        userId,
        applicationId,
        title:
          input.prepTaskTitle?.trim() ||
          `Prep for ${input.label?.trim() || `round ${round}`} at ${application.company.name}`,
        dueAt: toDate(zone, input.prepTaskDueAt) ?? null,
      },
      select: { id: true, title: true, dueAt: true },
    });
    prepTask = task;
  }

  return {
    interview: (await getInterview(userId, created.id))!,
    duplicateOf: null,
    prepTask,
    applicationRound,
  };
}

/** Archive filter 1 of 5. */
export async function listInterviews(
  userId: string,
  options?: {
    applicationId?: string;
    companyId?: string;
    from?: Date | string;
    to?: Date | string;
    outcome?: InterviewOutcome;
    upcomingOnly?: boolean;
    limit?: number;
  },
): Promise<InterviewRow[]> {
  const zone = await timeZoneOf(userId);
  const where: Prisma.InterviewWhereInput = {
    userId,
    // 1 of 5 — an interview has no archivedAt of its own.
    application: {
      archivedAt: null,
      ...(options?.companyId ? { companyId: options.companyId } : {}),
    },
    ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
    ...(options?.outcome ? { outcome: options.outcome } : {}),
  };
  const from = options?.from ? toDate(zone, options.from) : null;
  const to = options?.to ? toDate(zone, options.to) : null;
  if (from || to || options?.upcomingOnly) {
    where.scheduledAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
      ...(options?.upcomingOnly ? { gte: new Date() } : {}),
    };
  }

  const rows = await db.interview.findMany({
    where,
    include: interviewInclude,
    orderBy: [{ scheduledAt: "desc" }, { round: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(options?.limit ?? 100, 1), 500),
  });
  return rows.map(shape);
}

/**
 * Every round on one application, questions and all.
 *
 * Separate from `listInterviews` rather than an option on it, because the two
 * have different jobs: the list is what a tool returns for a whole search and
 * must stay small, and this is what one screen draws. Folding them together
 * would mean an assistant asking for a year of rounds got every answer to every
 * question along with them.
 *
 * Archive filter 1b of 5 — same rule as the list it sits beside.
 */
export async function listInterviewDetails(
  userId: string,
  applicationId: string,
): Promise<InterviewDetail[]> {
  const rows = await db.interview.findMany({
    where: { userId, applicationId, application: { archivedAt: null } },
    include: detailInclude,
    orderBy: [{ round: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(shapeDetail);
}

/** Archive filter 2 of 5. */
export async function getInterview(userId: string, id: string): Promise<InterviewDetail | null> {
  const row = await db.interview.findFirst({
    // 2 of 5.
    where: { id, userId, application: { archivedAt: null } },
    include: detailInclude,
  });
  return row ? shapeDetail(row) : null;
}

/**
 * Fix a row. Writes no timeline entry — recording how it went is
 * `recordInterviewOutcome`, which is the one write with side effects.
 *
 * Deliberately does NOT filter on the archive; see the file header.
 */
export async function updateInterview(
  userId: string,
  id: string,
  patch: InterviewInput,
): Promise<InterviewDetail> {
  const existing = await db.interview.findFirst({
    where: { id, userId },
    select: { id: true, applicationId: true },
  });
  if (!existing) throw new Error("No such interview");

  const data = await rowsFor(userId, patch);
  const interviewerIds = await ownedContacts(userId, patch.interviewerIds);

  await db.interview.update({ where: { id }, data });
  if (interviewerIds) {
    // Sending the key replaces the set. Two statements rather than an upsert
    // dance, because the set is at most a handful of people.
    await db.interviewInterviewer.deleteMany({ where: { interviewId: id } });
    if (interviewerIds.length > 0) {
      await db.interviewInterviewer.createMany({
        data: interviewerIds.map((contactId) => ({ interviewId: id, contactId })),
      });
    }
  }
  await raiseApplicationRound(userId, existing.applicationId, patch.label?.trim() ?? "");

  const row = await db.interview.findFirst({ where: { id }, include: detailInclude });
  return shapeDetail(row!);
}

/**
 * How it went, and what they asked.
 *
 * The one write here with side effects: it rewrites the interview's own
 * INTERVIEW activity rather than appending a second, and raises the
 * application's round counter if this round is deeper than anything recorded.
 * Both touch a live application, so this resolves one.
 */
export async function recordInterviewOutcome(
  userId: string,
  id: string,
  input: {
    outcome?: InterviewOutcome;
    debrief?: string;
    occurredAt?: Date | string;
    questions?: QuestionInput[];
  },
): Promise<{
  interview: InterviewDetail;
  activityId: string;
  applicationRound: number;
  addedQuestions: number;
}> {
  const existing = await db.interview.findFirst({
    where: { id, userId, application: { archivedAt: null } },
    include: {
      application: { select: { id: true, roleTitle: true, company: { select: { name: true } } } },
    },
  });
  if (!existing) throw new Error("No such interview");

  const zone = await timeZoneOf(userId);
  const occurredAt = toDate(zone, input.occurredAt) ?? existing.scheduledAt ?? new Date();
  const outcome = input.outcome ?? (existing.outcome === "SCHEDULED" ? "HELD" : existing.outcome);
  const debrief = input.debrief ?? existing.debrief;

  const added = await addQuestions(userId, id, input.questions ?? []);

  // The timeline row this interview owns. Rewritten, never duplicated — and
  // re-created when somebody has deleted it from the timeline by hand, which is
  // why activityId carries no foreign key.
  const label = existing.label || `Round ${existing.round}`;
  const body = [
    `${label} (${FORMAT_LABEL[existing.format]}) — ${OUTCOME_LABEL[outcome]}.`,
    debrief.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  let activityId = existing.activityId ?? "";
  const owned = activityId
    ? await db.activity.findFirst({ where: { id: activityId, userId }, select: { id: true } })
    : null;
  if (owned) {
    await db.activity.update({ where: { id: owned.id }, data: { body, occurredAt } });
  } else {
    const activity = await db.activity.create({
      data: {
        userId,
        applicationId: existing.applicationId,
        type: "INTERVIEW",
        body,
        occurredAt,
      },
      select: { id: true },
    });
    activityId = activity.id;
  }

  await db.interview.update({
    where: { id },
    data: { outcome, debrief, activityId, scheduledAt: existing.scheduledAt ?? occurredAt },
  });
  const applicationRound = await raiseApplicationRound(userId, existing.applicationId, "");

  return {
    interview: (await getInterview(userId, id))!,
    activityId,
    applicationRound,
    addedQuestions: added,
  };
}

/** Append questions to a round. Additive: nothing already on file is touched. */
export async function addQuestions(
  userId: string,
  interviewId: string,
  questions: QuestionInput[],
): Promise<number> {
  const wanted = questions.filter((q) => q.question?.trim());
  if (wanted.length === 0) return 0;

  const interview = await db.interview.findFirst({
    // 3 of 5.
    where: { id: interviewId, userId, application: { archivedAt: null } },
    select: { id: true },
  });
  if (!interview) throw new Error("No such interview");

  const last = await db.interviewQuestion.aggregate({
    where: { interviewId },
    _max: { sortOrder: true },
  });
  let order = last._max.sortOrder ?? 0;

  await db.interviewQuestion.createMany({
    data: wanted.map((q) => {
      order += 1;
      const question = q.question.trim();
      return {
        userId,
        interviewId,
        kind: q.kind ?? "BEHAVIOURAL",
        question,
        key: questionKey(question),
        answer: q.answer ?? "",
        confidence: confidenceOf(q.confidence) ?? 0,
        better: q.better ?? "",
        sortOrder: order,
      };
    }),
  });
  return wanted.length;
}

/** Correct one question. Only the fields sent change. */
export async function updateQuestion(
  userId: string,
  id: string,
  patch: Partial<QuestionInput>,
) {
  const existing = await db.interviewQuestion.findFirst({
    // 4 of 5.
    where: { id, userId, interview: { application: { archivedAt: null } } },
    select: { id: true },
  });
  if (!existing) throw new Error("No such question");

  const data: Prisma.InterviewQuestionUncheckedUpdateInput = {};
  if (patch.kind !== undefined) data.kind = patch.kind;
  if (patch.question !== undefined) {
    const question = patch.question.trim();
    if (!question) throw new Error("A question needs some words");
    data.question = question;
    // The key is derived, so it must move with the words or the bank groups on
    // a question nobody asked.
    data.key = questionKey(question);
  }
  if (patch.answer !== undefined) data.answer = patch.answer;
  if (patch.better !== undefined) data.better = patch.better;
  const confidence = confidenceOf(patch.confidence);
  if (confidence !== undefined) data.confidence = confidence;

  return db.interviewQuestion.update({ where: { id }, data });
}

export async function deleteQuestion(userId: string, id: string) {
  const { count } = await db.interviewQuestion.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such question");
  return { deleted: count };
}

/** Deliberately does NOT filter on the archive; see the file header. */
export async function deleteInterview(userId: string, id: string) {
  const existing = await db.interview.findFirst({
    where: { id, userId },
    select: { id: true, activityId: true, _count: { select: { questions: true } } },
  });
  if (!existing) throw new Error("No such interview");

  // The activity it owns goes with it. Anything else on the timeline was
  // written by somebody else and stays.
  if (existing.activityId) {
    await db.activity.deleteMany({ where: { id: existing.activityId, userId } });
  }
  await db.interview.delete({ where: { id } });
  // The application's round counter is NOT lowered. How far it got is a fact.
  return { deleted: 1, deletedQuestions: existing._count.questions };
}

/** Rounds in a window, for schedule.ts. The same shape offersDueBetween has. */
export async function interviewsBetween(userId: string, from: Date, to: Date) {
  const rows = await db.interview.findMany({
    // 5 of 5.
    where: {
      userId,
      application: { archivedAt: null },
      scheduledAt: { gte: from, lte: to },
      // A cancelled round is not an appointment.
      outcome: { notIn: ["CANCELLED"] },
    },
    include: interviewInclude,
    orderBy: { scheduledAt: "asc" },
  });
  return rows.map(shape);
}

/**
 * One round as the browser needs it: dates flattened to strings, relations
 * narrowed to what the panel draws. Same job letterForUi and offerForUi do, and
 * here for the same reason — a Date crossing the server/client boundary is a
 * serialisation warning, and sending the whole application back with every
 * round is sending the same object five times.
 */
export function interviewForUi(row: InterviewDetail) {
  return {
    id: row.id,
    round: row.round,
    label: row.label,
    format: row.format,
    outcome: row.outcome,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    durationMins: row.durationMins,
    location: row.location,
    prep: row.prep,
    debrief: row.debrief,
    interviewers: row.interviewers.map((person) => ({ id: person.id, name: person.name })),
    questions: row.questions.map((question) => ({
      id: question.id,
      kind: question.kind,
      question: question.question,
      answer: question.answer,
      confidence: question.confidence,
      better: question.better,
    })),
  };
}

export type InterviewForUi = ReturnType<typeof interviewForUi>;

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

export type BankAnswer = {
  questionId: string;
  answer: string;
  better: string;
  confidence: number;
  company: string;
  round: number;
  outcome: InterviewOutcome;
  applicationStage: Stage;
  /** Correlation, never proof. The type name says so and so does the tool. */
  ledSomewhere: boolean;
};

export type BankEntry = {
  key: string;
  /** The most recently recorded wording. The words vary; this is the one to print. */
  question: string;
  kind: QuestionKind;
  timesAsked: number;
  companies: { id: string; name: string }[];
  answers: BankAnswer[];
  meanConfidence: number | null;
  lastAskedAt: Date | null;
};

export type QuestionBank = {
  entries: BankEntry[];
  /** Asked more than once. The list worth rehearsing. */
  repeated: BankEntry[];
  /** No answer on file, or a confidence of 1 or 2. The homework. */
  weak: BankEntry[];
  /** Answers from a round that was passed, or a job that reached an offer. */
  worked: BankEntry[];
  coverage: {
    kind: QuestionKind;
    label: string;
    intent: string;
    questions: number;
    answered: number;
    meanConfidence: number | null;
  }[];
  totals: { interviews: number; questions: number; answered: number; employers: number };
  /** What this cannot tell you, in words. Always populated. */
  caveats: string[];
};

const mean = (values: number[]) =>
  values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

/** Archive filter 5 of 5 — spelled two levels deep, on every read below. */
export async function questionBank(
  userId: string,
  options?: {
    applicationId?: string;
    companyId?: string;
    kind?: QuestionKind;
    search?: string;
    minTimesAsked?: number;
    limit?: number;
  },
): Promise<QuestionBank> {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 300);
  const where: Prisma.InterviewQuestionWhereInput = {
    userId,
    // 5 of 5 — a question hangs off an interview which hangs off an
    // application, so the filter is two levels deep and every read spells it.
    interview: {
      application: {
        archivedAt: null,
        ...(options?.companyId ? { companyId: options.companyId } : {}),
      },
      ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
    },
    ...(options?.kind ? { kind: options.kind } : {}),
    ...(options?.search ? { question: { contains: options.search, mode: "insensitive" as const } } : {}),
  };

  const [groups, coverageRows, interviewCount] = await Promise.all([
    db.interviewQuestion.groupBy({
      by: ["key"],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _count: { key: "desc" } }, { _max: { createdAt: "desc" } }],
      take: limit,
    }),
    db.interviewQuestion.groupBy({
      by: ["kind"],
      where: { userId, interview: { application: { archivedAt: null } } },
      _count: { _all: true },
    }),
    db.interview.count({ where: { userId, application: { archivedAt: null } } }),
  ]);

  const floor = options?.minTimesAsked ?? 1;
  const keys = groups.filter((group) => group._count._all >= floor).map((group) => group.key);

  const rows =
    keys.length === 0
      ? []
      : await db.interviewQuestion.findMany({
          where: { ...where, key: { in: keys } },
          include: {
            interview: {
              select: {
                round: true,
                outcome: true,
                application: {
                  select: { stage: true, company: { select: { id: true, name: true } } },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        });

  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }

  const entries: BankEntry[] = keys.map((key) => {
    const list = byKey.get(key) ?? [];
    const newest = list[0];
    const companies = new Map<string, string>();
    for (const row of list) {
      companies.set(row.interview.application.company.id, row.interview.application.company.name);
    }
    const answers: BankAnswer[] = list
      .map((row) => ({
        questionId: row.id,
        answer: row.answer,
        better: row.better,
        confidence: row.confidence,
        company: row.interview.application.company.name,
        round: row.interview.round,
        outcome: row.interview.outcome,
        applicationStage: row.interview.application.stage,
        ledSomewhere:
          row.interview.outcome === "PASSED" ||
          GOOD_STAGES.includes(row.interview.application.stage),
      }))
      .sort(
        (a, b) =>
          Number(b.ledSomewhere) - Number(a.ledSomewhere) ||
          b.confidence - a.confidence ||
          Number(Boolean(b.answer)) - Number(Boolean(a.answer)),
      );

    return {
      key,
      question: newest?.question ?? key,
      kind: newest?.kind ?? "OTHER",
      timesAsked: list.length,
      companies: [...companies].map(([id, name]) => ({ id, name })),
      answers,
      meanConfidence: mean(answers.filter((a) => a.confidence > 0).map((a) => a.confidence)),
      lastAskedAt: newest?.createdAt ?? null,
    };
  });

  const answered = rows.filter((row) => row.answer.trim() !== "").length;
  const employers = new Set(rows.map((row) => row.interview.application.company.id)).size;
  const questions = coverageRows.reduce((total, row) => total + row._count._all, 0);

  const caveats = [
    "Questions are grouped by their exact wording, so the same question remembered two different ways is two entries here. Merge them by eye before reporting a count.",
    "`ledSomewhere` means the round was passed or the job reached an offer. That is correlation: it does not show the answer was why, and a good answer in a job you lost for other reasons still reads as not working.",
  ];
  if (questions < 20) {
    caveats.push(
      `Only ${questions} question${questions === 1 ? " is" : "s are"} on file, which is not enough to draw a conclusion from. Say so rather than reporting a pattern.`,
    );
  }

  return {
    entries,
    repeated: entries.filter((entry) => entry.timesAsked > 1),
    weak: entries.filter(
      (entry) =>
        entry.answers.every((answer) => answer.answer.trim() === "") ||
        (entry.meanConfidence !== null && entry.meanConfidence <= 2),
    ),
    worked: entries.filter((entry) => entry.answers.some((answer) => answer.ledSomewhere && answer.answer.trim() !== "")),
    // Kinds with zero are INCLUDED: a zero is the most informative row here,
    // because it says which kind of question they have never written down.
    coverage: QUESTION_KINDS.map((kind) => {
      const of = rows.filter((row) => row.kind === kind);
      const declared = coverageRows.find((row) => row.kind === kind)?._count._all ?? 0;
      return {
        kind,
        label: QUESTION_LABEL[kind],
        intent: QUESTION_INTENT[kind],
        questions: declared,
        answered: of.filter((row) => row.answer.trim() !== "").length,
        meanConfidence: mean(of.filter((row) => row.confidence > 0).map((row) => row.confidence)),
      };
    }),
    totals: { interviews: interviewCount, questions, answered, employers },
    caveats,
  };
}

/**
 * Everything worth having in front of you before a round.
 *
 * The letters.ts pattern: one call that gathers what a good answer needs, so an
 * assistant does not have to know which six tools to call and in which order.
 * `employerQuestions` is the half people do not expect and the half that
 * matters — what THIS employer has already asked, which nothing else in the app
 * could answer before questions were rows.
 *
 * Takes either a booked round or just the job: somebody asking "what should I
 * expect at Stripe" has not necessarily put a date in yet, and refusing to help
 * until they do would be the wrong answer.
 */
export async function interviewBriefing(
  userId: string,
  target: { applicationId?: string; interviewId?: string },
) {
  const interview = target.interviewId ? await getInterview(userId, target.interviewId) : null;
  if (target.interviewId && !interview) throw new Error("No such interview");

  const applicationId = interview?.application.id ?? target.applicationId;
  if (!applicationId) throw new Error("Pass an application_id or an interview_id");

  const [application, rounds, bank] = await Promise.all([
    db.application.findFirst({
      // Prepping for a job you binned is a mistake worth refusing.
      where: { id: applicationId, userId, archivedAt: null },
      select: {
        id: true,
        roleTitle: true,
        stage: true,
        interviewRound: true,
        jobDescription: true,
        salaryRange: true,
        notes: true,
        company: { select: { id: true, name: true, website: true, notes: true } },
        activities: {
          orderBy: { occurredAt: "desc" },
          take: 10,
          select: { type: true, body: true, occurredAt: true },
        },
        tasks: {
          where: { doneAt: null },
          orderBy: { dueAt: "asc" },
          select: { id: true, title: true, dueAt: true },
        },
      },
    }),
    listInterviews(userId, { applicationId }),
    questionBank(userId, { limit: 40 }),
  ]);
  if (!application) throw new Error("No such application");

  // Narrowed to this employer. A second call rather than a filter over the
  // first, because the bank's grouping and its caveats are computed per read
  // and slicing the general one afterwards would report a count that was never
  // true of this employer.
  const atEmployer = await questionBank(userId, { companyId: application.company.id, limit: 40 });

  const missing: string[] = [];
  if (!application.jobDescription) missing.push("the posting — capture_job_posting would fill it");
  if (!application.company.notes) missing.push("anything researched about the company");
  if (interview && interview.interviewers.length === 0) missing.push("who is in the room");
  if (bank.totals.questions === 0) {
    missing.push("any question ever recorded, so there is no bank to draw on yet");
  }
  if (rounds.length === 0) missing.push("any earlier round at this employer to learn from");

  return {
    /** Null when prepping a job generally rather than one booked round. */
    interview,
    application,
    company: application.company,
    /** Who is in the room, when a round was named. */
    interviewers: interview?.interviewers ?? [],
    /** Every round at this employer, most recent first, with how each went. */
    history: rounds.filter((row) => row.id !== interview?.id),
    /** What THIS employer has already asked. The most useful list here. */
    employerQuestions: atEmployer.entries,
    /** What gets asked everywhere, most asked first. */
    commonQuestions: bank.repeated,
    /** On file with no answer, or one they rated badly. The homework. */
    weakAnswers: bank.weak,
    /** Whatever the stage checklist already put on their list for this job. */
    tasks: application.tasks,
    formatIntent: interview ? FORMAT_INTENT[interview.format] : "",
    /**
     * What is NOT on file. The most useful thing in this result: say the gaps
     * out loud rather than writing around them, and never invent a story, an
     * employer, a date or a metric to fill one.
     */
    missing,
  };
}

// ---------------------------------------------------------------------------
// Meetings that look like interviews
// ---------------------------------------------------------------------------

/** A calendar meeting that matches the pipeline, shaped for scheduleInterview. */
export type CalendarInterview = {
  /** The provider's own event id. `calendarEventId` refuses a second copy. */
  calendarEventId: string;
  title: string;
  start: Date;
  durationMins: number;
  location: string;
  url: string;
  format: InterviewFormat;
  applicationId: string;
  application: string;
  /** Contact ids already on file for the people in the room. */
  interviewerIds: string[];
  interviewers: string[];
  /** True when an Interview row already carries this event's id. */
  alreadyScheduled: boolean;
};

/**
 * Meetings on their own calendar that look like interviews, as inputs.
 *
 * DELIBERATELY NOT A WRITER. It returns what `schedule_interview` would take and
 * stops, because a meeting called "Acme — chat" might be a screen or might be a
 * catch-up with somebody who used to work there, and there is no rule that can
 * tell. The assistant reads these back, the person says which are real, and
 * `schedule_interview` writes them one at a time.
 *
 * `calendarEventId` carries through, which is what makes running this twice
 * harmless: scheduleInterview already refuses a second row for an event it has
 * seen.
 */
export async function interviewsFromCalendar(
  userId: string,
  options?: { days?: number; now?: Date },
): Promise<{ meetings: CalendarInterview[]; warning: string | null; windowDays: number }> {
  const now = options?.now ?? new Date();
  const windowDays = Math.min(Math.max(options?.days ?? 21, 1), 90);
  const { listMatchedEvents } = await import("@/lib/data/accounts");

  const { events, warning } = await listMatchedEvents(
    userId,
    now,
    new Date(now.getTime() + windowDays * 86_400_000),
  );

  const applicationIds = [...new Set(events.map((event) => event.applicationId).filter(Boolean))] as string[];
  if (applicationIds.length === 0) return { meetings: [], warning, windowDays };

  // Archive filter, spelled by hand: a meeting about a job in the bin is not an
  // interview to schedule.
  const [applications, taken] = await Promise.all([
    db.application.findMany({
      where: { userId, id: { in: applicationIds }, archivedAt: null },
      select: { id: true, roleTitle: true, company: { select: { name: true } } },
    }),
    db.interview.findMany({
      where: { userId, calendarEventId: { in: events.map((event) => event.id) } },
      select: { calendarEventId: true },
    }),
  ]);
  const byId = new Map(applications.map((row) => [row.id, row]));
  const seen = new Set(taken.map((row) => row.calendarEventId));

  const meetings: CalendarInterview[] = [];
  for (const event of events) {
    const application = event.applicationId ? byId.get(event.applicationId) : undefined;
    if (!application) continue;
    const minutes = Math.max(
      15,
      Math.round((event.end.getTime() - event.start.getTime()) / 60_000) || 30,
    );
    meetings.push({
      calendarEventId: event.id,
      title: event.title,
      start: event.start,
      durationMins: minutes,
      location: event.location,
      url: event.url,
      // Read off the meeting rather than guessed at: a link in the location is
      // a video call, an address is an onsite, and neither is a judgement.
      format: /zoom|meet\.google|teams|whereby|hangout|https?:\/\//i.test(
        `${event.location} ${event.url}`,
      )
        ? "VIDEO"
        : event.location.trim()
          ? "ONSITE"
          : "OTHER",
      applicationId: application.id,
      application: `${application.roleTitle} at ${application.company.name}`,
      interviewerIds: event.contactId ? [event.contactId] : [],
      interviewers: event.contactName ? [event.contactName] : [],
      alreadyScheduled: seen.has(event.id),
    });
  }

  return { meetings: meetings.sort((a, b) => a.start.getTime() - b.start.getTime()), warning, windowDays };
}
