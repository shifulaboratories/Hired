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

/**
 * Resolved hex, not `var(--…)`: a screenshot has no theme to read from.
 *
 * Two vocabularies land here. A RUNG is "APPLIED", "ROUND_n" or "OFFER" — the
 * ladder's own keys, and the rounds reuse the hues the three interview stages
 * wore before they were merged, so a chart still reads left to right as
 * further along. An ENDING carries a palette token instead, because the reason
 * it ended is a tag the person owns and its colour is theirs to pick.
 */
const RUNG_TONE: Record<string, string> = {
  APPLIED: "#64748b",
  ROUND_1: "#3b82f6",
  ROUND_2: "#8b5cf6",
  ROUND_3: "#ec4899",
  ROUND_4: "#d946ef",
  ROUND_5: "#a855f7",
  ROUND_6: "#7c3aed",
  INTERVIEWING: "#8b5cf6",
  OFFER: "#f59e0b",
};

/** The eight tag swatches, plus the two endings that are not tags. */
const ENDING_TONE: Record<string, string> = {
  slate: "#94a3b8",
  blue: "#3b82f6",
  teal: "#14b8a6",
  green: "#10b981",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  pink: "#ec4899",
  accepted: "#10b981",
  lost: "#94a3b8",
};

const FALLBACK_TONE = "#94a3b8";
const OPEN_TONE = "#0ea5e9";

export const FUNNEL_TITLE = "Where each application ended up";

/** The one place the layout's colours and words are chosen. */
export function funnelOptions(width?: number, height?: number) {
  return { width, height, openLabel: "Still going", openTone: OPEN_TONE };
}

/**
 * A rung as the layout wants it: words and colours already chosen.
 *
 * Exported because the downloadable image builds the same picture from the
 * same rungs, and two of these would be two charts the day somebody edited one.
 */
export function toSankeyInput(rungs: FunnelRung[]) {
  return rungs.map((rung) => ({
    key: rung.key,
    label: rung.label,
    tone: RUNG_TONE[rung.key] ?? FALLBACK_TONE,
    reached: rung.reached,
    visited: rung.visited,
    advanced: rung.advanced,
    open: rung.open,
    ended: rung.ended.map((ending) => ({
      key: ending.reason,
      label: ending.reason,
      tone: ENDING_TONE[ending.tone] ?? FALLBACK_TONE,
      count: ending.count,
    })),
  }));
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
  const layout = sankeyLayout(toSankeyInput(rungs), funnelOptions(width, height));

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
