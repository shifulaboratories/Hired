import { ActivityType, Prisma, Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { pick } from "@/lib/data/patch";
import { DAY, hasGoneQuiet, lastTouchAt, quietDaysFor } from "@/lib/quiet";
import { readQuickLog } from "@/lib/quick-log";
import {
  TagKind,
  type TagRef,
  assertOwnedTagIds,
  flattenTags,
  resolveTagIds,
  tagInclude,
} from "@/lib/data/tags";
import { archiveRecords } from "@/lib/data/archive";
import { timeZoneOf } from "@/lib/data/me";
import { atHourInDays, civilDay, endOfDay, instantAt, startOfWeek } from "@/lib/time";
import {
  type CompanyFilters,
  type CompanyMissing,
  type CompanySort,
  type ContactFilters,
  type ContactMissing,
  type ContactSort,
  EMPTY_COMPANY_FILTERS,
  EMPTY_CONTACT_FILTERS,
  companyDesc,
  contactDesc,
  matchesCompany,
  matchesContact,
  sortCompanies,
  sortContacts,
} from "@/lib/crm-filters";
import { loadPosting, type ParsedPosting } from "@/lib/posting";

/** Like me.ts: userId is the required first argument on every query. */

export const STAGES: Stage[] = [
  "WISHLIST",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "FINAL",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "GHOSTED",
];

/** Stages shown as columns on the board. Terminal states get their own view. */
export const BOARD_STAGES: Stage[] = [
  "WISHLIST",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "FINAL",
  "OFFER",
];

export const STAGE_LABEL: Record<Stage, string> = {
  WISHLIST: "Wishlist",
  APPLIED: "Applied",
  SCREEN: "Screening",
  INTERVIEW: "Interviewing",
  FINAL: "Final round",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  GHOSTED: "Ghosted",
};

/**
 * A stage is a position on one path, not a category, so the hue rotates in one
 * direction as an application advances — steel, blue, violet, pink, then gold
 * at the offer. Turning one way is what keeps it a path: you can tell "further
 * along" from two chips without knowing which label is which.
 *
 * The three endings sit outside the rotation because they mean something other
 * than progress. Values are CSS variables so they follow the theme; a fixed
 * colour tuned for one mode goes muddy in the other.
 */
export const STAGE_TONE: Record<Stage, string> = {
  WISHLIST: "var(--stage-wishlist)",
  APPLIED: "var(--stage-applied)",
  SCREEN: "var(--stage-screen)",
  INTERVIEW: "var(--stage-interview)",
  FINAL: "var(--stage-final)",
  OFFER: "var(--stage-offer)",
  ACCEPTED: "var(--stage-accepted)",
  REJECTED: "var(--stage-rejected)",
  WITHDRAWN: "var(--stage-withdrawn)",
  GHOSTED: "var(--stage-ghosted)",
};

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  NOTE: "Note",
  STAGE_CHANGE: "Stage change",
  EMAIL_SENT: "Email sent",
  EMAIL_RECEIVED: "Email received",
  CALL: "Call",
  INTERVIEW: "Interview",
  FOLLOW_UP: "Follow-up",
  APPLIED: "Applied",
  OFFER: "Offer",
  REJECTION: "Rejection",
  REFERRAL: "Referral",
  OUTREACH: "Outreach",
};

/**
 * The kinds of touch a person logs by hand, in the order a picker should
 * offer them. The rest of ActivityType is written by the system — a stage
 * change, an application — and offering those invites a timeline that
 * disagrees with the board.
 */
export const ACTIVITY_OPTIONS: ActivityType[] = [
  "NOTE",
  "OUTREACH",
  "EMAIL_SENT",
  "EMAIL_RECEIVED",
  "CALL",
  "INTERVIEW",
  "FOLLOW_UP",
  "REFERRAL",
];

export const TERMINAL_STAGES: Stage[] = ["ACCEPTED", "REJECTED", "WITHDRAWN", "GHOSTED"];

/**
 * The endings where someone else decided, or nobody did. Used by the funnel:
 * a rejection is a decision against you and a ghosting is the absence of one,
 * and telling them apart is the difference between "my resume is not landing"
 * and "I am not following up".
 */
export const NO_ANSWER_STAGES: Stage[] = ["GHOSTED"];

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

/**
 * How many applications and people a company has — LIVE ones.
 *
 * Shared by listCompanies, readCompany and the merge survivor read, so the
 * filter belongs here rather than at three call sites. `contacts` is a
 * `ContactCompany[]` join, not `Contact[]`, so its predicate has to reach
 * through the link to the person.
 */
const companyCounts = {
  _count: {
    select: {
      applications: { where: { archivedAt: null } },
      contacts: { where: { contact: { archivedAt: null } } },
    },
  },
} satisfies Prisma.CompanyInclude;

export type CompanyInput = {
  name: string;
  website?: string;
  notes?: string;
  /**
   * The four tag sets a company wears. Names or ids; ids win. Each REPLACES
   * its own set and leaves the other three alone, so setting an industry does
   * not clear where the company is.
   */
  industry?: string[];
  industryIds?: string[];
  size?: string[];
  sizeIds?: string[];
  location?: string[];
  locationIds?: string[];
  tags?: string[];
  tagIds?: string[];
};

/** Which kind each of a company's four tag sets holds. */
const COMPANY_TAG_FIELDS = [
  ["industry", "industryIds", TagKind.INDUSTRY],
  ["size", "sizeIds", TagKind.SIZE],
  ["location", "locationIds", TagKind.LOCATION],
  ["tags", "tagIds", TagKind.COMPANY],
] as const;

/**
 * Write whichever of a company's four tag sets the patch mentions.
 *
 * One set at a time, and only the kind being replaced is cleared: all four
 * share one join table, so a blanket delete would take the other three with
 * it. A set the patch is silent about is left exactly as it is.
 */
async function writeCompanyTags(userId: string, companyId: string, patch: Partial<CompanyInput>) {
  for (const [names, ids, kind] of COMPANY_TAG_FIELDS) {
    const resolved = await resolveTagIds(userId, kind, {
      tagIds: patch[ids],
      tags: patch[names],
    });
    if (resolved === undefined) continue;
    await db.companyTag.deleteMany({ where: { companyId, tag: { kind, userId } } });
    if (resolved.length > 0) {
      await db.companyTag.createMany({
        data: resolved.map((tagId) => ({ companyId, tagId })),
        skipDuplicates: true,
      });
    }
  }
}

/** Columns a caller may write. Anything else in the patch is dropped. */
const COMPANY_COLUMNS = ["name", "website", "notes"] as const;
const CONTACT_COLUMNS = [
  "name",
  "title",
  "email",
  "phone",
  "linkedin",
  "twitter",
  "instagram",
  "github",
  "website",
  "relationship",
  "notes",
] as const;

/** Cuts of the company list that keep coming up as questions. */
/** The cut list lives in crm-filters.ts, so there is one of it. */
export type { CompanyCut as CompanyFilter } from "@/lib/crm-filters";

/**
 * Every company, cut and ordered.
 *
 * The filtering happens in `matchesCompany` over the rows this fetches rather
 * than in the Prisma `where`, and that is deliberate: a faceted count is "how
 * many would survive if I relaxed this one dimension", which needs the
 * unfiltered set in hand. Doing it in SQL for the list and again in a predicate
 * for the counts would be two definitions of one rule — the fork invariant 2
 * exists to prevent. It costs one full read of a personal-sized table.
 */
export async function listCompanies(
  userId: string,
  options?: {
    search?: string;
    filter?: CompanyFilters["cut"];
    tagIds?: string[];
    industryIds?: string[];
    sizeIds?: string[];
    locationIds?: string[];
    missing?: CompanyMissing[];
    sort?: CompanySort;
    dir?: "asc" | "desc";
  },
) {
  const where: Prisma.CompanyWhereInput = { userId, archivedAt: null };

  const rows = await db.company.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      ...companyCounts,
      ...tagInclude,
      // Plumbing for the two derived fields below, not part of the result.
      applications: { where: { archivedAt: null }, select: { appliedAt: true, stage: true } },
    },
  });
  // "When did I last apply here" and "is anything still live" are the two
  // questions a company list gets asked; answer them on every row rather than
  // making callers fetch each company.
  const mapped = rows.map(({ applications, ...company }) => ({
    ...flattenTags(company),
    lastAppliedAt: applications.reduce<Date | null>(
      (latest, application) =>
        application.appliedAt && (!latest || application.appliedAt > latest)
          ? application.appliedAt
          : latest,
      null,
    ),
    openApplications: applications.filter(
      (application) => !TERMINAL_STAGES.includes(application.stage),
    ).length,
  }));

  const filters: CompanyFilters = {
    ...EMPTY_COMPANY_FILTERS,
    cut: options?.filter ?? null,
    industries: options?.industryIds ?? [],
    sizes: options?.sizeIds ?? [],
    locations: options?.locationIds ?? [],
    tags: options?.tagIds ?? [],
    missing: options?.missing ?? [],
    search: options?.search ?? "",
  };
  const sort = options?.sort ?? "name";
  return sortCompanies(
    mapped.filter((company) => matchesCompany(company, filters)),
    sort,
    companyDesc(sort, options?.dir),
  );
}

export async function getCompany(userId: string, id: string) {
  const company = await db.company.findFirst({
    where: { id, userId, archivedAt: null },
    include: {
      applications: {
        where: { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          roleTitle: true,
          stage: true,
          location: true,
          workMode: true,
          salaryRange: true,
          jobUrl: true,
          tags: { include: { tag: true }, orderBy: { tag: { name: "asc" as const } } },
          appliedAt: true,
          nextFollowUpAt: true,
          updatedAt: true,
        },
      },
      contacts: {
        where: { contact: { archivedAt: null } },
        orderBy: { createdAt: "asc" },
        include: { contact: true },
      },
      ...tagInclude,
    },
  });
  if (!company) return null;
  return {
    ...flattenTags(company),
    applications: company.applications.map(flattenTags),
    // Callers want the people, not the rows that link them here.
    contacts: company.contacts.map((link) => link.contact),
  };
}

/** One company as every writer hands it back: counts, and flat tags. */
async function readCompany(userId: string, id: string) {
  const company = await db.company.findFirstOrThrow({
    where: { id, userId, archivedAt: null },
    include: { ...companyCounts, ...tagInclude },
  });
  return flattenTags(company);
}

export async function createCompany(userId: string, input: CompanyInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A company needs a name");
  // Only a LIVE company clashes. One in the archive keeps its name out of the
  // way through archiveKey, which is what lets you track a new job at a company
  // you deleted last month.
  const existing = await db.company.findFirst({ where: { userId, name, archivedAt: null } });
  if (existing) throw new Error(`You already have a company called "${name}"`);
  const company = await db.company.create({
    data: { userId, ...pick({ ...input, name }, COMPANY_COLUMNS) },
  });
  await writeCompanyTags(userId, company.id, input);
  return readCompany(userId, company.id);
}

