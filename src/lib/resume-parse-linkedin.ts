/**
 * Making a LinkedIn profile look like a resume, before the generic parser reads
 * it.
 *
 * People paste LinkedIn far more often than they paste a resume — it is the
 * document they actually keep up to date — and what the clipboard gives you is
 * not a resume. It repeats the employer, hangs a duration off every date, marks
 * employment type with a middot, and groups several titles under one company
 * with the company named once. Read straight, that produces jobs called
 * "Full-time", employers called "3 yrs 8 mos", and promotions filed as jobs at
 * no company at all.
 *
 * This is a normaliser, not a second parser. It rewrites the text into the
 * shape resume-parse.ts already reads well and hands it on, so there is one
 * implementation of "what is a job" rather than two that drift. Everything it
 * does is visible in the review step, because it changes what the fields say.
 */

/** "Jan 2021 - Present · 3 yrs 8 mos" — the tail is LinkedIn's arithmetic. */
const DURATION_TAIL = /\s*[·•]\s*(?:(?:about|over|less than)\s+)?\d+\s*(?:yrs?|years?|mos?|months?)(?:\s+\d+\s*(?:mos?|months?))?\s*$/i;

/** "(3 years 8 months)" — the same thing in LinkedIn's PDF export. */
const DURATION_PARENS = /\s*\((?:(?:about|over|less than)\s+)?\d+\s*(?:yrs?|years?|mos?|months?)(?:[ ,]+\d+\s*(?:mos?|months?))?\)\s*$/i;

const EMPLOYMENT_TYPES = [
  "Full-time",
  "Part-time",
  "Self-employed",
  "Freelance",
  "Contract",
  "Internship",
  "Apprenticeship",
  "Seasonal",
];

/** "· Hybrid", "· Remote", "· On-site" — where, not what. */
const WORKPLACE = /\s*[·•]\s*(?:Hybrid|Remote|On-?site)\s*$/i;

/** LinkedIn's own furniture: logos, follower counts, its call to action. */
const FURNITURE =
  /^(?:.*\blogo\b.*|\d[\d,]*\s+followers?|\d[\d,]*\s+connections?|Show all .*|See more|…see more|Show credential|Endorsed by .*|Skills?:.*|Top skills?:.*|Contact info|Message|Follow|Connect|Open to work|Providing services)$/i;

const MONTH =
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?/i;

const DATE_LINE = new RegExp(
  `^\\s*(?:${MONTH.source}\\s+)?\\d{4}\\s*(?:–|—|-|to)\\s*(?:(?:${MONTH.source}\\s+)?\\d{4}|present|current|now)\\s*$`,
  "i",
);

/**
 * Does this read like something copied off LinkedIn?
 *
 * Two independent markers, not one. A single "· Full-time" could be a line in
 * anybody's resume, and normalising an ordinary document as though it were a
 * profile would be worse than not trying: the whole point of this file is that
 * it only fires where it helps.
 */
export function looksLikeLinkedIn(text: string): boolean {
  const markers = [
    DURATION_TAIL.test(text) || /\b\d+\s+yrs?\b/i.test(text),
    new RegExp(`[·•]\\s*(?:${EMPLOYMENT_TYPES.join("|")})\\b`, "i").test(text),
    /\b\d[\d,]*\s+(?:followers|connections)\b/i.test(text),
    /(?:^|\n)\s*(?:…see more|Show credential|Top skills)\b/i.test(text),
    // The clipboard repeats an employer under itself, once per job.
    hasRepeatedLine(text),
  ].filter(Boolean).length;
  return markers >= 2;
}

/**
 * Does this line read like the name of a company, rather than a sentence about
 * one?
 *
 * The structural rule "a line two above a date is the employer" is true of a
 * profile and also true of the last bullet of the job above, which sits
 * directly on top of the next job's title. Filing "Grew the data team from two
 * to nine." as an employer is the worst thing this file can do, so a name has
 * to look like one: short, and not a finished sentence.
 */
function readsLikeAName(line: string): boolean {
  return line.split(/\s+/).length <= 7 && !/[.!?]$/.test(line);
}

