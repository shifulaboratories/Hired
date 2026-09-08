import { db } from "@/lib/db";
import { getSettings, setSetting, SETTING_KEYS } from "@/lib/settings";

/**
 * Deleting, made reversible.
 *
 * Pressing Delete on a company, a person or an application does not destroy it.
 * The row gets an `archivedAt` and drops out of every list, board, picker,
 * filter, count and search in the app; the archive screen is where it can be
 * brought back, or finished off, and anything left there is destroyed once the
 * instance's retention window runs out.
 *
 * Like every file in this directory, `userId` is the first positional argument
 * and every query filters on it. The one function that breaks that rule is
 * `sweepArchive`, and it is safe for the same reasons `src/lib/data/system.ts`
 * gives: it takes no content in, returns no content out, is unreachable from
 * any tool or server action, and only ever removes rows that are already past
 * their own owner's window.
 *
 * Three models, not everything deletable. Roles, highlights, notes, resumes,
 * tasks, tags and saved views still delete outright, and their copy says so.
 * The reason is the one thing a soft delete cannot buy you: every read of an
 * archivable model has to exclude archived rows, nothing in the toolchain
 * catches a read that forgets, and the list of reads has to stay short enough
 * to audit by hand. See .claude/DECISIONS.md.
 */

export type ArchiveKind = "company" | "contact" | "application";

export const ARCHIVE_KINDS: ArchiveKind[] = ["company", "contact", "application"];

export const ARCHIVE_KIND_LABEL: Record<ArchiveKind, { one: string; many: string }> = {
  company: { one: "company", many: "companies" },
  contact: { one: "person", many: "people" },
  application: { one: "application", many: "applications" },
};

/**
 * The two halves of every archive-aware query.
 *
 * Spread them for brevity, but do not mistake them for safety: TypeScript skips
 * excess-property checking on a spread, so `{ userId, ...LIVE }` compiles
 * against a where clause for a model that has no `archivedAt` at all. The
 * compiler will not catch a missed filter and neither will the build. Only
 * exercising it against a real database will.
 */
export const LIVE = { archivedAt: null } as const;
export const IN_ARCHIVE = { archivedAt: { not: null } } as const;

export type ArchiveEntry = {
  kind: ArchiveKind;
  id: string;
  /** What it was called. */
  title: string;
  /** One line of context — the role's employer, the person's title. */
  subtitle: string;
  archivedAt: Date;
  /** When it will be destroyed. Null when retention is off. */
  purgeAt: Date | null;
  /** "with 3 applications", or "" when nothing came along. */
  withIt: string;
  /** A live record has taken this one's name, so restoring it would clash. */
  nameTaken: boolean;
};

type Skip = { id: string; reason: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Archive records of one kind.
 *
 * Ids that are not this user's, or are already archived, are SKIPPED rather
 * than throwing — the same rule `moveApplicationsStage` follows, and for the
 * same reason: binning twelve rows should not fail on the one a second tab
 * already dealt with.
 */
export async function archiveRecords(
  userId: string,
  kind: ArchiveKind,
  ids: string[],
): Promise<{ archived: ArchiveEntry[]; skipped: Skip[] }> {
  const archived: ArchiveEntry[] = [];
  const skipped: Skip[] = [];
  const now = new Date();
  const { archiveRetentionDays } = await getSettings();

  for (const id of [...new Set(ids)]) {
    try {
      const entry = await archiveOne(userId, kind, id, now, archiveRetentionDays);
      if (entry) archived.push(entry);
      else skipped.push({ id, reason: `No ${ARCHIVE_KIND_LABEL[kind].one} with id ${id}` });
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : "Could not archive that" });
    }
  }
  return { archived, skipped };
}

