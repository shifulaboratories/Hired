"use client";

import { useEffect, useRef, useState } from "react";
import { ResumePaper, type PaperSettings } from "@/components/resume/resume-paper";
import { readFragments } from "@/lib/resume-measure-dom";
import {
  emptyLayout,
  layoutFromFragments,
  pageBox,
  type PageLayout,
} from "@/lib/resume-pagination";
import type { ResumeDoc } from "@/lib/resume-schema";

/**
 * A second, invisible copy of the document, laid out in page-sized columns so
 * the browser reports where it breaks.
 *
 * It is a copy rather than a measurement of the visible preview because the
 * preview is inside a `transform: scale()` wrapper, and a scaled element's
 * rectangles are scaled too — measuring it would report a page height that
 * changes when you zoom. This one is never scaled and never seen.
 *
 * The paper is rendered with `pageMargin: 0` and the margin is carried by the
 * host's column size, which is the same arrangement the printed page uses now
 * that the margin lives on the page box.
 */
export function PageMeasure({
  doc,
  settings,
  onLayout,
}: {
  doc: ResumeDoc;
  settings: PaperSettings;
  onLayout: (layout: PageLayout) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const box = pageBox(settings.pageMargin);
  // Kept in a ref so a parent that re-creates the callback every render does
  // not re-run the measurement.
  const report = useRef(onLayout);
  report.current = onLayout;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    // After paint, and after fonts settle: the resume sets its own family, and
    // measuring mid-swap reports the fallback's metrics.
    const run = () => {
      if (cancelled || !host.current) return;
      const fragments = readFragments(host.current, box.width);
      report.current(
        fragments.length ? layoutFromFragments(fragments, box) : emptyLayout(box),
      );
    };
    const frame = requestAnimationFrame(run);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fonts?.ready.then(run).catch(() => {});
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [doc, settings, box.width, box.height]);

  return (
    <div
      ref={host}
      className="rp-measure-host"
      aria-hidden
      style={
        {
          "--rp-page-w": `${box.width}px`,
          "--rp-page-h": `${box.height}px`,
        } as React.CSSProperties
      }
    >
      <ResumePaper doc={doc} settings={{ ...settings, pageMargin: 0 }} />
    </div>
  );
}
