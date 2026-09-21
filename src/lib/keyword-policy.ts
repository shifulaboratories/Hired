/**
 * How close to a posting's own words a document may get.
 *
 * The problem is real and it is not a matter of taste. Applicant tracking
 * systems screen on exact tokens. Somebody who has run Salesforce for three
 * years is, to the filter, a person who has never heard of HubSpot — and is cut
 * before a human reads a line, over a tool they could be productive in inside a
 * week. Writing "CRM" when the posting says "Salesforce" loses a screen for
 * nothing at all.
 *
 * So this is a dial, but it is NOT a dial between honest and dishonest. Look at
 * what the three levels actually differ on: how much of the POSTING'S
 * VOCABULARY may be used for work that is genuinely on file, and whether a tool
 * you have not used may appear as comparable. None of them permits claiming you
 * did a thing at a place you did not do it — that floor is in CRITICAL_RULES
 * in handler.ts, it applies at every level, and nothing here weakens it.
 *
 * That is not squeamishness, it is what works. A filter scans the whole
 * document for the token; it does not care whether "HubSpot" sits in a skills
 * line or in a bullet under an employer. Putting it in the skills line passes
 * exactly the same filter and survives the interview that follows. Putting it
 * under an employer with dates passes the same filter and collapses the first
 * time somebody asks a question about it. The second buys nothing and costs
 * the job.
 *
 * Pure, and not in src/lib/data/: no database, no userId, same as
 * resume-schema.ts and letter-kinds.ts.
 */

export const KEYWORD_POLICIES = ["STRICT", "MATCH", "ADJACENT"] as const;
export type KeywordPolicy = (typeof KEYWORD_POLICIES)[number];

export const DEFAULT_KEYWORD_POLICY: KeywordPolicy = "MATCH";

export const POLICY_LABEL: Record<KeywordPolicy, string> = {
  STRICT: "Your words only",
  MATCH: "Their words for your work",
  ADJACENT: "Plus what transfers",
};

/** One line, for a settings row. */
export const POLICY_BLURB: Record<KeywordPolicy, string> = {
  STRICT:
    "Nothing is rephrased to match a posting. Safest, and it loses screens over vocabulary.",
  MATCH:
    "Work you actually did, described in the posting's words. No new claims — the same claim, their spelling.",
  ADJACENT:
    "Everything above, plus tools you have not used may appear as comparable when you have recorded the transfer.",
};

/**
 * What each level permits, written for whoever is doing the writing.
 *
 * This text goes to an assistant verbatim — through the briefing, through
 * get_me_snapshot and through the tailoring workflow — so it is instructions,
 * not documentation. Every sentence is a rule somebody has to be able to
 * follow without asking a follow-up question.
 */
export const POLICY_RULE: Record<KeywordPolicy, string> = {
  STRICT: `Use their own words. Do not rephrase anything to match the posting, even when the
posting's word means the same thing. If the posting asks for something they have not
written down, say so — do not go looking for a way to say yes.`,

  MATCH: `Use the POSTING'S vocabulary for work that is genuinely on file. If they wrote "CRM"
and the posting says "Salesforce administration", and Salesforce is what they actually
used, write it the posting's way. Same claim, their spelling — this adds no experience,
it only stops a filter missing experience they really have. Where the posting names a
tool nothing on file supports, leave it out and report it as a gap.`,

  ADJACENT: `Everything MATCH permits. In addition: when the posting names a tool they have not
used AND they have recorded a transfer that covers it, that tool may appear in a SKILLS
line, marked as comparable — "Salesforce (comparable: HubSpot, Pipedrive)" or a
"Transferable" group. Never inside a bullet under an employer. Never with a date, a
duration or a metric. Never phrased as something they did. A transfer they have not
recorded does not exist: do not infer one, and do not invent the bridge yourself. Say in
your summary which keywords you placed this way, so they can answer for them in a room.`,
};

/** The floor, restated wherever a policy is. True at every level, including ADJACENT. */
export const POLICY_FLOOR =
  "At every level: never claim work at an employer they did not do, never invent a date, " +
  "a duration or a metric, and never move a tool they have not used into a bullet about a job.";

export function isKeywordPolicy(value: string): value is KeywordPolicy {
  return (KEYWORD_POLICIES as readonly string[]).includes(value);
}

/**
 * A stored value, or the default.
 *
 * Validated rather than cast: a typo written straight into the column would
 * otherwise reach a writer as a policy with no rule text behind it, and the
 * failure mode of that is silence — the assistant simply gets no instruction
 * and falls back to whatever it would have done anyway.
 */
export function readPolicy(value: string | null | undefined): KeywordPolicy {
  const upper = (value ?? "").trim().toUpperCase();
  return isKeywordPolicy(upper) ? upper : DEFAULT_KEYWORD_POLICY;
}

/** The full instruction for one policy: what it permits, then the floor. */
export function policyInstruction(policy: KeywordPolicy): string {
  return `${POLICY_RULE[policy]}\n${POLICY_FLOOR}`;
}
