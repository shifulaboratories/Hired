"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Stage } from "@prisma/client";
import { STAGES, STAGE_LABEL, STAGE_TONE, TERMINAL_STAGES } from "@/lib/data/pipeline";
import { STALE_AFTER, hasGoneQuiet } from "@/lib/quiet";
import type { ListRow, ListSort } from "@/lib/pipeline-list";
import { ApplicationActions } from "@/components/pipeline/application-actions";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { useOpenApplication } from "@/components/pipeline/application-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseISODate, toISODate } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ColumnGrip,
  ResizableColumns,
  useColumnStyle,
} from "@/components/lists/resizable-columns";
import { SortMenu } from "@/components/lists/sort-menu";
import type { StoredWidths } from "@/lib/column-widths";
import { moveApplicationsStageAction, moveStageAction, updateApplicationAction } from "@/server/actions";
import { cn, relativeDay } from "@/lib/utils";

/**
 * The table view, which is also the fastest way to edit.
 *
 * The row used to be a single link, which made it a good list and a bad table:
 * every correction — a stage, a salary you finally learned, a follow-up you
 * want a week later — meant opening a panel and closing it again. Now the
 * company cell navigates and the rest of the cells are the fields themselves,
 * so a table of twenty applications can be brought up to date without leaving
 * it. Edits save on change (stage) or on blur (text and dates), matching the
 * rest of the app, which has no save button anywhere.
 */

/**
 * The columns, and which of them can be turned off.
 *
 * `field: null` means structural. Company is what a row IS; Stage is the inline
 * editor the table exists for (it writes straight through to the board, see
 * the header comment above); the checkbox and the actions cell are controls,
 * not data. A setting that can make a screen useless is not a setting.
 */
/**
 * `col` is the key in the width catalogue. A column without one cannot be
 * dragged: the company cell flexes to fill whatever the rest leave, and the
 * trailing actions cell is a control. The Tailwind `w-*` on a resizable column
 * is the width before anything is stored — an inline width from the catalogue
 * overrides it, and the class is what renders where there is no provider, on
 * the shared pipeline and the print page.
 */
const COLUMNS: {
  key: ListSort | null;
  label: string;
  className: string;
  field: string | null;
  col?: string;
}[] = [
  { key: "company", label: "Company", className: "flex-1 min-w-0", field: null },
  { key: "stage", label: "Stage", className: "w-32 shrink-0", field: null, col: "stage" },
  {
    key: "followUp",
    label: "Follow-up",
    className: "w-28 shrink-0",
    field: "followUp",
    col: "followUp",
  },
  {
    key: "waiting",
    label: "Waiting",
    className: "w-20 shrink-0 text-right",
    field: "waiting",
    col: "waiting",
  },
  {
    key: "quiet",
    label: "Quiet",
    className: "w-20 shrink-0 text-right hidden md:block",
    field: "quiet",
    col: "quiet",
  },
  {
    key: "salary",
    label: "Salary",
    className: "w-32 shrink-0 hidden lg:block",
    field: "salary",
    col: "salary",
  },
  {
    key: null,
    label: "Location",
    className: "w-32 shrink-0 hidden xl:block",
    field: "location",
    col: "location",
  },
  {
    key: null,
    label: "Log",
    className: "w-10 shrink-0 text-right hidden sm:block",
    field: "activity",
    col: "activity",
  },
  {
    key: "updated",
    label: "Touched",
    className: "w-20 shrink-0 text-right hidden sm:block",
    field: "updated",
    col: "updated",
  },
  { key: null, label: "", className: "w-8 shrink-0", field: null },
];

/**
 * A body cell at the dragged width.
 *
 * `className` keeps the Tailwind `w-*` it replaces, so the cell still has a
 * width where there is no provider — the shared pipeline and the print page
 * render these rows with nothing to drag.
 */
