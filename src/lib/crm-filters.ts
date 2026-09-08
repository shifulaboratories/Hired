import type { TagKind } from "@prisma/client";

/**
 * What each CRM list is currently showing.
 *
 * The CRM's `pipeline-filters.ts`, and deliberately its twin: the URL is the
 * state, one predicate is shared by the page that filters and the menu that
 * builds links, and a dimension ORs inside itself and ANDs with every other.
 *
 * Pure, and importing nothing from `src/lib/data/` at runtime — the type-only
 * TagKind import is erased — because the facet menus are client components and
 * a client bundle may not pull Prisma into the browser. Same rule as
 * `src/lib/quiet.ts` and `src/lib/social.ts`.
 *
 * These parameter names deliberately do not collide with the pipeline's. If
 * saved views ever grow a scope, each screen can whitelist its own keys
 * without renaming anything anybody has already saved.
 */

export const COMPANY_CUTS = ["active", "applied", "never-applied", "with-contacts"] as const;
export type CompanyCut = (typeof COMPANY_CUTS)[number];

export const CONTACT_CUTS = ["ping-due", "with-application", "no-company"] as const;
export type ContactCut = (typeof CONTACT_CUTS)[number];

/** Gaps worth fixing in one sitting. These AND with each other. */
export const COMPANY_MISSING = ["website", "industry", "location"] as const;
export type CompanyMissing = (typeof COMPANY_MISSING)[number];

export const CONTACT_MISSING = ["email", "tags"] as const;
export type ContactMissing = (typeof CONTACT_MISSING)[number];

export const COMPANY_SORTS = ["name", "applied", "apps", "people"] as const;
export type CompanySort = (typeof COMPANY_SORTS)[number];

export const CONTACT_SORTS = ["name", "company", "ping", "touch"] as const;
export type ContactSort = (typeof CONTACT_SORTS)[number];

export type CompanyFilters = {
  /** One cut at a time, like the pipeline's stage chips. */
  cut: CompanyCut | null;
  /** Tag ids, by kind. Each ORs inside itself and ANDs with the others. */
  industries: string[];
  sizes: string[];
  locations: string[];
  /** Tag ids of any kind — the loose one, for when you have an id. */
  tags: string[];
  missing: CompanyMissing[];
  search: string;
};

export type ContactFilters = {
  cut: ContactCut | null;
  companies: string[];
  tags: string[];
  /** Minimum days since anything was logged against them. */
  quiet: number | null;
  missing: ContactMissing[];
  search: string;
};

export const EMPTY_COMPANY_FILTERS: CompanyFilters = {
  cut: null,
  industries: [],
  sizes: [],
  locations: [],
  tags: [],
  missing: [],
  search: "",
};

export const EMPTY_CONTACT_FILTERS: ContactFilters = {
  cut: null,
  companies: [],
  tags: [],
  quiet: null,
  missing: [],
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

/** Unknown values are dropped rather than thrown: a stale link narrows less, not nothing. */
const only = <T extends string>(values: string[], allowed: readonly T[]) =>
  values.filter((value): value is T => (allowed as readonly string[]).includes(value));

const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[]) =>
  (allowed as readonly string[]).includes(value ?? "") ? (value as T) : null;

// ---------------------------------------------------------------------------
// The rows these predicates run over
// ---------------------------------------------------------------------------

/** Structural, so listCompanies' own return type satisfies it. */
export type FilterableCompany = {
  name: string;
  website: string;
  notes: string;
  tags: { id: string; name: string; kind: TagKind }[];
  lastAppliedAt: Date | null;
  openApplications: number;
  _count: { applications: number; contacts: number };
};

export type FilterableContact = {
  name: string;
  title: string;
  email: string;
  relationship: string;
  notes: string;
  nextFollowUpAt: Date | null;
  /**
   * The LIVE application they are attached to, not the raw column.
   *
   * Archiving an application does not clear `Contact.applicationId`, and the
   * relation is fetched with an archive filter — so the column can say "yes"
   * while every screen shows no application at all. The cut has to read what
   * the screens read.
   */
  application: { id: string } | null;
  createdAt: Date;
  companies: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  /** The single most recent touch, which is what listContacts fetches. */
  activities: { occurredAt: Date }[];
};

const hay = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" ").toLowerCase();

/** Of one kind, without importing the tags module into a client bundle. */
const ofKind = (tags: { kind: TagKind }[], kind: TagKind) =>
  tags.filter((tag) => tag.kind === kind);

/**
 * Days since anything was logged against a person.
 *
 * Falls back to how long they have been on file when nothing has ever been
 * logged — somebody added four months ago and never contacted is precisely who
 * "nothing logged for 90 days" is asked about, and treating them as a blank
 * would hide the answer behind the question.
 */
