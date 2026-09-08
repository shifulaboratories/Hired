import Link from "next/link";
import { CalendarDaysIcon, KanbanIcon, ListIcon } from "lucide-react";
import type { Stage } from "@prisma/client";
import { STAGE_LABEL, TERMINAL_STAGES } from "@/lib/data/pipeline";
import { SearchBox } from "@/components/crm/search-box";
import { FilterMenu, type FilterFacets } from "@/components/pipeline/filter-menu";
import { buildPipelineQuery, type PipelineFilters } from "@/lib/pipeline-filters";
import { cn } from "@/lib/utils";

/**
 * What the Filter menu is holding, in words, beside the two chips.
 *
 * The stages left the toolbar; without a line like this, turning three of them
 * on shows a narrowed board whose only explanation is a number on a button.
 * Named up to three, counted after that, and the four endings collapse to
 * "Closed" because that is how they were picked.
 */
function stageSummary(stages: Stage[]) {
  const closed = TERMINAL_STAGES.every((stage) => stages.includes(stage));
  const live = closed ? stages.filter((stage) => !TERMINAL_STAGES.includes(stage)) : stages;
  const parts = [...live.map((stage) => STAGE_LABEL[stage]), ...(closed ? ["Closed"] : [])];
  if (parts.length <= 3) return parts.join(", ");
  return `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more`;
}

/**
 * The pipeline's controls, across the top.
 *
 * Horizontal rather than down the side because a board is the widest thing in
 * the product and a rail was taking 216px out of it for nine links. Across the
 * top the same controls cost two rows and the columns get their width back.
 *
 * Everything is a Link, so the whole thing is server-rendered and the URL is
 * the state — a view, a filter and a search you can paste to yourself.
 */

export const PIPELINE_VIEWS = ["board", "list", "calendar"] as const;
export type PipelineView = (typeof PIPELINE_VIEWS)[number];

export function parseView(value: string | undefined): PipelineView {
  return (PIPELINE_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as PipelineView)
    : "board";
}

export type ToolbarCounts = {
  all: number;
  overdue: number;
  /** Per stage, for the Stage dimension inside the Filter menu. */
  byStage: Record<Stage, number>;
};

/**
 * Counts come from the rows the page is holding, not from pipelineStats.
 *
 * The chips used to be fed by a separate aggregate that ignored `q`, so
 * searching "stripe" left "Screening 12" sitting above a board with one card
 * on it. With five more dimensions that lie would compound.
 */

const VIEWS: { view: PipelineView; label: string; icon: typeof ListIcon }[] = [
  { view: "board", label: "Board", icon: KanbanIcon },
  { view: "list", label: "List", icon: ListIcon },
  { view: "calendar", label: "Calendar", icon: CalendarDaysIcon },
];

export function PipelineToolbar({
  view,
  filters,
  counts,
  facets,
  sort,
  dir,
  action,
  views,
  share,
  fields,
  exportLink,
}: {
  view: PipelineView;
  filters: PipelineFilters;
  counts: ToolbarCounts;
  facets: FilterFacets;
  sort?: string;
  dir?: string;
  action: React.ReactNode;
  views: React.ReactNode;
  share: React.ReactNode;
  /** Which optional fields this view draws. */
  fields: React.ReactNode;
  /**
   * Export what this screen is showing. Absent on the calendar, following the
   * `limited` precedent below: a calendar has no rows, so "export what's shown"
   * has no honest answer.
   */
  exportLink?: React.ReactNode;
}) {
  const href = (next: PipelineFilters, nextView: PipelineView = view) =>
    buildPipelineQuery({ view: nextView, filters: next, sort, dir });

  const nothingOn = filters.stages.length === 0 && !filters.overdue;
  return (
    <div className="mb-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-inset shadow-field inline-flex items-center gap-0.5 rounded-control p-0.5">
          {VIEWS.map(({ view: candidate, label, icon: Icon }) => {
            const active = candidate === view;
            return (
              <Link
                key={candidate}
                href={href(filters, candidate)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "touch-target flex h-11 items-center gap-1.5 rounded-chip px-2.5 text-[12.5px] font-medium transition-colors duration-150 md:h-7",
                  active
                    ? "bg-card text-foreground shadow-btn"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </Link>
            );
          })}
        </div>

        <SearchBox
          placeholder="Company, role, notes, the posting itself…"
          className="w-full sm:w-64"
        />

        <FilterMenu
          filters={filters}
          facets={facets}
          view={view}
          sort={sort}
          dir={dir}
          // A calendar entry is a date, not an application: it carries a stage
          // and a kind and nothing else, so the dimensions that live on the
          // application cannot narrow it. The menu says so rather than
          // appearing to work and quietly doing nothing.
          limited={view === "calendar"}
        />

        {fields}
        {views}
        {share}
        {exportLink}

        <div className="ml-auto">{action}</div>
      </div>

      {/* Two chips, not twelve.
          The stages used to sit here as a row you scrolled sideways, above a
          board whose columns are the stages. They are a dimension like tags or
          companies and they live in the Filter menu now. What is left is the
          one cut worth a click from anywhere: what is overdue. The front page
          is built around it, the bell counts it, and burying it three clicks
          deep to tidy this row would have cost more than the row did. "Everything" stays beside it because a filter you cannot see the
          way out of is a trap. */}
      <div className="flex items-center gap-1">
        <Chip href={href({ ...filters, stages: [], overdue: false })} active={nothingOn} count={counts.all}>
          Everything
        </Chip>
        <Chip
          href={href({ ...filters, overdue: !filters.overdue })}
          active={filters.overdue}
          count={counts.overdue}
          tone={counts.overdue > 0 ? "var(--destructive)" : undefined}
          emphasis={counts.overdue > 0}
        >
          Needs a nudge
        </Chip>
        {filters.stages.length > 0 && (
          <span className="text-faint ml-1 text-[12px]">
            {stageSummary(filters.stages)}
          </span>
        )}
      </div>
    </div>
  );
}

function Chip({
  href,
  active,
  count,
  tone,
  emphasis,
  children,
}: {
  href: string;
  active: boolean;
  count: number;
  tone?: string;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "touch-target flex h-11 shrink-0 items-center gap-1.5 rounded-chip px-2 text-[12.5px] transition-colors duration-150 md:h-7",
        active
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {tone && <span className="size-1.5 shrink-0 rounded-full" style={{ background: tone }} />}
      {children}
      <span
        className={cn(
          "meta text-[11.5px]",
          emphasis ? "text-destructive font-medium" : "text-faint",
        )}
      >
        {count || ""}
      </span>
    </Link>
  );
}