function Body({
  col,
  className,
  title,
  children,
}: {
  col: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const style = useColumnStyle(col);
  return (
    <div className={className} style={style} title={title}>
      {children}
    </div>
  );
}

/** One header or body cell, at whatever width the catalogue says. */
function Cell({
  column,
  children,
  className,
}: {
  column: (typeof COLUMNS)[number];
  children?: React.ReactNode;
  className?: string;
}) {
  const style = useColumnStyle(column.col ?? "");
  return (
    <div className={cn(column.className, className)} style={style}>
      {children}
    </div>
  );
}

export function PipelineList({
  rows,
  sort,
  desc,
  fields,
  widths,
}: {
  rows: ListRow[];
  sort: ListSort;
  desc: boolean;
  /** Which optional columns to draw. Structural ones are always drawn. */
  fields: string[];
  /** Stored column widths, already parsed and clamped by the server. */
  widths: StoredWidths;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const params = useSearchParams();

  const visibleIds = useMemo(() => rows.map((row) => row.id), [rows]);
  // Structural columns are never in the catalogue, so they are never dropped.
  const columns = useMemo(() => {
    const on = new Set(fields);
    return COLUMNS.filter((column) => column.field === null || on.has(column.field));
  }, [fields]);
  const chosen = useMemo(
    () => visibleIds.filter((id) => selected.has(id)),
    [visibleIds, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      chosen.length === visibleIds.length ? new Set() : new Set([...prev, ...visibleIds]),
    );

  if (rows.length === 0) {
    return (
      <div className="text-faint rounded-xl border border-dashed py-16 text-center text-[13px]">
        Nothing tracked yet.
      </div>
    );
  }

  return (
    <ResizableColumns list="pipeline" stored={widths}>
      <div className="space-y-2">
        {chosen.length > 0 && (
          <BulkBar ids={chosen} onDone={() => setSelected(new Set())} />
        )}

        {/* Sorting, reachable on a phone. Half these keys have no heading to
            click below `md`, and the toolbar above is shared with the board and
            the calendar, where a sort key means nothing — so it lives here,
            with the table it sorts. */}
        <div className="flex justify-end">
          <SortMenu
            active={sort}
            desc={desc}
            ariaLabel="Sort the pipeline table"
            options={SORTS.map(({ key, label }) => ({
              key,
              label,
              href: sortHref(key, sort, desc, params),
              ascHref: dirHref(key, false, params),
              descHref: dirHref(key, true, params),
            }))}
          />
        </div>

        <div className="bg-card shadow-card overflow-hidden rounded-xl">
          <div className="eyebrow bg-inset flex items-center gap-3 px-4 py-2">
            <div className="flex w-5 shrink-0 items-center">
              <Checkbox
                checked={chosen.length === visibleIds.length}
                onCheckedChange={toggleAll}
                aria-label="Select every row"
              />
            </div>
            {columns.map((column) => (
              <Cell key={column.label} column={column} className="relative">
                {column.col && <ColumnGrip column={column.col} />}
                {column.key ? (
                  <Link
                    href={sortHref(column.key, sort, desc, params)}
                    className="hover:text-foreground touch-target inline-flex min-h-11 items-center gap-1 transition-colors duration-150 md:min-h-0"
                  >
                    {column.label}
                    {sort === column.key &&
                      (desc ? (
                        <ArrowDownIcon className="size-2.5" />
                      ) : (
                        <ArrowUpIcon className="size-2.5" />
                      ))}
                  </Link>
                ) : (
                  column.label
                )}
              </Cell>
            ))}
          </div>

          <ul className="divide-y">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                columns={columns}
                selected={selected.has(row.id)}
                onSelect={() => toggle(row.id)}
              />
            ))}
          </ul>
        </div>
      </div>
    </ResizableColumns>
  );
}

