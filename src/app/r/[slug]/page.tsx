import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getResumeBySlug } from "@/lib/data/resumes";
import { ResumePaper } from "@/components/resume/resume-paper";
import { PageMarginStyle } from "@/components/resume/page-margin-style";

export const dynamic = "force-dynamic";

/**
 * The public face of a resume. No authentication, by design — this is the link
 * you paste into an application form.
 *
 * The slug is the only thing protecting it, so the page is deliberately mute:
 * it renders one document and nothing else. No navigation into the app, no
 * owner's name in the chrome, no way to walk from here to anything the owner
 * hasn't published. A slug that doesn't resolve, or resolves to a resume that
 * has been withdrawn, is a plain 404 — indistinguishable from one that never
 * existed, so the page can't be used to probe for real links.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const resume = await getResumeBySlug(slug);
  if (!resume) return { title: "Not found", robots: { index: false, follow: false } };

  const name = resume.doc.header.name?.trim();
  const title = resume.doc.header.title?.trim();

  return {
    title: name ? `${name} — Resume` : resume.name,
    description: title || undefined,
    // Unlisted means unlisted. An indexed "unlisted" link is a listed one.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function PublicResumePage({ params }: Params) {
  const { slug } = await params;
  const resume = await getResumeBySlug(slug);
  if (!resume) notFound();

  return (
    <main className="min-h-svh bg-neutral-200 py-6 print:bg-white print:py-0 sm:py-10">
      <PageMarginStyle pageMargin={resume.pageMargin} />
      <div className="mx-auto w-fit max-w-full overflow-x-auto px-3 print:overflow-visible print:px-0">
        <div className="bg-white shadow-2xl print:shadow-none">
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

      <p className="text-muted-foreground no-print mt-6 text-center text-xs">
        Print or save this page as a PDF from your browser.
      </p>
    </main>
  );
}