async function archiveOne(
  userId: string,
  kind: ArchiveKind,
  id: string,
  now: Date,
  retention: number,
): Promise<ArchiveEntry | null> {
  if (kind === "company") {
    const company = await db.company.findFirst({ where: { id, userId, archivedAt: null } });
    if (!company) return null;
    // Archiving a company takes its live applications with it, marked so a
    // restore can tell them from one the person binned separately. It does NOT
    // take the people: somebody is a founder at one company and an advisor at
    // another, which is why ContactCompany exists at all.
    const swept = await db.$transaction(async (tx) => {
      const { count } = await tx.application.updateMany({
        where: { companyId: id, userId, archivedAt: null },
        data: { archivedAt: now, archivedWith: id },
      });
      await tx.company.update({
        where: { id },
        // archiveKey is the row's own id, so any number of archived companies
        // can share a name with each other and with a live one.
        data: { archivedAt: now, archiveKey: id },
      });
      return count;
    });
    return {
      kind,
      id,
      title: company.name,
      subtitle: company.website || "",
      archivedAt: now,
      purgeAt: purgeAt(now, retention),
      withIt: swept > 0 ? `with ${plural(swept, "application", "applications")}` : "",
      nameTaken: false,
    };
  }

  if (kind === "application") {
    const application = await db.application.findFirst({
      where: { id, userId, archivedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (!application) return null;
    // Its timeline and its tasks follow it through the parent filters rather
    // than columns of their own, so a restore brings the thread back whole.
    await db.application.update({
      where: { id },
      data: { archivedAt: now, archivedWith: null },
    });
    return {
      kind,
      id,
      title: application.roleTitle,
      subtitle: application.company.name,
      archivedAt: now,
      purgeAt: purgeAt(now, retention),
      withIt: "",
      nameTaken: false,
    };
  }

  const contact = await db.contact.findFirst({
    where: { id, userId, archivedAt: null },
    include: { companies: { include: { company: { select: { name: true } } } } },
  });
  if (!contact) return null;
  await db.contact.update({ where: { id }, data: { archivedAt: now } });
  return {
    kind,
    id,
    title: contact.name,
    subtitle: [contact.title, contact.companies[0]?.company.name].filter(Boolean).join(" · "),
    archivedAt: now,
    purgeAt: purgeAt(now, retention),
    withIt: "",
    nameTaken: false,
  };
}

/**
 * Bring archived records back.
 *
 * Two rules carry the weight. Restoring a company restores exactly the
 * applications that went in WITH it — `archivedWith` is how one the person
 * binned a week earlier stays where they put it. And restoring an application
 * whose company is still archived brings the company back too, because a live
 * application pointing at an archived company is a row no board can draw.
 */
export async function restoreRecords(
  userId: string,
  kind: ArchiveKind,
  ids: string[],
): Promise<{ restored: ArchiveEntry[]; alsoRestored: ArchiveEntry[]; skipped: Skip[] }> {
  const restored: ArchiveEntry[] = [];
  const alsoRestored: ArchiveEntry[] = [];
  const skipped: Skip[] = [];

  for (const id of [...new Set(ids)]) {
    try {
      const result = await restoreOne(userId, kind, id);
      if (!result) {
        skipped.push({ id, reason: `Nothing in the archive with id ${id}` });
        continue;
      }
      restored.push(result.entry);
      alsoRestored.push(...result.also);
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : "Could not restore that" });
    }
  }
  return { restored, alsoRestored, skipped };
}

/** The one sentence both clash paths use, so they cannot drift apart. */
function nameClash(name: string) {
  return new Error(
    `You already have a company called "${name}". Rename that one first, or restore this and fold the two together with merge_companies.`,
  );
}

/** Prisma's unique-violation code. A read-then-write cannot be race-proof. */
function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Un-archive a company row, and optionally the applications that went in with
 * it.
 *
 * `withApplications` is false when this is called to make a single restored
 * application drawable: an application under an archived company is a row no
 * board can render, so the company has to come back — but bringing back every
 * OTHER application that was swept in with it is not what the person asked
 * for, and they would have no idea it had happened.
 */
async function restoreCompany(userId: string, id: string, withApplications = true) {
  const company = await db.company.findFirst({
    where: { id, userId, archivedAt: { not: null } },
  });
  if (!company) return null;
  const clash = await db.company.findFirst({
    where: { userId, name: company.name, archivedAt: null },
  });
  if (clash) throw nameClash(company.name);
  try {
    const swept = await db.$transaction(async (tx) => {
      await tx.company.update({ where: { id }, data: { archivedAt: null, archiveKey: "" } });
      if (!withApplications) return 0;
      const { count } = await tx.application.updateMany({
        where: { userId, archivedWith: id, archivedAt: { not: null } },
        data: { archivedAt: null, archivedWith: null },
      });
      return count;
    });
    return { company, swept };
  } catch (error) {
    if (isUniqueViolation(error)) throw nameClash(company.name);
    throw error;
  }
}

async function restoreOne(
  userId: string,
  kind: ArchiveKind,
  id: string,
): Promise<{ entry: ArchiveEntry; also: ArchiveEntry[] } | null> {
  if (kind === "company") {
    const done = await restoreCompany(userId, id);
    if (!done) return null;
    return {
      entry: {
        kind,
        id,
        title: done.company.name,
        subtitle: done.company.website || "",
        archivedAt: done.company.archivedAt ?? new Date(),
        purgeAt: null,
        withIt: done.swept > 0 ? `with ${plural(done.swept, "application", "applications")}` : "",
        nameTaken: false,
      },
      also: [],
    };
  }

  if (kind === "application") {
    const application = await db.application.findFirst({
      where: { id, userId, archivedAt: { not: null } },
      include: { company: true },
    });
    if (!application) return null;
    const also: ArchiveEntry[] = [];
    if (application.company.archivedAt) {
      // Same name check, same sentence: a live application under an archived
      // company cannot be drawn anywhere, so the company has to come first.
      // The company ALONE — restoring one application must not quietly bring
      // back every sibling that went into the archive beside it.
      const done = await restoreCompany(userId, application.companyId, false);
      if (done) {
        also.push({
          kind: "company",
          id: application.companyId,
          title: done.company.name,
          subtitle: done.company.website || "",
          archivedAt: done.company.archivedAt ?? new Date(),
          purgeAt: null,
          withIt: "",
          nameTaken: false,
        });
      }
    }
    await db.application.update({
      where: { id },
      data: { archivedAt: null, archivedWith: null },
    });
    return {
      entry: {
        kind,
        id,
        title: application.roleTitle,
        subtitle: application.company.name,
        archivedAt: application.archivedAt ?? new Date(),
        purgeAt: null,
        withIt: "",
        nameTaken: false,
      },
      also: also.filter((entry) => !already(also, entry)),
    };
  }

  const contact = await db.contact.findFirst({
    where: { id, userId, archivedAt: { not: null } },
    include: { companies: { include: { company: { select: { name: true } } } } },
  });
  if (!contact) return null;
  await db.contact.update({ where: { id }, data: { archivedAt: null } });
  return {
    entry: {
      kind,
      id,
      title: contact.name,
      subtitle: [contact.title, contact.companies[0]?.company.name].filter(Boolean).join(" · "),
      archivedAt: contact.archivedAt ?? new Date(),
      purgeAt: null,
      withIt: "",
      nameTaken: false,
    },
    also: [],
  };
}

const already = (list: ArchiveEntry[], entry: ArchiveEntry) =>
  list.filter((other) => other.kind === entry.kind && other.id === entry.id).length > 1;

function purgeAt(archivedAt: Date, retention: number): Date | null {
  if (retention <= 0) return null;
  return new Date(archivedAt.getTime() + retention * 86400000);
}

/**
 * How many of each kind are in the bin.
 *
 * Its own query rather than a field on listArchive, because the four list
 * screens want the number without wanting the rows.
 */
export async function archiveCounts(
  userId: string,
): Promise<Record<ArchiveKind, number> & { total: number }> {
  const [company, contact, application] = await Promise.all([
    db.company.count({ where: { userId, archivedAt: { not: null } } }),
    db.contact.count({ where: { userId, archivedAt: { not: null } } }),
    db.application.count({ where: { userId, archivedAt: { not: null } } }),
  ]);
  return { company, contact, application, total: company + contact + application };
}

/**
 * What is in the bin, newest first.
 *
 * Every row carries its own purge date, computed from `archivedAt` plus the
 * window rather than from anything the sweep has done — so the screen is right
 * whether or not a sweep has run recently, and a countdown never disagrees with
 * what is on the row.
 */
export async function listArchive(
  userId: string,
  options?: { kind?: ArchiveKind; search?: string; limit?: number },
): Promise<{
  entries: ArchiveEntry[];
  counts: Record<ArchiveKind, number>;
  total: number;
  retentionDays: number;
  capped: ArchiveKind[];
}> {
  const limit = options?.limit ?? 200;
  const search = options?.search?.trim();
  const wants = (kind: ArchiveKind) => !options?.kind || options.kind === kind;
  const { archiveRetentionDays } = await getSettings();

  const [companies, contacts, applications, companyCount, contactCount, applicationCount] =
    await Promise.all([
      wants("company")
        ? db.company.findMany({
            where: {
              userId,
              archivedAt: { not: null },
              ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
            },
            orderBy: { archivedAt: "desc" },
            take: limit,
            // Only the applications a restore would actually bring back:
            // restoreCompany moves the ones it swept in, and an application the
            // person binned separately stays where they put it. Counting all of
            // them made the row promise more than the restore delivers.
            include: {
              _count: { select: { applications: { where: { archivedWith: { not: null } } } } },
            },
          })
        : [],
      wants("contact")
        ? db.contact.findMany({
            where: {
              userId,
              archivedAt: { not: null },
              ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
            },
            orderBy: { archivedAt: "desc" },
            take: limit,
            include: { companies: { include: { company: { select: { name: true } } } } },
          })
        : [],
      wants("application")
        ? db.application.findMany({
            where: {
              userId,
              archivedAt: { not: null },
              ...(search
                ? {
                    OR: [
                      { roleTitle: { contains: search, mode: "insensitive" as const } },
                      { company: { name: { contains: search, mode: "insensitive" as const } } },
                    ],
                  }
                : {}),
            },
            orderBy: { archivedAt: "desc" },
            take: limit,
            include: { company: { select: { name: true } } },
          })
        : [],
      db.company.count({ where: { userId, archivedAt: { not: null } } }),
      db.contact.count({ where: { userId, archivedAt: { not: null } } }),
      db.application.count({ where: { userId, archivedAt: { not: null } } }),
    ]);

  // Which archived company names a live company has since taken, so the screen
  // can warn before a restore is refused rather than after.
  const names = companies.map((company) => company.name);
  const taken = new Set(
    names.length === 0
      ? []
      : (
          await db.company.findMany({
            where: { userId, archivedAt: null, name: { in: names } },
            select: { name: true },
          })
        ).map((row) => row.name),
  );

  const entries: ArchiveEntry[] = [
    ...companies.map((company) => ({
      kind: "company" as const,
      id: company.id,
      title: company.name,
      subtitle: company.website || "",
      archivedAt: company.archivedAt!,
      purgeAt: purgeAt(company.archivedAt!, archiveRetentionDays),
      withIt:
        company._count.applications > 0
          ? `with ${plural(company._count.applications, "application", "applications")}`
          : "",
      nameTaken: taken.has(company.name),
    })),
    ...contacts.map((contact) => ({
      kind: "contact" as const,
      id: contact.id,
      title: contact.name,
      subtitle: [contact.title, contact.companies[0]?.company.name].filter(Boolean).join(" · "),
      archivedAt: contact.archivedAt!,
      purgeAt: purgeAt(contact.archivedAt!, archiveRetentionDays),
      withIt: "",
      nameTaken: false,
    })),
    ...applications.map((application) => ({
      kind: "application" as const,
      id: application.id,
      title: application.roleTitle,
      subtitle: application.company.name,
      archivedAt: application.archivedAt!,
      purgeAt: purgeAt(application.archivedAt!, archiveRetentionDays),
      withIt: application.archivedWith ? "archived with its company" : "",
      nameTaken: false,
    })),
  ].sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());

  const counts = {
    company: companyCount,
    contact: contactCount,
    application: applicationCount,
  };
  const capped = ARCHIVE_KINDS.filter((kind) => {
    const shown = { company: companies.length, contact: contacts.length, application: applications.length }[kind];
    return shown >= limit && counts[kind] > shown;
  });

  return {
    entries,
    counts,
    total: companyCount + contactCount + applicationCount,
    retentionDays: archiveRetentionDays,
    capped,
  };
}

