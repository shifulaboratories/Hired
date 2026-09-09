/**
 * Turning one typed line into one logged touch.
 *
 * "Recruiter called about Stripe, wants a system design round" is how a person
 * actually reports their week, and until now the app could only take it as
 * four fields on a form. The matching is deliberately deterministic — this
 * app has no language model of its own and must not grow one, because
 * self-hosting it stays one environment variable — so it does what a person
 * would do with a highlighter: look for a company it already knows, then for
 * words that name a kind of touch or a stage.
 *
 * Nothing here writes. It ranks candidates and proposes; the person confirms.
 * Pure and client-safe, so the preview can re-rank as you type without a
 * round trip.
 */

/** The parts of an application this can match against. */
export type Matchable = {
  id: string;
  company: string;
  roleTitle: string;
  stage: string;
};

export type QuickLogMatch = {
  id: string;
  company: string;
  roleTitle: string;
  stage: string;
  /** Higher is better. Only ever compared against its own siblings. */
  score: number;
  /** What matched, so the preview can say why rather than just asserting. */
  because: string;
};

export type QuickLogReading = {
  matches: QuickLogMatch[];
  /** The kind of touch the words point at. NOTE when they point at nothing. */
  type: string;
  /** A stage the words name, when they name one unambiguously. */
  stage: string | null;
};

/** Words that name a kind of touch, longest phrase first so "phone screen" wins. */
const TYPE_CUES: [RegExp, string][] = [
  [/\b(phone\s+screen|screening\s+call|recruiter\s+screen)\b/i, "CALL"],
  [/\b(call(ed)?|spoke|chat(ted)?|zoom|hopped\s+on)\b/i, "CALL"],
  [/\b(interview(ed)?|onsite|on-site|loop|panel|system\s+design|final\s+round)\b/i, "INTERVIEW"],
  [/\b(emailed|sent\s+(an?\s+)?(email|note|follow[-\s]?up)|reached\s+out|messaged|dm'?e?d)\b/i, "EMAIL_SENT"],
  [/\b(replied|got\s+back|heard\s+back|responded|came\s+back)\b/i, "EMAIL_RECEIVED"],
  [/\b(referred|referral|intro(duction|duced)?)\b/i, "REFERRAL"],
  [/\b(offer(ed)?)\b/i, "OFFER"],
  [/\b(reject(ed|ion)?|turned\s+me\s+down|passed\s+on|no\s+thanks|not\s+moving\s+forward)\b/i, "REJECTION"],
  [/\b(applied|submitted|sent\s+(my|the)\s+(resume|application))\b/i, "APPLIED"],
  [/\b(followed\s+up|nudged|chased|pinged)\b/i, "FOLLOW_UP"],
];

/** Words that name a stage. Only used to PROPOSE a move, never to make one. */
const STAGE_CUES: [RegExp, string][] = [
  [/\b(accepted|signed|taking\s+the\s+offer)\b/i, "ACCEPTED"],
  // The three endings are one stage now, so all three sets of words point at
  // it. WHY it ended is a tag, and guessing a tag from a sentence is a step
  // too far for something that only ever proposes.
  [/\b(reject(ed|ion)?|turned\s+me\s+down|passed\s+on|not\s+moving\s+forward|no\s+thanks)\b/i, "LOST"],
  [/\b(withdrew|withdrawn|pulled\s+out|dropped\s+out|ghosted|never\s+heard\s+back)\b/i, "LOST"],
  [/\b(offer(ed)?)\b/i, "OFFER"],
  [/\b(final\s+round|onsite|on-site|loop|panel)\b/i, "INTERVIEWING"],
  [/\b(interview|system\s+design|technical\s+round)\b/i, "INTERVIEWING"],
  [/\b(phone\s+screen|screening|screen(er)?|recruiter\s+call)\b/i, "INTERVIEWING"],
  [/\b(applied|submitted)\b/i, "APPLIED"],
];

/** Words too common to identify anything. A role called "Engineer" is not a match. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "with", "for", "about", "at", "to", "of", "on", "in",
  "my", "me", "i", "we", "they", "it", "is", "was", "were", "had", "has", "have",
  "job", "role", "position", "company", "team", "engineer", "engineering", "manager",
  "senior", "staff", "lead", "principal", "software", "developer", "call", "email",
  "interview", "screen", "offer", "recruiter", "next", "week", "today", "yesterday",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

function firstCue(text: string, cues: [RegExp, string][]): string | null {
  for (const [pattern, value] of cues) if (pattern.test(text)) return value;
  return null;
}

/**
 * Read a line against a pipeline.
 *
 * A company name found in the text is worth far more than a role word: there
 * is exactly one Stripe and a hundred Senior Engineers. Ties are left as ties
 * — the caller shows both and lets the person point.
 */
export function readQuickLog(text: string, applications: Matchable[]): QuickLogReading {
  const trimmed = text.trim();
  const tokens = new Set(words(trimmed));
  const lower = trimmed.toLowerCase();

  const matches: QuickLogMatch[] = [];
  for (const application of applications) {
    let score = 0;
    const because: string[] = [];

    const company = application.company.trim().toLowerCase();
    if (company && lower.includes(company)) {
      score += 10 + Math.min(company.length, 20) / 20;
      because.push(application.company);
    } else {
      // A one-word company still counts when it appears as a word of its own.
      const companyWords = words(application.company);
      const hit = companyWords.filter((word) => tokens.has(word));
      if (hit.length > 0) {
        score += 6 * (hit.length / companyWords.length);
        because.push(hit.join(" "));
      }
    }

    const roleWords = words(application.roleTitle);
    const roleHits = roleWords.filter((word) => tokens.has(word));
    if (roleHits.length > 0) {
      score += 2 * (roleHits.length / roleWords.length);
      because.push(roleHits.join(" "));
    }

    if (score > 0) {
      matches.push({
        id: application.id,
        company: application.company,
        roleTitle: application.roleTitle,
        stage: application.stage,
        score,
        because: because.join(" · "),
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.company.localeCompare(b.company));

  return {
    matches: matches.slice(0, 5),
    type: firstCue(trimmed, TYPE_CUES) ?? "NOTE",
    stage: firstCue(trimmed, STAGE_CUES),
  };
}

/** Whether the top match is far enough ahead to be offered on its own. */
export function isConfident(matches: QuickLogMatch[]): boolean {
  if (matches.length === 0) return false;
  if (matches.length === 1) return matches[0].score >= 6;
  return matches[0].score >= 6 && matches[0].score >= matches[1].score * 1.5;
}
