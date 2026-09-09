/**
 * The Sankey's geometry, computed once and drawn twice.
 *
 * Pure: no React, no Prisma, no DOM. The page renders these rectangles inline
 * and the share route renders the same ones into a standalone SVG that a
 * headless Chromium turns into a PNG. A layout computed in the component would
 * mean the image and the screen could disagree, which for a thing whose whole
 * job is to be screenshotted and posted is the one bug that matters.
 *
 * Not a general Sankey. A job search has one spine — applied, screen,
 * interview, final, offer — and everything that leaves it leaves sideways and
 * never comes back. That is a much smaller problem than the layered graph a
 * real Sankey library solves, and it has an exact answer rather than an
 * iterated one: each rung is a column, its survivors continue, and its
 * departures stack below them.
 */

/**
 * What this module needs to draw one rung — and nothing else.
 *
 * It used to take stage keys and look their words and colours up through the
 * caller's catalogue. It cannot any more: a rung may be "Round 3" and an exit
 * may be a tag the person named themselves, neither of which any catalogue
 * here could know. So each rung and each ending arrives carrying its own label
 * and its own colour, and this file knows no palette and no vocabulary at all,
 * which is what its header always claimed.
 */
export type FunnelRungInput = {
  key: string;
  label: string;
  /** A CSS colour, already resolved by the caller. */
  tone: string;
  reached: number;
  /** How many were actually in this rung, not merely past its depth. */
  visited: number;
  advanced: number;
  ended: { key: string; label: string; tone: string; count: number }[];
  open: number;
};

export type SankeyNode = {
  id: string;
  label: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A CSS colour. The caller resolves it, so this file knows no palette. */
  tone: string;
  /** Departures are drawn quieter than the spine. */
  kind: "spine" | "exit";
};

export type SankeyLink = {
  id: string;
  /** An SVG path, already a ribbon rather than a line. */
  path: string;
  value: number;
  tone: string;
  kind: "spine" | "exit";
};

export type SankeyLayout = {
  width: number;
  height: number;
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** True when there is nothing to draw, so callers can say so instead. */
  empty: boolean;
};

export type SankeyOptions = {
  width?: number;
  height?: number;
  /** What the still-live band at each rung is called, and its colour. */
  openLabel: string;
  openTone: string;
};

const NODE_WIDTH = 14;
const PADDING = { top: 28, right: 148, bottom: 28, left: 8 };
/** Vertical gap between a rung's survivors and the exits stacked under them. */
const GAP = 10;
/**
 * Horizontal room kept clear for the column the exits land in.
 *
 * Without it the last rung's block and the exit block sit at almost the same x
 * and overlap — the offer column ended up hidden behind "Offer accepted", which
 * is exactly the square somebody wants to see.
 */
const EXIT_LANE = 120;
/**
 * The least vertical room a departure gets in the landing column.
 *
 * Its label is 11.5px whatever the chart's scale, so two exits worth one
 * application each, on a chart of forty, would otherwise be drawn 3px apart and
 * their labels would sit on top of each other. This is the floor that stops it.
 */
const MIN_EXIT_PITCH = 17;

/**
 * A ribbon from one x to another, as a filled path.
 *
 * Two cubics and a close, rather than a thick line: a stroke cannot change
 * width along its length, and the whole point of a Sankey is that a flow is as
 * wide as it is big.
 */
function ribbon(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) {
  const cx = x0 + (x1 - x0) / 2;
  return [
    `M${x0},${y0}`,
    `C${cx},${y0} ${cx},${y1} ${x1},${y1}`,
    `L${x1},${y1 + h1}`,
    `C${cx},${y1 + h1} ${cx},${y0 + h0} ${x0},${y0 + h0}`,
    "Z",
  ].join(" ");
}