export async function updateCompany(userId: string, id: string, patch: Partial<CompanyInput>) {
  // Read first rather than leaning on updateMany's count: a patch that only
  // moves tags has no columns in it, and an empty update reports nothing
  // changed — which used to come back as "no company with id".
  const current = await db.company.findFirst({ where: { id, userId } });
  if (!current) throw new Error(`No company with id ${id}`);
  // A stale id in an assistant's hand must not quietly edit something the
  // person has deleted.
  if (current.archivedAt) {
    throw new Error(`"${current.name}" is in the archive. Restore it before changing it.`);
  }

  const data = pick(patch, COMPANY_COLUMNS);
  if (data.name !== undefined) {
    data.name = data.name.trim();
    if (!data.name) throw new Error("A company needs a name");
    const clash = await db.company.findFirst({
      where: { userId, name: data.name, id: { not: id }, archivedAt: null },
    });
    if (clash) throw new Error(`You already have a company called "${data.name}"`);
  }
  if (Object.keys(data).length > 0) await db.company.update({ where: { id }, data });
  await writeCompanyTags(userId, id, patch);
  return readCompany(userId, id);
}

/**
 * Refuses while applications point here, and unlinks the people who represent it.
 *
 * It no longer refuses while applications point here, and it no longer needs
 * to. That guard existed because `Application.company` is `onDelete: Cascade`
 * at the database level, so destroying a company would have taken its
 * applications and their whole history with it. Nothing is destroyed here now:
 * the company and its live applications go into the archive together, marked
 * so a restore brings back exactly those and leaves an application the person
 * binned separately where they put it. The cascade danger has moved to
 * deleteArchived and the purge, which is where the guard now lives.
 *
 * The people are NOT archived with it. Somebody is a founder at one company
 * and an advisor at another, which is what ContactCompany exists for; they keep
 * every other company and simply lose this one. To fold a duplicate employer
 * away without archiving anything, use mergeCompanies.
 */
export async function deleteCompany(userId: string, id: string) {
  const { archived, skipped } = await archiveRecords(userId, "company", [id]);
  if (archived.length === 0) throw new Error(skipped[0]?.reason ?? `No company with id ${id}`);
  return { id, name: archived[0].title, archived: true, withIt: archived[0].withIt };
}

/**
 * Folding a duplicate employer into the one you are keeping.
 *
 * "Stripe", "Stripe, Inc." and "stripe" all end up on file — an application
 * created one, a capture created another, and a typo created the third. The
 * applications are spread across them, so the company page tells you a half
 * truth wherever you look.
 *
 * The rules, in order of how much they matter:
 *
 *   1. Nothing is deleted except the duplicate's own row. Applications and
 *      contacts move; none is dropped, and none is de-duplicated — two
 *      identical role titles on the survivor is the correct outcome, because
 *      the alternative is guessing which of two records to destroy.
 *   2. Notes are never lost. The survivor's notes win their position and the
 *      duplicate's are appended under a line saying where they came from.
 *   3. Blanks are filled, values are never overwritten. The duplicate usually
 *      holds the website (it was auto-created from a posting) while the record
 *      you kept holds the research, or the other way round.
 *   4. The survivor's NAME is never taken from the duplicate. Which name lives
 *      is the direction of the merge; renaming afterwards is a separate act.
 *
 * The transaction is not a nicety. `Application.company` is `onDelete: Cascade`,
 * so the delete has to come after the re-pointing, and a failure in between
 * would leave the pipeline split across two companies — the exact state being
 * repaired, but now half-done.
 */

/** Scalars a merge may fill in on the survivor. `name` is deliberately absent. */
/**
 * The only column left worth filling from a duplicate. Industry, size and
 * location used to be here; they are tags now and merge as a union instead,
 * which is strictly better — a duplicate can contribute a location even when
 * the survivor already has one.
 */
const MERGE_FILL_COLUMNS = ["website"] as const;

export type CompanyMergePlan = {
  keep: { id: string; name: string };
  merge: { id: string; name: string };
  /** How many rows change owner. */
  applications: number;
  contacts: number;
  /** Tags the survivor gains — industry, size, location and the rest. */
  tags: number;
  /** Which blank fields on the survivor get filled, and with what. */
  fills: { field: string; value: string }[];
  /** Whether the duplicate's notes will be appended to the survivor's. */
  notesAppended: boolean;
  /** Role titles that move, for a confirmation that is not a blind click. */
  movingRoles: string[];
};

async function planCompanyMerge(userId: string, keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new Error("Those are the same company.");
  const [keep, merge] = await Promise.all([
    db.company.findFirst({
      where: { id: keepId, userId, archivedAt: null },
      include: {
        applications: { where: { archivedAt: null }, select: { roleTitle: true } },
        contacts: { where: { contact: { archivedAt: null } }, select: { contactId: true } },
        tags: { select: { tagId: true } },
      },
    }),
    db.company.findFirst({
      where: { id: mergeId, userId, archivedAt: null },
      include: {
        applications: { where: { archivedAt: null }, select: { roleTitle: true } },
        contacts: { where: { contact: { archivedAt: null } }, select: { contactId: true } },
        tags: { select: { tagId: true } },
      },
    }),
  ]);
  if (!keep) throw new Error(`No company with id ${keepId}`);
  if (!merge) throw new Error(`No company with id ${mergeId}`);

  const fills = MERGE_FILL_COLUMNS.flatMap((field) =>
    !keep[field].trim() && merge[field].trim() ? [{ field, value: merge[field] }] : [],
  );
  // Skipped when the survivor already carries them — merging the same pair
  // twice (a name recreated by upsertCompanyByName, then merged again) must
  // not double the text.
  const loserNotes = merge.notes.trim();
  const notesAppended = Boolean(loserNotes) && !keep.notes.includes(loserNotes);

  // Someone can already represent both, and that link is dropped rather than
  // moved — the pair is the join's primary key — so it is not a person the
  // survivor gains.
  // Tags are a set, so the survivor ends up wearing the union — the duplicate's
  // industry and location are exactly the kind of thing worth keeping.
  const keptTags = new Set(keep.tags.map((link) => link.tagId));
  const movingTags = merge.tags.filter((link) => !keptTags.has(link.tagId));

  const alreadyKept = new Set(keep.contacts.map((link) => link.contactId));
  const movingContacts = merge.contacts.filter((link) => !alreadyKept.has(link.contactId));

  const plan: CompanyMergePlan = {
    keep: { id: keep.id, name: keep.name },
    merge: { id: merge.id, name: merge.name },
    applications: merge.applications.length,
    contacts: movingContacts.length,
    tags: movingTags.length,
    fills,
    notesAppended,
    movingRoles: merge.applications.map((application) => application.roleTitle),
  };
  return { plan, keep, merge, loserNotes };
}

/** What a merge would do, without doing any of it. */
export async function previewCompanyMerge(
  userId: string,
  keepId: string,
  mergeId: string,
): Promise<CompanyMergePlan> {
  const { plan } = await planCompanyMerge(userId, keepId, mergeId);
  return plan;
}

export async function mergeCompanies(userId: string, keepId: string, mergeId: string) {
  const { plan, keep, loserNotes } = await planCompanyMerge(userId, keepId, mergeId);

  const notes = !keep.notes.trim()
    ? loserNotes
    : plan.notesAppended
      ? `${keep.notes}\n\n— merged from "${plan.merge.name}" on ${civilDay(new Date(), await timeZoneOf(userId))} —\n${loserNotes}`
      : keep.notes;

  await db.$transaction(async (tx) => {
    // Re-point first. The delete at the end cascades to applications, so
    // anything still pointing at the duplicate when it goes is destroyed.
    await tx.application.updateMany({
      where: { companyId: mergeId, userId },
      data: { companyId: keepId },
    });
    // Drop the duplicate's link for anyone already at the survivor, then move
    // the rest: (contactId, companyId) is the primary key, so re-pointing both
    // would collide.
    await tx.contactCompany.deleteMany({
      where: {
        companyId: mergeId,
        contact: { userId, companies: { some: { companyId: keepId } } },
      },
    });
    await tx.contactCompany.updateMany({
      where: { companyId: mergeId, contact: { userId } },
      data: { companyId: keepId },
    });
    // The survivor wears the union of both tag sets: an industry or a location
    // recorded on only one of a duplicated pair is worth keeping.
    await tx.companyTag.deleteMany({
      where: {
        companyId: mergeId,
        tag: { userId },
        tagId: { in: keep.tags.map((link) => link.tagId) },
      },
    });
    await tx.companyTag.updateMany({
      where: { companyId: mergeId, tag: { userId } },
      data: { companyId: keepId },
    });
    await tx.company.update({
      where: { id: keepId },
      data: {
        ...Object.fromEntries(plan.fills.map((fill) => [fill.field, fill.value])),
        ...(notes === keep.notes ? {} : { notes }),
      },
    });
    // Ownership was established by planCompanyMerge's userId-filtered reads.
    await tx.company.delete({ where: { id: mergeId } });
  });

  const survivor = await db.company.findFirstOrThrow({
    where: { id: keepId, userId, archivedAt: null },
    include: companyCounts,
  });
  return { ...survivor, merged: plan };
}

export async function upsertCompanyByName(
  userId: string,
  name: string,
  extra?: Partial<{ website: string; notes: string }>,
) {
  const clean = name.trim();
  // The last line of defence against a half-typed name becoming a company.
  // Callers reach here from an autosave, a tool argument and a posting parse,
  // and a Company row named "" is unreachable, unnameable and permanent.
  if (!clean) throw new Error("A company needs a name");
  // `archiveKey: ""` is the whole point of the compound key: this only ever
  // matches a LIVE company. Tracking a job at Stripe a month after you deleted
  // Stripe gives you a new Stripe, rather than silently resurrecting the old
  // one and every application that went into the archive with it. Restoring
  // the archived one afterwards is refused by name and points at
  // merge_companies, which is the tool for deciding what the one record says.
  return db.company.upsert({
    where: { userId_name_archiveKey: { userId, name: clean, archiveKey: "" } },
    create: { userId, name: clean, ...extra },
    update: extra ?? {},
  });
}

/** A company as a contact's callers want it: the row, not the link to it. */
export type CompanyRef = { id: string; name: string; website: string };

/**
 * The join rows a caller never wants to see, flattened. Spelled out with Omit
 * for the same reason flattenTags is: a spread over a generic keeps the
 * original `companies` in the resulting type.
 */
/**
 * A contact's two join sets, flattened where they are read.
 *
 * Written at each call site rather than as one generic helper: a generic whose
 * constraint names both join shapes collapses to that constraint when the
 * argument is Prisma's intersection type, and every other field on a contact
 * silently disappears from the result type while the value stays right.
 */
const contactShape = <T extends { companies: { company: CompanyRef }[]; tags: { tag: TagRef }[] }>(
  row: T,
) => ({
  companies: row.companies.map((link) => link.company),
  tags: row.tags.map((link) => link.tag),
});

function flattenCompanies<T extends { companies: { company: CompanyRef }[] }>(
  row: T,
): Omit<T, "companies"> & { companies: CompanyRef[] } {
  return { ...row, companies: row.companies.map((link) => link.company) };
}

/**
 * Names and ids in, ids out — the set a person represents, in the order given.
 *
 * Ids are re-checked against this user because the join table carries no
 * userId of its own; names go through upsertCompanyByName, so "she also
 * advises Vercel" links the Vercel already on file rather than a second one.
 * Returns undefined when the caller said nothing about companies, which is how
 * updateContact tells "leave them alone" from "detach every one".
 */
