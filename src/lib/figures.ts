/**
 * Numbers in someone's own material, and the ones stated two different ways.
 *
 * The failure this is for is specific and it happened: a combined follower
 * count written as 150M+ in one place and 200M+ in another. Nobody lies on
 * purpose; a number gets rounded up in one draft, the draft gets copied, and a
 * resume goes out with the bigger figure while the background still carries
 * the smaller one. Whoever reads both — a recruiter with the LinkedIn profile
 * open, say — sees a person who cannot keep their story straight.
 *
 * A heuristic, and says so. It finds a figure, decides what it is a figure OF
 * from the nearest noun, and groups figures by that noun and by unit within
 * one job. Two figures in the same group that disagree are a CANDIDATE. It
 * does not know that "grew revenue from $1M to $3M" is two true numbers, so a
 * pair that appears together in one sentence is treated as compatible — a
 * before-and-after — unless that sentence says "or" or "both", which is how
 * people write down a number they are unsure of.
 *
 * Pure: no database. src/lib/data/me-checks.ts feeds it.
 */

export type FigureUnit = "money" | "percent" | "multiple" | "count";

export type Figure = {
  /** As written, e.g. "$90K" or "150M+". */
  raw: string;
  value: number;
  unit: FigureUnit;
  /** What it is a figure of, stemmed: "follower", "revenue", "budget". */
  key: string;
  /** The sentence it sits in, for a person to read. */
  sentence: string;
  /** Sentences are numbered across one call so co-occurrence can be tested. */
  sentenceId: number;
  /** True when the sentence says "or" / "both" / "either": a stated doubt. */
  unsure: boolean;
};

const NUMBER =
  /(\$|€|£)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?(k|mm|m|bn|b|thousand|million|billion)\b)?(\+)?(\s?%|\s?percent\b|x\b|×)?/gi;

const MAGNITUDE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
};

/** Words that sit next to a number without being what it counts. */
const STOP = new Set(
  (
    "a an the of in on per and or to for with from across over under by at plus more than total " +
    "combined monthly annual annually yearly weekly daily new active organic paid net gross about " +
    "roughly nearly almost around approximately up down all some our my their his her its each " +
    "was were is are be been being has have had stated reported reached hit grew grown generated " +
    "drove as both either cut saved raised closed managed ran led built ~ into only just " +
    "one two three four five six seven eight nine ten eleven twelve twenty thirty hundred"
  ).split(" "),
);

/** A figure of time is a duration, and durations are not what this is for. */
const TIME = /^(?:ms|s|sec|secs|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|years?|yrs?|quarters?|am|pm)$/i;

/** Words too generic to group on: two unrelated figures would share them. */
const GENERIC = new Set(["time", "times", "thing", "item", "one", "number", "figure", "amount", "level"]);

function stem(word: string) {
  let w = word.toLowerCase().replace(/'s$/, "");
  if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  return w;
}


/** Tokens with a note of whether each ends a clause (a comma, a semicolon…). */
function tokens(text: string) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({
      word: raw.replace(/^[^\w$€£~]+|[^\w]+$/g, ""),
      stops: /[,;:.!?)]$/.test(raw),
    }))
    .filter((token) => token.word);
}

function content(word: string) {
  const lower = word.toLowerCase();
  return !(STOP.has(lower) || lower.length < 3 || TIME.test(lower) || /\d/.test(word));
}

/**
 * What a figure counts, read forward: the noun phrase after it, and the LAST
 * word of that phrase — the head noun. "$45K monthly paid acquisition budget"
 * is a budget, not an acquisition; "150M+ followers" is followers. The phrase
 * ends at a clause mark, a stop word or another number, whose noun is its own.
 */
function nounAfter(list: { word: string; stops: boolean }[]): string | null {
  const phrase: string[] = [];
  for (const token of list) {
    if (/\d/.test(token.word)) break;
    if (!content(token.word)) {
      if (phrase.length) break;
      continue;
    }
    phrase.push(token.word);
    if (token.stops || phrase.length === 3) break;
  }
  if (!phrase.length) return null;
  const head = stem(phrase[phrase.length - 1]);
  return GENERIC.has(head) ? null : head;
}

