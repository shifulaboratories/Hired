import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { evidenceSources, getResume, listResumeNames } from "@/lib/data/resumes";
import { getProfile, listRoles } from "@/lib/data/me";
import { requireUser } from "@/lib/auth";
import { accountAccess } from "@/lib/data/accounts";
import { ResumeEditor } from "@/components/resume/resume-editor";
import { pdfRenderingAvailable } from "@/lib/pdf";

export const dynamic = "force-dynamic";

export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const headerList = await headers();
  const { id } = await params;
  // Everything independent in one round: the document, the other documents
  // by name (so "tailored from" can be set without the full list's outcome
  // joins), the profile (the photo, so the design toggle previews instantly),
  // the evidence the editor marks bullets against — the same material and rule
  // trace_resume_evidence uses — and every job, labels only, to pull one in.
  const [resume, names, profile, googleConnection, evidence, roleRows] = await Promise.all([
    getResume(user.id, id),
    listResumeNames(user.id),
    getProfile(user.id),
    accountAccess(user.id),
    evidenceSources(user.id),
    listRoles(user.id),
  ]);
  if (!resume) notFound();
  const siblings = names.filter((row) => row.id !== id);
  const roles = roleRows.map((role) => ({
    id: role.id,
    label: [role.title, role.company].filter(Boolean).join(" — ") || "Untitled role",
    bullets: role._count.highlights,
  }));

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
      updatedAt={resume.updatedAt.toISOString()}
      canRenderPdf={pdfRenderingAvailable()}
      shareUrl={resume.slug ? `${proto}://${host}/r/${resume.slug}` : null}
      base={base ? { id: base.id, name: base.name, doc: base.doc } : null}
      doc={resume.doc}
      evidence={evidence}
      roles={roles}
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
