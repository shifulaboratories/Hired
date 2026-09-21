/**
 * A role's background, read as sections rather than as one blob.
 *
 * `Role.background` is and stays ONE markdown string. That is deliberate:
 * `update_role` replaces it wholesale, the workspace export round-trips it as a
 * single field, and the schema has promised "unlimited markdown" since the
 * first commit. Columns would cost a migration and every round-trip path.
 *
 * What was missing is that a background holds three different KINDS of thing,
 * and only one of them belongs on a resume:
 *
 *   evidence  what they did. Raw material. This is what gets mined.
 *   rules     how to write about this role. Binding on whoever writes.
 *   caveats   positioning and interview prep. NEVER resume content.
 *
 * Before this, all three were the same undifferentiated text, so a tailoring
 * conversation read "tenure is short, have the answer ready" with exactly the
 * same status as "brought the work in-house". People were already signalling
 * the difference by shouting in capitals; this makes the app understand it.
 *
 * DEFAULT IS EVIDENCE. A section is only reclassified when its heading matches
 * the small list below, so every background written before this existed means
 * precisely what it meant yesterday. Nothing is silently excluded from a
 * resume; a section has to ask to be.
 *
 * Pure, and not in src/lib/data/: it touches no database and takes no userId,
 * the same way resume-schema.ts and letter-kinds.ts do not.
 */

export type SectionKind = "evidence" | "rules" | "caveats";

export type BackgroundSection = {
  kind: SectionKind;
  /** The heading text without its hashes. Empty for the opening paragraph. */
  heading: string;
  /** Everything under the heading, trimmed. May be empty. */
  body: string;
  /** Where this section starts in the original string, for an editor to seek. */
  offset: number;
};

/**
 * Headings that mean something, lowercased.
 *
 * Kept SHORT on purpose. Every alias is a chance to classify something as a
 * rule that a person meant as evidence — which silently drops real material
 * out of their resumes, and is the failure this list must not cause. Two
 * spellings and one synonym each is the whole budget; the editor inserts the
 * canonical heading so nobody has to remember them, and the reader shows every
 * section's kind so a miss is visible rather than silent.
 */
const RESERVED: Record<string, SectionKind> = {
  rule: "rules",
  rules: "rules",
  "naming rule": "rules",
  "naming rules": "rules",
  "writing rules": "rules",
  constraints: "rules",
  caveat: "caveats",
  caveats: "caveats",
  positioning: "caveats",
  "interview prep": "caveats",
};

/** The spellings the editor writes and the tool descriptions teach. */
export const CANONICAL: Record<Exclude<SectionKind, "evidence">, string> = {
  rules: "Rules",
  caveats: "Caveats",
};

/**
 * What a heading means.
 *
 * A trailing colon and a parenthetical are stripped before matching, because
 * people date their own decisions — "Naming rule (resolved 2026-08-17)" is a
 * naming rule, and failing to see that would be the app being pedantic about
 * punctuation at the cost of getting the answer wrong.
 */
export function sectionKind(heading: string): SectionKind {
  const bare = heading
    .replace(/\([^)]*\)/g, " ")
    .replace(/[:•\-–—]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return RESERVED[bare] ?? "evidence";
}

/**
 * Split a background into its sections.
 *
 * Only `##` opens a section. A `###` belongs to the section above it, so a
 * writer can subdivide without changing what anything MEANS — and so a stray
 * third hash cannot quietly turn a caveat back into evidence.
 *
 * Text before the first heading becomes one untitled evidence section, which is
 * where the opening line of most backgrounds lives.
 */
export function parseBackground(text: string): BackgroundSection[] {
  if (!text.trim()) return [];

  const sections: BackgroundSection[] = [];
  const lines = text.split("\n");
  let heading = "";
  let buffer: string[] = [];
  let offset = 0;
  let cursor = 0;

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (heading || body) sections.push({ kind: sectionKind(heading), heading, body, offset });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^##(?!#)\s*(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
      offset = cursor;
    } else {
      buffer.push(line);
    }
    cursor += line.length + 1;
  }
  flush();

  return sections;
}