async function resolveCompanyIds(
  userId: string,
  input: { companyIds?: string[]; companies?: string[]; company?: string },
): Promise<string[] | undefined> {
  if (input.companyIds !== undefined) {
    if (input.companyIds.length === 0) return [];
    const owned = await db.company.findMany({
      where: { id: { in: input.companyIds }, userId, archivedAt: null },
      select: { id: true },
    });
    const found = new Set(owned.map((row) => row.id));
    const missing = input.companyIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw new Error(`No company with id ${missing[0]}`);
    return [...new Set(input.companyIds)];
  }

  const names =
    input.companies !== undefined
      ? input.companies
      : input.company !== undefined
        ? [input.company]
        : undefined;
  if (names === undefined) return undefined;

  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const company = await upsertCompanyByName(userId, name);
    if (!ids.includes(company.id)) ids.push(company.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export type ApplicationInput = {
  company: string;
  /** The company's own site. Drives the logo; nothing else depends on it. */
  companyWebsite?: string;
  roleTitle: string;
  stage?: Stage;
  jobUrl?: string;
  jobDescription?: string;
  location?: string;
  workMode?: string;
  salaryRange?: string;
  /** Tag ids, when you already have them. Wins over `tags`. */
  tagIds?: string[];
  /** Tag names — resolved against what exists, created only when nothing matches. */
  tags?: string[];
  /** Legacy spellings from when these were called sources. Lowest precedence. */
  sourceIds?: string[];
  sources?: string[];
  source?: string;
  notes?: string;
  appliedAt?: Date | string | null;
  nextFollowUpAt?: Date | string | null;
  resumeId?: string | null;
};

/**
 * Tags used to be called sources, and `sources` on an application is a spelling
 * plenty of saved prompts and scripts still use. One translation here rather
 * than a second code path: the new names win, the old ones still work.
 */
function tagArgs(input: {
  tagIds?: string[];
  tags?: string[];
  tag?: string;
  sourceIds?: string[];
  sources?: string[];
  source?: string;
}) {
  return {
    tagIds: input.tagIds ?? input.sourceIds,
    tags: input.tags ?? input.sources,
    tag: input.tag ?? input.source,
  };
}

const applicationTagInclude = {
  tags: { include: { tag: true }, orderBy: { tag: { name: "asc" as const } } },
} satisfies Prisma.ApplicationInclude;

const applicationInclude = {
  company: true,
  ...applicationTagInclude,
  resume: { select: { id: true, name: true } },
  _count: {
    select: { activities: true, tasks: true, contacts: { where: { archivedAt: null } } },
  },
  // The moment this application last changed stage, for "how long has it been
  // sitting there". updatedAt is not that date — editing a note bumps it — and
  // "waiting 40 days" is only worth printing if it is true.
  activities: {
    where: { toStage: { not: null } },
    orderBy: { occurredAt: "desc" as const },
    take: 1,
    select: { occurredAt: true },
  },
} satisfies Prisma.ApplicationInclude;

/**
 * When each of these applications last had anything happen to it, in one
 * query rather than one per card. Postgres answers it off the existing
 * (applicationId, occurredAt) index.
 */
async function lastActivityByApplication(userId: string, ids: string[]) {
  const found = new Map<string, Date>();
  if (ids.length === 0) return found;
  const rows = await db.activity.groupBy({
    by: ["applicationId"],
    where: { userId, applicationId: { in: ids } },
    _max: { occurredAt: true },
  });
  for (const row of rows) {
    if (row.applicationId && row._max.occurredAt) found.set(row.applicationId, row._max.occurredAt);
  }
  return found;
}

export async function listApplications(
  userId: string,
  options?: { stage?: Stage; includeClosed?: boolean; search?: string; quietForDays?: number },
) {
  const where: Prisma.ApplicationWhereInput = { userId, archivedAt: null };
  if (options?.stage) where.stage = options.stage;
  else if (!options?.includeClosed) where.stage = { notIn: TERMINAL_STAGES };
  if (options?.search) {
    where.OR = [
      { roleTitle: { contains: options.search, mode: "insensitive" } },
      { company: { name: { contains: options.search, mode: "insensitive" } } },
      { notes: { contains: options.search, mode: "insensitive" } },
    ];
  }
  const rows = await db.application.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    include: applicationInclude,
  });
  // The take-1 transition row is plumbing for the dates below, not something a
  // caller — or an assistant reading a tool result — should have to interpret.
  const touched = await lastActivityByApplication(userId, rows.map((row) => row.id));
  const now = new Date();
  const mapped = rows.map(({ activities, ...application }) => {
    const since = activities[0]?.occurredAt ?? application.createdAt;
    const subject = {
      stage: application.stage,
      createdAt: application.createdAt,
      appliedAt: application.appliedAt,
      lastActivityAt: touched.get(application.id) ?? null,
      lastStageChangeAt: activities[0]?.occurredAt ?? null,
    };
    return {
      ...flattenTags(application),
      stageSince: since,
      daysInStage: Math.floor((now.getTime() - since.getTime()) / DAY),
      // Two questions, and confusing them is why the board could answer
      // neither: daysInStage is how long it has sat where it is, quietDays is
      // how long since ANYTHING happened. A logged call resets the second and
      // leaves the first alone.
      lastTouchAt: lastTouchAt(subject),
      quietDays: quietDaysFor(subject, now),
    };
  });
  // Filtered here rather than in the query: the number is computed, so
  // Postgres cannot answer it without the same read.
  return options?.quietForDays === undefined
    ? mapped
    : mapped.filter((row) => row.quietDays >= options.quietForDays!);
}

export async function getApplication(userId: string, id: string) {
  const application = await db.application.findFirst({
    // Archived reads as gone here too, not just in the lists. The archive
    // screen is the one place a deleted record exists, and a detail page that
    // half-renders something you deleted is worse than a clean not-found.
    where: { id, userId, archivedAt: null },
    include: {
      company: true,
      ...applicationTagInclude,
      resume: { select: { id: true, name: true } },
      activities: { orderBy: { occurredAt: "desc" } },
      contacts: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
      tasks: { orderBy: [{ done: "asc" }, { dueAt: "asc" }] },
    },
  });
  if (!application) return null;
  // The timeline is already here in full, newest first, so the same two dates
  // the list computes cost nothing extra here.
  const subject = {
    stage: application.stage,
    createdAt: application.createdAt,
    appliedAt: application.appliedAt,
    lastActivityAt: application.activities[0]?.occurredAt ?? null,
    lastStageChangeAt:
      application.activities.find((activity) => activity.toStage !== null)?.occurredAt ?? null,
  };
  return {
    ...flattenTags(application),
    lastTouchAt: lastTouchAt(subject),
    quietDays: quietDaysFor(subject, new Date()),
  };
}

/**
 * Links a person is reachable at: trimmed, blanks dropped, deduped. Same rule
 * as sources below, and for the same reason — a form that submits an empty row
 * should not persist one.
 */
function cleanLinks(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}


/**
 * A date argument, as an instant.
 *
 * A bare "2026-03-14" is a CIVIL date — somebody picked a day off a calendar,
 * or an assistant repeated one back — and `new Date` reads it as UTC midnight,
 * which is the 13th for everyone west of Greenwich. It lands at 9am in their
 * own zone instead: the same hour every date this app sets itself uses, so a
 * follow-up picked by hand behaves exactly like one the app worked out. Values
 * that already carry a time are instants and pass through untouched.
 */
