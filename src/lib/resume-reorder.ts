import type { ResumeDoc, ResumeSection, SectionKind } from "@/lib/resume-schema";

/**
 * Moving one thing inside a resume document.
 *
 * Pure, and deliberately outside src/lib/data/ so the editor can import it into
 * the browser for its drag handles while `reorder_resume` imports it on the
 * server. What "move this above that" means has one implementation, not two.
 *
 * Everything here takes and returns a whole document and mutates nothing: the
 * editor holds the result in state and lets autosave write it, and the data
 * layer re-parses it before the write, so a bad move cannot reach the database
 * in a shape the schema would reject.
 */

/** Where a section keeps its entries. Summary sections have none. */
const ENTRY_KEY: Record<SectionKind, keyof ResumeSection | null> = {
  summary: null,
  experience: "experience",
  education: "education",
  projects: "projects",
  skills: "skills",
  certifications: "certifications",
  custom: "items",
};

/**
 * The fields of an entry this module actually looks at. Six item types share
 * one shape here — every one of them names itself with one of these keys and
 * keeps its lines under `bullets` or, for education, `details`. Reading them
 * through one type keeps the move in one piece instead of six branches; the
 * schema is still what validates the result on the way to the database.
 */
type AnyEntry = {
  id?: string;
  title?: string;
  company?: string;
  school?: string;
  name?: string;
  bullets?: string[];
  details?: string[];
};

export function entriesOf(section: ResumeSection): AnyEntry[] {
  const key = ENTRY_KEY[section.kind];
  return key ? (section[key] as unknown as AnyEntry[]) : [];
}

function withEntries(section: ResumeSection, entries: AnyEntry[]): ResumeSection {
  const key = ENTRY_KEY[section.kind];
  return key ? ({ ...section, [key]: entries } as ResumeSection) : section;
}

/**
 * Every name an entry answers to, most specific first.
 *
 * A job goes by its title and by its company, and a person naming one says
 * either — "move the Stripe job up" and "move the staff engineer role up" are
 * the same request. Matching only the display label made the second work and
 * the first fail with a list that did not even mention the word they used.
 */
export function entryNames(entry: AnyEntry): string[] {
  return [entry.title, entry.company, entry.school, entry.name].filter(
    (name): name is string => Boolean(name),
  );
}

/** What an entry calls itself, whichever kind it is. */
export function entryLabel(entry: AnyEntry): string {
  return entryNames(entry)[0] ?? "";
}

/** An entry's lines, under whichever key its kind uses. */
function linesOf(entry: AnyEntry): { key: "bullets" | "details"; lines: string[] } {
  if (entry.details && !entry.bullets) return { key: "details", lines: entry.details };
  return { key: "bullets", lines: entry.bullets ?? [] };
}

/** Move one item of a list to a new index, closing the gap behind it. */
export function moveWithin<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item);
  return next;
}

type Candidate = {
  id?: string;
  /** What the error message and the result call it. */
  label: string;
  /** Everything it answers to, the label included. */
  names?: string[];
};

/**
 * Find one thing in a list by whatever the caller had to hand.
 *
 * An assistant that just read a document has ids; a person talking to it has
 * "the Stripe job" or "the third bullet". All of them resolve here, in that
 * order of confidence, and a miss reports what was actually available rather
 * than only that it failed — an assistant can retry from the error.
 */
function locate(candidates: Candidate[], needle: string, what: string): number {
  const query = needle.trim();
  if (!query) throw new Error(`Name the ${what} to move.`);

  if (/^\d+$/.test(query)) {
    const index = Number(query) - 1;
    if (index < 0 || index >= candidates.length) {
      throw new Error(`There is no ${what} number ${query} — there are ${candidates.length}.`);
    }
    return index;
  }

  const lower = query.toLowerCase();
  const names = (c: Candidate) => (c.names ?? [c.label]).map((name) => name.toLowerCase());
  const tests = [
    (c: Candidate) => c.id === query,
    (c: Candidate) => names(c).some((name) => name === lower),
    (c: Candidate) => names(c).some((name) => name.startsWith(lower)),
    (c: Candidate) => names(c).some((name) => name.includes(lower)),
  ];
  let found = -1;
  for (const test of tests) {
    found = candidates.findIndex(test);
    if (found !== -1) break;
  }
  if (found === -1) {
    const options = candidates.map((c, i) => `${i + 1}. ${c.label || "(untitled)"}`).join("; ");
    throw new Error(`No ${what} matching "${query}". This resume has: ${options || "none"}.`);
  }
  return found;
}

