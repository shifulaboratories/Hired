import type { TagKind } from "@prisma/client";
import { applicationFieldValues, getApplication, listCompanyNames } from "@/lib/data/pipeline";
import { listTags, tagsOfKind } from "@/lib/data/tags";
import { offerForUi } from "@/lib/data/offers";
import { letterForUi, listLetters } from "@/lib/data/letters";
import { interviewForUi, listInterviewDetails } from "@/lib/data/interviews";
import { getResume, listResumeNames } from "@/lib/data/resumes";
import { accountAccess } from "@/lib/data/accounts";
import { getSettings } from "@/lib/settings";

/**
 * Everything the application screen is handed, built once.
 *
 * Two callers draw the same screen — the full page at /applications/<id> and
 * the side panel that opens over the board — and each used to map the same
 * forty fields by hand. They had already drifted: the panel fetched letters and
 * interviews one after the other after everything else had come back, and its
 * tag options carried a `kind` the page's did not. One builder, so the next
 * field added to the screen is added once.
 *
 * Not in src/lib/data: nothing here is a rule about the data, it is one
 * screen's serialized props, and no MCP tool wants them — get_application is
 * that. The caller resolves `userId` from the session, as everywhere.
 *
 * The company picker reads labels only. It wanted id, name and website and was
 * handed every company with its counts, tags and applications.
 */
export async function applicationDetail(userId: string, id: string) {
  const [
    application,
    resumes,
    tagOptions,
    lossOptions,
    companies,
    settings,
    googleAccess,
    fieldValues,
    letters,
    interviews,
  ] = await Promise.all([
    getApplication(userId, id),
    listResumeNames(userId),
    listTags(userId, "APPLICATION"),
    listTags(userId, "LOSS"),
    listCompanyNames(userId),
    getSettings(),
    accountAccess(userId),
    applicationFieldValues(userId),
    listLetters(userId, { applicationId: id }),
    listInterviewDetails(userId, id),
  ]);
  if (!application) return null;

  // Only when one is attached: the document carries the owner's photo as a
  // data URI, and the panel is opened far more often than a resume is read.
  const attached = application.resumeId ? await getResume(userId, application.resumeId) : null;

  return {
    application: {
      id: application.id,
      company: application.company.name,
      companyId: application.companyId,
      roleTitle: application.roleTitle,
      stage: application.stage,
      interviewRound: application.interviewRound,
      roundLabel: application.roundLabel,
      jobUrl: application.jobUrl,
      postingStatus: application.postingStatus,
      postingNote: application.postingNote,
      postingGoneSince: application.postingGoneSince?.toISOString() ?? null,
      jobDescription: application.jobDescription,
      location: application.location,
      workMode: application.workMode,
      salaryRange: application.salaryRange,
      // One join table, two catalogues: where it came from, and why it ended.
      tags: tagsOfKind(application.tags, "APPLICATION"),
      lossTags: tagsOfKind(application.tags, "LOSS"),
      notes: application.notes,
      appliedAt: application.appliedAt?.toISOString() ?? null,
      nextFollowUpAt: application.nextFollowUpAt?.toISOString() ?? null,
      resumeId: application.resumeId,
    },
    activities: application.activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      body: activity.body,
      occurredAt: activity.occurredAt.toISOString(),
    })),
    contacts: application.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      linkedin: contact.linkedin,
      relationship: contact.relationship,
    })),
    tasks: application.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      done: task.done,
      dueAt: task.dueAt?.toISOString() ?? null,
    })),
    offers: application.offers.map(offerForUi),
    letters: letters.map(letterForUi),
    interviews: interviews.map(interviewForUi),
    resumes: resumes.map((resume) => ({ id: resume.id, name: resume.name })),
    tagOptions: tagOptions.map(tagOption),
    lossOptions: lossOptions.map(tagOption),
    fieldValues,
    company: {
      id: application.companyId,
      name: application.company.name,
      website: application.company.website,
    },
    companies: companies.map((item) => ({ id: item.id, name: item.name, website: item.website })),
    resumePreview: attached
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
      : null,
    logos: settings.companyLogos,
    googleAccess,
  };
}

export type ApplicationDetailPayload = NonNullable<Awaited<ReturnType<typeof applicationDetail>>>;

/** The picker wants a flat count, not the three it is summed from. */
export function tagOption(tag: {
  id: string;
  name: string;
  color: string;
  kind: TagKind;
  _count: { applications: number; companies: number; contacts: number };
}) {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    kind: tag.kind,
    count: tag._count.applications + tag._count.companies + tag._count.contacts,
  };
}