/** LinkedIn's copy names the employer twice in a row, logo line then text. */
function hasRepeatedLine(text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim());
  return lines.some(
    (line, index) =>
      line.length > 1 &&
      index > 0 &&
      lines[index - 1] === line &&
      !/^[•‣▪◦·*-]/.test(line),
  );
}

/**
 * Rewrite a pasted profile into the shape the resume parser reads.
 *
 * Two passes, and it matters. The first only cleans lines — furniture out,
 * durations and workplace tags off, employment type lifted out of the middot
 * list. The second reads structure, and can only do that against lines that are
 * already clean: whether something is a company or a title is decided by what
 * follows it, and a first attempt that cleaned and looked ahead at once was
 * looking ahead at text it had not cleaned yet. It pasted the employer onto
 * location lines and bullets.
 *
 * The structural job is carrying an employer down. LinkedIn groups a promotion
 * under the company it happened at, naming the company once and then listing
 * titles; read straight, the second title is a job at no employer. Here the
 * company is written onto each title line, so three promotions at one employer
 * arrive as three jobs at that employer — which is what they are, and what a
 * resume would say.
 */
export function flattenLinkedIn(text: string): string {
  type Line = { text: string; employment?: string };

  // --- pass one: clean, and only clean.
  const clean: Line[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    let line = raw.trim();
    if (!line || FURNITURE.test(line)) continue;
    const employment = EMPLOYMENT_TYPES.find((type) =>
      new RegExp(`[·•]\\s*${type}\\b`, "i").test(line),
    );
    line = line
      .replace(DURATION_TAIL, "")
      .replace(DURATION_PARENS, "")
      .replace(WORKPLACE, "")
      .replace(new RegExp(`\\s*[·•]\\s*(?:${EMPLOYMENT_TYPES.join("|")})\\b`, "i"), "")
      .replace(/\s*[·•]\s*$/, "")
      .trim();
    if (!line) continue;
    // "Stripe" straight after "Stripe": the logo's alt text and the name. This
    // has to happen AFTER cleaning — the clipboard writes the employer once
    // bare and once with "· Full-time" on it, and those are only the same line
    // once the suffix is gone.
    const previous = clean[clean.length - 1];
    if (previous && previous.text === line) {
      if (employment && !previous.employment) previous.employment = employment;
      continue;
    }
    clean.push({ text: line, ...(employment ? { employment } : {}) });
  }

  // --- pass two: read structure against clean lines.
  const out: string[] = [];
  const isDate = (at: number) => Boolean(clean[at]) && DATE_LINE.test(clean[at].text);
  let employer = "";
  let employerType: string | undefined;
  let inExperience = false;

  for (let index = 0; index < clean.length; index++) {
    const { text: line, employment } = clean[index];

    if (/^(experience|education|licenses?\s*&?\s*certifications?|projects|skills|about|summary)$/i.test(line)) {
      inExperience = /^experience$/i.test(line);
      employer = "";
      employerType = undefined;
      out.push(line);
      continue;
    }

    if (inExperience && !isDate(index) && !/^[•‣▪◦·*\-–—]/.test(line)) {
      // Followed by dates: a job title. Followed by something that is followed
      // by dates: the employer that title sits under.
      if (isDate(index + 1)) {
        const type = employment ?? employerType;
        // A blank line first: the generic parser separates one job from the
        // next by blank lines, and a profile has none — every job in it runs
        // straight into the one below. Without this, three jobs arrive as one
        // with the others' titles read as its bullets.
        if (out.length && out[out.length - 1] !== "") out.push("");
        out.push(employer ? `${line} — ${employer}` : line);
        // On its own line, not inside the name: the generic parser reads
        // "Contract", "Internship" and the rest out of an entry's text, and
        // anything welded into the employer becomes part of the employer.
        if (type) out.push(type);
        continue;
      }
      if (isDate(index + 2) && readsLikeAName(line)) {
        employer = line;
        employerType = employment;
        // Not emitted on its own: it goes onto the title line below, where
        // "Title — Company" is a shape the parser already reads.
        continue;
      }
    }

    out.push(line);
  }

  return out.join("\n");
}
