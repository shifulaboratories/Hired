import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getResume } from "@/lib/data/resumes";
import { ResumePaper } from "@/components/resume/resume-paper";
import { PrintTrigger } from "@/components/resume/print-trigger";
import { PageMarginStyle } from "@/components/resume/page-margin-style";
import { documentTitle } from "@/lib/print-names";

export const dynamic = "force-dynamic";

/**
 * A bare page containing nothing but the document, sized to US Letter.
 * "Save as PDF" from the browser print dialog gives a real, selectable,
 * ATS-readable PDF — no headless Chrome on the server required.
 */
type Params = { params: Promise<{ id: string }> };

/**
 * The tab title is what the print dialog names the PDF, so it is set here,
 * where Next will not overwrite it, rather than from an effect it did.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await requireUser();
  const { id } = await params;
  const resume = await getResume(user.id, id);
  if (!resume) return { title: "Resume" };
  return { title: { absolute: documentTitle(resume.doc.header.name, "resume", resume.name) } };
}

export default async function PrintPage({ params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  const resume = await getResume(user.id, id);
  if (!resume) notFound();

  return (
    <div className="min-h-svh bg-neutral-200 py-8 print:bg-white print:py-0">
      <PageMarginStyle pageMargin={resume.pageMargin} />
      <PrintTrigger />
      <div className="mx-auto w-fit bg-white shadow-2xl print:shadow-none">
        <ResumePaper
          doc={resume.doc}
          linkify
          settings={{
            template: resume.template,
            accent: resume.accent,
            fontFamily: resume.fontFamily,
            fontSize: resume.fontSize,
            lineHeight: resume.lineHeight,
            pageMargin: resume.pageMargin,
            photo: resume.photo,
          }}
        />
      </div>
    </div>
  );
}
