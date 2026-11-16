/**
 * The fallback half of how a resume's margin reaches paper.
 *
 * Normally the margin is the paper's own padding, repeated on every page by
 * box-decoration-break: clone, with a zero @page margin so the browser has no
 * room to print its date and URL headers (globals.css says why). A browser that
 * cannot clone padding across pages — Safari, today — would slice it instead:
 * page one gets the top margin, the last page the bottom, and the pages between
 * get none. For those, and only those, the margin goes back onto the page box,
 * which is right on every page; Safari's own headers and footers are off unless
 * someone turns them on.
 *
 * It is emitted per document because `@page` cannot read a custom property and
 * the margin is a per-resume setting. Any route that can be printed — the print
 * page and the public link — renders one of these.
 */
export function PageMarginStyle({ pageMargin }: { pageMargin: number }) {
  const margin = Math.max(0, Math.round(pageMargin));
  return (
    <style>{`@media print { @supports not (box-decoration-break: clone) {
  @page { margin: ${margin}px; }
  .resume-paper { width: auto !important; padding: 0 !important; }
} }`}</style>
  );
}
