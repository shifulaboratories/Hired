"use client";

import { useState } from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * One date, picked from a calendar rather than typed into a native control.
 *
 * `input[type=date]` was doing the job and doing it four different ways: three
 * segments in the browser's locale on Chrome, a text box on Firefox for Linux,
 * a wheel on iOS, and "mm/dd/yyyy" in grey on every empty one — which, in a
 * column of follow-up dates, was louder than the dates that were actually set.
 * It also cannot say "next Tuesday" is next Tuesday.
 *
 * The value stays an ISO `YYYY-MM-DD` string on the way in and out, because
 * that is what the server actions, the URL and the database already speak.
 *
 * **Dates here are civil dates, not instants.** A follow-up on the 14th is the
 * 14th wherever you open it, so the string is split and rebuilt by its parts
 * rather than passed through `new Date("2026-03-14")`, which parses as UTC
 * midnight and renders as the 13th for anyone west of Greenwich.
 */

/** "2026-03-14" → a Date at local midnight. Undefined for anything else. */
export function parseISODate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** A Date → "2026-03-14", by its local parts. */
export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function DateField({
  value,
  onChange,
  placeholder = "No date",
  ariaLabel,
  className,
  align = "start",
  /** Colour the trigger as overdue. The caller decides what overdue means. */
  tone,
  clearable = true,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  align?: "start" | "end" | "center";
  tone?: "overdue";
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseISODate(value);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-label={ariaLabel}
            className={cn(
              "h-9 min-w-0 flex-1 justify-start gap-2 px-3 font-normal",
              !selected && "text-muted-foreground",
              tone === "overdue" && selected && "text-destructive",
            )}
          >
            <CalendarIcon className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">
              {selected
                ? selected.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align={align} className="w-auto p-2">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            captionLayout="dropdown"
            autoFocus
            onSelect={(next) => {
              // react-day-picker hands back undefined when the selected day is
              // clicked again. That is a clear, and it is the same act as the
              // button beside it.
              onChange(next ? toISODate(next) : "");
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {clearable && selected && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-faint hover:text-destructive shrink-0"
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
