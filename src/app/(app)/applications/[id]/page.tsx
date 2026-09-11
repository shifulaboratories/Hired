import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { applicationFieldValues, getApplication, listCompanies } from "@/lib/data/pipeline";
import { listTags, tagsOfKind } from "@/lib/data/tags";
import { offerForUi } from "@/lib/data/offers";
import { letterForUi, listLetters } from "@/lib/data/letters";
import { getResume, listResumeNames } from "@/lib/data/resumes";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { accountAccess } from "@/lib/data/accounts";
import { ApplicationDetail } from "@/components/pipeline/application-detail";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [
    application,
    resumes,
    tagOptions,
    lossOptions,
    companies,
    { companyLogos },
    googleConnection,
    fieldValues,
    letters,
  ] =
    await Promise.all([
      getApplication(user.id, id),
      listResumeNames(user.id),
      listTags(user.id, "APPLICATION"),
      listTags(user.id, "LOSS"),
      listCompanies(user.id),
      getSettings(),
      accountAccess(user.id),
      applicationFieldValues(user.id),
      listLetters(user.id, { applicationId: id }),
    ]);
  if (!application) notFound();

  // Fetched only when one is attached: the document carries the owner's photo
  // as a data URI, which is not something to ship for a card nobody asked for.
  const attached = application.resumeId ? await getResume(user.id, application.resumeId) : null;

  return (
    <PageShell>
      <FadeIn>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2 mb-4">
          <Link href="/applications">
            <ArrowLeftIcon /> Pipeline
          </Link>
        </Button>

        <ApplicationDetail
          application={{
            id: application.id,
            company: application.company.name,
            companyId: application.companyId,
            roleTitle: application.roleTitle,
            interviewRound: application.interviewRound,
            roundLabel: application.roundLabel,
            stage: application.stage,
            jobUrl: application.jobUrl,
            jobDescription: application.jobDescription,
            location: application.location,
            workMode: application.workMode,
            salaryRange: application.salaryRange,
            tags: tagsOfKind(application.tags, "APPLICATION"),
            lossTags: tagsOfKind(application.tags, "LOSS"),
            notes: application.notes,
            appliedAt: application.appliedAt?.toISOString() ?? null,
            nextFollowUpAt: application.nextFollowUpAt?.toISOString() ?? null,
            resumeId: application.resumeId,
          }}
          activities={application.activities.map((activity) => ({
            id: activity.id,
            type: activity.type,
            body: activity.body,
            occurredAt: activity.occurredAt.toISOString(),
          }))}
          contacts={application.contacts.map((contact) => ({
            id: contact.id,
            name: contact.name,
            title: contact.title,
            email: contact.email,
            linkedin: contact.linkedin,
            relationship: contact.relationship,
          }))}
          offers={application.offers.map(offerForUi)}
          letters={letters.map(letterForUi)}
          tasks={application.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            done: task.done,
            dueAt: task.dueAt?.toISOString() ?? null,
          }))}
          resumes={resumes.map((resume) => ({ id: resume.id, name: resume.name }))}
          fieldValues={fieldValues}
          tagOptions={tagOptions.map(asOption)}
          lossOptions={lossOptions.map(asOption)}
          company={{
            id: application.companyId,
            name: application.company.name,
            website: application.company.website,
          }}
          companies={companies.map((item) => ({
            id: item.id,
            name: item.name,
            website: item.website,
          }))}
          resumePreview={
            attached
              ? {
                  id: attached.id,
                  name: attached.name,
                  doc: attached.doc,
                  settings: {
                    template: attached.template,
                    accent: attached.accent,
                    fontFamily: attached.fontFamily,
                    fontSize: attached.fontSize,
                    lineHeight: attached.lineHeight,
                    pageMargin: attached.pageMargin,
                    photo: attached.showPhoto ? attached.photo : "",
                  },
                }
              : null
          }
          logos={companyLogos}
          googleAccess={googleConnection}
        />
      </FadeIn>
    </PageShell>
  );
}

/** The picker wants a flat count, not the three it is summed from. */
function asOption(tag: {
  id: string;
  name: string;
  color: string;
  _count: { applications: number; companies: number; contacts: number };
}) {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    count: tag._count.applications + tag._count.companies + tag._count.contacts,
  };
}
