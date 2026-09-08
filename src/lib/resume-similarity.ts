/**
 * How much of one sentence survives in another, 0-1.
 *
 * Dice rather than shared-over-longest, because a bullet written from a note
 * usually says more than the note did: "Ran the Postgres migration" becoming
 * "Led the Postgres migration across six services" keeps everything that
 * mattered and scores 0.43 by the longest measure.
 *
 * Deliberately not in resume-diff.ts. That module compares bullets by exact
 * string and says why — the reader sees both wordings rather than a score's
 * opinion of whether they are the same bullet. This is a different question:
 * whether two claims are the same claim.
 *
 * Pure and free of Prisma so both sides of the question can share it: tracing a
 * resume's bullets back to a person's own material (`trace_resume_evidence`)
 * and deciding whether a re-imported resume is telling us anything new
 * (`import_resume`). Two implementations of "are these the same bullet" would
 * disagree the first time one of them was tuned.
 */
export function bulletSimilarity(a: string, b: string): number {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .filter((token) => token.length > 1),
    );
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/**
 * Above this, two bullets are the same bullet reworded.
 *
 * Tuned for the import, where the cost of the two errors is lopsided: a
 * duplicate bullet on a role is visible clutter a person has to delete, while a
 * missed one is a line they can add back from the document they still have. So
 * this leans toward treating a near-match as already on file.
 */
export const SAME_BULLET = 0.72;
