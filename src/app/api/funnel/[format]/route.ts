import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { funnelFlows } from "@/lib/data/pipeline";
import { funnelFilename, funnelPng, funnelSvg } from "@/lib/funnel-image";

/**
 * The funnel as a downloadable image.
 *
 * Auth-gated like every other content route: this draws one person's search,
 * and the app's only unauthenticated pages are the two unlisted-slug ones.
 * `requireUser` redirects rather than throwing, which is the right answer for a
 * link someone opens in a new tab with an expired session.
 *
 * PNG asks for a headless Chromium and says plainly when the host has none.
 * The SVG needs nothing and is offered beside it for exactly that reason.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ format: string }> },
) {
  const user = await requireUser();
  const { format } = await params;
  if (format !== "png" && format !== "svg") {
    return NextResponse.json({ error: "Ask for png or svg." }, { status: 404 });
  }

  const { rungs, applied } = await funnelFlows(user.id);
  if (applied === 0) {
    return NextResponse.json(
      { error: "Nothing to chart yet — apply to something first." },
      { status: 409 },
    );
  }

  if (format === "svg") {
    return new NextResponse(funnelSvg(rungs), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${funnelFilename("svg")}"`,
        // Somebody's live pipeline. Never a shared cache, never a stale copy.
        "Cache-Control": "private, no-store",
      },
    });
  }

  try {
    const png = await funnelPng(rungs);
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${funnelFilename("png")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    // 503 rather than 500: the request was fine, this host cannot serve it.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not render that." },
      { status: 503 },
    );
  }
}
