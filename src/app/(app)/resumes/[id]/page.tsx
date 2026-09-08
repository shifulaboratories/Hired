import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getResume, listResumeNames } from "@/lib/data/resumes";
import { getProfile } from "@/lib/data/me";
import { requireUser } from "@/lib/auth";
import { accountAccess } from "@/lib/data/accounts";
import { ResumeEditor } from "@/components/resume/resume-editor";

export const dynamic = "force-dynamic";

export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const headerList = await headers();
  const { id } = await params;
  const resume = await getResume(user.id, id);
  if (!resume) notFound();
  // Every other document by name only, so "tailored from" can be set from the
  // evidence panel without paying for the full list's outcome joins.
  const siblings = (await listResumeNames(user.id)).filter((row) => row.id !== id);

  // The editor gets the photo whether or not this document shows it, so the
  // toggle in the design popover previews instantly.
  const profile = await getProfile(user.id);
  const googleConnection = await accountAccess(user.id);

  // The base this variant was tailored from, for the live compare view. A
  // dangling reference (base deleted) resolves to null and the editor simply
  // doesn't offer the comparison.
  const base = resume.baseResumeId ? await getResume(user.id, resume.baseResumeId) : null;

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <ResumeEditor
      id={resume.id}
      shareUrl={resume.slug ? `${proto}://${host}/r/${resume.slug}` : null}
      base={base ? { id: base.id, name: base.name, doc: base.doc } : null}
      doc={resume.doc}
      meta={{
        name: resume.name,
        targetRole: resume.targetRole,
        targetCompany: resume.targetCompany,
        template: resume.template,
        accent: resume.accent,
        fontFamily: resume.fontFamily,
        fontSize: resume.fontSize,
        lineHeight: resume.lineHeight,
        pageMargin: resume.pageMargin,
        notes: resume.notes,
        isFavorite: resume.isFavorite,
        showPhoto: resume.showPhoto,
      }}
      photo={profile.photo}
      siblings={siblings.map((row) => ({ id: row.id, name: row.name }))}
      applications={resume.applications.map((application) => ({
        id: application.id,
        roleTitle: application.roleTitle,
        stage: application.stage,
        company: application.company.name,
        appliedAt: application.appliedAt?.toISOString() ?? null,
      }))}
      googleAccess={googleConnection}
    />
  );
}
