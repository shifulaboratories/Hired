/**
 * A role's background, read as sections rather than as one blob.
 *
 * `Role.background` is and stays ONE markdown string. That is deliberate:
 * `update_role` replaces it wholesale, the workspace export round-trips it as a
 * single field, and the schema has promised "unlimited markdown" since the
 * first commit. Columns would cost a migration and every round-trip path.
 *
 * What was missing is that a background holds four different KINDS of thing,
 * and only one of them belongs on a resume:
 *
 *   evidence  what they did. Raw material. This is what gets mined.
 *   rules     how to write about this role. Binding on whoever writes.
 *   caveats   positioning and interview prep. NEVER resume content.
 *   open      something they have not settled yet — a date they are unsure of,
 *             a number they need to check. Not usable until it is resolved.
 *
 * Before this, all of it was the same undifferentiated text, so a tailoring
 * conversation read "tenure is short, have the answer ready" with exactly the
 * same status as "brought the work in-house". People were already signalling
 * the difference by shouting in capitals; this makes the app understand it.
 *
 * DEFAULT IS EVIDENCE. A section is only reclassified when its heading matches
 * the small list below, or a paragraph opens with one of the shouted markers
 * after it, so ordinary prose means precisely what it meant yesterday. Nothing is silently excluded from a
 * resume; a section has to ask to be.
 *
 * Pure, and not in src/lib/data/: it touches no database and takes no userId,
 * the same way resume-schema.ts and letter-kinds.ts do not.
 */

export type SectionKind = "evidence" | "rules" | "caveats" | "open";

export type BackgroundSection = {
  kind: SectionKind;
  /**
   * The heading text without its hashes. Empty for the opening paragraph, and
   * for evidence that carries on under a heading after a marked paragraph.
   * For a marked paragraph it is the marker as written, e.g. "NAMING RULE".
   */
  heading: string;
  /** Everything under the heading, trimmed. May be empty. */
  body: string;
  /** Where this section starts in the original string, for an editor to seek. */
  offset: number;
  /**
   * True when a marker at the start of a paragraph opened this section rather
   * than a `##` heading. It runs to the next blank line — or, for a marked
   * bullet, to the next bullet — and then whatever the heading above held
   * resumes.
   */
  inline?: boolean;
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
  open: "open",
  "open questions": "open",
  unresolved: "open",
  "to confirm": "open",
};

/** The spellings the editor writes and the tool descriptions teach. */
export const CANONICAL: Record<Exclude<SectionKind, "evidence">, string> = {
  rules: "Rules",
  caveats: "Caveats",
  open: "Open questions",
};

/**
 * Markers written in CAPITALS, inside the text rather than as a heading.
 *
 * This is how people — and the assistants writing for them — actually mark
 * things: "NAMING RULE: describe it by function", "⚠️ OPEN: confirm the start
 * month", "## Post-departure signal — INTERVIEW ONLY". Before this was read,
 * every one of those was evidence, so an interview-only line went straight into
 * resumeEvidence with a warning sign on it.
 *
 * The capitals are the whole safety argument. A lowercase "open source:" or
 * "Positioning:" at the start of a paragraph is prose and stays evidence; only
 * a label that is SHOUTED, and that matches one of these exactly, is read as a
 * marker. "OPEN SOURCE:" does not match OPEN, because these are whole-label
 * matches, not substrings.
 */
const MARKERS: Array<[RegExp, Exclude<SectionKind, "evidence">]> = [
  [/^(?:(?:[A-Z]+ ){0,3}(?:RULES?|GUARDRAILS?)|NAMING|FRAMING|WORDING)$/, "rules"],
  [/^(?:CAVEATS?|INTERVIEW ONLY|INTERVIEW PREP|POSITIONING|NOT FOR (?:THE )?RESUMES?|NEVER ON A RESUME)$/, "caveats"],
  [/^(?:OPEN|OPEN QUESTIONS?|UNRESOLVED|TO CONFIRM|UNCONFIRMED|NEEDS CONFIRMING|TBD|TODO)$/, "open"],
];

/** What a shouted label means, or null when it is not one of the markers. */
function markerKind(label: string): Exclude<SectionKind, "evidence"> | null {
  const bare = label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  // Shouting is the signal. A label with any lowercase letter is prose.
  if (!/[A-Z]/.test(bare) || bare !== bare.toUpperCase()) return null;
  for (const [pattern, kind] of MARKERS) if (pattern.test(bare)) return kind;
  return null;
}

/**
 * A marker at the start of a line: an optional bullet, optional bold, an
 * optional warning sign or other symbol, the CAPITAL label with an optional
 * parenthetical, then a colon. Group 1 is the bullet, 2 the label, 3 the rest.
 */
