import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { SERVER_ZONE } from "@/lib/time";
import { STAGES, TERMINAL_STAGES } from "@/lib/data/pipeline";
import { matchesFilters, parsePipelineFilters } from "@/lib/pipeline-filters";

/**
 * Sharing a pipeline, read-only.
 *
 * The job this exists for: handing a friend, a coach or a former manager a
 * link so they can look at the search and tell you what to chase. It is
 * modelled on the unlisted resume rather than on accounts and permissions,
 * because the person you send it to is somebody you already decided to send it
 * to — a per-viewer permission model would be ceremony protecting nothing.
 *
 * A link can point at the whole pipeline or at one saved view. That second one
 * is usually what somebody actually wants: "everything I have from a referral"
 * is a reasonable thing to show a friend, and the entire board is not. The
 * whole-pipeline link is the row with a null savedViewId, wearing whatever
 * slug it already had, so nothing an existing link does has changed.
 */

/** ~60 bits, the same entropy budget as a published resume's slug. */
function newSlug() {
  return randomBytes(8).toString("base64url");
}

const shareSelect = {
  id: true,
  slug: true,
  includeClosed: true,
  lastViewedAt: true,
  createdAt: true,
  savedViewId: true,
  savedView: { select: { id: true, name: true } },
} as const;

/** Every link this person has minted, the whole-pipeline one first. */
export async function listPipelineShares(userId: string) {
  return db.pipelineShare.findMany({
    where: { userId },
    orderBy: [{ shareKey: "asc" }, { createdAt: "asc" }],
    select: shareSelect,
  });
}

/**
 * The whole-pipeline link, or null.
 *
 * Kept under its old name and old meaning because the settings screen, the
 * share dialog and `get_pipeline_share` all ask exactly this question.
 */
export async function getPipelineShare(userId: string) {
  return db.pipelineShare.findUnique({
    where: { userId_shareKey: { userId, shareKey: "" } },
    select: shareSelect,
  });
}

/**
 * Mint a link, or return the existing one — sharing the same thing twice is
 * not two links.
 *
 * `savedViewId` narrows it to one saved view. The view has to be theirs, and
 * it is checked here rather than trusted, because this function is what turns
 * an id into a public URL.
 */
export async function sharePipeline(
  userId: string,
  options?: { includeClosed?: boolean; savedViewId?: string | null },
) {
  const savedViewId = options?.savedViewId ?? null;
  if (savedViewId) {
    const view = await db.savedView.findFirst({
      where: { id: savedViewId, userId },
      select: { id: true },
    });
    if (!view) throw new Error("No such saved view");
  }
  const shareKey = savedViewId ?? "";

  const existing = await db.pipelineShare.findUnique({
    where: { userId_shareKey: { userId, shareKey } },
    select: shareSelect,
  });
  if (existing) {
    if (options?.includeClosed === undefined || options.includeClosed === existing.includeClosed) {
      return existing;
    }
    return db.pipelineShare.update({
      where: { userId_shareKey: { userId, shareKey } },
      data: { includeClosed: options.includeClosed },
      select: shareSelect,
    });
  }

  // The unique index on slug is the arbiter; retry rather than pre-checking,
  // which another request can race.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.pipelineShare.create({
        data: {
          userId,
          savedViewId,
          shareKey,
          slug: newSlug(),
          includeClosed: options?.includeClosed ?? false,
        },
        select: shareSelect,
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new Error("Could not mint a share link. Try again.");
}

/**
 * Stop sharing. Deletes the row, which destroys the address — re-sharing mints
 * a different one. Deliberately not a flag you can flip back: the reason you
 * revoke a link is usually that it reached someone you did not intend, and a
 * pause that can be undone does not fix that.
 *
 * With no arguments it revokes the whole-pipeline link and leaves any view
 * links alone. `all` revokes every one of them, which is the answer to "stop
 * sharing anything".
 */
export async function unsharePipeline(
  userId: string,
  options?: { savedViewId?: string | null; all?: boolean },
) {
  const where = options?.all
    ? { userId }
    : { userId, shareKey: options?.savedViewId ?? "" };
  const { count } = await db.pipelineShare.deleteMany({ where });
  return { shared: false as const, revoked: count };
}

/**
 * The anonymous read. The second function in this directory without a leading
 * userId, and like `getResumeBySlug` that makes it the place where a mistake
 * is a data leak rather than a type error.
 *
 * The `select` below is an ALLOW-LIST, not an omit-list, so a column added to
 * Application later cannot silently become public. What is deliberately absent
 * matters as much as what is present:
 *
 *   notes           — private thinking about an employer
 *   jobDescription  — enormous, and not what a reviewer is here for
 *   salaryRange     — a reviewer does not need someone's compensation
 *   contacts        — other people's names and email addresses. A share link
 *                     is consent to show your own search, never consent to
 *                     publish a third party's contact details.
 *   activities      — the timeline is where offhand notes about people live
 *
 * Do not widen this without asking whether a stranger holding the URL should
 * see the new field.
 *
 * A view link narrows it further. The saved view's own filters are applied
 * here, over rows fetched with the private columns the predicate needs — those
 * are read and then dropped, never returned. Anything the filters exclude is
 * not in the response at all, so the narrowing is real rather than cosmetic.
 */