export type ReorderInput = {
  /** The section, by id, heading or 1-based number. */
  section: string;
  /** An entry inside it, by id, name or 1-based number. */
  entry?: string;
  /** A bullet inside that entry, by text or 1-based number. */
  bullet?: string;
  /** Where it lands, 1-based. Clamped to the list. */
  position: number;
};

export type ReorderResult = {
  doc: ResumeDoc;
  moved: { kind: "section" | "entry" | "bullet"; label: string; from: number; to: number };
};

/**
 * Move the deepest thing named: a bullet if one is named, else an entry, else
 * the section itself. Positions in and out are 1-based, because they are what
 * a person says and what the tool reports back.
 */
export function reorderDoc(doc: ResumeDoc, input: ReorderInput): ReorderResult {
  if (!Number.isFinite(input.position)) {
    throw new Error("Give position as a 1-based number: 1 puts it first.");
  }
  const sectionAt = locate(
    doc.sections.map((section) => ({
      id: section.id,
      label: section.heading || section.kind,
      names: [section.heading, section.kind].filter(Boolean),
    })),
    input.section,
    "section",
  );
  const section = doc.sections[sectionAt];
  const clamp = (length: number) => Math.min(Math.max(input.position, 1), length) - 1;

  if (input.entry === undefined && input.bullet === undefined) {
    const to = clamp(doc.sections.length);
    return {
      doc: { ...doc, sections: moveWithin(doc.sections, sectionAt, to) },
      moved: {
        kind: "section",
        label: section.heading || section.kind,
        from: sectionAt + 1,
        to: to + 1,
      },
    };
  }

  const entries = entriesOf(section);
  if (!entries.length) {
    throw new Error(`The "${section.heading || section.kind}" section has no entries to move.`);
  }
  // A bullet named without an entry is unambiguous only when the section has
  // one entry; anything else is a question, not a guess.
  if (input.entry === undefined && entries.length > 1) {
    throw new Error(
      `Say which entry the bullet is in: the "${section.heading || section.kind}" section has ${entries.length}.`,
    );
  }
  const entryAt =
    input.entry === undefined
      ? 0
      : locate(
          entries.map((entry) => ({
            id: entry.id,
            label: entryLabel(entry),
            names: entryNames(entry),
          })),
          input.entry,
          "entry",
        );
  const entry = entries[entryAt];

  if (input.bullet === undefined) {
    const to = clamp(entries.length);
    return {
      doc: {
        ...doc,
        sections: doc.sections.map((each, at) =>
          at === sectionAt ? withEntries(each, moveWithin(entries, entryAt, to)) : each,
        ),
      },
      moved: { kind: "entry", label: entryLabel(entry), from: entryAt + 1, to: to + 1 },
    };
  }

  const { key, lines } = linesOf(entry);
  if (!lines.length) throw new Error(`"${entryLabel(entry)}" has no bullets to move.`);
  const bulletAt = locate(
    lines.map((line) => ({ label: line })),
    input.bullet,
    "bullet",
  );
  const to = clamp(lines.length);
  const movedEntry = { ...entry, [key]: moveWithin(lines, bulletAt, to) };
  return {
    doc: {
      ...doc,
      sections: doc.sections.map((each, at) =>
        at === sectionAt
          ? withEntries(
              each,
              entries.map((one, i) => (i === entryAt ? movedEntry : one)),
            )
          : each,
      ),
    },
    moved: { kind: "bullet", label: lines[bulletAt], from: bulletAt + 1, to: to + 1 },
  };
}
