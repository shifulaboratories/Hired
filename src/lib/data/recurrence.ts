import type { TaskRepeat } from "@prisma/client";
import { atHourInDays, atHourInMonths, clockIn } from "@/lib/time";

/**
 * When a repeating task comes back.
 *
 * Small and pure — no `db` and no `userId`, because it computes a date and
 * touches nothing. Kept out of pipeline.ts because that file is imported by
 * client components and this is arithmetic they will never need.
 *
 * THE DECISION THAT MATTERS: the next date is stepped from the ANCHOR — the due
 * date of the first instance — and not from the last one. "Every Monday" ticked
 * off three weeks late must land on the next Monday, not on the Monday three
 * weeks hence. Stepping from the last due date drifts; stepping from the anchor
 * and taking the first occurrence after now does not, and it is also what stops
 * a month of ignored instances materialising forty rows the day somebody
 * catches up.
 */

export type Recurrence = {
  unit: TaskRepeat;
  every: number;
  until: Date | null;
  anchor: Date;
};

const DAY = 86_400_000;

/** 1-365, integral. Refused by name rather than clamped, so a typo is visible. */
export function assertEvery(every: number): number {
  if (!Number.isInteger(every) || every < 1 || every > 365) {
    throw new Error("Repeat every N: N has to be a whole number between 1 and 365.");
  }
  return every;
}

/**
 * The first occurrence strictly after `now`, stepped from the anchor.
 *
 * O(1) rather than a loop, because a task anchored two years ago would otherwise
 * step a hundred times to catch up. Elapsed-millisecond arithmetic can be off by
 * one across a DST boundary, so the computed result is checked against `now` and
 * stepped one further interval if it did not clear it — ONE correction, bounded.
 *
 * Returns null when the series has run out.
 */
export function nextOccurrence(
  timeZone: string,
  recurrence: Recurrence,
  now: Date,
): Date | null {
  const every = Math.max(1, Math.trunc(recurrence.every));
  const anchor = recurrence.anchor;
  const hour = clockIn(anchor, timeZone).hour;

  let candidate: Date;
  if (recurrence.unit === "MONTH") {
    const from = clockIn(anchor, timeZone);
    const to = clockIn(now, timeZone);
    const elapsed = (to.year - from.year) * 12 + (to.month - from.month);
    const steps = Math.max(1, Math.ceil((elapsed + 1) / every)) * every;
    candidate = atHourInMonths(timeZone, steps, hour, anchor);
    if (candidate.getTime() <= now.getTime()) {
      candidate = atHourInMonths(timeZone, steps + every, hour, anchor);
    }
  } else {
    const stepDays = every * (recurrence.unit === "WEEK" ? 7 : 1);
    const elapsed = Math.max(0, now.getTime() - anchor.getTime());
    const steps = Math.max(1, Math.ceil((elapsed + 1) / (stepDays * DAY))) * stepDays;
    candidate = atHourInDays(timeZone, steps, hour, anchor);
    if (candidate.getTime() <= now.getTime()) {
      candidate = atHourInDays(timeZone, steps + stepDays, hour, anchor);
    }
  }

  if (recurrence.until && candidate.getTime() > recurrence.until.getTime()) return null;
  return candidate;
}
