/**
 * A document's margin, stated where a printer will honour it.
 *
 * The margin belongs to the page box rather than to the paper: padding on a box
 * that fragments across pages is sliced, so page one keeps the top of it, the
 * last page keeps the bottom, and every page in between gets none at all. That
 * was measurably true of this app's own PDFs before this existed.
 *
 * It is emitted per document rather than living in globals.css because `@page`
 * cannot read a custom property, and the margin is a per-resume setting. Any
 * route that can be printed — the print page and the public link — renders one
 * of these; the screen keeps the paper's own padding and is untouched.
 */
export function PageMarginStyle({ pageMargin }: { pageMargin: number }) {
  return (
    <style>{`@media print { @page { margin: ${Math.max(0, Math.round(pageMargin))}px; } }`}</style>
  );
}
