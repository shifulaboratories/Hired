"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { GROUP_LABEL, GROUP_ORDER, monthName, type RoleGroup } from "@/lib/timeline";

/**
 * The career as one strip: a row per role, a bar for when it ran, and the gaps
 * between jobs shaded, so the question an interviewer will ask is visible
 * before they ask it. career_timeline says the same thing in words.
 *
 * Colour is identity — which kind of role — from a validated four-slot
 * categorical palette, stepped separately for dark. Every row is labelled in
 * text, so colour is never the only way to tell a role apart.
 */

type Row = {
  id: string;
  title: string;
  company: string;
  group: RoleGroup;
  start: number | null;
  end: number | null;
  isCurrent: boolean;
  unconfirmed: boolean;
};
type Gap = { from: number; to: number; months: number };

const SWATCH: Record<RoleGroup, string> = {
  employment: "bg-[var(--tl-1)]",
  contract: "bg-[var(--tl-2)]",
  advisory: "bg-[var(--tl-3)]",
  internship: "bg-[var(--tl-4)]",
};

// Validated with the dataviz palette checker: light against the card, dark
// against the dark card. Light slots 3 and 4 sit under 3:1 on white, which is
// why every bar has a text label beside it.
const PALETTE =
  "[--tl-1:#2a78d6] [--tl-2:#eb6834] [--tl-3:#1baf7a] [--tl-4:#eda100] " +
  "dark:[--tl-1:#3987e5] dark:[--tl-2:#d95926] dark:[--tl-3:#199e70] dark:[--tl-4:#c98500]";

function span(months: number) {
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}y ${rest}m` : `${years} ${years === 1 ? "year" : "years"}`;
}

export function CareerTimeline({
  rows,
  gaps,
  range,
}: {
  rows: Row[];
  gaps: Gap[];
  range: { start: number; end: number };
}) {
  const [open, setOpen] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const placed = rows.filter((row) => row.start !== null);
  if (placed.length < 2) return null;

  const total = Math.max(1, range.end - range.start + 1);
  const x = (month: number) => `${((month - range.start) / total) * 100}%`;
  const w = (from: number, to: number) => `${(Math.max(1, to - from + 1) / total) * 100}%`;
  const firstYear = Math.ceil(range.start / 12);
  const lastYear = Math.floor(range.end / 12);
  const step = Math.max(1, Math.ceil((lastYear - firstYear + 1) / 8));
  const years: number[] = [];
  for (let year = firstYear; year <= lastYear; year += step) years.push(year);
  const groups = GROUP_ORDER.filter((group) => placed.some((row) => row.group === group));

  return (
    <Card className={PALETTE}>
      <CardContent className="space-y-3 pt-5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-[15px] font-semibold tracking-tight">Timeline</span>
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            {gaps.length === 0
              ? "No gaps of three months or more between jobs"
              : `${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"} of three months or more between jobs`}
            <ChevronDownIcon className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          </span>
        </button>

        {open && (
          <>
            {groups.length > 1 && (
              <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {groups.map((group) => (
                  <span key={group} className="flex items-center gap-1.5">
                    <span className={cn("size-2.5 rounded-sm", SWATCH[group])} aria-hidden />
                    {GROUP_LABEL[group]}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
              <div />
              <div className="text-muted-foreground relative h-4 text-[10.5px] tabular-nums">
                {years.map((year) => (
                  <span key={year} className="absolute -translate-x-1/2" style={{ left: x(year * 12) }}>
                    {year}
                  </span>
                ))}
              </div>

              {placed.map((row) => {
                const start = row.start as number;
                const end = row.end ?? start;
                const label = `${row.title} · ${row.company}`;
                const when = `${monthName(start)} – ${row.isCurrent ? "now" : monthName(end)}`;
                const active = hover === row.id;
                return (
                  <div key={row.id} className="contents">
                    <div
                      className={cn(
                        "truncate py-1 text-xs",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                      title={label}
                    >
                      {label}
                    </div>
                    <div className="relative py-1">
                      {/* Gridlines behind, recessive. */}
                      {years.map((year) => (
                        <span
                          key={year}
                          className="bg-border absolute inset-y-0 w-px"
                          style={{ left: x(year * 12) }}
                          aria-hidden
                        />
                      ))}
                      {gaps.map((gap, index) => (
                        <span
                          key={index}
                          className="border-warning/50 bg-warning-tint absolute inset-y-0 border-x border-dashed"
                          style={{ left: x(gap.from), width: w(gap.from, gap.to) }}
                          aria-hidden
                        />
                      ))}
                      {/* The hit target is the whole row height, bigger than the bar. */}
                      <button
                        type="button"
                        onMouseEnter={() => setHover(row.id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(row.id)}
                        onBlur={() => setHover(null)}
                        aria-label={`${label}, ${when}${row.unconfirmed ? ", a month not confirmed" : ""}`}
                        className="relative block h-3 w-full outline-none"
                      >
                        <span
                          className={cn(
                            "absolute inset-y-0 rounded-[4px] transition-opacity",
                            SWATCH[row.group],
                            row.unconfirmed && "opacity-60",
                            hover && !active && "opacity-40",
                          )}
                          style={{ left: x(start), width: w(start, end) }}
                        />
                        {active && (
                          <span
                            role="tooltip"
                            className="bg-popover text-popover-foreground shadow-raised absolute bottom-full z-20 mb-1.5 rounded-md border px-2 py-1 text-[11.5px] whitespace-nowrap"
                            // Anchored to whichever side keeps it on the card.
                            style={(start - range.start) / total > 0.55 ? { right: 0 } : { left: x(start) }}
                          >
                            <span className="font-medium">{label}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {when} · {span(end - start + 1)}
                              {row.unconfirmed && " · a month not confirmed"}
                            </span>
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {gaps.length > 0 && (
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                {gaps.map((gap, index) => (
                  <li key={index}>
                    <span className="text-foreground font-medium">{span(gap.months)}</span> between{" "}
                    {monthName(gap.from)} and {monthName(gap.to)}. Have the answer ready; it is the first
                    thing a recruiter reading dates notices.
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
