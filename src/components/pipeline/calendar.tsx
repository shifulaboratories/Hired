import Link from "next/link";
import {
  BellIcon,
  CalendarDaysIcon,
  CheckSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HandshakeIcon,
  HistoryIcon,
  UsersIcon,
} from "lucide-react";
import type { Stage } from "@prisma/client";
import { STAGE_LABEL, STAGE_TONE, type ScheduleKind } from "@/lib/data/pipeline";
import { cn } from "@/lib/utils";
import { clockIn, SERVER_ZONE } from "@/lib/time";

export type CalendarEntry = {
  kind: ScheduleKind;
  id: string;
  /** ISO day, YYYY-MM-DD, already in the month being shown. */
  day: string;
  title: string;
  /** The role, or the person's title — whatever the title does not already say. */
  detail: string;
  /** Null for anything that is not an application. */
  stage: Stage | null;
  applicationId: string | null;
  contactId: string | null;
  done: boolean | null;
  /** A MEETING with nothing on the pipeline to open goes to Google Calendar instead. */
  url?: string;
};

/**
 * A month grid of everything with a date on it.
 *
 * Deliberately not a real calendar: no dragging, no creating by clicking an
 * empty square, no week or day zoom. Dates in this product are set by the work
 * — moving a stage schedules the follow-up — so the calendar's job is to answer
 * "what is coming" and hand you a link, not to be a second place to edit.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Parse `YYYY-MM`, falling back to the current month.
 *
 * `timeZone` decides which month "current" is — on the last day of a month the
 * server and the reader can disagree about it. The grid itself is drawn in UTC
 * and stays that way: a month has the same shape everywhere, and only the two
 * zone-sensitive questions — which cell an entry lands in, and which cell is
 * today — are answered from the reader's calendar.
 */
export function parseMonth(
  value: string | undefined,
  timeZone: string = SERVER_ZONE,
): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  const here = clockIn(new Date(), timeZone);
  const current = { year: here.year, month: here.month - 1 };
  if (!match) return current;
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return current;
  return { year: Number(match[1]), month };
}

