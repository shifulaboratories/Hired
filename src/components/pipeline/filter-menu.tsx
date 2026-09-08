import type { Stage } from "@prisma/client";
import { FacetMenu, type FacetGroup } from "@/components/filters/facet-menu";
import { tagTone } from "@/lib/data/tags";
import { BOARD_STAGES, STAGE_LABEL, STAGE_TONE, TERMINAL_STAGES } from "@/lib/data/pipeline";
import { buildPipelineQuery, toggleIn, type PipelineFilters } from "@/lib/pipeline-filters";

export type FilterFacets = {
  tags: { id: string; name: string; color: string; count: number }[];
  companies: { id: string; name: string; count: number }[];
  resumes: { id: string; name: string; count: number }[];
  /** Per-stage counts, for the Stage dimension. */
  stages: Record<Stage, number>;
};

const WAITING = [7, 14, 30];

/**
 * The pipeline's dimensions, as rows for the shared popover.
 *
 * Stage is one of them now. It spent a release as a row of chips under the
 * toolbar, which read well at five stages and badly at ten: the row was the
 * widest thing on the page, it scrolled sideways on a phone, and it sat above
 * a board whose columns already say what the stages are. Stage is a dimension
 * like any other, so it lives where the others do — and what is left above the
 * board is the one cut worth a click, which is what is overdue.
 *
 * The popover itself lives in `src/components/filters/facet-menu.tsx`, because
 * the CRM lists need exactly the same control. What stays here is the part that
 * is only true of the pipeline: which dimensions there are, what each row says,
 * and the URL each one produces.
 *
 * This file is no longer a client component. It builds hrefs rather than
 * pushing them, so `tagTone` resolves on the server and the only interactive
 * part is the shell. Its export, its props and its path are unchanged, so
 * `toolbar.tsx` did not move.
 */
export function FilterMenu({
  filters,
  facets,
  view,
  sort,
  dir,
  limited = false,
}: {
  filters: PipelineFilters;
  facets: FilterFacets;
  view: string;
  sort?: string;
  dir?: string;
  /** The current view can only honour stages and overdue. Say so. */
  limited?: boolean;
}) {
  const href = (next: PipelineFilters) =>
    buildPipelineQuery({ view, filters: next, sort, dir });

  // Stage counts toward the badge now that it is in here. Overdue does not:
  // it is still a chip of its own above the board, so counting it would say 1
  // over a menu with nothing ticked in it.
  const active =
    filters.stages.length +
    filters.tags.length +
    filters.companies.length +
    filters.resumes.length +
    (filters.waiting !== null ? 1 : 0) +
    (filters.quiet !== null ? 1 : 0) +
    0;

  const closedOn = TERMINAL_STAGES.every((stage) => filters.stages.includes(stage));

  const groups: FacetGroup[] = [
    {
      heading: "Stage",
      rows: [
        ...BOARD_STAGES.map((stage) => ({
          id: `st-${stage}`,
          label: STAGE_LABEL[stage],
          count: facets.stages[stage],
          on: filters.stages.includes(stage),
          dot: STAGE_TONE[stage],
          href: href({ ...filters, stages: toggleIn(filters.stages, stage) as Stage[] }),
        })),
        {
          // The four endings as one row, because "show me the closed ones" is
          // one question. Subtractive on the way off, so turning it back off
          // keeps whichever live stages were also on.
          id: "st-closed",
          label: "Closed — rejected, ghosted, withdrawn, offer taken",
          count: TERMINAL_STAGES.reduce((total, stage) => total + facets.stages[stage], 0),
          on: closedOn,
          href: href({
            ...filters,
            stages: closedOn
              ? filters.stages.filter((stage) => !TERMINAL_STAGES.includes(stage))
              : ([...new Set([...filters.stages, ...TERMINAL_STAGES])] as Stage[]),
          }),
        },
      ],
    },
    {
      heading: "Tags",
      rows: facets.tags.map((tag) => ({
        id: `src-${tag.id}`,
        label: tag.name,
        count: tag.count,
        on: filters.tags.includes(tag.id),
        dot: tagTone(tag.color),
        href: href({ ...filters, tags: toggleIn(filters.tags, tag.id) }),
      })),
    },
    {
      heading: "Company",
      rows: facets.companies.map((company) => ({
        id: `co-${company.id}`,
        label: company.name,
        count: company.count,
        on: filters.companies.includes(company.id),
        href: href({ ...filters, companies: toggleIn(filters.companies, company.id) }),
      })),
    },
    {
      heading: "Resume sent",
      rows: facets.resumes.map((resume) => ({
        id: `cv-${resume.id}`,
        label: resume.name,
        count: resume.count,
        on: filters.resumes.includes(resume.id),
        href: href({ ...filters, resumes: toggleIn(filters.resumes, resume.id) }),
      })),
    },
    {
      heading: "Sitting still for",
      separated: true,
      rows: WAITING.map((days) => ({
        id: `w-${days}`,
        label: `${days} days or more`,
        on: filters.waiting === days,
        href: href({ ...filters, waiting: filters.waiting === days ? null : days }),
      })),
    },
    {
      // Sitting still is about the stage; quiet is about you. An application
      // can be three days into Screening and three weeks since anyone said
      // anything.
      heading: "Nothing logged for",
      rows: WAITING.map((days) => ({
        id: `qd-${days}`,
        label: `${days} days or more`,
        on: filters.quiet === days,
        href: href({ ...filters, quiet: filters.quiet === days ? null : days }),
      })),
    },
  ];

  return (
    <FacetMenu
      groups={groups}
      activeCount={active}
      clearHref={href({
        ...filters,
        stages: [],
        tags: [],
        companies: [],
        resumes: [],
        waiting: null,
        quiet: null,
      })}
      placeholder="Stage, tag, company, resume…"
      ariaLabel="Filter the pipeline"
      note={
        limited
          ? "The calendar shows dates, so only Stage and Needs a nudge narrow it. The rest apply on the board and the table."
          : undefined
      }
    />
  );
}