function Row({
  row,
  columns,
  selected,
  onSelect,
}: {
  row: ListRow;
  columns: typeof COLUMNS;
  selected: boolean;
  onSelect: () => void;
}) {
  // One lookup rather than a Set per cell: a row draws ten cells and there are
  // as many rows as the person has applications.
  const shows = (field: string) => columns.some((column) => column.field === field);
  const openPanel = useOpenApplication();
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Optimistic local copy: an edit shows immediately and rolls back if the
  // server refuses, rather than the row sitting unchanged until a refresh.
  const [values, setValues] = useState({
    stage: row.stage,
    nextFollowUpAt: row.nextFollowUpAt ? row.nextFollowUpAt.slice(0, 10) : "",
    salaryRange: row.salaryRange,
    location: row.location,
  });

  const due = values.nextFollowUpAt ? new Date(values.nextFollowUpAt) : null;
  const overdue = due ? due.getTime() < Date.now() : false;
  const closed = TERMINAL_STAGES.includes(values.stage);
  // Null where the quiet rule has no threshold — a wishlist entry has not gone
  // quiet because nothing was meant to happen yet, and a closed one is over.
  const quiet = STALE_AFTER[values.stage] === undefined ? null : row.quietDays;

  const save = (patch: Partial<typeof values>, run: () => Promise<unknown>) => {
    const before = values;
    setValues((current) => ({ ...current, ...patch }));
    startTransition(async () => {
      try {
        await run();
        router.refresh();
      } catch (error) {
        setValues(before);
        toast.error(error instanceof Error ? error.message : "Could not save that.");
      }
    });
  };

  const commitText = (key: "salaryRange" | "location", value: string) => {
    if (value === row[key]) return;
    save({ [key]: value }, () => updateApplicationAction(row.id, { [key]: value }));
  };

  return (
    <li
      style={{ ["--tone" as string]: STAGE_TONE[values.stage] }}
      className={cn("stage-band flex items-center gap-3 px-4 py-2", selected && "bg-accent/40")}
    >
      <div className="flex w-5 shrink-0 items-center">
        <Checkbox checked={selected} onCheckedChange={onSelect} aria-label={`Select ${row.company}`} />
      </div>

      {/* The one cell that still navigates. */}
      <Link
        href={`/applications/${row.id}`}
        data-nav-item
        onClick={(event) => {
          if (!openPanel || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          openPanel(row.id);
        }}
        className="hover:text-primary flex min-w-0 flex-1 items-center gap-2.5 transition-colors duration-150"
      >
        <CompanyAvatar name={row.company} domain={row.domain} size={26} />
        <div className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{row.company}</span>
          <div className="text-faint truncate text-[12px]">{row.roleTitle}</div>
        </div>
      </Link>

      <Body col="stage" className="w-32 shrink-0">
        <Select
          value={values.stage}
          onValueChange={(value) =>
            save({ stage: value as Stage }, () => moveStageAction(row.id, value as Stage))
          }
        >
          <SelectTrigger
            size="sm"
            aria-label={`Stage for ${row.company}`}
            className="stage-chip h-7 w-full border-0 px-1.5 text-[11.5px] font-medium shadow-none md:h-7"
            style={{ ["--tone" as string]: STAGE_TONE[values.stage] }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {STAGE_LABEL[stage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Body>

      {shows("followUp") && (
        <Body col="followUp" className="w-28 shrink-0">
          <DateCell
            value={values.nextFollowUpAt}
            label={`Follow-up date for ${row.company}`}
            overdue={overdue}
            onChange={(value) =>
              save({ nextFollowUpAt: value }, () =>
                updateApplicationAction(row.id, { nextFollowUpAt: value || null }),
              )
            }
          />
        </Body>
      )}

      {/* Read-only: this is a measurement, not a field. Dashes on a closed
          application because "waiting 40 days" is meaningless once it is over. */}
      {shows("waiting") && (
        <Body
          col="waiting"
          className={cn(
            "nums w-20 shrink-0 text-right text-[12px]",
            !closed && row.daysInStage >= 21 ? "text-destructive" : "text-faint",
          )}
          title={closed ? undefined : `In ${STAGE_LABEL[values.stage]} for ${row.daysInStage} days`}
        >
          {closed ? "—" : `${row.daysInStage}d`}
        </Body>
      )}

      {/* The other measurement, and the one chasing is decided on: days since
          anything at all happened, not days since it last moved. */}
      {shows("quiet") && (
        <Body
          col="quiet"
          className={cn(
            "nums hidden w-20 shrink-0 text-right text-[12px] md:block",
            hasGoneQuiet(values.stage, row.quietDays, TERMINAL_STAGES)
              ? "text-[var(--warning)] font-medium"
              : "text-faint",
          )}
          title={quiet === null ? undefined : `Nothing logged for ${row.quietDays} days`}
        >
          {quiet === null ? "—" : `${quiet}d`}
        </Body>
      )}

      {shows("salary") && (
        <Body col="salary" className="hidden w-32 shrink-0 lg:block">
        <CellInput
          value={values.salaryRange}
          placeholder="—"
          aria-label={`Salary for ${row.company}`}
          onBlurValue={(value) => commitText("salaryRange", value)}
          onLocalChange={(value) => setValues((c) => ({ ...c, salaryRange: value }))}
          className="nums"
        />
        </Body>
      )}

      {shows("location") && (
        <Body col="location" className="hidden w-32 shrink-0 xl:block">
          <CellInput
            value={values.location}
            placeholder="—"
            aria-label={`Location for ${row.company}`}
            onBlurValue={(value) => commitText("location", value)}
            onLocalChange={(value) => setValues((c) => ({ ...c, location: value }))}
          />
        </Body>
      )}

      {shows("activity") && (
        <Body col="activity" className="nums text-faint hidden w-10 shrink-0 text-right text-[12px] sm:block">
          {row.activityCount || "—"}
        </Body>
      )}

      {shows("updated") && (
        <Body col="updated" className="nums text-faint hidden w-20 shrink-0 text-right text-[12px] sm:block">
          {new Date(row.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </Body>
      )}

      {/* The same verbs the board card offers. Two views of one pipeline
          should not disagree about what you can do to a row. */}
      <div className="flex w-8 shrink-0 justify-end">
        <ApplicationActions
          application={{
            id: row.id,
            company: row.company,
            roleTitle: row.roleTitle,
            stage: values.stage,
            jobUrl: row.jobUrl,
          }}
        />
      </div>
    </li>
  );
}

/**
 * A date cell that is a dash until you use it.
 *
 * An empty `input[type=date]` prints "mm/dd/yyyy", and a column of those on
 * every row without a follow-up is louder than the dates that are actually
 * set — the opposite of what the column is for. So an empty cell renders as
 * the same em dash the rest of the table uses and only becomes a picker once
 * you click it.
 */
function DateCell({
  value,
  label,
  overdue,
  onChange,
}: {
  value: string;
  label: string;
  overdue: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "nums hover:border-input hover:bg-inset h-7 w-full rounded-control border border-transparent px-1.5 text-left text-[12px] transition-colors duration-150",
            !selected && "text-faint",
            overdue && selected && "text-destructive font-medium",
          )}
        >
          {selected
            ? selected.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "—"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          autoFocus
          onSelect={(next) => {
            onChange(next ? toISODate(next) : "");
            setOpen(false);
          }}
        />
        {/* The one act the grid cannot express. Clearing by clicking the
            selected day again is real but undiscoverable, so it is also a
            row under the calendar. */}
        {selected && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive mt-1 w-full"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <XIcon /> Clear
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A cell that looks like text until you touch it. A table of visible input
 * boxes reads as a form and destroys the density the list exists for, so the
 * border and background only arrive on hover and focus.
 */
function CellInput({
  value,
  placeholder,
  className,
  onBlurValue,
  onLocalChange,
  ...props
}: {
  value: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  /** Commit on blur — right for free text, which is not done until you leave. */
  onBlurValue?: (value: string) => void;
  onLocalChange?: (value: string) => void;
  "aria-label": string;
}) {
  return (
    <input
      {...props}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onLocalChange?.(event.target.value)}
      onBlur={(event) => onBlurValue?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn(
        "text-muted-foreground placeholder:text-faint h-7 w-full min-w-0 truncate rounded-control border border-transparent bg-transparent px-1.5 text-base transition-colors duration-150 outline-none md:text-[12px]",
        "hover:border-input hover:bg-inset focus:border-ring focus:bg-inset focus:ring-ring/25 focus:ring-2",
        className,
      )}
    />
  );
}

/** Appears only when something is selected: a toolbar you did not ask for is clutter. */
function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const move = (stage: Stage) =>
    startTransition(async () => {
      try {
        const result = await moveApplicationsStageAction(ids, stage);
        const n = result.moved.length;
        toast.success(
          `${n} ${n === 1 ? "application" : "applications"} → ${STAGE_LABEL[stage]}` +
            (result.skipped.length ? `, ${result.skipped.length} skipped` : ""),
        );
        onDone();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not move those.");
      }
    });

  return (
    <div className="bg-card shadow-card flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
      <span className="nums text-[12.5px] font-medium">
        {ids.length} selected
      </span>
      <span className="text-faint hidden text-[12px] sm:inline">Move to</span>
      <Select onValueChange={(value) => move(value as Stage)} disabled={pending}>
        <SelectTrigger size="sm" className="w-40" aria-label="Move selected to stage">
          <SelectValue placeholder="Pick a stage" />
        </SelectTrigger>
        <SelectContent>
          {STAGES.map((stage) => (
            <SelectItem key={stage} value={stage}>
              {STAGE_LABEL[stage]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground ml-auto"
        onClick={onDone}
        disabled={pending}
      >
        <XIcon /> Clear
      </Button>
    </div>
  );
}

/**
 * Clicking the column you're already sorted by flips the direction.
 *
 * Built from the URL you are on rather than from scratch: the old version
 * made a fresh query string, so sorting a filtered list silently threw away
 * the filters, the search and the saved view you were looking through.
 */
/** The sort keys, for the menu. The headings carry the same set. */
const SORTS: { key: ListSort; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "stage", label: "Stage" },
  { key: "followUp", label: "Follow-up" },
  { key: "waiting", label: "Waiting" },
  { key: "quiet", label: "Quiet" },
  { key: "salary", label: "Salary" },
  { key: "updated", label: "Touched" },
];

/** A direction picked outright, rather than the heading's toggle. */
function dirHref(key: ListSort, desc: boolean, current: URLSearchParams) {
  const params = new URLSearchParams(current);
  params.set("view", "list");
  params.set("sort", key);
  if (desc) params.set("dir", "desc");
  else params.delete("dir");
  return `/applications?${params}`;
}

function sortHref(key: ListSort, sort: ListSort, desc: boolean, current: URLSearchParams) {
  const params = new URLSearchParams(current);
  params.set("view", "list");
  params.set("sort", key);
  if (key === sort && !desc) params.set("dir", "desc");
  else params.delete("dir");
  return `/applications?${params}`;
}
