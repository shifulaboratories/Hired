import type { Stage } from "@prisma/client";
import { STALE_AFTER } from "@/lib/quiet";

/**
 * The list view's shape and sorting.
 *
 * Split out from the component because the page sorts on the server and the
 * component is a client component — a `"use client"` file's exports cannot be
 * called from the server, and the failure is a runtime 500 rather than a type
 * error, so it is worth keeping the pure half somewhere it cannot happen.
 */

export const LIST_SORTS = [
  "followUp",
  "company",
  "stage",
  "updated",
  "salary",
  "waiting",
  "quiet",
] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export function parseSort(value: string | undefined): ListSort {
  return (LIST_SORTS as readonly string[]).includes(value ?? "")
    ? (value as ListSort)
    : "followUp";
}

export type ListRow = {
  id: string;
  company: string;
  roleTitle: string;
  stage: Stage;
  location: string;
  salaryRange: string;
  nextFollowUpAt: string | null;
  activityCount: number;
  updatedAt: string;
  /** Days since the stage last changed. The "how long has this been sitting" number. */
  daysInStage: number;
  /** Days since anything at all happened. Chasing is decided on this one. */
  quietDays: number;
  /** The posting, for the row's own actions. Empty when there never was one. */
  jobUrl: string;
  /** Null when logos are off, or no domain could be worked out. */
  domain: string | null;
};

/**
 * What a row is built from. Structural, so listApplications' own return type
 * satisfies it without either side importing the other.
 */
export type ListSource = {
  id: string;
  company: { name: string };
  roleTitle: string;
  stage: Stage;
  location: string;
  salaryRange: string;
  nextFollowUpAt: Date | null;
  updatedAt: Date;
  daysInStage: number;
  quietDays: number;
  jobUrl: string;
  _count: { activities: number };
};

/** One mapping, shared by the table and the export, so they cannot drift. */
export function toListRow(application: ListSource, domain: string | null): ListRow {
  return {
    id: application.id,
    company: application.company.name,
    roleTitle: application.roleTitle,
    stage: application.stage,
    location: application.location,
    salaryRange: application.salaryRange,
    nextFollowUpAt: application.nextFollowUpAt?.toISOString() ?? null,
    activityCount: application._count.activities,
    updatedAt: application.updatedAt.toISOString(),
    daysInStage: application.daysInStage,
    quietDays: application.quietDays,
    jobUrl: application.jobUrl,
    domain,
  };
}

const STAGE_ORDER: Stage[] = [
  "OFFER",
  "FINAL",
  "INTERVIEW",
  "SCREEN",
  "APPLIED",
  "WISHLIST",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "GHOSTED",
];

/**
 * Sorting happens here rather than in the query because the useful default —
 * soonest follow-up first, then everything with no date at all — is not an
 * ordering Postgres gives you for free, and the list is a person's own
 * pipeline: tens of rows, not thousands.
 */
export function sortRows(rows: ListRow[], sort: ListSort, desc: boolean): ListRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sort) {
      case "company":
        return a.company.localeCompare(b.company) || a.roleTitle.localeCompare(b.roleTitle);
      case "stage":
        return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
      case "updated":
        return b.updatedAt.localeCompare(a.updatedAt);
      // Longest wait first: the useful question is what has been ignored, not
      // what was touched a minute ago.
      case "waiting":
        return b.daysInStage - a.daysInStage;
      // Same argument, different question: what nobody has touched, rather
      // than what has not moved. Rows the rule gives no threshold — closed,
      // and the wishlist — sort last rather than first: they have the largest
      // numbers in the workspace and none of them mean anything.
      case "quiet": {
        const quiet = (row: ListRow) =>
          STALE_AFTER[row.stage] === undefined ? -1 : row.quietDays;
        return quiet(b) - quiet(a);
      }
      case "salary":
        // No salary sorts last either way: a blank is not "cheapest".
        return (salaryFloor(b.salaryRange) || -1) - (salaryFloor(a.salaryRange) || -1);
      case "followUp":
      default:
        if (!a.nextFollowUpAt && !b.nextFollowUpAt) return b.updatedAt.localeCompare(a.updatedAt);
        if (!a.nextFollowUpAt) return 1;
        if (!b.nextFollowUpAt) return -1;
        return a.nextFollowUpAt.localeCompare(b.nextFollowUpAt);
    }
  });
  return desc ? sorted.reverse() : sorted;
}

/** First number that looks like money, so "$210k – $260k" sorts on 210000. */
function salaryFloor(range: string): number {
  const match = range.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m)?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  return unit === "k" ? value * 1000 : unit === "m" ? value * 1e6 : value;
}

