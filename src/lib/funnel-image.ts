import { chromium } from "playwright-core";
import { FUNNEL_TITLE, funnelOptions } from "@/components/analytics/funnel-sankey";
import { sankeyDocument, sankeyLayout } from "@/lib/funnel-sankey";
import { chromiumPath } from "@/lib/pdf";
import type { FunnelRung } from "@/lib/data/pipeline";

/**
 * The funnel as a file you can post.
 *
 * Two formats and one drawing. The SVG comes from the same emitter the page
 * uses, so what you download is what you were looking at; the PNG is that SVG
 * through the same headless Chromium `pdf.ts` already needs, and where the host
 * has none the SVG is the answer rather than an error. Slack, LinkedIn and
 * every browser open an SVG, so the degradation costs a file format rather than
 * the feature.
 *
 * `setContent` rather than `page.goto` at an app URL: this document has no
 * stylesheet, no fonts to wait for and no session to carry, so pointing a
 * browser back at ourselves would mean a second authenticated request to render
 * something we already have in a string.
 */

/** 2× so the image is sharp where people actually look at it. */
const SCALE = 2;

export function funnelSvg(rungs: FunnelRung[], options?: { width?: number }): string {
  const layout = sankeyLayout(rungs, funnelOptions(options?.width ?? 1000, 460));
  // React never renders this, so the XML declaration a standalone file wants
  // has to be written by hand.
  return `<?xml version="1.0" encoding="UTF-8"?>\n${sankeyDocument(layout, FUNNEL_TITLE)}`;
}

export async function funnelPng(rungs: FunnelRung[]): Promise<Buffer> {
  const executablePath = chromiumPath();
  if (!executablePath) {
    throw new Error(
      "No Chromium on this host, so the server cannot render a PNG. Download the SVG instead — it opens anywhere an image does.",
    );
  }

  const svg = funnelSvg(rungs, { width: 1000 });
  // A white ground rather than transparent: a transparent PNG pasted into a
  // dark Slack shows dark text on dark, and this is a thing people paste.
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#ffffff}
    #sheet{padding:28px 32px;width:1000px;box-sizing:content-box;
      font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  </style><div id="sheet">${svg}</div>`;

  let browser = null;
  try {
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const context = await browser.newContext({ deviceScaleFactor: SCALE });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const sheet = page.locator("#sheet");
    if ((await sheet.count()) === 0) throw new Error("The chart rendered nothing.");
    const bytes = await sheet.screenshot({ type: "png" });
    return Buffer.from(bytes);
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** `hired-funnel-2026-09-04.png`, so a downloads folder stays legible. */
export function funnelFilename(extension: "png" | "svg", now = new Date()) {
  return `hired-funnel-${now.toISOString().slice(0, 10)}.${extension}`;
}
