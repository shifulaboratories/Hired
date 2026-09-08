import Link from "next/link";
import { headers } from "next/headers";
import type { Stage } from "@prisma/client";
import { EmptyState, PageHeader, PageShell } from "@/components/page-header";
import {
  applicationFieldValues,
  BOARD_STAGES,
  STAGES,
  STAGE_LABEL,
  TERMINAL_STAGES,
  listApplications,
} from "@/lib/data/pipeline";
import { listSchedule } from "@/lib/data/schedule";
import { listResumeNames } from "@/lib/data/resumes";
import { listTags } from "@/lib/data/tags";
import { archiveCounts } from "@/lib/data/archive";
import { getProfile } from "@/lib/data/me";
import { parseWidths } from "@/lib/column-widths";
import { FieldsMenu } from "@/components/pipeline/fields-menu";
import { Button } from "@/components/ui/button";
import { DownloadIcon, KanbanIcon } from "lucide-react";
import { visibleFields } from "@/lib/pipeline-fields";
import { ArchiveNote } from "@/components/archive/archive-note";
import { PipelineBoard } from "@/components/pipeline/board";
import { PipelineList } from "@/components/pipeline/list";
import { parseSort, sortRows, toListRow, type ListRow } from "@/lib/pipeline-list";
import {
  PipelineCalendar,
  monthWindow,
  parseMonth,
  type CalendarEntry,
} from "@/components/pipeline/calendar";
import {
  PipelineToolbar,
  parseView,
  type PipelineView,
} from "@/components/pipeline/toolbar";
import {
  EMPTY_FILTERS as EMPTY,
  hasAnyFilter,
  matchesFilters,
  parsePipelineFilters,
  type PipelineFilters,
} from "@/lib/pipeline-filters";
import { ApplicationPanelProvider } from "@/components/pipeline/application-panel";
import { SavedViews } from "@/components/pipeline/saved-views";
import { SharePipeline } from "@/components/pipeline/share-pipeline";
import { getPipelineShare } from "@/lib/data/pipeline-share";
import { listSavedViews, normaliseQuery } from "@/lib/data/views";
import { NewApplicationDialog } from "@/components/pipeline/new-application-dialog";
import { requireUser } from "@/lib/auth";
import { companyDomain } from "@/lib/company";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const BLURB: Record<PipelineView, string> = {
  board: "Drag a card to move it forward. Follow-up dates set themselves when the stage changes.",
  list: "Every application in one table. Click a column to sort by it, again to reverse.",
  calendar: "Follow-ups, task deadlines, everything you have logged, and — with a calendar connected — the interviews on your own calendar, by the day it lands.",
};

