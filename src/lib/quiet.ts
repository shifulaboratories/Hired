/**
 * How long an application has been quiet, as a rule rather than a guess.
 *
 * The number was computed inside `diagnoseSearch` and never left it, so the
 * dashboard could tell you three things had gone quiet while the board they
 * were sitting on said nothing. It lives here — a pure module with no Prisma
 * import — because the board and the filter menu are client components, and
 * `src/lib/resume-text.ts` already records what happens when a function is
 * imported into the browser from the data layer: it drags the whole module,
 * Prisma and node:crypto included, into the bundle.
 */

export const DAY = 86_400_000;

/**
 * How long an application can sit in a stage before it has probably died.
 *
 * These are the numbers diagnoseSearch has always used, kept exactly, because
 * one rule means one set of thresholds — a dashboard that calls something
 * stalled while the card beside it looks fine is worse than either alone. A
 * wishlist entry is not quiet (nothing has happened because nothing was meant
 * to happen yet) so it has no threshold, and neither do the endings.
 */
export const STALE_AFTER: Partial<Record<string, number>> = {
  APPLIED: 21,
  // One number for the whole of interviewing, where there used to be three
  // (14 for a screen, 14 for an interview, 10 for a final round). Two of them
  // were the same anyway, and which of the three a given employer's process
  // belonged in was a guess — so the tighter of the two live numbers wins and
  // the rule stays one sentence: two weeks of silence mid-process is quiet.
  INTERVIEWING: 14,
  OFFER: 7,
};

/**
 * When a card starts saying how long it has been. Below this the number is
 * noise — everything is a few days quiet — and a badge on every card teaches
 * nothing.
 */
export const SHOW_QUIET_AFTER = 7;

/** Everything the rule needs to know about one application. */
export type QuietSubject = {
  stage: string;
  createdAt: Date;
  appliedAt?: Date | null;
  /** The most recent activity of any kind, if there is one. */
  lastActivityAt?: Date | null;
  /** When it last changed stage, if it ever has. */
  lastStageChangeAt?: Date | null;
};

/**
 * The last time anything actually happened, which is deliberately NOT
 * `updatedAt`: dragging a card past another one writes a sort order and would
 * otherwise reset the clock on an application nobody touched.
 */
export function lastTouchAt(subject: QuietSubject): Date {
  const candidates = [
    subject.lastActivityAt,
    subject.lastStageChangeAt,
    subject.appliedAt,
    subject.createdAt,
  ].filter(Boolean) as Date[];
  return candidates.reduce((latest, date) => (date > latest ? date : latest), candidates[0]);
}

/** Whole days since the last touch. Never negative, even with a future date. */
export function quietDaysFor(subject: QuietSubject, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - lastTouchAt(subject).getTime()) / DAY));
}

/**
 * Whether this one is worth chasing: past its stage's threshold, and still
 * live. A rejection that has sat untouched for a year is not a job to chase.
 */
export function hasGoneQuiet(stage: string, quietDays: number, terminal: readonly string[]): boolean {
  if (terminal.includes(stage)) return false;
  const threshold = STALE_AFTER[stage];
  return threshold !== undefined && quietDays >= threshold;
}
