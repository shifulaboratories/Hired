import { Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { atHourInDays } from "@/lib/time";

/**
 * How long after a job lands in a stage its follow-up date is set for.
 *
 * `nextFollowUpAt` has always been armed on a stage move, from three numbers
 * hard-coded in pipeline.ts. This makes those numbers a person's own, without
 * changing anything for anybody who never sets one: an absent row resolves to
 * the same built-in, so no existing date moves.
 *
 * NULL IS NOT THE SAME AS NO ROW, and it is the thing to get right. A stored
 * null means "this stage deliberately arms nothing", which is what somebody
 * means by "I don't chase wishlist rows". No row at all means "use the
 * built-in". Deleting the row is how you go back to the default, which is why
 * `setStageCadence` distinguishes `null` from `undefined`.
 *
 * A sibling of stage-templates.ts rather than a column on StageTemplate: a
 * checklist line fires once per application EVER and a cadence re-arms on EVERY
 * move, which is the opposite rule.
 *
 * It must not import pipeline.ts. pipeline.ts imports stage-templates.ts, and
 * client components import pipeline.ts for its labels — a cycle here is not an
 * abstract concern. The stage list comes off the runtime enum instead.
 */

/**
 * The stages a cadence can be set on.
 *
 * `Object.values(Stage)` preserves declaration order, which is the same order
 * as `pipeline.STAGES`. That is a coincidence worth naming rather than relying
 * on silently: this file cannot import that constant without a cycle, and the
 * only thing it actually needs is the set, not the order.
 */
export const CADENCE_STAGES: Stage[] = Object.values(Stage).filter(
  (stage) => stage !== "ACCEPTED" && stage !== "LOST",
);

/**
 * Days after entering a stage that a nudge should fire.
 *
 * Moved here verbatim from pipeline.ts's FOLLOW_UP_DAYS, comment and all, so
 * there is one set of built-in numbers rather than two that can drift.
 */
export const DEFAULT_CADENCE: Partial<Record<Stage, number>> = {
  APPLIED: 7,
  // Four days, which is what screening and interviewing both used. The final
  // round's three is gone with the stage: the tighter number belonged to the
  // last conversation, and there is no longer a column that says which one
  // that is. A round is the person's note to themselves, not a rule.
  INTERVIEWING: 4,
  OFFER: 2,
};

/** A follow-up a year out is a note, not a follow-up. */
const MAX_DAYS = 365;

export type CadenceRow = {
  stage: Stage;
  /** What will actually be used: the stored days, the built-in, or null for off. */
  days: number | null;
  /** "yours" = a stored row, "off" = a stored null, "default" = no row at all. */
  source: "yours" | "off" | "default";
  /** The built-in for this stage, so a caller can say what reverting would give. */
  fallback: number | null;
};

export async function listStageCadences(userId: string): Promise<CadenceRow[]> {
  const stored = await db.stageCadence.findMany({ where: { userId } });
  const byStage = new Map(stored.map((row) => [row.stage, row]));

  return CADENCE_STAGES.map((stage) => {
    const row = byStage.get(stage);
    const fallback = DEFAULT_CADENCE[stage] ?? null;
    if (!row) return { stage, days: fallback, source: "default" as const, fallback };
    if (row.days === null) return { stage, days: null, source: "off" as const, fallback };
    return { stage, days: row.days, source: "yours" as const, fallback };
  });
}

/**
 * Set, switch off, or revert one stage.
 *
 * `days: number` stores it. `days: null` stores "arm nothing". `days: undefined`
 * DELETES the row and goes back to the built-in. Three meanings for one
 * argument is unusual and is the whole point of the model; the tool description
 * spells it out.
 */
export async function setStageCadence(
  userId: string,
  stage: Stage,
  days: number | null | undefined,
): Promise<CadenceRow[]> {
  if (stage === "ACCEPTED" || stage === "LOST") {
    throw new Error(
      `A move to ${stage} clears the follow-up date outright, so a cadence on it could never fire. Set one on APPLIED, INTERVIEWING or WISHLIST instead.`,
    );
  }

  if (days === undefined) {
    await db.stageCadence.deleteMany({ where: { userId, stage } });
    return listStageCadences(userId);
  }

  if (days !== null) {
    if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0) {
      throw new Error("A cadence is a whole number of days, and cannot be negative.");
    }
    if (days > MAX_DAYS) {
      throw new Error(`${days} days is a note, not a follow-up. The most this takes is ${MAX_DAYS}.`);
    }
  }

  await db.stageCadence.upsert({
    where: { userId_stage: { userId, stage } },
    create: { userId, stage, days },
    update: { days },
  });
  return listStageCadences(userId);
}

/** What one move should use. No row falls through to the built-in. */
export async function cadenceFor(userId: string, stage: Stage): Promise<number | null> {
  const row = await db.stageCadence.findUnique({
    where: { userId_stage: { userId, stage } },
    select: { days: true },
  });
  if (!row) return DEFAULT_CADENCE[stage] ?? null;
  return row.days;
}

/**
 * The date a move should arm, or `undefined` for "leave nextFollowUpAt alone".
 *
 * The whole arm-or-leave rule lives here so the move stays readable and so a
 * second caller cannot implement it differently. Step 3 is the one that matters
 * and the one the old code did not do: a date somebody set by hand for next
 * Tuesday must survive a stage move, because they set it on purpose.
 */
export async function followUpForMove(
  userId: string,
  stage: Stage,
  timeZone: string,
  current: Date | null,
  override?: number | null,
  now = new Date(),
): Promise<Date | null | undefined> {
  if (override !== undefined) {
    if (override === null) return null;
    return atHourInDays(timeZone, override, 9, now);
  }
  // A date still in the future was set for a reason. Do not overwrite it.
  if (current && current.getTime() > now.getTime()) return undefined;

  const days = await cadenceFor(userId, stage);
  if (days === null) return null;
  return atHourInDays(timeZone, days, 9, now);
}
