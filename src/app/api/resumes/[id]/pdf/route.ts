import { requireUser, createEphemeralSession, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { getResume } from "@/lib/data/resumes";
import { renderPdf, pdfRenderingAvailable } from "@/lib/pdf";
import { attachmentDisposition, documentTitle } from "@/lib/print-names";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Rendering a page in a real browser is slow by web standards.
export const maxDuration = 60;

/**
 * A real PDF, rendered server-side, with no print dialog in the way.
 *
 * It drives a headless browser to this app's own /print/[id] — the same page a
 * person would print by hand — so the bytes match what the editor shows and the
 * text stays selectable and ATS-readable.
 *
 * When the host has no Chromium this returns 501 with a plain explanation, and
 * the UI keeps offering the print page. That is the pre-existing behaviour, so
 * an instance without a browser is no worse off than before.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const resume = await getResume(user.id, id);
  if (!resume) return new Response("Not found", { status: 404 });

  if (!pdfRenderingAvailable()) {
    return new Response(
      "This instance has no headless browser, so it cannot render PDFs on the server. " +
        `Open /print/${id} and use your browser's "Save as PDF" instead.`,
      { status: 501, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const token = await createEphemeralSession(user.id);

  try {
    const { bytes } = await renderPdf({
      url: `${origin}/print/${id}`,
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
        "Content-Disposition": attachmentDisposition(
          documentTitle(resume.doc.header.name, "resume", resume.name),
          "resume",
        ),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Could not render that resume.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } finally {
    await destroySession(token);
  }
}