const INLINE_MARKER =
  /^(\s*(?:[-*+]|\d+[.)])\s+)?(?:\*\*)?\s*(?:[^\w\s(*#]{1,4}\s*)?([A-Z][A-Z '&/]*[A-Z](?:\s*\([^)]*\))?)\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/;

function inlineMarker(line: string) {
  const match = INLINE_MARKER.exec(line);
  if (!match) return null;
  const kind = markerKind(match[2]);
  if (!kind) return null;
  return { kind, bullet: Boolean(match[1]), label: match[2].trim(), rest: match[3] };
}

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
  const reserved = RESERVED[bare];
  if (reserved) return reserved;

  // A shouted suffix after a dash: "Post-departure signal — INTERVIEW ONLY".
  // The heading keeps its name; the suffix says what kind of thing it is.
  const suffix = /\s[—–-]+\s*([^—–-]+?)\s*$/.exec(heading.trim());
  if (suffix) {
    const kind = markerKind(suffix[1].replace(/^[^\w(]+/, ""));
    if (kind) return kind;
  }

  // Or a shouted prefix: "## ⚠️ OPEN: follower count".
  const prefix = inlineMarker(heading.trim());
  if (prefix && !prefix.bullet) return prefix.kind;

  return "evidence";
}

/**
 * Split a background into its sections.
 *
 * Only `##` opens a headed section. A `###` belongs to the section above it, so
 * a writer can subdivide without changing what anything MEANS — and so a stray
 * third hash cannot quietly turn a caveat back into evidence.
 *
 * Inside an EVIDENCE section, a paragraph that opens with a shouted marker
 * ("RULE:", "⚠️ OPEN:", "**INTERVIEW ONLY:**") becomes a section of its own
 * for as long as that paragraph runs — to the next blank line, or for a marked
 * bullet to the next bullet — and the evidence around it carries on under no
 * heading, so resumeEvidence reassembles it without repeating the one above.
 * Inside a rules, caveats or open section markers change nothing: the heading
 * already said what everything under it is, and a marker cannot promote a
 * caveat back to evidence.
 *
 * Text before the first heading becomes one untitled evidence section, which is
 * where the opening line of most backgrounds lives.
 */
export function parseBackground(text: string): BackgroundSection[] {
  if (!text.trim()) return [];

  const sections: BackgroundSection[] = [];
  const lines = text.split("\n");
  let heading = "";
  let kind: SectionKind = "evidence";
  let inline = false;
  let buffer: string[] = [];
  let offset = 0;
  let cursor = 0;
  // The kind of the `##` section we are inside, which a marked paragraph
  // interrupts and then hands back to.
  let headedKind: SectionKind = "evidence";
  let markedBullet = false;

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (heading || body) {
      sections.push(inline ? { kind, heading, body, offset, inline } : { kind, heading, body, offset });
    }
    buffer = [];
  };

  /** Close a marked paragraph and return to plain evidence under no heading. */
  const resume = (at: number) => {
    flush();
    heading = "";
    kind = headedKind;
    inline = false;
    offset = at;
  };

  for (const line of lines) {
    const match = /^##(?!#)\s*(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
      kind = headedKind = sectionKind(heading);
      inline = false;
      offset = cursor;
    } else if (inline && (!line.trim() || (markedBullet && /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)))) {
      // The marked paragraph is over: a blank line ends it, and so does the
      // next bullet when it was one bullet that was marked.
      resume(cursor);
      if (line.trim()) {
        const marker = inlineMarker(line);
        if (marker && headedKind === "evidence") {
          flush();
          heading = marker.label;
          kind = marker.kind;
          inline = true;
          markedBullet = marker.bullet;
          offset = cursor;
          buffer.push(marker.rest);
        } else {
          buffer.push(line);
        }
      }
    } else {
      const marker = !inline && headedKind === "evidence" ? inlineMarker(line) : null;
      if (marker) {
        flush();
        heading = marker.label;
        kind = marker.kind;
        inline = true;
        markedBullet = marker.bullet;
        offset = cursor;
        buffer.push(marker.rest);
      } else {
        buffer.push(line);
      }
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
 * The rules, caveats and open questions, as lines, for a writer to obey
 * rather than quote.
 *
 * Bullets are unwrapped so a caller gets statements rather than markdown; a
 * section with no bullets comes back as its paragraphs. A marked paragraph
 * comes back as one line, because "NAMING RULE: by function only. No product
 * names." is one rule however many sentences it takes.
 */
export function writingGuidance(text: string): {
  rules: string[];
  caveats: string[];
  open: string[];
} {
  const linesOf = (kind: SectionKind) =>
    sectionsOfKind(text, kind)
      .flatMap((section) => {
        const lines = section.body.split("\n");
        const listed = lines.some((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line));
        return section.inline && !listed ? [lines.map((line) => line.trim()).join(" ")] : lines;
      })
      .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);
  return { rules: linesOf("rules"), caveats: linesOf("caveats"), open: linesOf("open") };
}

/** True when this background carries anything a writer has to obey. */
export function hasGuidance(text: string): boolean {
  const { rules, caveats, open } = writingGuidance(text);
  return rules.length > 0 || caveats.length > 0 || open.length > 0;
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
  // Only `##` sections are candidates: a marked paragraph is somebody's single
  // flagged line, and filing the next rule inside it would glue two rules into
  // one paragraph.
  const kind = sectionKind(name);
  const sections = parseBackground(text);
  const headed = (section: BackgroundSection) => Boolean(section.heading) && !section.inline;
  const index =
    kind === "evidence"
      ? sections.findIndex(
          (section) => headed(section) && section.heading.toLowerCase() === name.toLowerCase(),
        )
      : sections.findIndex((section) => headed(section) && section.kind === kind);
  if (index < 0) return `${text.trim()}\n\n## ${name}\n${body}`.trim();

  // The section runs to the next `##`, or to the end of the text — past any
  // marked paragraphs and the evidence resuming after them, which are all
  // still under its heading.
  const next = sections.findIndex((section, i) => i > index && headed(section));
  const end = next >= 0 ? sections[next].offset : text.length;
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
  // Headings go entirely rather than losing their hashes: "Scope — LEAD WITH
  // THIS" is a note to a writer, not a preview of the work.
  const flat = resumeEvidence(text)
    .replace(/^#{1,6}\s.*$/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
