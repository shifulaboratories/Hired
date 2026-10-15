import { getResumeBySlug } from "@/lib/data/resumes";
import { resumeToText } from "@/lib/resume-text";

export const dynamic = "force-dynamic";

/**
 * The published resume as data, for an employer's system to read when the
 * person pastes their link into an application (Recruited's "Apply with Hired"
 * does this). It is exactly what /r/[slug] shows and nothing more: the same
 * lookup, the same 404 for anything unpublished or unknown, hidden sections
 * left out, and no photo — publishing with a photo consents to a page showing
 * it, not to a copy being kept elsewhere.
 *
 * The shape is a contract with readers we don't control: `format` and
 * `version` say what follows, `doc` is the resume document (resume-schema.ts),
 * and `text` is the same thing as plain text so a reader needn't know the
 * schema. Add fields freely; change one only with a new version.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resume = await getResumeBySlug(slug);
  const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
  if (!resume) return Response.json({ error: "not found" }, { status: 404, headers });
  const doc = { ...resume.doc, sections: resume.doc.sections.filter((s) => s.visible) };
  return Response.json(
    { format: "hired-resume", version: 1, updatedAt: resume.updatedAt.toISOString(), doc, text: resumeToText(doc) },
    { headers },
  );
}
