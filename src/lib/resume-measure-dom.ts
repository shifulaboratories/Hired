import type { RawFragment } from "@/lib/resume-pagination";

/**
 * Ask the browser where the pages break, rather than guessing.
 *
 * The host this reads is a multi-column box whose column is exactly one page's
 * content box. CSS fragmentation and paged fragmentation are the same
 * machinery, and they honour the same `break-inside: avoid` on `.rp-block` —
 * which is why that rule lives outside `@media print` — so the column an
 * element lands in IS the page it prints on.
 *
 * `getClientRects()` returns one rectangle per fragment, so an element split
 * across a boundary comes back as two and the split is visible in the result.
 *
 * Deliberately free of imports and closures beyond its own body: the same
 * function is serialised into a headless page during verification, so what is
 * checked is what runs.
 */
export function readFragments(host: HTMLElement, columnWidth: number): RawFragment[] {
  const marked = Array.from(host.querySelectorAll<HTMLElement>("[data-rp]"));
  if (marked.length === 0) return [];

  const hostRect = host.getBoundingClientRect();
  const out: RawFragment[] = [];
  for (const element of marked) {
    const key = element.dataset.rp;
    if (!key) continue;
    const rects = element.getClientRects();
    for (let part = 0; part < rects.length; part++) {
      const rect = rects[part];
      // Columns run left to right, so the horizontal offset names the page.
      // Rounded because sub-pixel column positions drift by fractions.
      const page = Math.max(0, Math.round((rect.left - hostRect.left) / columnWidth));
      out.push({
        key,
        part,
        page,
        top: rect.top - hostRect.top,
        height: rect.height,
      });
    }
  }
  return out;
}
