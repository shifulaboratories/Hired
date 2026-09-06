import type { ResumeDoc } from "@/lib/resume-schema";

/**
 * Where a resume's pages actually break.
 *
 * Pure and client-safe, beside resume-text.ts and resume-diff.ts and out of
 * src/lib/data/ for the reason written at the top of resume-text.ts: importing
 * from the data layer drags Prisma into the browser bundle.
 *
 * The editor used to answer "how many pages?" with estimateLines(), which
 * assumes ~110 characters a line and 46 lines a page and never sees fontSize,
 * lineHeight, pageMargin or template — all four of which sit one click away in
 * the Design popover. This module takes measurements instead.
 *
 * The measuring is done by the browser, not here: `readFragments` in
 * resume-measure-dom.ts renders the real document inside a multi-column box
 * whose column size is the page's content box, and CSS fragmentation puts each
 * element where a printer would. That was checked against the real PDF rather
 * than assumed — the naive contentHeight / 1056 division disagrees with the
 * printed page count on documents where `break-inside: avoid` pushes a whole
 * entry down, which is most of them past one page. This file only turns the
 * rectangles that come back into an answer.
 */

/** 8.5in and 11in at CSS's 96dpi. The only place these numbers appear. */
export const PAGE_WIDTH_PX = 816;
export const PAGE_HEIGHT_PX = 1056;

export type PageBox = { width: number; height: number };

/** The content box of one page: the sheet, less the document's own margin. */
export function pageBox(pageMargin: number): PageBox {
  const margin = Math.max(0, pageMargin);
  return {
    width: Math.max(1, PAGE_WIDTH_PX - 2 * margin),
    height: Math.max(1, PAGE_HEIGHT_PX - 2 * margin),
  };
}

/** One rectangle the browser produced for one marked element. */
export type RawFragment = {
  /** The element's `data-rp` path, e.g. "s1/e0/b2". */
  key: string;
  /** Which of that element's rectangles this is; > 0 means it was split. */
  part: number;
  /** Zero-based page (column) the rectangle landed on. */
  page: number;
  /** Offset from the top of that page's content box. */
  top: number;
  height: number;
};

export type PageBreak = {
  /** The page this break opens, 1-based: the first break opens page 2. */
  page: number;
  /** The element that starts the new page. */
  key: string;
  /** True when that element began on the previous page and was cut. */
  splits: boolean;
  /** Height left unused at the foot of the page before it. */
  slack: number;
};

export type PageLayout = {
  pages: number;
  box: PageBox;
  /** Length pages - 1. Empty for a single-page document. */
  breaks: PageBreak[];
  /** Height used on each page. */
  used: number[];
  /** How full the last page is, 0..1. */
  lastPageFill: number;
  fragments: RawFragment[];
};

export function emptyLayout(box: PageBox): PageLayout {
  return { pages: 1, box, breaks: [], used: [0], lastPageFill: 0, fragments: [] };
}

/** A section wrapper spans whatever its entries span; it never "starts" a page. */
const isSectionWrapper = (key: string) => /^s\d+$/.test(key);

/**
 * Turn measured rectangles into a page layout.
 *
 * `fragments` must arrive in DOM order, so among the elements that BEGIN on a
 * page the first one is the coarsest: an <article> precedes its own <li>, and
 * "page 2 starts at the Meridian entry" beats "page 2 starts at a bullet".
 *
 * Section wrappers are skipped when choosing that element. A <section> holding
 * five jobs straddles every page it covers, so it is always the first rectangle
 * on the page and always a continuation — naming it would make every break read
 * as a split and point at the heading rather than at the entry you can move.
 */
