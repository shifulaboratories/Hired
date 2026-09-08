import type { ResumeDoc } from "@/lib/resume-schema";

/**
 * What to cut when a resume runs long.
 *
 * Pure and client-safe, like resume-text.ts and resume-diff.ts, so the editor
 * and the MCP tool rank candidates the same way.
 *
 * This ranks; it does not measure. How many pages a document actually makes is
 * a question only a browser can answer — the editor asks one (see
 * resume-pagination.ts) and export_resume_pdf renders one. What is knowable
 * without a layout engine is which pieces are big, and that is what a person
 * asking "what do I cut?" wants: the longest bullets, and the sections carrying
 * the most weight.
 */

/** Roughly how many rendered lines a string of body text occupies. */
const linesFor = (text: string, perLine = 105) => Math.max(1, Math.ceil(text.trim().length / perLine));

export type TrimCandidate = {
  /** A `data-rp` path, so the editor can jump to it and the tool can name it. */
  path: string;
  /** Where it lives: "Senior Engineer — Meridian". */
  entry: string;
  text: string;
  /** Characters, and the lines they cost. */
  length: number;
  lines: number;
};

export type SectionWeight = {
  path: string;
  heading: string;
  kind: string;
  visible: boolean;
  lines: number;
  /** How many entries or bullets it holds. */
  items: number;
};

export type FitReport = {
  /** Longest first. The obvious things to shorten or drop. */
  bullets: TrimCandidate[];
  /** Heaviest first. A section you can hide outright is the biggest lever. */
  sections: SectionWeight[];
  /** Total estimated lines, and the estimate's own page count. */
  estimatedLines: number;
  approxPages: number;
};

const entryLabel = (title: string, company: string) =>
  [title, company].filter(Boolean).join(" — ") || "an entry";

/**
 * Rank what is worth cutting. `perPage` is the estimator's lines-per-page, kept
 * as an argument so the caller states the assumption rather than this file
 * hiding a second copy of it.
 */
export function fitReport(doc: ResumeDoc, perPage: number): FitReport {
  const bullets: TrimCandidate[] = [];
  const sections: SectionWeight[] = [];
  let total = 5; // the header

  doc.sections.forEach((section, index) => {
    const path = `s${index}`;
    let lines = 2; // the heading and its rule
    let items = 0;

    if (section.kind === "summary" && section.text.trim()) {
      lines += linesFor(section.text, 110);
      items += 1;
    }

    // Every entry kind that can carry bullets, with the letter its `data-rp`
    // path uses so the editor can jump straight to what it names.
    const entries: { letter: string; label: string; bullets: string[] }[] = [
      ...section.experience.map((item) => ({
        letter: "e",
        label: entryLabel(item.title, item.company),
        bullets: item.bullets,
      })),
      ...section.projects.map((item) => ({
        letter: "p",
        label: item.name || "a project",
        bullets: item.bullets,
      })),
      ...section.items.map((item) => ({
        letter: "x",
        label: item.title || "an entry",
        bullets: item.bullets,
      })),
      ...section.education.map((item) => ({
        letter: "d",
        label: entryLabel(item.degree, item.school),
        bullets: item.details,
      })),
    ];

    // Positions are per kind, matching how the renderer indexes each list.
    const seen: Record<string, number> = {};
    for (const entry of entries) {
      const position = seen[entry.letter] ?? 0;
      seen[entry.letter] = position + 1;
      items += 1;
      lines += 2;
      entry.bullets.forEach((text, bulletIndex) => {
        if (!text.trim()) return;
        const cost = linesFor(text);
        lines += cost;
        bullets.push({
          path: `${path}/${entry.letter}${position}/b${bulletIndex}`,
          entry: entry.label,
          text,
          length: text.trim().length,
          lines: cost,
        });
      });
    }

    if (section.kind === "skills") {
      for (const group of section.skills) {
        items += 1;
        lines += linesFor(`${group.name}: ${group.skills.join(", ")}`, 95);
      }
    }
    if (section.kind === "certifications") {
      items += section.certifications.length;
      lines += section.certifications.length;
    }

    sections.push({
      path,
      heading: section.heading || section.kind,
      kind: section.kind,
      visible: section.visible,
      lines,
      items,
    });
    if (section.visible) total += lines;
  });

  bullets.sort((a, b) => b.length - a.length);
  const visibleSections = [...sections].sort((a, b) => b.lines - a.lines);

  return {
    bullets,
    sections: visibleSections,
    estimatedLines: total,
    approxPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

// ---------------------------------------------------------------------------
// The cuts themselves
// ---------------------------------------------------------------------------

/**
 * Remove the bullet a path names, returning a new document.
 *
 * Returns the document unchanged when the path does not resolve, which is what
 * happens if the layout it came from is a beat behind an edit. Silently doing
 * nothing is right here: the alternative is deleting whatever now sits at that
 * index, which would be somebody else's sentence.
 */
export function removeBulletAt(doc: ResumeDoc, path: string): ResumeDoc {
  const match = /^s(\d+)\/([epxd])(\d+)\/b(\d+)$/.exec(path);
  if (!match) return doc;
  const [, rawSection, letter, rawEntry, rawBullet] = match;
  const sectionIndex = Number(rawSection);
  const entryIndex = Number(rawEntry);
  const bulletIndex = Number(rawBullet);
  const section = doc.sections[sectionIndex];
  if (!section) return doc;

  const drop = (list: string[]) =>
    bulletIndex < list.length ? list.filter((_, index) => index !== bulletIndex) : list;

  const sections = [...doc.sections];
  if (letter === "e" && section.experience[entryIndex]) {
    const experience = [...section.experience];
    experience[entryIndex] = {
      ...experience[entryIndex],
      bullets: drop(experience[entryIndex].bullets),
    };
    sections[sectionIndex] = { ...section, experience };
  } else if (letter === "p" && section.projects[entryIndex]) {
    const projects = [...section.projects];
    projects[entryIndex] = { ...projects[entryIndex], bullets: drop(projects[entryIndex].bullets) };
    sections[sectionIndex] = { ...section, projects };
  } else if (letter === "x" && section.items[entryIndex]) {
    const items = [...section.items];
    items[entryIndex] = { ...items[entryIndex], bullets: drop(items[entryIndex].bullets) };
    sections[sectionIndex] = { ...section, items };
  } else if (letter === "d" && section.education[entryIndex]) {
    const education = [...section.education];
    education[entryIndex] = {
      ...education[entryIndex],
      details: drop(education[entryIndex].details),
    };
    sections[sectionIndex] = { ...section, education };
  } else {
    return doc;
  }
  return { ...doc, sections };
}

/** Hide or show a section without deleting it. The biggest single lever. */
export function setSectionVisible(doc: ResumeDoc, index: number, visible: boolean): ResumeDoc {
  const section = doc.sections[index];
  if (!section) return doc;
  const sections = [...doc.sections];
  sections[index] = { ...section, visible };
  return { ...doc, sections };
}
