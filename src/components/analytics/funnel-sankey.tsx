import { STAGE_LABEL } from "@/lib/data/pipeline";
import type { FunnelRung } from "@/lib/data/pipeline";
import { sankeyBody, sankeyLayout } from "@/lib/funnel-sankey";

/**
 * The search, drawn.
 *
 * A server component with no interactivity on purpose, and the markup itself
 * comes from the same string emitter the downloadable file uses — so what you
 * post is exactly what you were looking at, down to the pixel. That is why the
 * body is injected rather than written as JSX: two emitters would be two
 * pictures the day somebody edited one of them.
 *
 * Nothing here reads a CSS variable for the flows. The tones are resolved hex,
 * because the headless browser that turns this into a PNG loads no stylesheet
 * of ours and `var(--stage-tone)` would come out black.
 */

/** Resolved hex, not `var(--…)`: a screenshot has no theme to read from. */
const TONES: Record<string, string> = {
  APPLIED: "#64748b",
  SCREEN: "#3b82f6",
  INTERVIEW: "#8b5cf6",
  FINAL: "#ec4899",
  OFFER: "#f59e0b",
  ACCEPTED: "#10b981",
  REJECTED: "#ef4444",
  GHOSTED: "#94a3b8",
  WITHDRAWN: "#a1a1aa",
  OPEN: "#0ea5e9",
};

const EXIT_TONE = "#94a3b8";

const LABEL: Record<string, string> = {
  ...STAGE_LABEL,
  // The endings read as outcomes here rather than as board columns: "Ghosted"
  // is a stage name, "No response" is what happened.
  GHOSTED: "No response",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrew",
  ACCEPTED: "Offer accepted",
  OPEN: "Still going",
};

export const FUNNEL_TITLE = "Where each application ended up";

/** The one place the layout's colours and words are chosen. */
export function funnelOptions(width?: number, height?: number) {
  return {
    width,
    height,
    tones: TONES,
    exitTone: EXIT_TONE,
    labelFor: (stage: string) => LABEL[stage] ?? stage,
  };
}

export function FunnelSankey({
  rungs,
  width = 900,
  /**
   * Short on purpose. This is the overview at the top of a tab, not the
   * report — a Sankey wants width and needs almost no height to be read, and
   * at 420 it was a slab that pushed everything under it below the fold. The
   * downloadable file passes its own, larger, box.
   */
  height = 200,
}: {
  rungs: FunnelRung[];
  width?: number;
  height?: number;
}) {
  const layout = sankeyLayout(rungs, funnelOptions(width, height));

  if (layout.empty) {
    return (
      <p className="text-muted-foreground py-12 text-center text-sm">
        Nothing to chart yet. Apply to something and this fills in.
      </p>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={FUNNEL_TITLE}
      className="text-foreground h-auto w-full"
      xmlns="http://www.w3.org/2000/svg"
      // Numbers counted from the database and labels from the catalogue above.
      // Nothing a person typed reaches this string; see sankeyBody.
      dangerouslySetInnerHTML={{
        __html: sankeyBody(layout, {
          ink: "currentColor",
          faint: "currentColor",
          standalone: false,
          // Brighter than the file, because the card behind this is nearly
          // black in the default theme and a 34% wash disappears into it.
          flow: { spine: 0.5, exit: 0.32 },
        }),
      }}
    />
  );
}

export { LABEL as FUNNEL_LABEL, TONES as FUNNEL_TONES };