export function sankeyLayout(rungs: FunnelRungInput[], options: SankeyOptions): SankeyLayout {
  const width = options.width ?? 900;
  const height = options.height ?? 420;
  const total = rungs[0]?.reached ?? 0;
  if (total === 0) {
    return { width, height, nodes: [], links: [], empty: true };
  }

  // Only the rungs somebody was actually IN.
  //
  // `reached` is a depth: an application that went from an interview straight
  // to an offer counts as having got past the final-round rung, which is what
  // makes the arithmetic close. Drawing a column for it would put "Final round
  // 1" on a chart belonging to somebody who never had one — and this chart's
  // whole job is to be posted and read by strangers. So a rung nobody entered
  // is skipped, and the ribbon joins the columns either side of it: the
  // survivors leaving one rung always equal the depth reached at the next kept
  // one, whether or not anything in between was drawn.
  const live = rungs.filter(
    (rung) => rung.reached > 0 && (rung.visited > 0 || rung.open > 0 || rung.ended.length > 0),
  );
  const inner = {
    width: width - PADDING.left - PADDING.right,
    height: height - PADDING.top - PADDING.bottom,
  };
  // Every rung's exits are stacked under it, so the tallest column is the first
  // one — which is the whole population. Scale off that and nothing overflows.
  const perUnit = inner.height / total;
  const columnGap =
    live.length > 1 ? (inner.width - NODE_WIDTH - EXIT_LANE) / (live.length - 1) : inner.width;

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  /**
   * Every departure, collected before any of them is placed.
   *
   * The landing column is shared by all five rungs, and each rung works out
   * where its own exits *want* to sit without knowing about the others. That is
   * fine while the drawing is tall — the wants happen not to overlap, because a
   * rung's exits occupy exactly the band between its survivors and its total —
   * but the labels beside them are a fixed 11.5px whatever the scale, so on a
   * short chart with a real search in it they land on top of each other and the
   * whole right-hand side becomes unreadable. So the placing happens once, over
   * all of them, in the pass below.
   */
  const departures: {
    id: string;
    label: string;
    tone: string;
    value: number;
    /** Where it leaves the spine. Fixed — this is what makes it readable. */
    fromX: number;
    fromY: number;
    height: number;
    /** Where it would land with nothing else in the way. */
    wantsY: number;
  }[] = [];

  live.forEach((rung, index) => {
    const x = PADDING.left + index * columnGap;
    const top = PADDING.top;
    const spineHeight = Math.max(1, rung.reached * perUnit);

    nodes.push({
      id: `rung-${rung.key}`,
      label: rung.label,
      value: rung.reached,
      x,
      y: top,
      width: NODE_WIDTH,
      height: spineHeight,
      tone: rung.tone,
      kind: "spine",
    });

    const next = live[index + 1];
    // Survivors first, from the top: the eye follows the spine across.
    let cursor = top;
    if (next && rung.advanced > 0) {
      const h = Math.max(1, rung.advanced * perUnit);
      const nextX = PADDING.left + (index + 1) * columnGap;
      links.push({
        id: `flow-${rung.key}`,
        path: ribbon(x + NODE_WIDTH, cursor, h, nextX, top, Math.max(1, next.reached * perUnit)),
        value: rung.advanced,
        tone: next.tone,
        kind: "spine",
      });
      cursor += h;
    }

    // Then everything that left here, stacked under the survivors and pushed
    // out to the right margin where the labels live.
    const exits = [
      ...rung.ended,
      // "Still going" is an exit from the diagram, not from the search — drawn
      // last so an in-flight application never sits above a rejection.
      ...(rung.open > 0
        ? [{ key: "OPEN", label: options.openLabel, tone: options.openTone, count: rung.open }]
        : []),
    ].filter((exit) => exit.count > 0);

    let exitY = cursor + (exits.length > 0 ? GAP : 0);
    for (const exit of exits) {
      const h = Math.max(1, exit.count * perUnit);
      departures.push({
        id: `${rung.key}-${exit.key}`,
        label: exit.label,
        tone: exit.tone,
        value: exit.count,
        fromX: x + NODE_WIDTH,
        fromY: cursor,
        height: h,
        wantsY: exitY,
      });
      cursor += h;
      exitY += h + GAP;
    }
  });

  // Place the landing column top to bottom, giving every label the room it
  // needs. A block keeps its true height — a 1 must not look like a 3 — so
  // what gives is the space beneath it, and the drawing grows rather than
  // overlapping. Deeper rungs land higher, which falls out of sorting: a
  // rung's exits sit in the band between its survivors and its total, and the
  // deeper the rung the smaller both are.
  const endX = PADDING.left + inner.width;
  let floorY = PADDING.top;
  for (const exit of departures.sort((a, b) => a.wantsY - b.wantsY)) {
    const y = Math.max(exit.wantsY, floorY);
    floorY = y + Math.max(exit.height, MIN_EXIT_PITCH);
    links.push({
      id: `exit-${exit.id}`,
      path: ribbon(exit.fromX, exit.fromY, exit.height, endX, y, exit.height),
      value: exit.value,
      tone: exit.tone,
      kind: "exit",
    });
    nodes.push({
      id: `end-${exit.id}`,
      label: exit.label,
      value: exit.value,
      x: endX,
      y,
      width: NODE_WIDTH,
      height: exit.height,
      tone: exit.tone,
      kind: "exit",
    });
  }

  // The exits fan downward, so the drawing is usually taller than the spine.
  // Grow the box to fit rather than clipping the bottom label off.
  const lowest = Math.max(
    height - PADDING.bottom,
    ...nodes.map((node) => node.y + node.height),
    PADDING.top,
  );
  return {
    width,
    height: Math.ceil(lowest + PADDING.bottom),
    nodes,
    links,
    empty: false,
  };
}

