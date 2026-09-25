/**
 * A career laid out in months: which roles ran when, where the gaps are, and
 * which jobs overlapped.
 *
 * Gaps and overlaps are the two things an interviewer asks about that a list
 * of roles hides. A list sorted by start date puts a six-month gap between two
 * cards that look adjacent, and puts three advisory roles that ran alongside a
 * full-time job in a row that reads like somebody who cannot hold a job.
 *
 * Pure. Both the Roles tab and career_timeline read it, so the strip on screen
 * and what an assistant is told about the gaps are the same arithmetic.
 */

export type RoleGroup = "employment" | "contract" | "advisory" | "internship";

export const GROUP_LABEL: Record<RoleGroup, string> = {
  employment: "Jobs",
  contract: "Contract and freelance",
  advisory: "Advisory and board",
  internship: "Internships",
};

export const GROUP_ORDER: RoleGroup[] = ["employment", "contract", "advisory", "internship"];

/**
 * Which kind of role this is, from its free-text employment type. Anything
 * unrecognised is a job — the default a person would expect, and the one that
 * keeps a typo from quietly moving a job out of the gap arithmetic.
 */
export function roleGroup(employmentType: string): RoleGroup {
  const type = employmentType.toLowerCase();
  if (/advis|board|mentor|volunteer|trustee/.test(type)) return "advisory";
  if (/intern|apprentice/.test(type)) return "internship";
  if (/contract|freelance|consult|fractional|self-employed/.test(type)) return "contract";
  return "employment";
}

/** "2021-03" → months since year 0. A bare "2021" counts from January. */
export function monthIndex(value: string): number | null {
  const match = /^(\d{4})(?:-(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const month = match[2] ? Number(match[2]) - 1 : 0;
  if (month < 0 || month > 11) return null;
  return Number(match[1]) * 12 + month;
}

export function monthName(index: number) {
  const year = Math.floor(index / 12);
  const month = new Date(Date.UTC(year, index % 12, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${month} ${year}`;
}

export type TimelineInput = {
  id: string;
  title: string;
  company: string;
  employmentType: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  startUnconfirmed?: boolean;
  endUnconfirmed?: boolean;
};

export type TimelineRole = TimelineInput & {
  group: RoleGroup;
  /** Month indexes; end is inclusive. Null when the role has no usable start. */
  start: number | null;
  end: number | null;
};

export type Gap = { from: number; to: number; months: number; after: string; before: string };
export type Overlap = { a: string; b: string; months: number };

/** A gap shorter than this is a notice period, not a question. */
export const GAP_MONTHS = 3;

export function careerTimeline(roles: TimelineInput[], now: Date) {
  const today = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const laid: TimelineRole[] = roles.map((role) => {
    const start = monthIndex(role.startDate);
    const end = role.isCurrent ? today : monthIndex(role.endDate) ?? start;
    return { ...role, group: roleGroup(role.employmentType), start, end };
  });

  // Gaps and overlaps are about the work that pays the rent: jobs and
  // contracts. Advisory roles run alongside by nature, and an internship
  // before a first job is not a gap anybody asks about.
  const primary = laid
    .filter((role) => role.start !== null && (role.group === "employment" || role.group === "contract"))
    .sort((a, b) => (a.start as number) - (b.start as number));

  const gaps: Gap[] = [];
  let reach: { end: number; label: string } | null = null;
  for (const role of primary) {
    const start = role.start as number;
    const end = role.end as number;
    const label = `${role.title} @ ${role.company}`;
    if (reach && start - reach.end - 1 >= GAP_MONTHS) {
      gaps.push({
        from: reach.end + 1,
        to: start - 1,
        months: start - reach.end - 1,
        after: reach.label,
        before: label,
      });
    }
    if (!reach || end > reach.end) reach = { end, label };
  }

  const overlaps: Overlap[] = [];
  for (let i = 0; i < primary.length; i += 1) {
    for (let j = i + 1; j < primary.length; j += 1) {
      const a = primary[i];
      const b = primary[j];
      const months = Math.min(a.end as number, b.end as number) - (b.start as number) + 1;
      // One shared month is a handover, not two jobs at once.
      if (months >= 2) {
        overlaps.push({
          a: `${a.title} @ ${a.company}`,
          b: `${b.title} @ ${b.company}`,
          months,
        });
      }
    }
  }

  const starts = laid.map((role) => role.start).filter((value): value is number => value !== null);
  const ends = laid.map((role) => role.end).filter((value): value is number => value !== null);
  return {
    roles: laid,
    gaps,
    overlaps,
    span: starts.length ? { start: Math.min(...starts), end: Math.max(...ends, today) } : null,
    today,
  };
}
