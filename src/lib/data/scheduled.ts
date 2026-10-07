import { db } from "@/lib/db";
import { SETTING_KEYS, getSettings, setSetting, type InstanceSettings } from "@/lib/settings";

/**
 * Whether anything outside the app is actually calling it on a schedule.
 *
 * This app runs no timers: the digest and the background sweeps happen when a
 * scheduler the self-hoster sets up calls /api/digest/<token> or
 * /api/sweep/<token>. No deploy path ships that scheduler. So a switch that
 * says "send me a Monday summary" or "watch this board" was a promise the
 * instance could not see itself breaking — the first one on the hosted
 * instance had never run, and nothing anywhere said so.
 *
 * The routes stamp a clock when they run. This file reads those clocks back as
 * one answer per job: is a token set at all, when did a call last arrive, and
 * is that recent enough to call the job scheduled. Every screen and tool that
 * offers a scheduled feature asks here, so "it will happen" is only ever said
 * when something has been seen to happen.
 *
 * Like system.ts, nothing here is anyone's content: it is the instance talking
 * about itself, so it takes no userId. The clocks are Setting rows of the same
 * bookkeeping kind as archive_swept_at, and listVariables hides them the same
 * way.
 */

export const JOBS = ["digest", "boards", "postings", "mail"] as const;
export type Job = (typeof JOBS)[number];

const CLOCK: Record<Job, string> = {
  digest: SETTING_KEYS.digestRanAt,
  boards: SETTING_KEYS.boardsRanAt,
  postings: SETTING_KEYS.postingsRanAt,
  mail: SETTING_KEYS.mailRanAt,
};

/**
 * How long without a call before a job counts as not running. Each is a few
 * times the cadence the admin help text asks for — hourly for the digest and
 * the mail, every few hours for boards, daily for postings — so one missed run
 * is not an alarm and a dead scheduler is.
 */
const STALE_AFTER_HOURS: Record<Job, number> = {
  digest: 6,
  boards: 24,
  postings: 72,
  mail: 6,
};

const WHAT: Record<Job, string> = {
  digest: "the digest address",
  boards: "the board sweep",
  postings: "the posting sweep",
  mail: "the mail sweep",
};

export type ScheduleState = {
  job: Job;
  /** A token is set, so the address answers at all. */
  enabled: boolean;
  lastRunAt: Date | null;
  /** Called recently enough to rely on. */
  running: boolean;
  /** One sentence for a person, empty when there is nothing to say. */
  note: string;
};

/** Stamp a job's clock. Called by the routes after a run, never before. */
export async function recordJobRun(job: Job, at = new Date()) {
  await setSetting(CLOCK[job], String(at.getTime()));
}

export async function scheduleStates(settings?: InstanceSettings): Promise<Record<Job, ScheduleState>> {
  const [resolved, rows] = await Promise.all([
    settings ?? getSettings(),
    db.setting.findMany({ where: { key: { in: Object.values(CLOCK) } } }),
  ]);
  const stamped = new Map(rows.map((row) => [row.key, Number.parseInt(row.value, 10)]));
  const now = Date.now();
  const out = {} as Record<Job, ScheduleState>;
  for (const job of JOBS) {
    const enabled = Boolean(job === "digest" ? resolved.digestToken : resolved.sweepToken);
    const ms = stamped.get(CLOCK[job]);
    const lastRunAt = ms && Number.isFinite(ms) ? new Date(ms) : null;
    const running =
      enabled && lastRunAt !== null && now - lastRunAt.getTime() < STALE_AFTER_HOURS[job] * 3_600_000;
    out[job] = { job, enabled, lastRunAt, running, note: noteFor(job, enabled, lastRunAt, running) };
  }
  return out;
}

export async function scheduleState(job: Job): Promise<ScheduleState> {
  return (await scheduleStates())[job];
}

function noteFor(job: Job, enabled: boolean, lastRunAt: Date | null, running: boolean): string {
  if (running) return "";
  if (!enabled) {
    return `Nothing is scheduled on this instance: ${WHAT[job]} is off, so this will not happen on its own until whoever runs it sets one up.`;
  }
  if (!lastRunAt) {
    return `Nothing has called ${WHAT[job]} on this instance yet, so this will not happen on its own until whoever runs it points a scheduler at it.`;
  }
  return `${WHAT[job][0].toUpperCase()}${WHAT[job].slice(1)} last ran ${lastRunAt.toISOString().slice(0, 10)}, so the scheduler that calls it has probably stopped.`;
}
