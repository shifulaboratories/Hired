import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { daysBetween, SERVER_ZONE } from "@/lib/time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** "2021-03" | "2021-03-01" | "Mar 2021" -> "Mar 2021" */
export function formatMonth(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const iso = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(trimmed);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  return trimmed;
}

export function dateRange(start?: string | null, end?: string | null, current?: boolean) {
  const s = formatMonth(start);
  const e = current ? "Present" : formatMonth(end);
  if (s && e) return `${s} – ${e}`;
  return s || e || "";
}

/**
 * "Today", "Tomorrow", "3d overdue" — a date read as a calendar, not a clock.
 *
 * `timeZone` is whose calendar. In the browser it can be left off, because the
 * host clock IS the reader's; on the server it must be passed or "today" means
 * today in whatever zone the instance runs in, which on a hosted one is UTC.
 * See src/lib/time.ts.
 */
export function relativeDay(
  date: Date | string | null | undefined,
  timeZone: string = SERVER_ZONE,
) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const days = daysBetween(new Date(), d, timeZone);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `in ${days}d`;
}

/** Past-tense counterpart to relativeDay: how long since something happened. */
export function agoDay(date: Date | string | null | undefined, timeZone: string = SERVER_ZONE) {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const days = daysBetween(d, new Date(), timeZone);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 61) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30.4)}mo ago`;
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export function truncate(text: string, max = 160) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