/**
 * Destroy archived records now, without waiting for the window.
 *
 * Every query here carries `archivedAt: { not: null }`. That is what makes it
 * structurally impossible for this function to destroy something live, and it
 * is why there is no confirmation logic down here: nothing reaches this code
 * that the person has not already deleted once.
 */
export async function deleteArchived(
  userId: string,
  kind: ArchiveKind,
  ids: string[],
): Promise<{ deleted: string[]; skipped: Skip[] }> {
  const deleted: string[] = [];
  const skipped: Skip[] = [];

  for (const id of [...new Set(ids)]) {
    try {
      if (kind === "company") {
        // The guard that matters. Application.company is ON DELETE CASCADE at
        // the database level, so a company row going out takes every
        // application pointing at it — and a live one must never ride along.
        const { count } = await db.company.deleteMany({
          where: { id, userId, archivedAt: { not: null }, applications: { none: { archivedAt: null } } },
        });
        if (count === 0) {
          skipped.push({ id, reason: "Not in the archive, or it still has a live application" });
          continue;
        }
      } else if (kind === "application") {
        const { count } = await db.application.deleteMany({
          where: { id, userId, archivedAt: { not: null } },
        });
        if (count === 0) {
          skipped.push({ id, reason: "Not in the archive" });
          continue;
        }
      } else {
        const { count } = await db.contact.deleteMany({
          where: { id, userId, archivedAt: { not: null } },
        });
        if (count === 0) {
          skipped.push({ id, reason: "Not in the archive" });
          continue;
        }
      }
      deleted.push(id);
    } catch (error) {
      skipped.push({ id, reason: error instanceof Error ? error.message : "Could not delete that" });
    }
  }
  return { deleted, skipped };
}