/**
 * Read backward, the nearest content word — "the follower count was 150M" —
 * stepping over other numbers, so the second of "both 150M+ and 200M+" finds
 * the same noun as the first.
 */
function nounBefore(list: { word: string }[]): string | null {
  for (const token of list) {
    if (!content(token.word)) continue;
    const head = stem(token.word);
    return GENERIC.has(head) ? null : head;
  }
  return null;
}

function sentencesOf(text: string) {
  return text
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => /\d/.test(sentence));
}

/** Every figure in a piece of text. `firstSentence` numbers the sentences. */
export function figuresIn(text: string, firstSentence = 0): { figures: Figure[]; sentences: number } {
  const figures: Figure[] = [];
  const sentences = sentencesOf(text);
  sentences.forEach((sentence, index) => {
    const unsure = /\b(?:or|both|either|vs\.?|versus)\b/i.test(sentence);
    for (const match of sentence.matchAll(NUMBER)) {
      const [raw, currency, digits, magnitude, , suffix] = match;
      const start = match.index ?? 0;
      const end = start + raw.length;
      const before = sentence.slice(Math.max(0, start - 1), start);
      const after = sentence.slice(end, end + 1);
      // p99, Q3, 5th, 2FA, 10am, a date's middle — not figures of anything.
      if (/[\w.\-/:]/.test(before) && !currency) continue;
      if (/[A-Za-z\-/:]/.test(after) && !suffix) continue;

      const base = Number(digits.replace(/,/g, ""));
      if (!Number.isFinite(base)) continue;
      const unit: FigureUnit = currency
        ? "money"
        : suffix && /%|percent/i.test(suffix)
          ? "percent"
          : suffix
            ? "multiple"
            : "count";
      // A bare four-digit number between 1900 and 2100 is a year.
      if (unit === "count" && !magnitude && base >= 1900 && base <= 2100 && !digits.includes(",")) continue;
      if (unit === "count" && !magnitude && base < 2) continue;

      const following = tokens(sentence.slice(end));
      if (following[0] && TIME.test(following[0].word)) continue;

      const preceding = tokens(sentence.slice(0, start)).reverse();
      const key = nounAfter(following) ?? nounBefore(preceding);
      if (!key) continue;

      figures.push({
        raw: raw.trim(),
        value: base * (magnitude ? MAGNITUDE[magnitude.toLowerCase()] : 1),
        unit,
        key,
        sentence,
        sentenceId: firstSentence + index,
        unsure,
      });
    }
  });
  return { figures, sentences: sentences.length };
}

/** Two values are the same figure when they are within 2% of each other. */
function sameValue(a: number, b: number) {
  return Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b));
}

/**
 * Groups of figures that disagree.
 *
 * Input figures must already share a scope — one job, or the global notes —
 * because two jobs' budgets are supposed to differ. A group is returned when
 * it holds at least two different values that are NOT explained by appearing
 * together in one plain sentence (a before-and-after).
 */
export function disagreements<T extends Figure>(figures: T[]): { key: string; unit: FigureUnit; figures: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const figure of figures) {
    const id = `${figure.unit}:${figure.key}`;
    groups.set(id, [...(groups.get(id) ?? []), figure]);
  }

  const out: { key: string; unit: FigureUnit; figures: T[] }[] = [];
  for (const members of groups.values()) {
    const distinct: T[] = [];
    for (const figure of members) {
      if (!distinct.some((other) => sameValue(other.value, figure.value))) distinct.push(figure);
    }
    if (distinct.length < 2) continue;

    const explained = (a: T, b: T) =>
      members.some(
        (x) =>
          sameValue(x.value, a.value) &&
          !x.unsure &&
          members.some((y) => y.sentenceId === x.sentenceId && sameValue(y.value, b.value)),
      );
    let conflict = false;
    for (let i = 0; i < distinct.length && !conflict; i += 1) {
      for (let j = i + 1; j < distinct.length && !conflict; j += 1) {
        if (!explained(distinct[i], distinct[j])) conflict = true;
      }
    }
    if (conflict) out.push({ key: members[0].key, unit: members[0].unit, figures: members });
  }
  return out;
}