function filterLabel(filters: PipelineFilters) {
  const parts = [
    ...filters.stages.map((stage) => STAGE_LABEL[stage]),
    ...(filters.overdue ? ["Needs a nudge"] : []),
  ];
  if (parts.length > 0) return parts.join(" · ");
  return hasAnyFilter(filters) ? "Filtered" : null;
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const headerList = await headers();
  const headerHost =
    headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const headerProto =
    headerList.get("x-forwarded-proto") ?? (headerHost.startsWith("localhost") ? "http" : "https");
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const view = parseView(one("view"));
  const filters = parsePipelineFilters(one, STAGES);
  const search = filters.search;

  // Resolved once per request: with logos off, no domain reaches the browser
  // at all, so there is nothing for it to go and fetch.
  const [{ companyLogos }, resumes, savedViews, tagOptions, everyApplication] =
    await Promise.all([
      getSettings(),
      listResumeNames(user.id),
      listSavedViews(user.id),
      listTags(user.id, "APPLICATION"),
      listApplications(user.id, { includeClosed: true }),
    ]);
  const bin = await archiveCounts(user.id);
  // Every view's field set on every load, so the Fields menu paints the change
  // immediately rather than after a round trip.
  const profile = await getProfile(user.id);
  const share = await getPipelineShare(user.id);
  const fieldValues = await applicationFieldValues(user.id);
  const shareBase = `${headerProto}://${headerHost}`;

  // Normalised the same way a view is saved, so "is this the view I am looking
  // at" is a string comparison rather than a parse on every render.
  const currentQuery = normaliseQuery(
    new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value] as [string, string]],
      ),
    ).toString(),
  );
  const domainFor = (application: { company: { name: string; website: string } }) =>
    companyLogos
      ? companyDomain({ name: application.company.name, website: application.company.website })
      : null;

  const now = Date.now();

  /**
   * Facet counting: each dimension is counted against the rows that pass every
   * OTHER dimension. So ticking one source does not collapse the source counts
   * to that source, and the stage chips answer "how many more would I see" —
   * which is the question a count on a filter is actually asked.
   */
  const passing = (except: keyof PipelineFilters) => {
    const relaxed: PipelineFilters = { ...filters, [except]: EMPTY[except] };
    return everyApplication.filter((application) => matchesFilters(application, relaxed, now));
  };

  const forStages = passing("stages");
  const counts = {
    // Counted against what the chip's own link produces — it clears the stages
    // and the overdue flag and keeps everything else, so relaxing every
    // dimension here would advertise a number you cannot get to.
    all: everyApplication.filter((application) =>
      matchesFilters(application, { ...filters, stages: [], overdue: false }, now),
    ).length,
    overdue: passing("overdue").filter(
      (application) =>
        !TERMINAL_STAGES.includes(application.stage) &&
        application.nextFollowUpAt !== null &&
        application.nextFollowUpAt.getTime() <= now,
    ).length,
    // Relaxed on stages, so a stage row counts what turning it on would show
    // rather than what is already through the stage filter. It feeds the Stage
    // dimension in the Filter menu, which is where the stages went.
    byStage: Object.fromEntries(
      STAGES.map((stage) => [stage, forStages.filter((a) => a.stage === stage).length]),
    ) as Record<Stage, number>,
  };

  const tally = <T,>(rows: typeof everyApplication, key: (row: (typeof everyApplication)[number]) => T[]) => {
    const out = new Map<T, number>();
    for (const row of rows) for (const value of key(row)) out.set(value, (out.get(value) ?? 0) + 1);
    return out;
  };
  const tagTally = tally(passing("tags"), (row) => row.tags.map((tag) => tag.id));
  const companyTally = tally(passing("companies"), (row) => [row.companyId]);
  const resumeTally = tally(passing("resumes"), (row) => [row.resumeId ?? "none"]);

  const facets = {
    tags: tagOptions
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        count: tagTally.get(tag.id) ?? 0,
      }))
      .filter((tag) => tag.count > 0 || filters.tags.includes(tag.id)),
    companies: [...companyTally.entries()]
      .map(([id, count]) => ({
        id,
        name: everyApplication.find((a) => a.companyId === id)?.company.name ?? "—",
        count,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    resumes: [
      ...resumes
        .map((resume) => ({
          id: resume.id,
          name: resume.name,
          count: resumeTally.get(resume.id) ?? 0,
        }))
        .filter((resume) => resume.count > 0 || filters.resumes.includes(resume.id)),
      ...(resumeTally.get("none")
        ? [{ id: "none", name: "No resume attached", count: resumeTally.get("none") ?? 0 }]
        : []),
    ],
    stages: counts.byStage,
  };

  // Nothing has ever been tracked here — which is not the same as "no results",
  // and the difference decides what to draw. A filter that matched nothing needs
  // the toolbar kept so you can undo it. A workspace with nothing in it needs
  // the opposite: seven columns saying Empty under eight controls that all do
  // nothing is what somebody's first visit used to look like, and it reads as a
  // broken screen rather than an invitation.
  if (everyApplication.length === 0 && !hasAnyFilter(filters)) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Pipeline"
          title="Every conversation in flight"
          description="One card per job you are going for. Move it along as things happen, and the follow-up dates set themselves."
        />
        <EmptyState
          icon={KanbanIcon}
          title="Nothing on the board yet"
          description="Add the first job you are going for — paste the posting and the form fills itself in. One is enough for the board, the reminders and the chart to start working."
          action={
            <NewApplicationDialog
              fieldValues={fieldValues}
              resumes={resumes.map((resume) => ({ id: resume.id, name: resume.name }))}
              tagOptions={tagOptions.map((tag) => ({
                id: tag.id,
                name: tag.name,
                color: tag.color,
                count: tag._count.applications + tag._count.companies + tag._count.contacts,
              }))}
            />
          }
        />
        {/* Archiving the last one lands here too, so the way back has to stay. */}
        <ArchiveNote kind="application" count={bin.application} />
      </PageShell>
    );
  }

  const chrome = (content: React.ReactNode) => (
    <ApplicationPanelProvider>
      <PageShell className="max-w-none">
        <PageHeader
          eyebrow={filterLabel(filters) ? `Pipeline · ${filterLabel(filters)}` : "Pipeline"}
          title="Every conversation in flight"
          description={BLURB[view]}
        />
        <PipelineToolbar
          view={view}
          filters={filters}
          counts={counts}
          facets={facets}
          sort={one("sort")}
          dir={one("dir")}
          action={
            <NewApplicationDialog
              fieldValues={fieldValues}
              resumes={resumes.map((resume) => ({ id: resume.id, name: resume.name }))}
              tagOptions={tagOptions.map((tag) => ({
                id: tag.id,
                name: tag.name,
                color: tag.color,
                count: tag._count.applications + tag._count.companies + tag._count.contacts,
              }))}
            />
          }
          share={
            <SharePipeline
              initial={
                share
                  ? { url: `${shareBase}/p/${share.slug}`, includeClosed: share.includeClosed }
                  : null
              }
            />
          }
          fields={
            <FieldsMenu
              view={view}
              visible={[
                ...visibleFields(
                  view,
                  view === "board"
                    ? profile.boardFields
                    : view === "list"
                      ? profile.listFields
                      : profile.calendarFields,
                ),
              ]}
            />
          }
          exportLink={
            view === "calendar" ? undefined : (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a href={`/api/export/applications?${currentQuery}`} download>
                  <DownloadIcon /> Export
                </a>
              </Button>
            )
          }
          views={
            <SavedViews
              views={savedViews.map((v) => ({ id: v.id, name: v.name, query: v.query }))}
              current={currentQuery}
            />
          }
        />
        {content}
        <ArchiveNote kind="application" count={bin.application} />
      </PageShell>
    </ApplicationPanelProvider>
  );

  if (view === "calendar") {
    const { year, month } = parseMonth(one("month"));
    const { from, to } = monthWindow(year, month);
    const schedule = await listSchedule(user.id, from, to);
    // A calendar entry belongs to an application, so a stage filter narrows it
    // the same way it narrows every other view. Entries with no application —
    // a standalone task — drop out, which is right: they have no stage.
    const kept = schedule.filter((entry) => {
      if (search && !`${entry.title} ${entry.detail}`.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      // A calendar entry is a date, not an application, so only the dimensions
      // an entry actually carries can narrow it: its stage, and whether it is
      // the follow-up itself. The rest are applied on the other two views.
      if (filters.overdue && entry.kind !== "FOLLOW_UP") return false;
      if (filters.stages.length === 0) return true;
      if (!entry.stage) return false;
      return filters.stages.includes(entry.stage);
    });
    const entries: CalendarEntry[] = kept.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      day: entry.date.toISOString().slice(0, 10),
      title: entry.title,
      detail: entry.detail,
      stage: entry.stage,
      applicationId: entry.applicationId,
      contactId: entry.contactId,
      done: entry.done,
      url: entry.url,
    }));
    return chrome(
      <PipelineCalendar
        year={year}
        month={month}
        entries={entries}
        today={new Date().toISOString().slice(0, 10)}
        fields={[...visibleFields("calendar", profile.calendarFields)]}
      />,
    );
  }

  // Already fetched above for the facet counts — one read, one predicate.
  const visible = everyApplication.filter((application) =>
    matchesFilters(application, filters, now),
  );

  if (view === "list") {
    const rows: ListRow[] = visible.map((application) =>
      toListRow(application, domainFor(application)),
    );
    const sort = parseSort(one("sort"));
    const desc = one("dir") === "desc";
    return chrome(
      <PipelineList
        rows={sortRows(rows, sort, desc)}
        sort={sort}
        desc={desc}
        fields={[...visibleFields("list", profile.listFields)]}
        widths={parseWidths(profile.columnWidths)}
        narrowed={hasAnyFilter(filters)}
      />,
    );
  }

  const toCard = (application: (typeof everyApplication)[number]) => ({
    id: application.id,
    company: application.company.name,
    roleTitle: application.roleTitle,
    stage: application.stage,
    location: application.location,
    salaryRange: application.salaryRange,
    nextFollowUpAt: application.nextFollowUpAt ? application.nextFollowUpAt.toISOString() : null,
    resumeName: application.resume?.name ?? null,
    activityCount: application._count.activities,
    quietDays: application.quietDays,
    jobUrl: application.jobUrl,
    domain: domainFor(application),
    tags: application.tags,
  });

  // Which columns the board draws. Filtering to one stage should show that one
  // column, not five empty ones beside it; filtering to Closed should show no
  // columns at all, because closed applications live under the board.
  const picked = filters.stages.filter((stage) => BOARD_STAGES.includes(stage));
  const onlyClosed = filters.stages.length > 0 && picked.length === 0;
  const columns = onlyClosed
    ? []
    : picked.length > 0
      ? BOARD_STAGES.filter((stage) => picked.includes(stage))
      : BOARD_STAGES;

  // A filter that matches nothing drew seven columns of "Empty" — and picking
  // only closed stages drew no columns at all, a blank space under a toolbar,
  // which reads as the app having failed rather than as a filter having
  // worked. The list says this; the board did not.
  if (visible.length === 0) {
    return chrome(
      <EmptyState
        icon={KanbanIcon}
        title="Nothing matches that"
        description={
          onlyClosed
            ? "Closed applications live under the board rather than on it. The list and the calendar will show them."
            : "Nothing on the board fits the search and filters you have on."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {onlyClosed && (
              <Button asChild variant="outline">
                <Link href={`/applications?view=list&${currentQuery}`}>Show them as a list</Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/applications">Clear the filters</Link>
            </Button>
          </div>
        }
      />,
    );
  }

  return chrome(
    <PipelineBoard
      open={visible.filter((a) => !TERMINAL_STAGES.includes(a.stage)).map(toCard)}
      closed={visible.filter((a) => TERMINAL_STAGES.includes(a.stage)).map(toCard)}
      columns={columns}
      fields={[...visibleFields("board", profile.boardFields)]}
    />,
  );
}