/**
 * Empty the bin, or one kind of it.
 *
 * Applications and contacts go first, then companies, so the cascade has
 * nothing left to take by the time a company row is removed.
 */
export async function emptyArchive(
  userId: string,
  options?: { kind?: ArchiveKind },
): Promise<{ deleted: Record<ArchiveKind, number>; total: number }> {
  const wants = (kind: ArchiveKind) => !options?.kind || options.kind === kind;
  const deleted: Record<ArchiveKind, number> = { company: 0, contact: 0, application: 0 };

  if (wants("application")) {
    deleted.application = (
      await db.application.deleteMany({ where: { userId, archivedAt: { not: null } } })
    ).count;
  }
  if (wants("contact")) {
    deleted.contact = (
      await db.contact.deleteMany({ where: { userId, archivedAt: { not: null } } })
    ).count;
  }
  if (wants("company")) {
    deleted.company += await destroyArchivedCompanies(userId, { userId, archivedAt: { not: null } }, deleted);
  }
  return { deleted, total: deleted.company + deleted.contact + deleted.application };
}

/**
 * Destroy archived companies, taking their archived applications by hand.
 *
 * `Application.company` is ON DELETE CASCADE at the database level, so deleting
 * a company row destroys every application under it whether or not this code
 * counted them. Scoped to one kind — "empty just the companies" — the cascade
 * used to take archived applications with it and report `application: 0`, which
 * is the one number somebody reads before agreeing to it.
 *
 * So the applications go first, explicitly and counted, and only then the
 * companies. The `none: { archivedAt: null }` guard still stands: a company
 * with a LIVE application is left alone rather than taking it down too.
 */
