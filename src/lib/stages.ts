import type { ActivityType, Stage } from "@prisma/client";

/**
 * Stage and activity vocabulary: labels, tones and orderings, with no data
 * access. Its own module because client components need these and the data
 * layer that owns them reaches the server's fetch guard, which a browser build
 * cannot load. pipeline.ts re-exports all of it, so server code is unchanged.
 */

export const STAGES: Stage[] = [
  "WISHLIST",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "ACCEPTED",
  "LOST",
];

/** Stages shown as columns on the board. Terminal states get their own view. */
export const BOARD_STAGES: Stage[] = ["WISHLIST", "APPLIED", "INTERVIEWING", "OFFER"];

export const STAGE_LABEL: Record<Stage, string> = {
  WISHLIST: "Wishlist",
  APPLIED: "Applied",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  LOST: "Lost",
};

/**
 * A stage is a position on one path, not a category, so the hue rotates in one
 * direction as an application advances — steel, violet, then gold at the offer.
 * Turning one way is what keeps it a path: you can tell "further along" from
 * two chips without knowing which label is which.
 *
 * The two endings sit outside the rotation because they mean something other
 * than progress. Values are CSS variables so they follow the theme; a fixed
 * colour tuned for one mode goes muddy in the other.
 */
export const STAGE_TONE: Record<Stage, string> = {
  WISHLIST: "var(--stage-wishlist)",
  APPLIED: "var(--stage-applied)",
  INTERVIEWING: "var(--stage-interview)",
  OFFER: "var(--stage-offer)",
  ACCEPTED: "var(--stage-accepted)",
  LOST: "var(--stage-lost)",
};

/**
 * How deep into interviewing a card is, as a colour.
 *
 * Screening, interviewing and final round were three stages and therefore three
 * hues, and losing them would have flattened the one thing they got right: you
 * could see from across the board that one job was further along than another.
 * The rounds inherit those hues instead — round 1 wears what screening wore,
 * round 2 what interviewing wore, round 3 and beyond what the final round wore.
 * An application whose round nobody has set gets the base tone, which is most
 * of them and is the point: the board says nothing until you say something.
 */
export const ROUND_TONE = [
  "var(--stage-screen)",
  "var(--stage-interview)",
  "var(--stage-final)",
] as const;

export function roundTone(round: number): string {
  if (round <= 0) return STAGE_TONE.INTERVIEWING;
  return ROUND_TONE[Math.min(round, ROUND_TONE.length) - 1];
}

/** "Round 2", or the name it was given. Empty when nobody has said. */
export function roundLabelOf(round: number, label: string): string {
  const named = label.trim();
  if (named) return named;
  return round > 0 ? `Round ${round}` : "";
}

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  EMAIL_SENT: "Email sent",
  EMAIL_RECEIVED: "Email received",
  CALL: "Call",
  INTERVIEW: "Interview",
  FOLLOW_UP: "Follow-up",
  APPLIED: "Applied",
  OFFER: "Offer",
  REJECTION: "Rejection",
  REFERRAL: "Referral",
  OUTREACH: "Outreach",
};

/**
 * The kinds of touch a person logs by hand, in the order a picker should
 * offer them. The rest of ActivityType is written by the system — a stage
 * change, an application — and offering those invites a timeline that
 * disagrees with the board.
 */
export const ACTIVITY_OPTIONS: ActivityType[] = [
  "NOTE",
  "OUTREACH",
  "EMAIL_SENT",
  "EMAIL_RECEIVED",
  "CALL",
  "INTERVIEW",
  "FOLLOW_UP",
  "REFERRAL",
];

export const TERMINAL_STAGES: Stage[] = ["ACCEPTED", "LOST"];
