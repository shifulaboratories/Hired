import type { Stage, StageTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { pick } from "@/lib/data/patch";
import { atHourInDays } from "@/lib/time";

/**
 * Stage checklists: what should happen when a job reaches a stage.
 *
 * Every search has a ritual. One person sends a thank-you within a day of every
 * interview; another always sets a reminder to check the posting is still up a
 * week after applying; a third does neither and would find both an annoyance.
 * So these are rows a person owns, nothing is built in, and a new account has
 * none until it asks for the starting set.
 *
 * Two rules that are the whole design:
 *
 * 1. **A line fires once per application, ever.** Not once per move. Going back
 *    to APPLIED after an interview falls through must not re-add the four tasks
 *    you already ticked off, so the dedupe is on `Task.stageTemplateId` and does
 *    not care whether the task is done.
 * 2. **Editing a template never touches what it already made.** A task on
 *    somebody's list is work in progress; the template is a setting. Deleting a
 *    line SET NULLs its tasks rather than deleting them.
 */

export type StageTemplateInput = {
  stage?: Stage;
  title?: string;
  detail?: string;
  /** Days from the move to the due date. Null means no date at all. */
  dueInDays?: number | null;
  enabled?: boolean;
  sortOrder?: number;
};

const EDITABLE = ["stage", "title", "detail", "dueInDays", "enabled", "sortOrder"] as const;

export async function listStageTemplates(userId: string, stage?: Stage) {
  return db.stageTemplate.findMany({
    where: { userId, ...(stage ? { stage } : {}) },
    orderBy: [{ stage: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function createStageTemplate(userId: string, input: StageTemplateInput) {
  const title = input.title?.trim();
  if (!title) throw new Error("A checklist line needs a title");
  if (!input.stage) throw new Error("A checklist line needs a stage");
  const last = await db.stageTemplate.findFirst({
    where: { userId, stage: input.stage },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return db.stageTemplate.create({
    data: {
      userId,
      stage: input.stage,
      title,
      detail: input.detail?.trim() ?? "",
      dueInDays: input.dueInDays ?? null,
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? (last ? last.sortOrder + 1 : 0),
    },
  });
}

export async function updateStageTemplate(userId: string, id: string, patch: StageTemplateInput) {
  const existing = await db.stageTemplate.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new Error("No such checklist line");
  const data = pick(patch, EDITABLE);
  if (typeof data.title === "string") {
    data.title = data.title.trim();
    if (!data.title) throw new Error("A checklist line needs a title");
  }
  return db.stageTemplate.update({ where: { id }, data });
}

/**
 * Delete a line. The tasks it already made stay — SET NULL in the database,
 * not cascade. Deleting a setting should never delete somebody's work.
 */
export async function deleteStageTemplate(userId: string, id: string) {
  const { count } = await db.stageTemplate.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such checklist line");
  return { deleted: count };
}

/**
 * A starting set, for somebody who does not want to design one.
 *
 * Deliberately short and deliberately boring — the four things that actually
 * get forgotten. Skips any stage where lines already exist rather than adding
 * duplicates, and reports what it did.
 */
const STARTER: { stage: Stage; title: string; detail: string; dueInDays: number | null }[] = [
  {
    stage: "APPLIED",
    title: "Check the posting is still up",
    detail: "A pulled listing usually means the role is filled or frozen. Worth knowing before you chase.",
    dueInDays: 7,
  },
  {
    stage: "APPLIED",
    title: "Find someone who works there",
    detail: "One person on the inside beats three follow-up emails. Add them under People.",
    dueInDays: 2,
  },
  {
    stage: "INTERVIEWING",
    title: "Send a thank-you",
    detail: "Within a day. Name one thing from the conversation and close one gap you noticed.",
    dueInDays: 1,
  },
  {
    stage: "INTERVIEWING",
    title: "Write down what they asked",
    detail: "Log it on the timeline while you still remember. It is what the next round is prepared from.",
    dueInDays: 0,
  },
  {
    stage: "OFFER",
    title: "Record the numbers",
    detail: "Base, bonus, equity, sign-on and the day you have to answer by.",
    dueInDays: 0,
  },
  {
    stage: "LOST",
    title: "Ask what would have made the difference",
    detail: "Most people never ask. The ones who do get an answer about a third of the time.",
    dueInDays: 2,
  },
];

export async function seedStageTemplates(userId: string) {
  const existing = await db.stageTemplate.findMany({ where: { userId }, select: { stage: true } });
  const taken = new Set(existing.map((row) => row.stage));
  const wanted = STARTER.filter((row) => !taken.has(row.stage));
  if (wanted.length === 0) {
    return { created: 0, skipped: STARTER.length, templates: await listStageTemplates(userId) };
  }
  let order = 0;
  await db.stageTemplate.createMany({
    data: wanted.map((row) => ({ userId, ...row, sortOrder: order++ })),
  });
  return {
    created: wanted.length,
    skipped: STARTER.length - wanted.length,
    templates: await listStageTemplates(userId),
  };
}

export type MaterialisedTask = { id: string; title: string; dueAt: Date | null; templateId: string };

/**
 * Fire the checklist for a stage, once per application.
 *
 * Called by moveApplicationStage after the move lands. Returns what it created
 * so the caller can say so — a stage move that silently adds four tasks is a
 * stage move somebody stops trusting.
 *
 * `timeZone` is passed in rather than looked up because the caller has already
 * resolved it for the follow-up date, and two reads of the same profile in one
 * move is one too many. The hour is 9am, the same as every other date this app
 * sets itself.
 */
export async function applyStageTemplates(
  userId: string,
  applicationId: string,
  stage: Stage,
  timeZone: string,
  now = new Date(),
): Promise<MaterialisedTask[]> {
  const templates = await db.stageTemplate.findMany({
    where: { userId, stage, enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (templates.length === 0) return [];

  // Once per application, ever — not once per move. Done tasks count: going
  // back a stage and forward again must not re-add what you already ticked.
  const already = await db.task.findMany({
    where: { userId, applicationId, stageTemplateId: { in: templates.map((row) => row.id) } },
    select: { stageTemplateId: true },
  });
  const fired = new Set(already.map((row) => row.stageTemplateId));
  const wanted = templates.filter((template) => !fired.has(template.id));
  if (wanted.length === 0) return [];

  const made: MaterialisedTask[] = [];
  for (const template of wanted) {
    const task = await db.task.create({
      data: {
        userId,
        applicationId,
        title: template.title,
        detail: template.detail,
        dueAt:
          template.dueInDays === null ? null : atHourInDays(timeZone, template.dueInDays, 9, now),
        stageTemplateId: template.id,
      },
      select: { id: true, title: true, dueAt: true },
    });
    made.push({ ...task, templateId: template.id });
  }
  return made;
}

/** How many live applications each line has already fired for. */
export async function stageTemplateUsage(userId: string): Promise<Map<string, number>> {
  const rows = await db.task.groupBy({
    by: ["stageTemplateId"],
    where: { userId, stageTemplateId: { not: null } },
    _count: { _all: true },
  });
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.stageTemplateId) out.set(row.stageTemplateId, row._count._all);
  }
  return out;
}

export type { StageTemplate };
