import type { Stage } from "@prisma/client";
import { TERMINAL_STAGES } from "@/lib/data/pipeline";
import { STALE_AFTER } from "@/lib/quiet";

/**
 * What the pipeline is currently showing.
 *
 * Pure, and shared by the page (which filters) and the toolbar (which builds
 * links), so there is one definition of what a filter means rather than a
 * server copy and a client copy that drift.
 *
 * The URL stays the state. Every parameter here is also whitelisted in
 * normaliseQuery (src/lib/data/views.ts) — a saved view is that string, so a
 * parameter this file understands and that file drops is a filter that
 * silently disappears the moment somebody saves the view.
 */
export type PipelineFilters = {
  stages: Stage[];
  /** ANDs with everything else now. It used to replace the stage set. */
  overdue: boolean;
  /**
   * Tag ids. The URL still spells it `src` — it was called "source" when
   * saved views started storing it, and renaming the parameter would break
   * every view anyone has already saved for the sake of tidiness.
   */
  tags: string[];
  companies: string[];
  resumes: string[];
  /** Minimum days sitting in the current stage. */
  waiting: number | null;
  /** Minimum days since ANYTHING happened. Not the same question as waiting. */
  quiet: number | null;
  search: string;
};

export const EMPTY_FILTERS: PipelineFilters = {
  stages: [],
  overdue: false,
  tags: [],
  companies: [],
  resumes: [],
  waiting: null,
  quiet: null,
  search: "",
};

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const positive = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * `f` still carries the stages, and still understands the two words it always
 * did. `closed` expands to the four terminal stages instead of being a mode of
 * its own, which is what makes "closed, but only the ghostings" expressible;
 * `overdue` becomes a flag, which is what makes "screening and overdue" work.
 * Both spellings survive so saved views and pasted links keep meaning what
 * they meant.
 */
export function parsePipelineFilters(
  one: (key: string) => string | undefined,
  stages: readonly Stage[],
): PipelineFilters {
  const parts = list(one("f"));
  const picked = parts.filter((part) => (stages as readonly string[]).includes(part)) as Stage[];
  const closed = parts.includes("closed");
  return {
    stages: closed ? [...new Set([...picked, ...TERMINAL_STAGES])] : picked,
    overdue: parts.includes("overdue"),
    tags: list(one("src")),
    companies: list(one("co")),
    resumes: list(one("cv")),
    waiting: positive(one("w")),
    quiet: positive(one("qd")),
    search: one("q")?.trim() ?? "",
  };
}

/** Anything at all narrowing the board, for "clear" and for the empty state. */
export function hasAnyFilter(filters: PipelineFilters): boolean {
  return (
    filters.stages.length > 0 ||
    filters.overdue ||
    filters.tags.length > 0 ||
    filters.companies.length > 0 ||
    filters.resumes.length > 0 ||
    filters.waiting !== null ||
    filters.quiet !== null ||
    Boolean(filters.search)
  );
}

/** The row shape the predicate needs. Satisfied by listApplications. */
export type FilterableApplication = {
  stage: Stage;
  nextFollowUpAt: Date | null;
  companyId: string;
  resumeId: string | null;
  daysInStage: number;
  quietDays: number;
  tags: { id: string; name: string }[];
  roleTitle: string;
  notes: string;
  location: string;
  workMode: string;
  jobDescription: string;
  company: { name: string };
};

/**
 * One predicate, applied to rows the page already has.
 *
 * Search runs here rather than in the Prisma `where` because half of what is
 * worth searching cannot be expressed there: a substring across a relation's
 * names is not something `has` can do, and "which of these mentioned Rust"
 * needs the description the query was not fetching to match on.
 */
export function matchesFilters(
  application: FilterableApplication,
  filters: PipelineFilters,
  now = Date.now(),
): boolean {
  if (filters.stages.length > 0 && !filters.stages.includes(application.stage)) return false;

  if (filters.overdue) {
    // A closed application cannot be overdue: nobody is waiting on it.
    if (TERMINAL_STAGES.includes(application.stage)) return false;
    if (application.nextFollowUpAt === null) return false;
    if (application.nextFollowUpAt.getTime() > now) return false;
  }

  if (filters.tags.length > 0) {
    const ids = new Set(application.tags.map((tag) => tag.id));
    if (!filters.tags.some((id) => ids.has(id))) return false;
  }
  if (filters.companies.length > 0 && !filters.companies.includes(application.companyId)) {
    return false;
  }
  if (filters.resumes.length > 0) {
    // "none" is a real answer to "which resume went out".
    const value = application.resumeId ?? "none";
    if (!filters.resumes.includes(value)) return false;
  }
  if (filters.waiting !== null && application.daysInStage < filters.waiting) return false;
  if (filters.quiet !== null) {
    // Same rule the card and the cell draw: a closed application is over and a
    // wishlist entry was never waiting, so neither can be "gone quiet" — and
    // closed rows have the largest quietDays in a workspace, so without this
    // they won every filter and every sort.
    if (STALE_AFTER[application.stage] === undefined) return false;
    if (application.quietDays < filters.quiet) return false;
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = [
      application.company.name,
      application.roleTitle,
      application.notes,
      application.location,
      application.workMode,
      application.jobDescription,
      ...application.tags.map((tag) => tag.name),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/** The URL for a set of filters. Keys are omitted when they carry nothing. */
export function buildPipelineQuery(input: {
  view?: string;
  filters: PipelineFilters;
  sort?: string;
  dir?: string;
  month?: string;
}): string {
  const { filters } = input;
  const params = new URLSearchParams();
  if (input.view && input.view !== "board") params.set("view", input.view);

  const f = [...filters.stages, ...(filters.overdue ? ["overdue"] : [])];
  if (f.length > 0) params.set("f", f.join(","));
  if (filters.tags.length > 0) params.set("src", filters.tags.join(","));
  if (filters.companies.length > 0) params.set("co", filters.companies.join(","));
  if (filters.resumes.length > 0) params.set("cv", filters.resumes.join(","));
  if (filters.waiting !== null) params.set("w", String(filters.waiting));
  if (filters.quiet !== null) params.set("qd", String(filters.quiet));
  if (filters.search) params.set("q", filters.search);
  if (input.sort) params.set("sort", input.sort);
  if (input.dir) params.set("dir", input.dir);
  if (input.month) params.set("month", input.month);

  const query = params.toString();
  return query ? `/applications?${query}` : "/applications";
}

/** Toggle one value in one of the list dimensions. */
export function toggleIn(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