/** The window a month grid actually shows: Monday before the 1st to Sunday after the last. */
export function monthWindow(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const from = new Date(Date.UTC(year, month, 1 - lead));
  const trail = 6 - ((last.getUTCDay() + 6) % 7);
  const to = new Date(Date.UTC(year, month + 1, trail));
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

const KIND_TONE: Record<ScheduleKind, string> = {
  FOLLOW_UP: "var(--warning)",
  TASK: "var(--primary)",
  ACTIVITY: "var(--stage-3)",
  MEETING: "var(--stage-interview)",
  INTERVIEW: "var(--stage-interview)",
  OFFER: "var(--stage-offer)",
};

const KIND_LABEL: Record<ScheduleKind, string> = {
  FOLLOW_UP: "Follow-up due",
  TASK: "Task due",
  ACTIVITY: "Logged",
  MEETING: "On your calendar",
  INTERVIEW: "Interview",
  OFFER: "Answer an offer by",
};

/**
 * A shape per kind, so the six kinds are not told apart by colour alone.
 *
 * Two of the six were already near-identical dots — MEETING and INTERVIEW share
 * `--stage-interview` — so even with perfect colour vision the legend was the
 * only way to read them apart, and the legend is at the top of a grid you have
 * scrolled away from. The dot stays as the colour cue; the icon is what makes
 * the kind legible on the chip itself.
 */
const KIND_ICON: Record<ScheduleKind, typeof BellIcon> = {
  FOLLOW_UP: BellIcon,
  TASK: CheckSquareIcon,
  ACTIVITY: HistoryIcon,
  MEETING: UsersIcon,
  INTERVIEW: CalendarDaysIcon,
  OFFER: HandshakeIcon,
};

export function PipelineCalendar({
  year,
  month,
  entries,
  today,
  fields,
}: {
  year: number;
  month: number;
  entries: CalendarEntry[];
  /** Passed in from the server so the grid and the highlight agree. */
  today: string;
  /**
   * What a chip shows besides its title. A chip has room for very little, so
   * the catalogue is two things — everything else on a schedule entry is
   * already inside the title and would print the same words twice.
   */
  fields: string[];
}) {
  const shows = new Set(fields);
  const { from } = monthWindow(year, month);
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const bucket = byDay.get(entry.day);
    if (bucket) bucket.push(entry);
    else byDay.set(entry.day, [entry]);
  }

  // In the array's own order, so the legend reads the same every month rather
  // than reshuffling with whatever happened to be scheduled first.
  const seen = new Set(entries.map((entry) => entry.kind));
  const present = (Object.keys(KIND_LABEL) as ScheduleKind[]).filter((kind) => seen.has(kind));

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(from);
    date.setUTCDate(from.getUTCDate() + i);
    return date;
  }).filter(
    // Six rows only when the month genuinely needs them.
    (_, i, all) => i < 35 || all.slice(35).some((d) => d.getUTCMonth() === month),
  );

  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="bg-card shadow-card overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <h2 className="text-[14px] font-semibold">{label}</h2>
        <div className="flex items-center gap-1">
          <MonthLink year={year} month={month - 1} aria-label="Previous month">
            <ChevronLeftIcon className="size-3.5" />
          </MonthLink>
          <MonthLink year={year} month={month + 1} aria-label="Next month">
            <ChevronRightIcon className="size-3.5" />
          </MonthLink>
          {/* Paging away from the current month is easy; paging back to it by
              hand is not. */}
          <Link
            href="/applications?view=calendar"
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex h-11 items-center rounded-chip px-2 text-[12px] font-medium transition-colors duration-150 md:h-6"
          >
            Today
          </Link>
        </div>
        {/* Only the kinds this month actually contains. Six fixed entries was
            a line of chrome as long as the month header, most of it explaining
            colours nothing on screen was using — and in an empty month it was
            the only thing on the card with any ink in it. */}
        {present.length > 0 && (
          <div className="text-faint ml-auto flex flex-wrap items-center gap-3 text-[11.5px]">
            {present.map((kind) => {
              const Icon = KIND_ICON[kind];
              return (
                <span key={kind} className="flex items-center gap-1">
                  <Icon className="size-3" style={{ color: KIND_TONE[kind] }} />
                  {KIND_LABEL[kind]}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Seven columns in 360px is 48px a cell, which is not a calendar — it is
          a grid of three-character stubs. The month keeps a usable width and
          scrolls sideways instead, the same gesture the board already uses. */}
      <div className="no-scrollbar overflow-x-auto">
        <div className="min-w-[44rem] md:min-w-0">
          <div className="eyebrow bg-inset grid grid-cols-7">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-1.5">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 border-t">
        {cells.map((date) => {
          const iso = date.toISOString().slice(0, 10);
          const outside = date.getUTCMonth() !== month;
          const items = byDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              className={cn(
                "min-h-[6.5rem] border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0",
                outside && "bg-inset",
              )}
            >
              <div
                className={cn(
                  "nums mb-1 flex size-5 items-center justify-center rounded-full text-[11.5px]",
                  iso === today && "bg-foreground text-background font-semibold",
                  iso !== today && (outside ? "text-faint/60" : "text-muted-foreground"),
                )}
              >
                {date.getUTCDate()}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((entry) => (
                  <CalendarChip
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    fields={shows}
                  />
                ))}
                {/* "+3 more" used to be a dead end: the busiest days in the
                    month were the ones you could not read. A details element
                    opens the rest in place — no client JavaScript, which this
                    server component has none of, and it stays keyboard and
                    screen-reader operable for free. */}
                {items.length > 3 && (
                  <details className="group/more">
                    <summary // list-none handles Firefox and Chrome; Safari needs the webkit marker
                      // hidden separately or the disclosure triangle stays.
                      className="text-muted-foreground hover:text-foreground hover:bg-accent rounded-chip cursor-pointer list-none px-1 py-0.5 text-[11px] transition-colors duration-150 [&::-webkit-details-marker]:hidden">
                      <span className="group-open/more:hidden">+{items.length - 3} more</span>
                      <span className="hidden group-open/more:inline">Show less</span>
                    </summary>
                    <div className="mt-0.5 space-y-0.5">
                      {items.slice(3).map((entry) => (
                        <CalendarChip
                          key={`${entry.kind}-${entry.id}`}
                          entry={entry}
                          fields={shows}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarChip({ entry, fields }: { entry: CalendarEntry; fields: Set<string> }) {
  const Icon = KIND_ICON[entry.kind];
  // What the chip cannot show. It used to repeat the title, which is the one
  // thing already on screen — so hovering a truncated row told you nothing.
  const tooltip = [
    KIND_LABEL[entry.kind],
    entry.title,
    entry.detail,
    entry.stage ? STAGE_LABEL[entry.stage] : "",
    entry.done ? "done" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <span
      className={cn(
        // Tall enough for a finger below md; back to the dense row above it.
        "flex min-h-11 items-center gap-1 truncate rounded-chip px-1 py-0.5 text-[11.5px] md:min-h-0",
        entry.done ? "text-faint line-through" : "text-foreground",
      )}
    >
      <Icon
        className="size-3 shrink-0"
        style={{ color: KIND_TONE[entry.kind] }}
        aria-hidden
      />
      {/* The title takes the room and the detail gets what is left, rather than
          the two splitting a 130px cell evenly and truncating each other into
          six characters apiece — which is what "Applie… Wishlist…" was. The
          detail waits for a genuinely wide screen; below that the tooltip
          carries it, which is why the tooltip now names the kind and the
          stage instead of repeating the title. */}
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      {fields.has("detail") && entry.detail && (
        <span className="text-faint hidden max-w-[45%] shrink truncate 2xl:inline">
          {entry.detail}
        </span>
      )}
      {fields.has("stage") && entry.stage && (
        <span
          className="stage-chip hidden shrink-0 rounded-chip px-1 text-[10px] font-medium lg:inline"
          style={{ ["--tone" as string]: STAGE_TONE[entry.stage] }}
        >
          {STAGE_LABEL[entry.stage]}
        </span>
      )}
    </span>
  );

  const href = entry.applicationId
    ? `/applications/${entry.applicationId}`
    : entry.contactId
      ? `/crm/contacts/${entry.contactId}`
      : null;
  if (!href && entry.url) {
    return (
      <a
        href={entry.url}
        target="_blank"
        rel="noreferrer noopener"
        title={tooltip}
        className="hover:bg-accent block rounded-chip transition-colors duration-150"
      >
        {body}
      </a>
    );
  }
  return href ? (
    <Link
      href={href}
      title={tooltip}
      className="hover:bg-accent block rounded-chip transition-colors duration-150"
    >
      {body}
    </Link>
  ) : (
    <div title={tooltip}>{body}</div>
  );
}

function MonthLink({
  year,
  month,
  children,
  ...props
}: {
  year: number;
  month: number;
  children: React.ReactNode;
  "aria-label": string;
}) {
  // Normalise an out-of-range month into the neighbouring year.
  const date = new Date(Date.UTC(year, month, 1));
  const target = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return (
    <Link
      href={`/applications?view=calendar&month=${target}`}
      className="text-muted-foreground hover:text-foreground hover:bg-accent touch-target flex size-11 items-center justify-center rounded-chip md:size-6 transition-colors duration-150"
      {...props}
    >
      {children}
    </Link>
  );
}