/** Sections of one kind, in the order they appear. */
export function sectionsOfKind(text: string, kind: SectionKind): BackgroundSection[] {
  return parseBackground(text).filter((section) => section.kind === kind);
}

/**
 * The part of a background a resume may be written from.
 *
 * This is the whole point of the file. Anything that reaches a document — a
 * resume bullet, a cover letter line — comes from here and never from the
 * string itself.
 */
export function resumeEvidence(text: string): string {
  return sectionsOfKind(text, "evidence")
    .map((section) => (section.heading ? `## ${section.heading}\n${section.body}` : section.body))
    .join("\n\n")
    .trim();
}

/**
 * The rules and caveats, as lines, for a writer to obey rather than quote.
 *
 * Bullets are unwrapped so a caller gets statements rather than markdown; a
 * section with no bullets comes back as its paragraphs.
 */
export function writingGuidance(text: string): { rules: string[]; caveats: string[] } {
  const linesOf = (kind: SectionKind) =>
    sectionsOfKind(text, kind)
      .flatMap((section) => section.body.split("\n"))
      .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);
  return { rules: linesOf("rules"), caveats: linesOf("caveats") };
}

/** True when this background carries anything a writer has to obey. */
export function hasGuidance(text: string): boolean {
  const { rules, caveats } = writingGuidance(text);
  return rules.length > 0 || caveats.length > 0;
}

/**
 * Add text to a background, merging into a section that already has that
 * heading rather than opening a second one with the same name.
 *
 * Appending twice under "Rules" used to leave two `## Rules` blocks, which then
 * read as two unrelated rules lists and rendered as a stutter. Merging is what
 * somebody means by "file this under Rules", and it keeps the reserved sections
 * to one each without a special case for them.
 *
 * The merge SPLICES rather than rebuilding the document from its sections.
 * Rebuilding was a line shorter and normalised everybody's blank lines on the
 * way past, so appending one rule rewrote every byte of the file — which the
 * version history would then show as "the whole background changed", and undo
 * would take them back past edits they never made. Everything outside the
 * target section comes out byte-identical.
 *
 * Pure: it returns the new string and writes nothing.
 */
export function appendToBackground(text: string, addition: string, heading?: string): string {
  const body = addition.trim();
  if (!body) return text;

  const name = heading?.trim();
  if (!name) return `${text.trim()}\n\n${body}`.trim();

  // A reserved heading matches by KIND, not by spelling. Somebody whose rules
  // live under "Naming rule (resolved 2026-08-17)" gets the next one filed
  // there, rather than a bare "## Rules" opening beside it — which is the
  // stutter this function exists to prevent, and which an assistant would cause
  // every single time, because the tool description teaches it to pass "Rules".
  // Anything else matches by name, where an exact heading is a literal request.
  const kind = sectionKind(name);
  const sections = parseBackground(text);
  const index =
    kind === "evidence"
      ? sections.findIndex((section) => section.heading.toLowerCase() === name.toLowerCase())
      : sections.findIndex((section) => section.kind === kind);
  if (index < 0) return `${text.trim()}\n\n## ${name}\n${body}`.trim();

  // The section runs to the start of the next one, or to the end of the text.
  const end = index + 1 < sections.length ? sections[index + 1].offset : text.length;
  const head = text.slice(0, end).replace(/\s+$/, "");
  return `${head}\n${body}${text.slice(end) ? `\n\n${text.slice(end).replace(/^\s+/, "")}` : ""}`;
}

/**
 * A one-line preview with the markdown taken off.
 *
 * From the EVIDENCE only, so a list of roles never previews somebody's note to
 * themselves about how short their tenure looks.
 */
export function backgroundExcerpt(text: string, max = 240): string {
  const flat = resumeEvidence(text)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