async function destroyArchivedCompanies(
  userId: string,
  where: { userId: string; archivedAt: { not: null } | { not: null; lte: Date } },
  deleted: Record<ArchiveKind, number>,
): Promise<number> {
  const doomed = await db.company.findMany({
    where: { ...where, applications: { none: { archivedAt: null } } },
    select: { id: true },
  });
  if (doomed.length === 0) return 0;
  const ids = doomed.map((row) => row.id);

  deleted.application += (
    await db.application.deleteMany({
      where: { userId, companyId: { in: ids }, archivedAt: { not: null } },
    })
  ).count;
  return (await db.company.deleteMany({ where: { userId, id: { in: ids } } })).count;
}

/** One person's expired rows. Same ordering and same guard as emptyArchive. */
export async function purgeExpiredFor(
  userId: string,
  now = new Date(),
): Promise<{ deleted: number }> {
  const { archiveRetentionDays } = await getSettings();
  if (archiveRetentionDays <= 0) return { deleted: 0 };
  const cutoff = new Date(now.getTime() - archiveRetentionDays * 86400000);
  const expired = { userId, archivedAt: { not: null, lte: cutoff } };

  const deleted: Record<ArchiveKind, number> = { company: 0, contact: 0, application: 0 };
  deleted.application = (await db.application.deleteMany({ where: expired })).count;
  deleted.contact = (await db.contact.deleteMany({ where: expired })).count;
  // Same reason as emptyArchive: the cascade must not take an application the
  // window has not reached yet.
  deleted.company = await destroyArchivedCompanies(userId, expired, deleted);
  return { deleted: deleted.application + deleted.contact + deleted.company };
}