// ---------------------------------------------------------------------------
// Drawing it
// ---------------------------------------------------------------------------

/**
 * The markup, built as a string rather than as JSX.
 *
 * The page and the downloadable file have to be the same picture, and the only
 * way to guarantee that is one emitter. It cannot be a React component that the
 * file route renders with `renderToStaticMarkup`, because Next refuses
 * `react-dom/server` inside the app router — so the string is the primitive and
 * the component injects it. Nothing here comes from a person: every number is
 * counted from the database and every label is looked up in a fixed catalogue.
 * `esc` is belt-and-braces for the day somebody passes a `labelFor` that isn't.
 */
const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type SankeyInk = {
  /** Label colour. A theme-aware page passes `currentColor`. */
  ink: string;
  faint: string;
  /** Opacities differ on a white sheet, which has no theme to sit against. */
  standalone: boolean;
  /**
   * How solid the ribbons are, spine and exit.
   *
   * The one thing that legitimately differs between the page and the file, and
   * only because the grounds differ: 34% of a colour reads as a pastel on white
   * and as mud on the app's near-black. The geometry, the words and the numbers
   * are identical — an opacity is not a different picture.
   */
  flow?: { spine: number; exit: number };
};

export function sankeyBody(
  layout: SankeyLayout,
  { ink, faint, standalone, flow }: SankeyInk,
): string {
  const solid = standalone ? 1 : 0.85;
  const quiet = standalone ? 1 : 0.6;
  const ribbons = flow ?? { spine: 0.34, exit: 0.2 };
  const parts: string[] = [];

  // Ribbons first, so a flow never covers the column it arrives at.
  for (const link of layout.links) {
    parts.push(
      `<path d="${link.path}" fill="${link.tone}" fill-opacity="${link.kind === "spine" ? ribbons.spine : ribbons.exit}"/>`,
    );
  }

  for (const node of layout.nodes) {
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="3"` +
        ` fill="${node.tone}" fill-opacity="${node.kind === "spine" ? 0.95 : 0.75}"/>`,
    );
    if (node.kind === "spine") {
      // Above the column: a spine block is 14px wide and a label will not fit
      // beside it.
      parts.push(
        `<text x="${node.x}" y="${node.y - 9}" font-size="12" font-weight="600" fill="${ink}" fill-opacity="${solid}">` +
          `${esc(node.label)}<tspan fill="${faint}" fill-opacity="${quiet}" dx="6" font-weight="400">${node.value}</tspan>` +
          `</text>`,
      );
    } else {
      // Beside it, in the right margin the layout reserved.
      parts.push(
        `<text x="${node.x + node.width + 8}" y="${node.y + node.height / 2}" dominant-baseline="middle"` +
          ` font-size="11.5" fill="${ink}" fill-opacity="${standalone ? 1 : 0.75}">` +
          `${esc(node.label)}<tspan fill="${faint}" fill-opacity="${quiet}" dx="5" font-weight="600">${node.value}</tspan>` +
          `</text>`,
      );
    }
  }

  return parts.join("");
}

/**
 * The same drawing as a standalone file: its own width, its own colours, and a
 * font stack, because a downloaded SVG carries no stylesheet with it.
 */
export function sankeyDocument(layout: SankeyLayout, title: string): string {
  const body = sankeyBody(layout, { ink: "#0f172a", faint: "#64748b", standalone: true });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}"` +
    ` width="${layout.width}" height="${layout.height}" role="img" aria-label="${esc(title)}"` +
    ` font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif">` +
    `<title>${esc(title)}</title>` +
    `<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>` +
    body +
    `</svg>`
  );
}