function toDate(
  timeZone: string,
  value: Date | string | null | undefined,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "string") {
    const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (civil) {
      return instantAt(timeZone, Number(civil[1]), Number(civil[2]), Number(civil[3]), 9);
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * One end of a date window.
 *
 * A bare "2026-03-14" means that whole day where the reader is, so the day at
 * either end of a window is included rather than half of it. Anything already
 * carrying a time is an instant and is taken as given — which is how the
 * calendar screen passes the exact grid it drew.
 */
function windowEdge(timeZone: string, value: Date | string, edge: "start" | "end"): Date {
  if (typeof value === "string") {
    const civil = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (civil) {
      const [, year, month, day] = civil.map(Number) as unknown as [number, number, number, number];
      return edge === "end"
        ? instantAt(timeZone, year, month, day, 23, 59, 59, 999)
        : instantAt(timeZone, year, month, day, 0, 0, 0, 0);
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** A resume may only be attached if the same user owns it. */
async function assertOwnsResume(userId: string, resumeId: string) {
  const resume = await db.resume.findFirst({ where: { id: resumeId, userId } });
  if (!resume) throw new Error(`No resume with id ${resumeId}`);
}

/**
 * The location and work-mode values already on this person's applications.
 *
 * Both are free text and always will be — "Remote (US, PST overlap)" is a real
 * answer and no enum survives it. What free text costs is consistency: three
 * spellings of Remote, none of which filter or group together. So the field
 * offers what you have used before, with a count each, and typing something new
 * is still just typing.
 *
 * Case-insensitive on the way in, first spelling wins on the way out: "remote"
 * typed after "Remote" folds into the one already on file rather than adding a
 * near-duplicate to the list. Archived applications do not vote — a value only
 * they carry is not a value you use.
 */
export async function applicationFieldValues(
  userId: string,
): Promise<{ location: { value: string; count: number }[]; workMode: { value: string; count: number }[] }> {
  const rows = await db.application.findMany({
    where: { userId, archivedAt: null },
    select: { location: true, workMode: true },
  });

  const tally = (pick: (row: (typeof rows)[number]) => string) => {
    const seen = new Map<string, { value: string; count: number }>();
    for (const row of rows) {
      const value = pick(row).trim();
      if (!value) continue;
      const key = value.toLowerCase();
      const existing = seen.get(key);
      if (existing) existing.count += 1;
      else seen.set(key, { value, count: 1 });
    }
    return [...seen.values()].sort(
      (a, b) => b.count - a.count || a.value.localeCompare(b.value),
    );
  };

  return { location: tally((row) => row.location), workMode: tally((row) => row.workMode) };
}

export async function createApplication(userId: string, input: ApplicationInput) {
  const company = await upsertCompanyByName(
    userId,
    input.company,
    input.companyWebsite ? { website: input.companyWebsite } : undefined,
  );
  const stage = input.stage ?? "WISHLIST";
  const zone = await timeZoneOf(userId);
  const appliedAt = toDate(zone, input.appliedAt) ?? (stage !== "WISHLIST" ? new Date() : null);
  if (input.resumeId) await assertOwnsResume(userId, input.resumeId);

  const application = await db.application.create({
    data: {
      userId,
      companyId: company.id,
      roleTitle: input.roleTitle,
      stage,
      jobUrl: input.jobUrl ?? "",
      jobDescription: input.jobDescription ?? "",
      location: input.location ?? "",
      workMode: input.workMode ?? "",
      salaryRange: input.salaryRange ?? "",
      tags: {
        create: ((await resolveTagIds(userId, TagKind.APPLICATION, tagArgs(input))) ?? []).map(
          (tagId) => ({ tagId }),
        ),
      },
      notes: input.notes ?? "",
      appliedAt,
      nextFollowUpAt: toDate(zone, input.nextFollowUpAt) ?? defaultFollowUp(zone, stage),
      resumeId: input.resumeId ?? null,
    },
    include: applicationInclude,
  });

  await db.activity.create({
    data: {
      userId,
      applicationId: application.id,
      type: stage === "WISHLIST" ? "NOTE" : "APPLIED",
      body: stage === "WISHLIST" ? "Added to wishlist." : `Applied for ${input.roleTitle}.`,
    },
  });

  return flattenTags(application);
}

export type CaptureResult =
  | { captured: true; application: Awaited<ReturnType<typeof createApplication>>; parsed: ParsedPosting }
  | { captured: false; parsed: ParsedPosting; reason: string };

/**
 * One move from a posting URL to a tracked application: fetch the page, read
 * the JobPosting data most boards embed, match or create the company, and
 * create the application on the wishlist with the description filled.
 *
 * When the page doesn't say who the employer is or what the role is called,
 * nothing is created — whatever WAS readable comes back so the caller can
 * complete it and create the application deliberately. Guessing an employer's
 * name from a URL is how a pipeline fills with companies that don't exist.
 */
export async function captureJobPosting(userId: string, url: string): Promise<CaptureResult> {
  const parsed = await loadPosting(url);

  if (!parsed.roleTitle || !parsed.company) {
    const missing = [
      !parsed.roleTitle ? "the role title" : null,
      !parsed.company ? "the employer" : null,
    ]
      .filter(Boolean)
      .join(" or ");
    return {
      captured: false,
      parsed,
      reason: `The page didn't state ${missing} in a readable way. Nothing was created.`,
    };
  }

  const application = await createApplication(userId, {
    company: parsed.company,
    companyWebsite: parsed.companyWebsite || undefined,
    roleTitle: parsed.roleTitle,
    stage: "WISHLIST",
    jobUrl: url.trim(),
    jobDescription: parsed.jobDescription,
    location: parsed.location,
    workMode: parsed.workMode,
    salaryRange: parsed.salaryRange,
    // The parser's spelling resolves against what exists before creating, so
    // a capture cannot mint "LinkedIn Jobs" beside an existing "LinkedIn"
    // unless the parser genuinely says something new.
    sources: parsed.source ? [parsed.source] : [],
  });
  return { captured: true, application, parsed };
}

export async function updateApplication(
  userId: string,
  id: string,
  patch: Partial<ApplicationInput> & { sortOrder?: number },
) {
  const current = await db.application.findFirst({ where: { id, userId } });
  if (!current) throw new Error(`No application with id ${id}`);
  if (current.archivedAt) {
    throw new Error(`"${current.roleTitle}" is in the archive. Restore it before changing it.`);
  }

  const zone = await timeZoneOf(userId);
  const data: Prisma.ApplicationUpdateInput = {};
  if (patch.roleTitle !== undefined) data.roleTitle = patch.roleTitle;
  if (patch.jobUrl !== undefined) data.jobUrl = patch.jobUrl;
  if (patch.jobDescription !== undefined) data.jobDescription = patch.jobDescription;
  if (patch.location !== undefined) data.location = patch.location;
  if (patch.workMode !== undefined) data.workMode = patch.workMode;
  if (patch.salaryRange !== undefined) data.salaryRange = patch.salaryRange;
  // Replaces the whole set, like every other array in this layer.
  const tagIds = await resolveTagIds(userId, TagKind.APPLICATION, tagArgs(patch));
  if (tagIds !== undefined) {
    data.tags = { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) };
  }
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.appliedAt !== undefined) data.appliedAt = toDate(zone, patch.appliedAt);
  if (patch.nextFollowUpAt !== undefined) data.nextFollowUpAt = toDate(zone, patch.nextFollowUpAt);
  if (patch.resumeId !== undefined) {
    if (patch.resumeId) {
      await assertOwnsResume(userId, patch.resumeId);
      data.resume = { connect: { id: patch.resumeId } };
    } else {
      data.resume = { disconnect: true };
    }
  }
  // The website lives on the company, not the application. Resolved after the
  // company itself, so moving an application to a different employer and
  // setting a website in the same call writes it to the new one.
  let companyId = current.companyId;
  if (patch.company !== undefined) {
    const company = await upsertCompanyByName(userId, patch.company);
    companyId = company.id;
    data.company = { connect: { id: company.id } };
  }
  if (patch.companyWebsite !== undefined) {
    await db.company.updateMany({
      where: { id: companyId, userId },
      data: { website: patch.companyWebsite },
    });
  }
  if (patch.stage !== undefined) {
    await db.application.update({ where: { id }, data });
    return moveApplicationStage(userId, id, patch.stage);
  }
  return flattenTags(
    await db.application.update({ where: { id }, data, include: applicationInclude }),
  );
}

/** Days after entering a stage that a nudge should fire. */
const FOLLOW_UP_DAYS: Partial<Record<Stage, number>> = {
  APPLIED: 7,
  SCREEN: 4,
  INTERVIEW: 4,
  FINAL: 3,
  OFFER: 2,
};

function defaultFollowUp(timeZone: string, stage: Stage): Date | null {
  const days = FOLLOW_UP_DAYS[stage];
  if (!days) return null;
  return inDays(timeZone, days);
}

/**
 * A date N days out at 9am. The hour is the whole point: a follow-up dated
 * "now plus three days" lands mid-afternoon and reads as overdue the morning
 * you meant to do it — and nine in the MORNING means nine where the person is,
 * not nine on whatever machine the instance happens to run on.
 */
function inDays(timeZone: string, days: number): Date {
  return atHourInDays(timeZone, days, 9);
}

/**
 * Push a follow-up out. Deferral, honestly labelled: nothing is logged and
 * nothing moves, which is why logFollowUp exists beside it.
 */
export async function snoozeFollowUp(userId: string, id: string, days: number) {
  return updateApplication(userId, id, { nextFollowUpAt: inDays(await timeZoneOf(userId), days) });
}

/** The same for a person's ping. */
export async function snoozeContactFollowUp(userId: string, id: string, days: number) {
  return updateContact(userId, id, { nextFollowUpAt: inDays(await timeZoneOf(userId), days) });
}

/**
 * Chased it: writes the touch AND moves the date, in that order.
 *
 * The pair is the point. Snoozing on its own records nothing, so a chase list
 * emptied by snoozing looks identical to a chase list you actually worked —
 * and the timeline, which is what "when did I last talk to them" is answered
 * from, stays empty. This resets the quiet clock, which snoozing deliberately
 * does not, and never touches the stage: following up is not progress.
 */
export async function logFollowUp(
  userId: string,
  input: {
    applicationId?: string;
    contactId?: string;
    /** What happened. Defaults to a plain statement that you chased it. */
    body?: string;
    type?: ActivityType;
    /** When to come back to it. Defaults to a week out. */
    days?: number;
  },
) {
  if (Boolean(input.applicationId) === Boolean(input.contactId)) {
    throw new Error("Log a follow-up against exactly one thing: an application or a contact.");
  }
  const activity = await addActivity(userId, {
    applicationId: input.applicationId,
    contactId: input.contactId,
    type: input.type ?? "FOLLOW_UP",
    body: input.body?.trim() || "Followed up.",
  });
  const next = inDays(await timeZoneOf(userId), input.days ?? 7);
  const subject = input.applicationId
    ? await updateApplication(userId, input.applicationId, { nextFollowUpAt: next })
    : await updateContact(userId, input.contactId as string, { nextFollowUpAt: next });
  return { activity, nextFollowUpAt: next, subject };
}

export async function moveApplicationStage(
  userId: string,
  id: string,
  stage: Stage,
  note?: string,
) {
  const current = await db.application.findFirst({ where: { id, userId } });
  if (!current) throw new Error(`No application with id ${id}`);
  if (current.archivedAt) {
    throw new Error(`"${current.roleTitle}" is in the archive. Restore it before changing it.`);
  }

  const data: Prisma.ApplicationUpdateInput = { stage };
  if (stage !== "WISHLIST" && !current.appliedAt) data.appliedAt = new Date();
  if (TERMINAL_STAGES.includes(stage)) {
    data.closedAt = new Date();
    data.nextFollowUpAt = null;
  } else {
    data.closedAt = null;
    data.nextFollowUpAt = defaultFollowUp(await timeZoneOf(userId), stage);
  }

  const updated = flattenTags(
    await db.application.update({ where: { id }, data, include: applicationInclude }),
  );

  if (current.stage !== stage) {
    await db.activity.create({
      data: {
        userId,
        applicationId: id,
        type: stageActivityType(stage),
        body: note ?? `${STAGE_LABEL[current.stage]} → ${STAGE_LABEL[stage]}`,
        // Recorded separately from the body, which a note is allowed to replace.
        // Without these the funnel is guesswork.
        fromStage: current.stage,
        toStage: stage,
      },
    });
  }
  return updated;
}

function stageActivityType(stage: Stage): ActivityType {
  if (stage === "APPLIED") return "APPLIED";
  if (stage === "OFFER" || stage === "ACCEPTED") return "OFFER";
  if (stage === "REJECTED") return "REJECTION";
  return "STAGE_CHANGE";
}

/**
 * Move several applications to the same stage in one go.
 *
 * Loops `moveApplicationStage` rather than issuing one `updateMany`, because
 * the whole value of a stage move is the things that happen around it — the
 * timeline entry, the follow-up date, the transition row the funnel is built
 * from. An `updateMany` would be one fast query that quietly destroys the
 * history this product exists to keep.
 *
 * Ids that don't belong to the caller are skipped rather than throwing, so
 * closing out twelve dead applications doesn't fail on the one that was
 * already deleted in another tab. Returns what actually moved.
 */
export async function moveApplicationsStage(userId: string, ids: string[], stage: Stage) {
  const moved: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    try {
      await moveApplicationStage(userId, id, stage);
      moved.push(id);
    } catch {
      skipped.push(id);
    }
  }
  return { moved, skipped, stage };
}

/**
 * Add or remove tags across a selection, in one act.
 *
 * Add and remove rather than replace: a bulk write that replaces would mean
 * "tag these nine as fintech" quietly stripping the size and location off
 * every one of them. The kind allowlist is what stops an APPLICATION tag
 * landing on a company, where nothing would ever render it and no picker could
 * take it back off.
 *
 * Ids that are not this person's are skipped, the same rule
 * moveApplicationsStage follows.
 */
export async function tagCompanies(
  userId: string,
  ids: string[],
  change: { add?: string[]; remove?: string[] },
) {
  const add = await assertOwnedTagIds(userId, change.add ?? [], [
    TagKind.INDUSTRY,
    TagKind.SIZE,
    TagKind.LOCATION,
    TagKind.COMPANY,
  ]);
  const remove = await assertOwnedTagIds(userId, change.remove ?? [], [
    TagKind.INDUSTRY,
    TagKind.SIZE,
    TagKind.LOCATION,
    TagKind.COMPANY,
  ]);
  const owned = await db.company.findMany({
    where: { id: { in: [...new Set(ids)] }, userId, archivedAt: null },
    select: { id: true },
  });
  const companyIds = owned.map((row) => row.id);
  if (remove.length > 0) {
    await db.companyTag.deleteMany({
      where: { companyId: { in: companyIds }, tagId: { in: remove } },
    });
  }
  if (add.length > 0) {
    await db.companyTag.createMany({
      data: companyIds.flatMap((companyId) => add.map((tagId) => ({ companyId, tagId }))),
      skipDuplicates: true,
    });
  }
  return { changed: companyIds, skipped: ids.filter((id) => !companyIds.includes(id)) };
}

export async function tagContacts(
  userId: string,
  ids: string[],
  change: { add?: string[]; remove?: string[] },
) {
  const add = await assertOwnedTagIds(userId, change.add ?? [], [TagKind.CONTACT]);
  const remove = await assertOwnedTagIds(userId, change.remove ?? [], [TagKind.CONTACT]);
  const owned = await db.contact.findMany({
    where: { id: { in: [...new Set(ids)] }, userId, archivedAt: null },
    select: { id: true },
  });
  const contactIds = owned.map((row) => row.id);
  if (remove.length > 0) {
    await db.contactTag.deleteMany({
      where: { contactId: { in: contactIds }, tagId: { in: remove } },
    });
  }
  if (add.length > 0) {
    await db.contactTag.createMany({
      data: contactIds.flatMap((contactId) => add.map((tagId) => ({ contactId, tagId }))),
      skipDuplicates: true,
    });
  }
  return { changed: contactIds, skipped: ids.filter((id) => !contactIds.includes(id)) };
}

/**
 * Put a whole selection on the chase list for one date.
 *
 * The date is validated HERE rather than handed to `toDate`, which returns null
 * for anything it cannot read. "next Tuesday" is a plausible thing for an
 * assistant to send, and through toDate it would silently clear the ping date
 * on every person in the batch instead of failing.
 */
export async function scheduleContactPings(userId: string, ids: string[], date: string | null) {
  let when: Date | null = null;
  if (date !== null && date !== "") {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) throw new Error(`"${date}" is not a date I can read`);
    when = parsed;
  }
  const { count } = await db.contact.updateMany({
    where: { id: { in: [...new Set(ids)] }, userId, archivedAt: null },
    data: { nextFollowUpAt: when },
  });
  return { changed: count, cleared: when === null };
}

/** Into the archive, with its timeline and its tasks. Nothing is destroyed. */
export async function deleteApplication(userId: string, id: string) {
  const { archived, skipped } = await archiveRecords(userId, "application", [id]);
  if (archived.length === 0) throw new Error(skipped[0]?.reason ?? `No application with id ${id}`);
  return { id, archived: true };
}

export async function reorderApplications(userId: string, ids: string[]) {
  await db.$transaction(
    ids.map((id, index) =>
      db.application.updateMany({
        where: { id, userId, archivedAt: null },
        data: { sortOrder: index },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Activities, tasks, contacts
// ---------------------------------------------------------------------------

export async function addActivity(
  userId: string,
  input: {
    applicationId?: string;
    contactId?: string;
    type?: ActivityType;
    body: string;
    occurredAt?: Date | string;
  },
) {
  // Exactly one parent. An entry lives on one timeline — an application's or
  // a person's — and a caller passing both hasn't decided which.
  if (Boolean(input.applicationId) === Boolean(input.contactId)) {
    throw new Error("Attach an activity to exactly one thing: an application or a contact.");
  }
  if (input.applicationId) {
    const application = await db.application.findFirst({
      where: { id: input.applicationId, userId, archivedAt: null },
    });
    if (!application) throw new Error(`No application with id ${input.applicationId}`);
  }
  if (input.contactId) {
    const contact = await db.contact.findFirst({
      where: { id: input.contactId, userId, archivedAt: null },
    });
    if (!contact) throw new Error(`No contact with id ${input.contactId}`);
  }

  return db.activity.create({
    data: {
      userId,
      applicationId: input.applicationId ?? null,
      contactId: input.contactId ?? null,
      type: input.type ?? "NOTE",
      body: input.body,
      occurredAt: toDate(await timeZoneOf(userId), input.occurredAt) ?? new Date(),
    },
  });
}

/**
 * One typed line, read against this person's live pipeline.
 *
 * The matcher itself is pure and lives in src/lib/quick-log.ts; this is the
 * read that feeds it. There is no tool for it on purpose: an assistant asked
 * "log that I spoke to Stripe" resolves the application with list_applications
 * far better than a stopword table can, and then calls log_activity or
 * move_application_stage. The table exists for the person typing into a box
 * on the dashboard, who has no assistant in the loop.
 */
export async function readQuickLogAgainstPipeline(userId: string, text: string) {
  const applications = await listApplications(userId);
  return readQuickLog(
    text,
    applications.map((application) => ({
      id: application.id,
      company: application.company.name,
      roleTitle: application.roleTitle,
      stage: application.stage,
    })),
  );
}

/**
 * A task belongs to an application or to nothing at all.
 *
 * Not `as const`: that would make the OR a readonly tuple, and Prisma's `OR`
 * is a mutable array, so it would not compile where it is spread.
 */
/**
 * A task whose subject is not in the archive.
 *
 * Three of the six things a task can be about are archivable, and each needs
 * BOTH legs: a task about a company has `applicationId: null`, so a
 * single-legged application filter would wave it straight through. Resumes,
 * roles and notes are not archivable — deleting one really deletes it, and the
 * foreign key takes the task with it — so they need no clause here.
 *
 * The AND is what makes this composable: every archivable subject gets its own
 * "unset, or alive" pair, and adding a fourth means adding a fourth pair rather
 * than reasoning about the whole expression again.
 */
const LIVE_TASK_PARENT: Prisma.TaskWhereInput = {
  AND: [
    { OR: [{ applicationId: null }, { application: { archivedAt: null } }] },
    { OR: [{ companyId: null }, { company: { archivedAt: null } }] },
    { OR: [{ contactId: null }, { contact: { archivedAt: null } }] },
  ],
};

/** Everything a task can be about, and the column each one lives in. */
export const TASK_SUBJECTS = [
  "application",
  "company",
  "contact",
  "resume",
  "role",
  "note",
] as const;
export type TaskSubject = (typeof TASK_SUBJECTS)[number];

const SUBJECT_COLUMN: Record<TaskSubject, string> = {
  application: "applicationId",
  company: "companyId",
  contact: "contactId",
  resume: "resumeId",
  role: "roleId",
  note: "noteId",
};

/**
 * Check that a subject is this person's, and turn it into columns to write.
 *
 * At most one subject: passing two is a caller that has not decided, and
 * silently keeping one of them would put a task on a thing nobody chose.
 * Ownership is checked here rather than trusted from the foreign key, because
 * the key only says the row exists — not that it belongs to the person writing.
 * An archived company or person is refused too: attaching a reminder to
 * something already in the bin makes a task nothing will ever show.
 */
export async function taskSubject(
  userId: string,
  input: Partial<Record<`${TaskSubject}Id`, string | null>>,
): Promise<Record<string, string | null>> {
  const named = TASK_SUBJECTS.filter((kind) => input[`${kind}Id`]);
  if (named.length > 1) {
    throw new Error(
      `A task is about one thing. You passed ${named.length}: ${named.join(", ")}.`,
    );
  }

  const columns: Record<string, string | null> = {};
  for (const kind of TASK_SUBJECTS) {
    const value = input[`${kind}Id`];
    // Absent means "leave it"; null means "unhook it"; a string means "set it".
    if (value === undefined) continue;
    columns[SUBJECT_COLUMN[kind]] = value ?? null;
  }
  // Setting one subject clears the others, so a task never carries two.
  if (named.length === 1) {
    for (const kind of TASK_SUBJECTS) {
      if (kind !== named[0]) columns[SUBJECT_COLUMN[kind]] = null;
    }
  }

  const kind = named[0];
  if (!kind) return columns;
  const id = input[`${kind}Id`] as string;

  const found = await (async () => {
    switch (kind) {
      case "application":
        return db.application.findFirst({ where: { id, userId, archivedAt: null } });
      case "company":
        return db.company.findFirst({ where: { id, userId, archivedAt: null } });
      case "contact":
        return db.contact.findFirst({ where: { id, userId, archivedAt: null } });
      case "resume":
        return db.resume.findFirst({ where: { id, userId } });
      case "role":
        return db.role.findFirst({ where: { id, userId } });
      case "note":
        return db.note.findFirst({ where: { id, userId } });
    }
  })();
  if (!found) throw new Error(`No ${kind} with id ${id}`);
  return columns;
}

/** What a task hands back about its subject, whichever kind it turned out to be. */
const taskSubjectInclude = {
  application: { include: { company: { select: { name: true } } } },
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  resume: { select: { id: true, name: true } },
  role: { select: { id: true, title: true, company: true } },
  note: { select: { id: true, title: true } },
} satisfies Prisma.TaskInclude;

/**
 * An activity belongs to an application OR a contact — exactly one, enforced
 * in addActivity rather than by the schema. Both legs are needed: a
 * single-legged filter lets every contact activity through unchecked, because
 * a contact's row has `applicationId: null` and matches the first branch on
 * its own.
 */
const LIVE_ACTIVITY_PARENT: Prisma.ActivityWhereInput = {
  AND: [
    { OR: [{ applicationId: null }, { application: { archivedAt: null } }] },
    { OR: [{ contactId: null }, { contact: { archivedAt: null } }] },
  ],
};

export async function listActivities(userId: string, applicationId?: string, limit = 40) {
  return db.activity.findMany({
    where: { userId, ...LIVE_ACTIVITY_PARENT, ...(applicationId ? { applicationId } : {}) },
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: {
      application: { include: { company: true } },
      contact: { select: { id: true, name: true } },
    },
  });
}

export type TaskSubjectInput = Partial<Record<`${TaskSubject}Id`, string | null>>;

export async function createTask(
  userId: string,
  input: {
    title: string;
    detail?: string;
    dueAt?: Date | string | null;
  } & TaskSubjectInput,
) {
  const title = input.title.trim();
  if (!title) throw new Error("A task needs a title");
  const subject = await taskSubject(userId, input);
  return db.task.create({
    data: {
      userId,
      title,
      detail: input.detail ?? "",
      dueAt: toDate(await timeZoneOf(userId), input.dueAt) ?? null,
      ...subject,
    },
    include: taskSubjectInclude,
  });
}

export async function listTasks(userId: string, options?: { done?: boolean; limit?: number }) {
  return db.task.findMany({
    where: {
      userId,
      ...LIVE_TASK_PARENT,
      ...(options?.done === undefined ? {} : { done: options.done }),
    },
    orderBy: [{ done: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: options?.limit ?? 100,
    include: taskSubjectInclude,
  });
}

/**
 * Change a task in place.
 *
 * Only what the patch mentions moves: `dueAt: null` clears the date,
 * `applicationId: null` unhooks it from the role, and a key that is absent is
 * left exactly as it was. `done` goes through setTaskDone instead, which keeps
 * doneAt honest.
 */
export async function updateTask(
  userId: string,
  id: string,
  patch: {
    title?: string;
    detail?: string;
    dueAt?: Date | string | null;
  } & TaskSubjectInput,
) {
  // Read first, write by id: the same shape as updateContact, and the only way
  // to write a relation — updateMany cannot connect one.
  const current = await db.task.findFirst({ where: { id, userId } });
  if (!current) throw new Error(`No task with id ${id}`);

  const data: Prisma.TaskUpdateInput = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error("A task needs a title");
    data.title = title;
  }
  if (patch.detail !== undefined) data.detail = patch.detail;
  if (patch.dueAt !== undefined) data.dueAt = toDate(await timeZoneOf(userId), patch.dueAt);
  const subject = await taskSubject(userId, patch);
  return db.task.update({
    where: { id },
    // Scalar foreign keys rather than connect/disconnect: `taskSubject` already
    // returns every column it means to move, including the ones it is clearing,
    // and expressing five of those as relation ops is five times the code for
    // the same UPDATE.
    data: { ...data, ...subject },
    include: taskSubjectInclude,
  });
}

export async function setTaskDone(userId: string, id: string, done: boolean) {
  const { count } = await db.task.updateMany({
    where: { id, userId },
    data: { done, doneAt: done ? new Date() : null },
  });
  if (count === 0) throw new Error(`No task with id ${id}`);
  return db.task.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteTask(userId: string, id: string) {
  const { count } = await db.task.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No task with id ${id}`);
  return { id };
}

export async function createContact(
  userId: string,
  input: {
    name: string;
    title?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    twitter?: string;
    instagram?: string;
    github?: string;
    website?: string;
    otherLinks?: string[];
    relationship?: string;
    notes?: string;
    /** Company ids, when you already have them. Wins over `companies`. */
    companyIds?: string[];
    /** Company names — the ones that do not exist yet are created. */
    companies?: string[];
    /** Legacy single-company spelling. `companyIds` and `companies` both win over it. */
    company?: string;
    /** Tag ids, when you already have them. Wins over `tags`. */
    tagIds?: string[];
    /** Tag names — the ones that do not exist yet are created. */
    tags?: string[];
    applicationId?: string | null;
  },
) {
  if (input.applicationId) {
    const application = await db.application.findFirst({
      where: { id: input.applicationId, userId, archivedAt: null },
    });
    if (!application) throw new Error(`No application with id ${input.applicationId}`);
  }
  const companyIds = (await resolveCompanyIds(userId, input)) ?? [];
  const tagIds = (await resolveTagIds(userId, TagKind.CONTACT, input)) ?? [];
  const contact = await db.contact.create({
    data: {
      userId,
      name: input.name,
      title: input.title ?? "",
      email: input.email ?? "",
      phone: input.phone ?? "",
      linkedin: input.linkedin ?? "",
      twitter: input.twitter ?? "",
      instagram: input.instagram ?? "",
      github: input.github ?? "",
      website: input.website ?? "",
      otherLinks: cleanLinks(input.otherLinks ?? []),
      relationship: input.relationship ?? "",
      notes: input.notes ?? "",
      companies: { create: companyIds.map((companyId) => ({ companyId })) },
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
      applicationId: input.applicationId ?? null,
    },
    include: contactInclude,
  });
  return { ...contact, ...contactShape(contact) };
}

const contactInclude = {
  // Ordered by when the link was made, so the first chip is the one a compact
  // list shows and it does not move about between renders.
  companies: {
    where: { company: { archivedAt: null } },
    include: { company: true },
    orderBy: { createdAt: "asc" as const },
  },
  ...tagInclude,
  application: {
    where: { archivedAt: null },
    select: {
      id: true,
      roleTitle: true,
      stage: true,
      location: true,
      salaryRange: true,
      jobUrl: true,
      nextFollowUpAt: true,
    },
  },
} satisfies Prisma.ContactInclude;

/** The cut list lives in crm-filters.ts, so there is one of it. */
export type { ContactCut as ContactFilter } from "@/lib/crm-filters";

/**
 * Every person, cut and ordered. Same shape as listCompanies, same reason.
 *
 * `applicationId` stays in the SQL because it scopes WHOSE contacts these are
 * rather than being a dimension of the screen. Everything else is a dimension,
 * and dimensions AND — which fixes a quiet bug in the version this replaces,
 * where passing `companyId` alongside the `no-company` cut had the second
 * assignment silently overwrite the first.
 */
export async function listContacts(
  userId: string,
  options?: {
    applicationId?: string;
    companyId?: string;
    companyIds?: string[];
    search?: string;
    filter?: ContactFilters["cut"];
    tagIds?: string[];
    quietDays?: number;
    missing?: ContactMissing[];
    sort?: ContactSort;
    dir?: "asc" | "desc";
  },
) {
  const where: Prisma.ContactWhereInput = { userId, archivedAt: null };
  if (options?.applicationId) where.applicationId = options.applicationId;

  const contacts = await db.contact.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      ...contactInclude,
      // The most recent touch, for "when did I last talk to them" in a list.
      activities: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" as const }, take: 1 },
    },
  });
  const mapped = contacts.map((contact) => ({ ...contact, ...contactShape(contact) }));

  const filters: ContactFilters = {
    ...EMPTY_CONTACT_FILTERS,
    cut: options?.filter ?? null,
    // The single-company shorthand folds into the dimension rather than
    // fighting it.
    companies: [...(options?.companyIds ?? []), ...(options?.companyId ? [options.companyId] : [])],
    tags: options?.tagIds ?? [],
    quiet: options?.quietDays ?? null,
    missing: options?.missing ?? [],
    search: options?.search ?? "",
  };
  // One `now` for the whole call, so "ping due" cannot answer differently for
  // the first row and the last.
  const now = Date.now();
  const sort = options?.sort ?? "name";
  return sortContacts(
    mapped.filter((contact) => matchesContact(contact, filters, now)),
    sort,
    contactDesc(sort, options?.dir),
    now,
  );
}

export async function getContact(userId: string, id: string) {
  const contact = await db.contact.findFirst({
    where: { id, userId, archivedAt: null },
    include: { ...contactInclude, activities: { orderBy: { occurredAt: "desc" as const } } },
  });
  return contact ? { ...contact, ...contactShape(contact) } : null;
}

export async function updateContact(
  userId: string,
  id: string,
  patch: Partial<{
    name: string;
    title: string;
    email: string;
    phone: string;
    linkedin: string;
    twitter: string;
    instagram: string;
    github: string;
    website: string;
    otherLinks: string[];
    relationship: string;
    notes: string;
    /** Company ids. REPLACES the whole set. Wins over `companies`. */
    companyIds: string[];
    /** Company names. REPLACES the whole set; unknown names are created. */
    companies: string[];
    /** Legacy single-company spelling. Both of the above win over it. */
    company: string;
    /** Tag ids. REPLACES the whole set. Wins over `tags`. */
    tagIds: string[];
    /** Tag names. REPLACES the whole set; unknown names are created. */
    tags: string[];
    applicationId: string | null;
    nextFollowUpAt: Date | string | null;
  }>,
) {
  const current = await db.contact.findFirst({ where: { id, userId } });
  if (!current) throw new Error(`No contact with id ${id}`);
  if (current.archivedAt) {
    throw new Error(`${current.name} is in the archive. Restore them before changing anything.`);
  }

  const data: Prisma.ContactUpdateInput = pick(patch, CONTACT_COLUMNS);
  if (patch.nextFollowUpAt !== undefined) {
    data.nextFollowUpAt = toDate(await timeZoneOf(userId), patch.nextFollowUpAt);
  }
  // An array is not a column pick: it replaces wholesale, and blank rows from a
  // half-filled form should never reach the database.
  if (patch.otherLinks !== undefined) data.otherLinks = cleanLinks(patch.otherLinks);
  // Companies and application are relations, so they are resolved by hand
  // rather than picked — and both are re-checked against this user.
  const companyIds = await resolveCompanyIds(userId, patch);
  if (companyIds !== undefined) {
    // Replace, like sources on an application: the caller sends the set they
    // want, not a delta.
    data.companies = { deleteMany: {}, create: companyIds.map((companyId) => ({ companyId })) };
  }
  // Tags replace too, and a contact's join carries only CONTACT tags — so
  // unlike a company's, where four lists share one table, a blanket delete
  // here takes nothing it shouldn't.
  const tagIds = await resolveTagIds(userId, TagKind.CONTACT, patch);
  if (tagIds !== undefined) {
    data.tags = { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) };
  }
  if (patch.applicationId !== undefined) {
    if (patch.applicationId) {
      const application = await db.application.findFirst({
        where: { id: patch.applicationId, userId, archivedAt: null },
      });
      if (!application) throw new Error(`No application with id ${patch.applicationId}`);
      data.application = { connect: { id: patch.applicationId } };
    } else {
      data.application = { disconnect: true };
    }
  }
  const contact = await db.contact.update({ where: { id }, data, include: contactInclude });
  return { ...contact, ...contactShape(contact) };
}

/** Into the archive, with their whole timeline. Nothing is destroyed. */
export async function deleteContact(userId: string, id: string) {
  const { archived, skipped } = await archiveRecords(userId, "contact", [id]);
  if (archived.length === 0) throw new Error(skipped[0]?.reason ?? `No contact with id ${id}`);
  return { id, archived: true };
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

/** Applications whose follow-up date has arrived (or passed). */
export async function followUpsDue(userId: string, withinDays = 0) {
  // The end of THEIR day. On a UTC host this is the difference between a chase
  // list that empties at midnight where you live and one that empties at 5pm.
  const cutoff = endOfDay(await timeZoneOf(userId), withinDays);
  return db.application.findMany({
    where: {
      userId,
      archivedAt: null,
      nextFollowUpAt: { lte: cutoff },
      stage: { notIn: TERMINAL_STAGES },
    },
    orderBy: { nextFollowUpAt: "asc" },
    include: { company: true },
  });
}

/** People whose ping date has arrived (or passed). */
export async function contactFollowUpsDue(userId: string, withinDays = 0) {
  const cutoff = endOfDay(await timeZoneOf(userId), withinDays);
  const contacts = await db.contact.findMany({
    where: { userId, archivedAt: null, nextFollowUpAt: { lte: cutoff } },
    orderBy: { nextFollowUpAt: "asc" },
    include: {
      companies: {
        where: { company: { archivedAt: null } },
        include: { company: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return contacts.map(flattenCompanies);
}

/**
 * Everything whose date has come round.
 *
 * The bell in the chrome, and the same answer over MCP. Three kinds of dated
 * thing pass their date and start meaning "do something": an application's next
 * follow-up, a person's next ping, and a task's due date. Meetings and logged
 * activities deliberately are not here — a calendar entry is not a debt, and an
 * activity is a record of something that already happened.
 *
 * Grouped rather than merged into one sorted column, because the three ask for
 * different actions: chase a company, ping a person, tick a thing off. One flat
 * list of look-alike rows makes you read every row to work out which is which.
 *
 * `withinDays` defaults to 0 — today and everything already late.
 */
export type DueItem = {
  kind: "APPLICATION" | "CONTACT" | "TASK";
  id: string;
  title: string;
  detail: string;
  dueAt: Date | null;
  /** Past its date rather than due today. The one thing worth colouring. */
  overdue: boolean;
};

export async function dueNow(
  userId: string,
  withinDays = 0,
): Promise<{ followUps: DueItem[]; pings: DueItem[]; tasks: DueItem[]; total: number }> {
  const now = new Date();
  const cutoff = endOfDay(await timeZoneOf(userId), withinDays);
  const late = (date: Date | null) => date !== null && date < now;

  const [applications, contacts, tasks] = await Promise.all([
    db.application.findMany({
      where: {
        userId,
        archivedAt: null,
        nextFollowUpAt: { lte: cutoff },
        stage: { notIn: TERMINAL_STAGES },
      },
      orderBy: { nextFollowUpAt: "asc" },
      include: { company: { select: { name: true } } },
    }),
    db.contact.findMany({
      where: { userId, archivedAt: null, nextFollowUpAt: { lte: cutoff } },
      orderBy: { nextFollowUpAt: "asc" },
      include: {
        companies: {
          where: { company: { archivedAt: null } },
          include: { company: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.task.findMany({
      where: { userId, done: false, dueAt: { lte: cutoff }, ...LIVE_TASK_PARENT },
      orderBy: { dueAt: "asc" },
      include: { application: { include: { company: { select: { name: true } } } } },
    }),
  ]);

  const followUps: DueItem[] = applications.map((application) => ({
    kind: "APPLICATION",
    id: application.id,
    title: application.company.name,
    detail: application.roleTitle,
    dueAt: application.nextFollowUpAt,
    overdue: late(application.nextFollowUpAt),
  }));

  const pings: DueItem[] = contacts.map((contact) => ({
    kind: "CONTACT",
    id: contact.id,
    title: contact.name,
    detail:
      [contact.title, ...contact.companies.map((link) => link.company.name)]
        .filter(Boolean)
        .join(" · ") || "Contact",
    dueAt: contact.nextFollowUpAt,
    overdue: late(contact.nextFollowUpAt),
  }));

  const dueTasks: DueItem[] = tasks.map((task) => ({
    kind: "TASK",
    id: task.id,
    title: task.title,
    detail: task.application ? task.application.company.name : task.detail,
    dueAt: task.dueAt,
    overdue: late(task.dueAt),
  }));

  return {
    followUps,
    pings,
    tasks: dueTasks,
    total: followUps.length + pings.length + dueTasks.length,
  };
}

/**
 * Everything with a date on it, in one window.
 *
 * Three tables carry dates — an application's next follow-up, a task's due
 * date, and an activity's occurredAt — and a person thinking about "next week"
 * is thinking about all three at once. Merging them here rather than in the
 * calendar component is what lets the same answer come back over MCP.
 */
/**
 * MEETING is a calendar event from a connected account that involves someone
 * on the pipeline. It is merged in by src/lib/data/schedule.ts rather than
 * here, so this file — which client components import for its constants —
 * never reaches the provider code and its Node-only libraries.
 */
export type ScheduleKind = "FOLLOW_UP" | "TASK" | "ACTIVITY" | "MEETING";

export type ScheduleEntry = {
  kind: ScheduleKind;
  id: string;
  date: Date;
  title: string;
  detail: string;
  company: string | null;
  applicationId: string | null;
  /** Set when the entry belongs to a person rather than an application. */
  contactId: string | null;
  stage: Stage | null;
  done: boolean | null;
  activityType: ActivityType | null;
  /** Set on a MEETING: the event in the provider's own calendar, when it has a page. */
  url?: string;
};

export async function listSchedule(
  userId: string,
  from: Date | string,
  to: Date | string,
): Promise<ScheduleEntry[]> {
  // A window given as bare dates is the reader's own days: "the 1st to the 7th"
  // covers both of those days end to end, where they are — not from 5pm on the
  // 31st to 4pm on the 7th, which is what UTC midnight would mean in Chicago.
  const zone = await timeZoneOf(userId);
  const start = windowEdge(zone, from, "start");
  const end = windowEdge(zone, to, "end");
  const range = { gte: start, lte: end };

  const [followUps, contactPings, tasks, activities] = await Promise.all([
    db.application.findMany({
      where: { userId, archivedAt: null, nextFollowUpAt: range, stage: { notIn: TERMINAL_STAGES } },
      include: { company: true },
    }),
    db.contact.findMany({
      where: { userId, archivedAt: null, nextFollowUpAt: range },
      include: {
        companies: {
          where: { company: { archivedAt: null } },
          include: { company: { select: { name: true } } },
        },
      },
    }),
    db.task.findMany({
      where: { userId, ...LIVE_TASK_PARENT, dueAt: range },
      include: { application: { include: { company: true } } },
    }),
    db.activity.findMany({
      where: { userId, ...LIVE_ACTIVITY_PARENT, occurredAt: range },
      include: {
        application: { include: { company: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
  ]);

  const entries: ScheduleEntry[] = [
    ...followUps.map((application) => ({
      kind: "FOLLOW_UP" as const,
      id: application.id,
      date: application.nextFollowUpAt!,
      title: `Follow up with ${application.company.name}`,
      detail: application.roleTitle,
      company: application.company.name,
      applicationId: application.id,
      contactId: null,
      stage: application.stage,
      done: null,
      activityType: null,
    })),
    ...contactPings.map((contact) => ({
      kind: "FOLLOW_UP" as const,
      id: contact.id,
      date: contact.nextFollowUpAt!,
      title: `Ping ${contact.name}`,
      detail: [contact.title, ...contact.companies.map((link) => link.company.name)]
        .filter(Boolean)
        .join(" · "),
      company: contact.companies[0]?.company.name ?? null,
      applicationId: null,
      contactId: contact.id,
      stage: null,
      done: null,
      activityType: null,
    })),
    ...tasks.map((task) => ({
      kind: "TASK" as const,
      id: task.id,
      date: task.dueAt!,
      title: task.title,
      detail: task.detail,
      company: task.application?.company.name ?? null,
      applicationId: task.applicationId,
      contactId: null,
      stage: task.application?.stage ?? null,
      done: task.done,
      activityType: null,
    })),
    ...activities.map((activity) => ({
      kind: "ACTIVITY" as const,
      id: activity.id,
      date: activity.occurredAt,
      title: `${ACTIVITY_LABEL[activity.type]} · ${
        activity.application?.company.name ?? activity.contact?.name ?? "Note"
      }`,
      detail: activity.body,
      company: activity.application?.company.name ?? null,
      applicationId: activity.applicationId,
      contactId: activity.contactId,
      stage: activity.application?.stage ?? null,
      done: null,
      activityType: activity.type,
    })),
  ];

  return entries.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * What is actually going wrong with the search.
 *
 * A funnel display shows six numbers and leaves the reading to you. This does
 * the reading: it works out which step is losing people and says so in one
 * sentence, because "you are getting responses but not past the screen" is a
 * different week's work from "nothing is coming back at all".
 *
 * Progress is measured by the furthest stage an application ever reached, not
 * by where it sits now — otherwise every rejection would look like it failed at
 * the first hurdle, and a rejection after a final round is the opposite signal
 * from a rejection after applying.
 */

/** The one path forward. Terminal stages sit outside it and end the journey. */
const LADDER: Stage[] = ["APPLIED", "SCREEN", "INTERVIEW", "FINAL", "OFFER"];

export type FunnelStep = {
  from: Stage;
  to: Stage;
  reached: number;
  advanced: number;
  /** Null rather than 0 when nobody has reached this step yet. */
  rate: number | null;
  medianDays: number | null;
};

export type SearchDiagnosis = {
  /** The sentence. Everything else on the screen supports this. */
  headline: string;
  detail: string;
  /** Which step is the bottleneck, or null when there isn't enough to say. */
  weakest: Stage | null;
  confident: boolean;
  steps: FunnelStep[];
  applied: number;
  inFlight: number;
  velocity: { weekStart: string; count: number }[];
  stalled: { id: string; company: string; roleTitle: string; stage: Stage; days: number }[];
  byResume: { id: string; name: string; sent: number; responded: number; rate: number | null }[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Every application, by how far it got and how it ended.
 *
 * This is the Sankey's whole input, and the only place the shape is computed —
 * the on-screen diagram, the shared image and the tool all read this, so there
 * is one answer to "how many did I apply to" rather than three.
 *
 * **Furthest reached, not currently at.** An application sitting in REJECTED
 * still went through a screen and two interviews, and a funnel that filed it
 * under "rejected after applying" would say the search leaks at the top when it
 * leaks at the end. So the rung comes from the transition history, and the
 * ending comes from where it is now — the same two-part reading `diagnoseSearch`
 * already does, which is why `LADDER` is shared rather than re-declared.
 *
 * **The wishlist is not in it.** A job you noted and never applied to did not
 * leak out of the funnel; it never entered. Counting it as "applied, no
 * response" would be the single easiest way to make this diagram lie.
 *
 * Archived applications are out, for the reason pipelineStats gives: half a
 * population is worse than either.
 */
export type FunnelRung = {
  stage: Stage;
  /**
   * How many ever got at least this far — a DEPTH, not a visit count.
   *
   * An application that went straight from an interview to an offer got past
   * the depth a final round sits at without having one, and counting it here is
   * what makes the arithmetic close: every rung's ins equal its outs, so the
   * ribbons join up. `visited` is the honest count, and the drawing uses it to
   * decide whether the column exists at all.
   */
  reached: number;
  /** How many were actually IN this stage — moved into it, or sitting in it. */
  visited: number;
  /** How many of those went on to the next rung. */
  advanced: number;
  /** How many stopped here, by the ending they stopped with. */
  ended: { stage: Stage; count: number }[];
  /** How many are sitting here right now, still live. */
  open: number;
};

export async function funnelFlows(userId: string): Promise<{
  rungs: FunnelRung[];
  applied: number;
  /** Everything not yet applied to. Reported, never drawn. */
  wishlist: number;
}> {
  const [applications, transitions] = await Promise.all([
    db.application.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, stage: true, appliedAt: true },
    }),
    db.activity.findMany({
      where: { userId, toStage: { not: null }, application: { archivedAt: null } },
      select: { applicationId: true, toStage: true },
    }),
  ]);

  const best = new Map<string, number>();
  const rank = (stage: Stage | null) => (stage ? LADDER.indexOf(stage) : -1);
  // Which rungs each application was genuinely in, as opposed to past.
  const seen = new Map<string, Set<number>>();
  for (const transition of transitions) {
    if (!transition.applicationId) continue;
    const previous = best.get(transition.applicationId) ?? -1;
    const index = rank(transition.toStage);
    best.set(transition.applicationId, Math.max(previous, index));
    if (index >= 0) {
      const set = seen.get(transition.applicationId);
      if (set) set.add(index);
      else seen.set(transition.applicationId, new Set([index]));
    }
  }

  const rungs: FunnelRung[] = LADDER.map((stage) => ({
    stage,
    reached: 0,
    visited: 0,
    advanced: 0,
    ended: [],
    open: 0,
  }));
  const endings = LADDER.map(() => new Map<Stage, number>());
  let wishlist = 0;

  for (const application of applications) {
    let furthest = Math.max(rank(application.stage), best.get(application.id) ?? -1);
    // ACCEPTED is not a rung, it is what happens at the top of one.
    if (application.stage === "ACCEPTED") furthest = Math.max(furthest, LADDER.indexOf("OFFER"));
    // Applied without a single logged move still applied.
    if (furthest < 0 && application.appliedAt) furthest = 0;
    if (furthest < 0) {
      wishlist += 1;
      continue;
    }

    const visits = seen.get(application.id) ?? new Set<number>();
    // Where it sits now counts as a visit; so does where it started.
    const here = rank(application.stage);
    if (here >= 0) visits.add(here);
    if (application.appliedAt || application.stage !== "WISHLIST") visits.add(0);

    for (let i = 0; i <= furthest; i++) {
      rungs[i].reached += 1;
      if (visits.has(i)) rungs[i].visited += 1;
      if (i < furthest) rungs[i].advanced += 1;
    }
    // Where it stopped: an ending if it has one, otherwise it is still open.
    if (TERMINAL_STAGES.includes(application.stage)) {
      const map = endings[furthest];
      map.set(application.stage, (map.get(application.stage) ?? 0) + 1);
    } else {
      rungs[furthest].open += 1;
    }
  }

  for (const [index, map] of endings.entries()) {
    rungs[index].ended = [...map.entries()]
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));
  }

  return { rungs, applied: rungs[0]?.reached ?? 0, wishlist };
}

export async function diagnoseSearch(userId: string): Promise<SearchDiagnosis> {
  const [applications, transitions] = await Promise.all([
    db.application.findMany({
      // Same rule as pipelineStats: what is in the archive is out of the
      // funnel. Deleting twenty dead threads and watching the response rate
      // not move would make the number meaningless.
      where: { userId, archivedAt: null },
      select: {
        id: true,
        stage: true,
        roleTitle: true,
        appliedAt: true,
        createdAt: true,
        updatedAt: true,
        resumeId: true,
        company: { select: { name: true } },
        resume: { select: { id: true, name: true } },
      },
    }),
    db.activity.findMany({
      // Through the parent, like every other activity read. Without it the
      // funnel's conversion rates exclude archived applications while its
      // median days in each stage still count them — one diagnosis built from
      // two different populations.
      where: { userId, toStage: { not: null }, application: { archivedAt: null } },
      select: { applicationId: true, fromStage: true, toStage: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }),
  ]);

  const byApplication = new Map<string, typeof transitions>();
  for (const transition of transitions) {
    // Stage transitions only exist on application activities; the null check
    // is for the type, not an expected case.
    if (!transition.applicationId) continue;
    const list = byApplication.get(transition.applicationId);
    if (list) list.push(transition);
    else byApplication.set(transition.applicationId, [transition]);
  }

  // --- how far each application ever got ------------------------------------
  const rank = (stage: Stage | null) => (stage ? LADDER.indexOf(stage) : -1);
  const furthest = new Map<string, number>();
  for (const application of applications) {
    let best = rank(application.stage);
    // ACCEPTED means they got the offer, whatever the row says now.
    if (application.stage === "ACCEPTED") best = LADDER.indexOf("OFFER");
    for (const transition of byApplication.get(application.id) ?? []) {
      best = Math.max(best, rank(transition.toStage));
    }
    // An application with a date on it was sent, even if nothing was logged.
    if (best < 0 && application.appliedAt) best = 0;
    furthest.set(application.id, best);
  }

  // --- time spent in each stage before moving on ----------------------------
  const daysIn = new Map<Stage, number[]>();
  for (const list of byApplication.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      const stage = list[i].toStage;
      if (!stage) continue;
      const days = Math.round((list[i + 1].occurredAt.getTime() - list[i].occurredAt.getTime()) / DAY);
      if (days < 0) continue;
      const bucket = daysIn.get(stage);
      if (bucket) bucket.push(days);
      else daysIn.set(stage, [days]);
    }
  }

  const steps: FunnelStep[] = LADDER.slice(0, -1).map((from, index) => {
    const reached = [...furthest.values()].filter((value) => value >= index).length;
    const advanced = [...furthest.values()].filter((value) => value >= index + 1).length;
    return {
      from,
      to: LADDER[index + 1],
      reached,
      advanced,
      rate: reached > 0 ? Math.round((advanced / reached) * 100) : null,
      medianDays: median(daysIn.get(from) ?? []),
    };
  });

  // --- velocity: six weeks back, Monday-anchored ----------------------------
  // Anchored to the reader's Monday, not the server's: a week boundary drawn in
  // UTC puts Sunday evening in Los Angeles into the week that has not started.
  const now = new Date();
  const zone = await timeZoneOf(userId);
  const monday = startOfWeek(zone, now);
  const weeks = Array.from({ length: 7 }, (_, i) =>
    // Step in civil days so a week containing a clock change is still a week.
    atHourInDays(zone, (i - 5) * 7, 0, monday),
  );
  const velocity = Array.from({ length: 6 }, (_, i) => {
    const start = weeks[i];
    const end = weeks[i + 1];
    return {
      weekStart: civilDay(start, zone),
      count: applications.filter(
        (application) =>
          application.appliedAt !== null &&
          application.appliedAt >= start &&
          application.appliedAt < end,
      ).length,
    };
  });

  // --- what has gone quiet ---------------------------------------------------
  // The same rule the board draws on a card, from src/lib/quiet.ts. It used to
  // be a closure here that read stage transitions only and fell back to
  // updatedAt — so logging a call left an application "stalled", and dragging
  // a card past another one (which writes a sort order) made a dead thread
  // look alive.
  const touched = await lastActivityByApplication(userId, applications.map((row) => row.id));
  const stalled = applications
    .map((application) => ({
      id: application.id,
      company: application.company.name,
      roleTitle: application.roleTitle,
      stage: application.stage,
      days: quietDaysFor(
        {
          stage: application.stage,
          createdAt: application.createdAt,
          appliedAt: application.appliedAt,
          lastActivityAt: touched.get(application.id) ?? null,
          lastStageChangeAt: byApplication.get(application.id)?.at(-1)?.occurredAt ?? null,
        },
        now,
      ),
    }))
    .filter((row) => hasGoneQuiet(row.stage, row.days, TERMINAL_STAGES))
    .sort((a, b) => b.days - a.days);

  // --- which resume is actually working --------------------------------------
  const resumeRows = new Map<string, { id: string; name: string; sent: number; responded: number }>();
  for (const application of applications) {
    if (!application.resume || (furthest.get(application.id) ?? -1) < 0) continue;
    const row = resumeRows.get(application.resume.id) ?? {
      id: application.resume.id,
      name: application.resume.name,
      sent: 0,
      responded: 0,
    };
    row.sent += 1;
    if ((furthest.get(application.id) ?? -1) >= 1) row.responded += 1;
    resumeRows.set(application.resume.id, row);
  }
  const byResume = [...resumeRows.values()]
    .map((row) => ({ ...row, rate: row.sent > 0 ? Math.round((row.responded / row.sent) * 100) : null }))
    .sort((a, b) => b.sent - a.sent);

  const applied = [...furthest.values()].filter((value) => value >= 0).length;
  const inFlight = applications.filter(
    (application) => !TERMINAL_STAGES.includes(application.stage),
  ).length;

  return {
    ...verdict(steps, applied, velocity),
    steps,
    applied,
    inFlight,
    velocity,
    stalled,
    byResume,
  };
}

/**
 * The sentence.
 *
 * Deliberately opinionated and deliberately not benchmarked against numbers we
 * cannot source. The thresholds below are this tool's own rules of thumb, and
 * the copy says which step is losing people rather than claiming what a normal
 * rate is. Under ten applications it says nothing at all, because a diagnosis
 * from four data points is a guess wearing a lab coat.
 */
function verdict(
  steps: FunnelStep[],
  applied: number,
  velocity: { weekStart: string; count: number }[],
) {
  const step = (from: Stage) => steps.find((candidate) => candidate.from === from);
  const response = step("APPLIED");
  const screen = step("SCREEN");
  const interview = step("INTERVIEW");
  const final = step("FINAL");

  const thisWeek = velocity[velocity.length - 1]?.count ?? 0;
  const previous = velocity.slice(0, -1);
  const busiest = Math.max(0, ...previous.map((week) => week.count));
  const slowing =
    busiest >= 3 && thisWeek * 2 < busiest
      ? ` You have also slowed down — ${thisWeek} sent this week against ${busiest} in your best recent week, and a search usually dies of that before anything else.`
      : "";

  if (applied < 10) {
    return {
      headline: "Too early to tell you anything useful.",
      detail: `${applied} application${applied === 1 ? "" : "s"} in. Around ten is where the numbers below start meaning something rather than describing luck.${slowing}`,
      weakest: null,
      confident: false,
    };
  }

  if (response && response.reached >= 10 && (response.rate ?? 0) < 15) {
    return {
      headline: "Almost nothing is coming back.",
      detail: `${response.advanced} of ${response.reached} applications got any response. At this volume that is not bad luck — it is the resume or which jobs you are applying to, and sending more of the same will not fix it.${slowing}`,
      weakest: "APPLIED" as Stage,
      confident: true,
    };
  }

  if (screen && screen.reached >= 4 && (screen.rate ?? 0) < 34) {
    return {
      headline: "You are getting responses but not past the screen.",
      detail: `${screen.advanced} of ${screen.reached} screens became an interview. The resume is working — this is a phone-screen problem, which is usually how you tell the story rather than what is in it.${slowing}`,
      weakest: "SCREEN" as Stage,
      confident: true,
    };
  }

  if (interview && interview.reached >= 3 && (interview.rate ?? 0) < 40) {
    return {
      headline: "You are getting into the room and not converting.",
      detail: `${interview.advanced} of ${interview.reached} interviews went further. You are being taken seriously; something in the loop itself is losing it.${slowing}`,
      weakest: "INTERVIEW" as Stage,
      confident: true,
    };
  }

  if (final && final.reached >= 2 && (final.rate ?? 0) < 50) {
    return {
      headline: "You are reaching final rounds and stopping there.",
      detail: `${final.advanced} of ${final.reached} final rounds became an offer. This close, the difference is usually fit and how you close rather than capability.${slowing}`,
      weakest: "FINAL" as Stage,
      confident: true,
    };
  }

  if (thisWeek === 0 && busiest >= 3) {
    return {
      headline: "Your funnel is fine. You have stopped feeding it.",
      detail: `Nothing sent this week, against ${busiest} in your best recent week. Every rate below is holding up — there is just less going in.`,
      weakest: null,
      confident: true,
    };
  }

  return {
    headline: "Nothing obviously broken.",
    detail: `${applied} applications in and every step is converting at a reasonable rate. Keep the volume up and chase what has gone quiet.${slowing}`,
    weakest: null,
    confident: true,
  };
}

export async function pipelineStats(userId: string) {
  // "This week" is the reader's week. Read before the counts rather than inside
  // them so all ten queries still go out together.
  const weekStart = startOfWeek(await timeZoneOf(userId));
  const [byStage, total, active, thisWeek, interviews, screening, offers, tasksOpen, followUps, flow] =
    await Promise.all([
      // Archived applications leave the funnel with everything else. Half of
      // them would be worse than either: `applied` below is derived as
      // total - WISHLIST, so a filtered total against unfiltered stage counts
      // computes a response rate off a denominator nobody can see.
      db.application.groupBy({
        by: ["stage"],
        where: { userId, archivedAt: null },
        _count: { _all: true },
      }),
      db.application.count({ where: { userId, archivedAt: null } }),
      // Not TERMINAL_STAGES alone: that leaves WISHLIST in, so a workspace
      // holding one job somebody has NOT applied to reported "In flight 1" on
      // the same screen that says a wishlist row never entered the funnel.
      // Both consumers — the stat tile and pipeline_stats — mean "sent, and
      // still alive".
      db.application.count({
        where: { userId, archivedAt: null, stage: { notIn: [...TERMINAL_STAGES, "WISHLIST"] } },
      }),
      db.application.count({
        where: { userId, archivedAt: null, appliedAt: { gte: weekStart } },
      }),
      db.application.count({
        where: { userId, archivedAt: null, stage: { in: ["INTERVIEW", "FINAL"] } },
      }),
      db.application.count({ where: { userId, archivedAt: null, stage: "SCREEN" } }),
      db.application.count({
        where: { userId, archivedAt: null, stage: { in: ["OFFER", "ACCEPTED"] } },
      }),
      db.task.count({ where: { userId, ...LIVE_TASK_PARENT, done: false } }),
      followUpsDue(userId, 0),
      // 3. The response rate is measured the way the funnel measures it, by
      // reusing the funnel. It used to be counted from where applications SIT:
      // one that got a phone screen and was then rejected sits in REJECTED, so
      // it counted as never having replied — and a search where every employer
      // answers and then says no reported a 0% response rate, printed directly
      // above a chart showing every one of them reaching the screen. One rule
      // about the data, in one place.
      funnelFlows(userId),
    ]);

  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const row of byStage) counts[row.stage] = row._count._all;

  const applied = flow.applied;
  // Everyone who ever got past "applied", however it ended afterwards.
  const responded = flow.rungs[0]?.advanced ?? 0;

  return {
    counts,
    total,
    active,
    thisWeek,
    interviews,
    screening,
    offers,
    tasksOpen,
    followUpsDue: followUps.length,
    responseRate: applied > 0 ? Math.round((responded / applied) * 100) : 0,
    /**
     * How many applications that rate is computed from. Under about ten it is
     * describing luck rather than a search, which the web app acts on by
     * showing an em dash instead — this is how anything else, an assistant
     * included, can make the same call rather than quoting a percentage at
     * somebody who has applied to three things.
     */
    responseRateBasis: applied,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export { Stage, ActivityType };
