import { headers } from "next/headers";
import Link from "next/link";
import { FileTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionEmpty } from "@/components/page-header";
import { Stagger, StaggerItem, Lift } from "@/components/motion";
import { SearchBox } from "@/components/crm/search-box";
import { ResumeSortSelect } from "@/components/resume/resume-sort";
import { listResumes, type ResumeListOpts } from "@/lib/data/resumes";
import { parseResumeDoc } from "@/lib/resume-schema";
import { diffResumeDocs } from "@/lib/resume-diff";
import { estimatePages } from "@/lib/resume-text";
import { NewResumeDialog } from "@/components/resume/new-resume-dialog";
import { ResumeCard } from "@/components/resume/resume-card";
import { ResumePaper } from "@/components/resume/resume-paper";
import { PaperThumb } from "@/components/resume/paper-thumb";
import { db } from "@/lib/db";
import { shortDay } from "@/lib/time";

/**
 * The resume grid, as it appears under Me → Resumes.
 *
 * A server component, and it has to stay one: every card draws a real
 * ResumePaper at thumbnail scale, and that render belongs on the server for
 * the same reason the published page's does. It loads its own data rather
 * than taking it as props so the Me page can skip all of it — the join and a
 * document render per resume — whenever a different tab is showing.
 *
 * `userId` is resolved by the page from the session cookie and passed down;
 * it never arrives from a client.
 */
export async function ResumesPanel({
  userId,
  search,
  sort,
  hasMaterial,
}: {
  userId: string;
  search: string;
  sort: NonNullable<ResumeListOpts["sort"]>;
  /** Whether there is anything in Me to build a resume out of. */
  hasMaterial: boolean;
}) {
  const [resumes, profile, headerList] = await Promise.all([
    listResumes(userId, { search, sort }),
    // One read for the whole grid: the thumbnails all draw the same face.
    db.profile.findUnique({ where: { userId }, select: { photo: true, timeZone: true } }),
    headers(),
  ]);
  const photo = profile?.photo ?? "";
  const zone = profile?.timeZone ?? "";

  // For the copy-link action on published cards, built the same way the editor
  // builds its share URL.
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  // Parsed once per document: the thumbnail, the page gauge and the lineage
  // diff all read the same object.
  const docs = new Map(resumes.map((resume) => [resume.id, parseResumeDoc(resume.data)]));
  const byId = new Map(resumes.map((resume) => [resume.id, resume]));
  const variantCounts = new Map<string, number>();
  for (const resume of resumes) {
    if (resume.baseResumeId) {
      variantCounts.set(resume.baseResumeId, (variantCounts.get(resume.baseResumeId) ?? 0) + 1);
    }
  }

  // In the default view, a base is followed by its variants, so twelve
  // near-identical thumbnails read as one family rather than a wall. A chosen
  // sort or an active search means the person asked for a different order —
  // honour it flat.
  const ordered =
    sort === "recent" && !search
      ? (() => {
          const out: typeof resumes = [];
          const seen = new Set<string>();
          for (const resume of resumes) {
            if (seen.has(resume.id)) continue;
            if (resume.baseResumeId && byId.has(resume.baseResumeId)) continue;
            seen.add(resume.id);
            out.push(resume);
            for (const variant of resumes) {
              if (variant.baseResumeId === resume.id && !seen.has(variant.id)) {
                seen.add(variant.id);
                out.push(variant);
              }
            }
          }
          for (const resume of resumes) if (!seen.has(resume.id)) out.push(resume);
          return out;
        })()
      : resumes;

  return (
    <>
      {(resumes.length > 0 || search) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchBox placeholder="Search resumes…" className="w-full sm:w-72" />
          <ResumeSortSelect className="ml-auto" />
        </div>
      )}

      {resumes.length === 0 && search ? (
        <SectionEmpty>
          Nothing matches “{search}”. Clear the search to see everything.
        </SectionEmpty>
      ) : resumes.length === 0 ? (
        <EmptyState
          icon={FileTextIcon}
          title="No resumes yet"
          description={
            hasMaterial
              ? "Build one from Me in a click, or ask Claude to tailor one to a job posting."
              : "Already have a resume? Paste it to Claude and say \"import this\" — it fills in Me and drafts a resume in one move. Or add a role under Me by hand first."
          }
          action={
            hasMaterial ? (
              <NewResumeDialog hasMaterial />
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button asChild variant="default" size="sm">
                  <Link href="/settings?tab=connections">Connect an assistant</Link>
                </Button>
                <NewResumeDialog hasMaterial={false} />
              </div>
            )
          }
        />
      ) : (
        <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ordered.map((resume) => {
            const doc = docs.get(resume.id)!;
            const baseRow = resume.baseResumeId ? byId.get(resume.baseResumeId) : undefined;
            return (
              <StaggerItem key={resume.id}>
                <Lift>
                  <ResumeCard
                    id={resume.id}
                    name={resume.name}
                    target={[resume.targetRole, resume.targetCompany].filter(Boolean).join(" · ")}
                    template={resume.template}
                    pages={estimatePages(doc)}
                    publicUrl={resume.slug ? `${proto}://${host}/r/${resume.slug}` : null}
                    photoOnPublicPage={resume.showPhoto && Boolean(photo)}
                    applications={resume._count.applications}
                    outcomes={resume.outcomes}
                    lineage={
                      resume.baseResume
                        ? {
                            baseId: resume.baseResume.id,
                            baseName: resume.baseResume.name,
                            changes: baseRow
                              ? diffResumeDocs(docs.get(baseRow.id)!, doc).summary
                              : "",
                          }
                        : null
                    }
                    variants={variantCounts.get(resume.id) ?? 0}
                    isFavorite={resume.isFavorite}
                    updatedLabel={shortDay(resume.updatedAt, zone)}
                  >
                    <PaperThumb>
                      <ResumePaper
                        doc={doc}
                        settings={{
                          template: resume.template,
                          accent: resume.accent,
                          fontFamily: resume.fontFamily,
                          fontSize: resume.fontSize,
                          lineHeight: resume.lineHeight,
                          pageMargin: resume.pageMargin,
                          photo: resume.showPhoto ? photo : "",
                        }}
                      />
                    </PaperThumb>
                  </ResumeCard>
                </Lift>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </>
  );
}
