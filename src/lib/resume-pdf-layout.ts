/**
 * Deciding whether a PDF's text can be read in order, and putting it in order
 * when it can.
 *
 * A PDF has no paragraphs. It has glyphs at coordinates, and the order they
 * appear in the file is the order the generator happened to emit them — which
 * for a two-column resume interleaves the columns: a line of your job history
 * followed by a line of your skills sidebar, forever. That is why this app has
 * always said "paste the text" instead of reading PDFs, and it was the right
 * call while the alternative was guessing.
 *
 * The alternative is not guessing. Text comes with positions, so a two-column
 * layout is *detectable*, and a document that is detectably unreadable can be
 * refused by name — "this is a two-column layout, its text comes out
 * interleaved" — which is a far better answer than either a silent mess or a
 * blanket refusal of every PDF, most of which are one column and read fine.
 *
 * Pure: positions in, a verdict and text out. The extraction itself lives in
 * the component that has the file, so this stays testable without a browser and
 * without pdfjs.
 */

/** One run of text on a page, as a PDF gives it: a box and its content. */
export type TextBox = {
  text: string;
  /** Left edge, in PDF units from the left of the page. */
  x: number;
  /** Baseline, in PDF units from the BOTTOM of the page — PDFs count up. */
  y: number;
  width: number;
};

export type PageBoxes = {
  width: number;
  height: number;
  boxes: TextBox[];
};

export type PdfReading =
  | { kind: "read"; text: string; pages: number }
  | { kind: "columns"; at: number; pages: number }
  | { kind: "empty" };

/**
 * A gutter is an x-position that no run of text crosses, with real text on
 * both sides of it.
 *
 * Asked of the runs themselves, never of assembled lines. Assembling lines
 * means grouping by baseline, and in a two-column layout the sidebar and the
 * body share baselines — so the "line" runs from the left margin to the right
 * one and crosses every candidate, which is exactly backwards. The first
 * version did that and could not see a two-column page at all.
 *
 * It is also what tells a real second column from a right-aligned date or a
 * date rail down the left: those sit beside lines that reach across the page,
 * so the crossings are there.
 */
const CROSSING_TOLERANCE = 0.02;
/** Each side has to be carrying a real share of the page's text. */
const MIN_SIDE_SHARE = 0.2;

export function gutterOf(page: PageBoxes): number | null {
  const boxes = page.boxes.filter((box) => box.text.trim());
  if (boxes.length < 8) return null;

  let best: { at: number; crossings: number } | null = null;
  // Only the middle of the page. A gutter at 15% is a margin, and refusing a
  // document over one would turn away resumes that read perfectly well.
  for (let step = 30; step <= 70; step += 1) {
    const at = (page.width * step) / 100;
    let crossings = 0;
    let left = 0;
    let right = 0;
    for (const box of boxes) {
      if (box.x < at && box.x + box.width > at) crossings += 1;
      else if (box.x + box.width <= at) left += 1;
      else right += 1;
    }
    if (left / boxes.length < MIN_SIDE_SHARE || right / boxes.length < MIN_SIDE_SHARE) continue;
    if (crossings / boxes.length > CROSSING_TOLERANCE) continue;
    if (!best || crossings < best.crossings) best = { at, crossings };
  }
  return best ? best.at : null;
}

/**
 * Put a page's text in reading order: down the page, and left to right within
 * a line.
 *
 * Only sound for a single-column page, which is why nothing calls it until
 * `gutterOf` has said there is one column. On a two-column page this produces
 * exactly the interleaving the app has always refused to hand anybody.
 */
export function readPage(page: PageBoxes): string {
  const rows = new Map<number, { y: number; boxes: TextBox[] }>();
  for (const box of page.boxes) {
    if (!box.text.trim()) continue;
    // Same baseline, give or take: generators wobble a point within a line, and
    // rounding to whole units would split glyphs sitting at 700.4 and 700.6.
    const key = Math.round(box.y / 3);
    const row = rows.get(key);
    if (row) row.boxes.push(box);
    else rows.set(key, { y: box.y, boxes: [box] });
  }
  // PDFs measure up from the bottom, so a bigger y is higher on the page.
  const ordered = [...rows.values()].sort((a, b) => b.y - a.y);
  if (ordered.length === 0) return "";

  // A paragraph break is a gap bigger than this page's own line spacing —
  // measured, not assumed. A fixed threshold put a blank line between every
  // single line at one font size and none at all at another, and the resume
  // parser reads blank lines as the boundary between one job and the next.
  //
  // 1.35, not 1.6: a real resume separates two jobs by rather less than half a
  // line. At 1.6 a document with a 10pt margin between jobs came through with
  // no break at all, and the parser read the first job's bullets as the second
  // job's company and title.
  const gaps = ordered.slice(1).map((row, index) => ordered[index].y - row.y).filter((gap) => gap > 0);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  const lines: string[] = [];
  ordered.forEach((row, index) => {
    if (index > 0 && median > 0 && ordered[index - 1].y - row.y > median * 1.35) lines.push("");
    lines.push(joinBoxes([...row.boxes].sort((a, b) => a.x - b.x)));
  });
  return lines.join("\n");
}

/**
 * Glue a line's runs together, putting a space between them only where the
 * page has one. A PDF splits a line wherever the font changes, so "**Stripe**,
 * Staff Engineer" arrives in three pieces that must not become "Stripe ,
 * Staff Engineer".
 */
function joinBoxes(boxes: TextBox[]): string {
  let line = "";
  let end: number | null = null;
  for (const box of boxes) {
    const gap = end === null ? 0 : box.x - end;
    // A space is about a quarter of a character; anything wider than half is a
    // real gap, anything narrower is the same word in another font.
    if (line && gap > 1.5 && !/\s$/.test(line) && !/^\s/.test(box.text)) line += " ";
    line += box.text;
    end = box.x + box.width;
  }
  return line.replace(/\s+/g, " ").trim();
}

/**
 * Read a whole document, or say why it cannot be read.
 *
 * One page in two columns is enough to refuse the document: a resume whose
 * second page is a sidebar is still a resume whose text comes out interleaved,
 * and half an import is worse than none — you would have to find what was
 * missing yourself.
 */
export function readPdf(pages: PageBoxes[]): PdfReading {
  const withText = pages.filter((page) => page.boxes.some((box) => box.text.trim()));
  if (withText.length === 0) return { kind: "empty" };
  for (const page of withText) {
    const gutter = gutterOf(page);
    if (gutter !== null) {
      return { kind: "columns", at: Math.round((gutter / page.width) * 100), pages: withText.length };
    }
  }
  return {
    kind: "read",
    text: withText.map(readPage).join("\n\n"),
    pages: withText.length,
  };
}