export function contactQuietDays(contact: FilterableContact, now = Date.now()): number {
  const since = contact.activities[0]?.occurredAt ?? contact.createdAt;
  return Math.floor((now - since.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------

/**
 * One definition of what a company filter means.
 *
 * It runs over rows the page already has rather than inside the Prisma `where`
 * for the same reason the pipeline's does: a faceted count is "how many would
 * survive if I relaxed this one dimension", which needs the unfiltered set in
 * hand. Two implementations — one in SQL for the list, one here for the counts
 * — would be exactly the fork invariant 2 exists to prevent.
 *
 * Every tag dimension is a plain id-membership test and never consults
 * `Tag.kind`. Kind decides which menu group offers which tag; it must not
 * decide what an id matches, or `tagIds` would stop meaning what its shipped
 * description says it means.
 */
export function matchesCompany(company: FilterableCompany, filters: CompanyFilters): boolean {
  if (filters.cut === "active" && company.openApplications === 0) return false;
  if (filters.cut === "applied" && company.lastAppliedAt === null) return false;
  if (filters.cut === "never-applied" && company.lastAppliedAt !== null) return false;
  if (filters.cut === "with-contacts" && company._count.contacts === 0) return false;

  const ids = new Set(company.tags.map((tag) => tag.id));
  const wears = (dimension: string[]) =>
    dimension.length === 0 || dimension.some((id) => ids.has(id));
  if (!wears(filters.industries)) return false;
  if (!wears(filters.sizes)) return false;
  if (!wears(filters.locations)) return false;
  if (!wears(filters.tags)) return false;

  for (const gap of filters.missing) {
    if (gap === "website" && company.website.trim()) return false;
    if (gap === "industry" && ofKind(company.tags, "INDUSTRY").length > 0) return false;
    if (gap === "location" && ofKind(company.tags, "LOCATION").length > 0) return false;
  }

  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = hay(
      company.name,
      company.website,
      company.notes,
      company.tags.map((tag) => tag.name).join(" "),
    );
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export function matchesContact(
  contact: FilterableContact,
  filters: ContactFilters,
  now = Date.now(),
): boolean {
  if (filters.cut === "ping-due") {
    if (contact.nextFollowUpAt === null || contact.nextFollowUpAt.getTime() > now) return false;
  }
  if (filters.cut === "with-application" && contact.application === null) return false;
  if (filters.cut === "no-company" && contact.companies.length > 0) return false;

  if (filters.companies.length > 0) {
    const linked = new Set(contact.companies.map((company) => company.id));
    if (!filters.companies.some((id) => linked.has(id))) return false;
  }
  if (filters.tags.length > 0) {
    const ids = new Set(contact.tags.map((tag) => tag.id));
    if (!filters.tags.some((id) => ids.has(id))) return false;
  }
  if (filters.quiet !== null && contactQuietDays(contact, now) < filters.quiet) return false;

  for (const gap of filters.missing) {
    if (gap === "email" && contact.email.trim()) return false;
    if (gap === "tags" && contact.tags.length > 0) return false;
  }

  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = hay(
      contact.name,
      contact.title,
      contact.email,
      contact.relationship,
      contact.notes,
      contact.companies.map((company) => company.name).join(" "),
      contact.tags.map((tag) => tag.name).join(" "),
    );
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export function hasAnyCompanyFilter(filters: CompanyFilters): boolean {
  return (
    filters.cut !== null ||
    filters.industries.length > 0 ||
    filters.sizes.length > 0 ||
    filters.locations.length > 0 ||
    filters.tags.length > 0 ||
    filters.missing.length > 0 ||
    Boolean(filters.search)
  );
}

export function hasAnyContactFilter(filters: ContactFilters): boolean {
  return (
    filters.cut !== null ||
    filters.companies.length > 0 ||
    filters.tags.length > 0 ||
    filters.quiet !== null ||
    filters.missing.length > 0 ||
    Boolean(filters.search)
  );
}

// ---------------------------------------------------------------------------
// The URL
// ---------------------------------------------------------------------------

type Reader = (key: string) => string | undefined;

export function parseCompanyFilters(one: Reader): CompanyFilters {
  return {
    cut: oneOf(one("f"), COMPANY_CUTS),
    industries: list(one("ind")),
    sizes: list(one("size")),
    locations: list(one("loc")),
    tags: list(one("tag")),
    missing: only(list(one("miss")), COMPANY_MISSING),
    search: one("q")?.trim() ?? "",
  };
}

export function parseContactFilters(one: Reader): ContactFilters {
  return {
    cut: oneOf(one("f"), CONTACT_CUTS),
    companies: list(one("co")),
    tags: list(one("tag")),
    quiet: positive(one("qd")),
    missing: only(list(one("miss")), CONTACT_MISSING),
    search: one("q")?.trim() ?? "",
  };
}

/** Fixed key order, so the same view built twice is the same string. */
function query(pairs: [string, string][]) {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) if (value) params.set(key, value);
  return params.toString();
}

export function buildCompanyQuery(input: {
  filters: CompanyFilters;
  sort?: CompanySort;
  dir?: string;
}): string {
  const { filters } = input;
  const string = query([
    ["f", filters.cut ?? ""],
    ["ind", filters.industries.join(",")],
    ["size", filters.sizes.join(",")],
    ["loc", filters.locations.join(",")],
    ["tag", filters.tags.join(",")],
    ["miss", filters.missing.join(",")],
    ["q", filters.search],
    ["sort", input.sort && input.sort !== "name" ? input.sort : ""],
    ["dir", input.dir ?? ""],
  ]);
  return string ? `/crm/companies?${string}` : "/crm/companies";
}

export function buildContactQuery(input: {
  filters: ContactFilters;
  sort?: ContactSort;
  dir?: string;
}): string {
  const { filters } = input;
  const string = query([
    ["f", filters.cut ?? ""],
    ["co", filters.companies.join(",")],
    ["tag", filters.tags.join(",")],
    ["qd", filters.quiet ? String(filters.quiet) : ""],
    ["miss", filters.missing.join(",")],
    ["q", filters.search],
    ["sort", input.sort && input.sort !== "name" ? input.sort : ""],
    ["dir", input.dir ?? ""],
  ]);
  return string ? `/crm/contacts?${string}` : "/crm/contacts";
}

export const parseCompanySort = (value: string | undefined): CompanySort =>
  oneOf(value, COMPANY_SORTS) ?? "name";

export const parseContactSort = (value: string | undefined): ContactSort =>
  oneOf(value, CONTACT_SORTS) ?? "name";

/** Name reads forwards; every other column is most-first until flipped. */
export const companyDesc = (sort: CompanySort, dir: string | undefined) =>
  dir ? dir === "desc" : sort !== "name";

export const contactDesc = (sort: ContactSort, dir: string | undefined) =>
  dir ? dir === "desc" : sort === "touch";

/** Toggle one id in a dimension, for building the next-state link. */
export const toggleIn = (values: string[], id: string) =>
  values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export function sortCompanies<T extends FilterableCompany>(
  rows: T[],
  sort: CompanySort,
  desc: boolean,
): T[] {
  return [...rows].sort((a, b) => {
    let order = 0;
    if (sort === "name") order = a.name.localeCompare(b.name);
    if (sort === "apps") order = a._count.applications - b._count.applications;
    if (sort === "people") order = a._count.contacts - b._count.contacts;
    if (sort === "applied") {
      // Companies never applied to sort together at the end, whatever the
      // direction — "sort by last applied" is a question about the others.
      if (!a.lastAppliedAt && !b.lastAppliedAt) return a.name.localeCompare(b.name);
      if (!a.lastAppliedAt) return 1;
      if (!b.lastAppliedAt) return -1;
      order = a.lastAppliedAt.getTime() - b.lastAppliedAt.getTime();
    }
    return (desc ? -order : order) || a.name.localeCompare(b.name);
  });
}

export function sortContacts<T extends FilterableContact>(
  rows: T[],
  sort: ContactSort,
  desc: boolean,
  now = Date.now(),
): T[] {
  return [...rows].sort((a, b) => {
    let order = 0;
    if (sort === "name") order = a.name.localeCompare(b.name);
    if (sort === "touch") order = contactQuietDays(a, now) - contactQuietDays(b, now);
    if (sort === "company") {
      // Same rule as "last applied": people with nobody on file sort last
      // whichever way the column points.
      const left = a.companies[0]?.name ?? "";
      const right = b.companies[0]?.name ?? "";
      if (!left && !right) return a.name.localeCompare(b.name);
      if (!left) return 1;
      if (!right) return -1;
      order = left.localeCompare(right);
    }
    if (sort === "ping") {
      if (!a.nextFollowUpAt && !b.nextFollowUpAt) return a.name.localeCompare(b.name);
      if (!a.nextFollowUpAt) return 1;
      if (!b.nextFollowUpAt) return -1;
      order = a.nextFollowUpAt.getTime() - b.nextFollowUpAt.getTime();
    }
    return (desc ? -order : order) || a.name.localeCompare(b.name);
  });
}
