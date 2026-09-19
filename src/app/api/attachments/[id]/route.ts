import { requireUser } from "@/lib/auth";
import { getAttachmentBytes } from "@/lib/data/attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Download a kept file.
 *
 * Auth-gated exactly as /api/resumes/[id]/pdf is, and scoped to the caller's own
 * id in the query itself: this is the ONLY address in the app that returns an
 * attachment's bytes, and an MCP tool that returned them instead would be a
 * four-megabyte base64 string in somebody's context window.
 *
 * Deliberately not gated on the archive — a link in your own browser history
 * for your own file should not 404 because you binned the job this morning.
 * The data layer's comment says the same thing at the line.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const file = await getAttachmentBytes(user.id, id);
  if (!file) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      // `inline` so a PDF or an image opens rather than downloading, with the
      // real filename kept for whichever the browser decides to do. Encoded
      // both ways: the plain one for old clients, the RFC 5987 one for names
      // with anything outside ASCII in them.
      "Content-Disposition": `inline; filename="${file.filename.replace(/["\\\r\n]/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      // Private, not public: this is behind a session and belongs to one person.
      "Cache-Control": "private, no-store",
      // A stored file is somebody else's bytes. Never let a browser guess a
      // type for it, and never let it run in this origin.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
