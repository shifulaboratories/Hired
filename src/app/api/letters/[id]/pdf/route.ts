import { requireUser, createEphemeralSession, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { getLetter } from "@/lib/data/letters";
import { renderPdf, pdfRenderingAvailable } from "@/lib/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Rendering a page in a real browser is slow by web standards.
export const maxDuration = 60;

/**
 * A letter as a PDF, rendered the same way a resume is.
 *
 * Deliberately a near-copy of /api/resumes/[id]/pdf rather than a shared
 * handler taking a kind: the two differ only in which data function they call
 * and which marker proves the page rendered, and a generic version would have
 * to take both as parameters — at which point the abstraction costs more than
 * it saves and hides the auth check inside a branch. If a third document kind
 * ever appears, fold all three then.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const letter = await getLetter(user.id, id);
  if (!letter) return new Response("Not found", { status: 404 });

  if (!pdfRenderingAvailable()) {
    return new Response(
      "This instance has no headless browser, so it cannot render PDFs on the server. " +
        `Open /print/letter/${id} and use your browser's "Save as PDF" instead.`,
      { status: 501, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const token = await createEphemeralSession(user.id);

  try {
    const { bytes } = await renderPdf({
      url: `${origin}/print/letter/${id}`,
      marker: ".letter-paper",
      sessionCookie: {
        name: SESSION_COOKIE,
        value: token,
        domain: url.hostname,
        secure: url.protocol === "https:",
      },
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName(letter.title)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Could not render that letter.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } finally {
    await destroySession(token);
  }
}

function fileName(name: string) {
  const stem = name.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "letter";
  return `${stem}.pdf`;
}
