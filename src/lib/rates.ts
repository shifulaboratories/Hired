/**
 * When a share of something is a rate, and when it is three rows.
 *
 * A search is a small sample for months, and a confident-looking 100% read off
 * one application is worse than no answer: somebody rewrites a resume because
 * of it. Every rate the app shows or a tool returns comes through here, and is
 * null under MIN_RATE_BASIS. Pure, so analytics.ts and pipeline.ts — which
 * import each other's neighbours — can both use it without a cycle.
 */

/** Under this, a rate is not a rate. */
export const MIN_RATE_BASIS = 5;

export function rateOf(part: number, whole: number): number | null {
  return whole >= MIN_RATE_BASIS ? Math.round((part / whole) * 100) : null;
}