export async function getSharedPipeline(slug: string) {
  if (!slug) return null;
  const share = await db.pipelineShare.findUnique({
    where: { slug },
    select: {
      id: true,
      userId: true,
      includeClosed: true,
      savedView: { select: { name: true, query: true } },
      user: { select: { name: true, profile: { select: { timeZone: true } } } },
    },
  });
  if (!share) return null;

  const rows = await db.application.findMany({
    where: {
      userId: share.userId,
      // Written out rather than spread from a shared constant, because this is
      // the one read in the app where a missed archive filter is a leak rather
      // than a bug: this page is unauthenticated, and the owner never looks at
      // it, so an application they deleted would sit visible to whoever holds
      // the link until somebody happened to notice.
      archivedAt: null,
      ...(share.includeClosed ? {} : { stage: { notIn: TERMINAL_STAGES } }),
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      roleTitle: true,
      stage: true,
      location: true,
      appliedAt: true,
      nextFollowUpAt: true,
      updatedAt: true,
      createdAt: true,
      company: { select: { name: true, website: true } },
      activities: {
        where: { toStage: { not: null } },
        orderBy: { occurredAt: "desc" as const },
        take: 1,
        select: { occurredAt: true },
      },
      // Read only so the saved view's predicate can run. Dropped below; none
      // of these four ever reaches the response.
      companyId: true,
      resumeId: true,
      notes: true,
      workMode: true,
      jobDescription: true,
      tags: { select: { tag: { select: { id: true, name: true } } } },
    },
  });

  // Bookkeeping must never fail the page for a viewer.
  void db.pipelineShare
    .update({ where: { id: share.id }, data: { lastViewedAt: new Date() } })
    .catch(() => {});

  const now = Date.now();
  const filters = share.savedView
    ? parsePipelineFilters(queryReader(share.savedView.query), STAGES)
    : null;

  // The real quiet metric, not updatedAt. A saved view can filter on it, and an
  // approximation here would show a stranger rows the owner's own view excludes
  // — which is the one kind of bug this file exists to prevent. One grouped
  // query, the same shape listApplications uses.
  const touched = new Map<string, Date>();
  if (filters?.quiet !== null && filters !== null && rows.length > 0) {
    const maxima = await db.activity.groupBy({
      by: ["applicationId"],
      where: { userId: share.userId, applicationId: { in: rows.map((row) => row.id) } },
      _max: { occurredAt: true },
    });
    for (const row of maxima) {
      if (row.applicationId && row._max.occurredAt) touched.set(row.applicationId, row._max.occurredAt);
    }
  }

  const applications = rows
    .map((row) => {
      const since = row.activities[0]?.occurredAt ?? row.createdAt;
      const quietSince = touched.get(row.id) ?? row.createdAt;
      return {
        row,
        daysInStage: Math.floor((now - since.getTime()) / 86_400_000),
        quietDays: Math.floor((now - quietSince.getTime()) / 86_400_000),
      };
    })
    .filter(
      ({ row, daysInStage, quietDays }) =>
        filters === null ||
        matchesFilters(
          {
            stage: row.stage,
            nextFollowUpAt: row.nextFollowUpAt,
            companyId: row.companyId,
            resumeId: row.resumeId,
            daysInStage,
            quietDays,
            tags: row.tags.map((link) => link.tag),
            roleTitle: row.roleTitle,
            notes: row.notes,
            location: row.location,
            workMode: row.workMode,
            jobDescription: row.jobDescription,
            company: { name: row.company.name },
          },
          filters,
          now,
        ),
    )
    .map(({ row, daysInStage }) => ({
      id: row.id,
      roleTitle: row.roleTitle,
      stage: row.stage,
      location: row.location,
      appliedAt: row.appliedAt,
      nextFollowUpAt: row.nextFollowUpAt,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      company: row.company,
      daysInStage,
    }));

  return {
    ownerName: share.user.name,
    /** Set when the link shows one saved view, so the page can say which. */
    viewName: share.savedView?.name ?? null,
    // The owner's calendar, not the viewer's. "Chase tomorrow" is a fact about
    // their week; a recruiter opening the link in Berlin should read the same
    // date the person who shared it does.
    ownerTimeZone: share.user.profile?.timeZone ?? SERVER_ZONE,
    applications,
  };
}

/** A saved view's stored query string, in the shape parsePipelineFilters wants. */
function queryReader(query: string) {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  return (name: string) => params.get(name) ?? undefined;
}
