import { db } from "@/lib/db";

/**
 * How far into their first ten minutes somebody is.
 *
 * A new workspace rendered a dashboard of zeros, an empty chase list and a
 * diagnosis of nothing — four cards agreeing that nothing has happened. Three
 * steps replace them, and each one answers "is this done" from what is
 * actually on file rather than from a flag somebody has to remember to set.
 *
 * userId first and positional, like everything else here: the answer is about
 * one person's workspace.
 */

export type SetupStep = {
  key: "connect" | "history" | "track";
  done: boolean;
  /** What the step is waiting for, in one line. */
  detail: string;
};

export type SetupStatus = {
  steps: SetupStep[];
  /** True while at least one step is outstanding. */
  outstanding: boolean;
  /** When they last finished or skipped the tour. Null means never. */
  tourSeenAt: Date | null;
};

export async function setupStatus(userId: string): Promise<SetupStatus> {
  const [connection, role, highlight, application, profile] = await Promise.all([
    // lastUsedAt, never the existence of a row: ensureDefaultConnection runs
    // from bootstrap, from sign-in and from every Settings render, so counting
    // rows reports every workspace that has ever existed as connected.
    db.mcpConnection.findFirst({
      where: { userId, lastUsedAt: { not: null } },
      select: { id: true, lastUsedAt: true },
    }),
    db.role.findFirst({ where: { userId }, select: { id: true } }),
    db.highlight.findFirst({ where: { userId }, select: { id: true } }),
    // Archiving your only application un-ticks the step, which is honest: the
    // setup strip asks whether you have started, not whether you ever did.
    db.application.findFirst({ where: { userId, archivedAt: null }, select: { id: true } }),
    db.profile.findUnique({ where: { userId }, select: { tourSeenAt: true } }),
  ]);

  // Easiest first. Connecting an assistant is the most powerful step and the
  // one most likely to stop somebody who has never heard of MCP, so it is not
  // the thing standing between them and their first useful minute.
  const steps: SetupStep[] = [
    {
      key: "track",
      done: application !== null,
      detail: application ? "You have a job on the board." : "No jobs on the board yet.",
    },
    {
      key: "history",
      done: role !== null || highlight !== null,
      detail:
        role || highlight ? "There is something to write resumes from." : "Nothing on file yet.",
    },
    {
      key: "connect",
      done: connection !== null,
      detail: connection ? "An assistant has used this account." : "Nothing connected yet.",
    },
  ];

  return {
    steps,
    // Connecting an assistant is optional — the card says so in as many words —
    // and an optional step was holding the strip open forever. Somebody who
    // never connects anything had three onboarding cards at the top of their
    // Today screen permanently. It still shows while the strip is up for
    // another reason, which is where it belongs: beside the two that matter.
    outstanding: steps.some((step) => step.key !== "connect" && !step.done),
    tourSeenAt: profile?.tourSeenAt ?? null,
  };
}

/**
 * Put the tour away, or bring it back.
 *
 * Finishing and skipping are the same write on purpose: somebody who closed it
 * on the second card has decided, and asking again tomorrow is the behaviour
 * everyone hates. Settings has the button that undoes it.
 *
 * An upsert rather than an update — a brand-new account may not have a Profile
 * row yet, and the first thing it does in the app should not be a crash.
 */
export async function setTourSeen(userId: string, seen: boolean) {
  const tourSeenAt = seen ? new Date() : null;
  await db.profile.upsert({
    where: { userId },
    update: { tourSeenAt },
    create: { userId, tourSeenAt },
  });
  return { tourSeenAt };
}