/** How often the instance-wide sweep is allowed to run. */
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * Clear everything past its window, across the instance.
 *
 * No `userId`, and that is the point: it is not a read of anyone's content,
 * takes nothing in and returns no content out. It is unreachable from any tool
 * or server action, and the only rows it touches are ones already archived
 * longer ago than their own owner's window allows.
 *
 * There is no cron and no worker in this app, so this is called opportunistically
 * — at boot, at sign-in, and from the MCP token resolver — and throttles itself
 * through a Setting row rather than a process timer, because the transport is
 * stateless and may be running as more than one replica.
 */
export async function sweepArchive(now = new Date()): Promise<{ purged: number; skipped: boolean }> {
  const settings = await getSettings();
  if (settings.archiveRetentionDays <= 0) return { purged: 0, skipped: true };

  const last = await db.setting.findUnique({ where: { key: SETTING_KEYS.archiveSweptAt } });
  const lastRun = last ? Number.parseInt(last.value, 10) : 0;
  if (Number.isFinite(lastRun) && now.getTime() - lastRun < SWEEP_EVERY_MS) {
    return { purged: 0, skipped: true };
  }
  await setSetting(SETTING_KEYS.archiveSweptAt, String(now.getTime()));

  const cutoff = new Date(now.getTime() - settings.archiveRetentionDays * 86400000);
  const expired = { archivedAt: { not: null, lte: cutoff } };

  const applications = (await db.application.deleteMany({ where: expired })).count;
  const contacts = (await db.contact.deleteMany({ where: expired })).count;
  // The companies whose applications are all gone or archived. Anything still
  // holding a LIVE application is left standing, because the foreign key would
  // take it down too.
  const doomed = await db.company.findMany({
    where: { ...expired, applications: { none: { archivedAt: null } } },
    select: { id: true },
  });
  const swept = doomed.length
    ? (
        await db.application.deleteMany({
          where: { companyId: { in: doomed.map((row) => row.id) }, archivedAt: { not: null } },
        })
      ).count
    : 0;
  const companies = doomed.length
    ? (await db.company.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } })).count
    : 0;
  return { purged: applications + swept + contacts + companies, skipped: false };
}