export function layoutFromFragments(fragments: RawFragment[], box: PageBox): PageLayout {
  if (fragments.length === 0) return emptyLayout(box);

  const pages = Math.max(1, ...fragments.map((fragment) => fragment.page + 1));
  const used: number[] = Array.from({ length: pages }, () => 0);
  for (const fragment of fragments) {
    used[fragment.page] = Math.max(used[fragment.page], fragment.top + fragment.height);
  }

  const breaks: PageBreak[] = [];
  for (let page = 1; page < pages; page++) {
    const onPage = fragments.filter((fragment) => fragment.page === page);
    if (onPage.length === 0) continue;
    // What begins here, rather than what merely continues onto here.
    const opener =
      onPage.find((fragment) => fragment.part === 0 && !isSectionWrapper(fragment.key)) ??
      onPage.find((fragment) => fragment.part === 0) ??
      onPage[0];
    breaks.push({
      page: page + 1,
      key: opener.key,
      // True when real content — not just the section box around it — was cut
      // in half by the boundary.
      splits: onPage.some((fragment) => fragment.part > 0 && !isSectionWrapper(fragment.key)),
      slack: Math.max(0, box.height - used[page - 1]),
    });
  }

  return {
    pages,
    box,
    breaks,
    used,
    lastPageFill: Math.min(1, used[pages - 1] / box.height),
    fragments,
  };
}

// ---------------------------------------------------------------------------
// Reading a path back into the document
// ---------------------------------------------------------------------------

export type BlockRef =
  | { kind: "header" }
  | { kind: "section"; section: number }
  | { kind: "text"; section: number }
  | { kind: "entry"; section: number; entry: number }
  | { kind: "bullet"; section: number; entry: number; bullet: number };

const ENTRY_LETTERS = "edpkcx";

/** Parse a `data-rp` path. Returns null for anything it does not recognise. */
export function parsePath(path: string): BlockRef | null {
  if (path === "header") return { kind: "header" };
  const parts = path.split("/");
  const section = /^s(\d+)$/.exec(parts[0] ?? "");
  if (!section) return null;
  const index = Number(section[1]);
  if (parts.length === 1) return { kind: "section", section: index };
  if (parts[1] === "text") return { kind: "text", section: index };
  const entry = new RegExp(`^([${ENTRY_LETTERS}])(\\d+)$`).exec(parts[1]);
  if (!entry) return null;
  const entryIndex = Number(entry[2]);
  if (parts.length === 2) return { kind: "entry", section: index, entry: entryIndex };
  const bullet = /^b(\d+)$/.exec(parts[2]);
  if (!bullet) return null;
  return { kind: "bullet", section: index, entry: entryIndex, bullet: Number(bullet[1]) };
}

/** A human label for a path — what to call it in "this lands on page 2". */
export function describePath(doc: ResumeDoc, path: string): string {
  const ref = parsePath(path);
  if (!ref) return "";
  if (ref.kind === "header") return "Your name and contact details";
  const section = doc.sections[ref.section];
  if (!section) return "";
  if (ref.kind === "section") return section.heading || section.kind;
  if (ref.kind === "text") return section.heading || "Summary";

  const entryLabel = () => {
    const job = section.experience[ref.entry];
    if (job) return [job.title, job.company].filter(Boolean).join(" — ") || "an entry";
    const project = section.projects[ref.entry];
    if (project) return project.name || "a project";
    const school = section.education[ref.entry];
    if (school) return [school.degree, school.school].filter(Boolean).join(" — ") || "a school";
    const cert = section.certifications[ref.entry];
    if (cert) return cert.name || "a certification";
    const group = section.skills[ref.entry];
    if (group) return group.name || "a skill group";
    const custom = section.items[ref.entry];
    if (custom) return custom.title || "an entry";
    return "an entry";
  };

  if (ref.kind === "entry") return entryLabel();
  const bullets =
    section.experience[ref.entry]?.bullets ??
    section.projects[ref.entry]?.bullets ??
    section.items[ref.entry]?.bullets ??
    section.education[ref.entry]?.details ??
    [];
  const text = bullets[ref.bullet] ?? "";
  return text ? `“${text.slice(0, 60)}${text.length > 60 ? "…" : ""}”` : entryLabel();
}

/** Everything that shows on one page, coarsest first. Feeds cut-to-fit. */
export function contentsOfPage(layout: PageLayout, page: number) {
  const zero = page - 1;
  const seen = new Set<string>();
  const rows: { key: string; partial: boolean }[] = [];
  for (const fragment of layout.fragments) {
    if (fragment.page !== zero || seen.has(fragment.key)) continue;
    seen.add(fragment.key);
    rows.push({
      key: fragment.key,
      partial: layout.fragments.filter((other) => other.key === fragment.key).length > 1,
    });
  }
  return rows;
}
