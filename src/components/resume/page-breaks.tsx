"use client";

import { useEffect, useRef, useState } from "react";
import type { PageLayout } from "@/lib/resume-pagination";

/**
 * Where this document stops being page one.
 *
 * The question a resume editor exists to answer is "what falls onto page two?",
 * and until now the preview was one continuous sheet that never said.
 *
 * The line is drawn at the top of the element that actually opens the next
 * page, not at a fixed multiple of the sheet height. Those are different
 * places: `.rp-block` carries `break-inside: avoid`, so a job that will not fit
 * in what is left of a page is pushed down whole and the page before it ends
 * early with slack. A rule ruled across the geometric boundary would cut
 * through a paragraph that in fact prints intact on the previous page.
 *
 * Positions come from `offsetTop`, which is a layout value and therefore
 * unaffected by the preview's `transform: scale()` — the overlay sits inside
 * the scaled box, so the lines scale with the document for free.
 */
export function PageBreaks({ layout }: { layout: PageLayout }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<{ page: number; top: number; splits: boolean }[]>([]);

  useEffect(() => {
    const container = anchor.current?.parentElement;
    if (!container || layout.breaks.length === 0) {
      setTops([]);
      return;
    }
    const measure = () => {
      const next: { page: number; top: number; splits: boolean }[] = [];
      for (const pageBreak of layout.breaks) {
        const target: HTMLElement | null = container.querySelector(
          `[data-rp="${CSS.escape(pageBreak.key)}"]`,
        );
        if (!target) continue;
        let top = 0;
        let node: HTMLElement | null = target;
        while (node && node !== container) {
          top += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
        }
        next.push({ page: pageBreak.page, top, splits: pageBreak.splits });
      }
      setTops(next);
    };
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  return (
    <div ref={anchor} className="pointer-events-none absolute inset-0" aria-hidden>
      {tops.map((mark) => (
        <div key={mark.page} style={{ position: "absolute", top: mark.top, left: 0, right: 0 }}>
          <div
            style={{
              borderTop: "1px dashed color-mix(in srgb, #b3261e 50%, transparent)",
              marginTop: -1,
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: -14,
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "color-mix(in srgb, #b3261e 70%, transparent)",
            }}
          >
            {mark.splits ? `Page ${mark.page} — splits here` : `Page ${mark.page}`}
          </div>
        </div>
      ))}
    </div>
  );
}
