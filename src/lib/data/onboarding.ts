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
};

export async function setupStatus(userId: string): Promise<SetupStatus> {
  const [connection, role, highlight, application] = await Promise.all([
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
  ]);

  const steps: SetupStep[] = [
    {
      key: "connect",
      done: connection !== null,
      detail: connection
        ? "An assistant has used this workspace."
        : "Nothing has connected over MCP yet.",
    },
    {
      key: "history",
      done: role !== null || highlight !== null,
      detail: role || highlight ? "There is material to write from." : "Nothing is on file yet.",
    },
    {
      key: "track",
      done: application !== null,
      detail: application ? "The pipeline has something in it." : "No applications tracked yet.",
    },
  ];

  return { steps, outstanding: steps.some((step) => !step.done) };
}
