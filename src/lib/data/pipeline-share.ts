import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { TERMINAL_STAGES } from "@/lib/data/pipeline";

/**
 * Sharing a pipeline, read-only.
 *
 * The job this exists for: handing a friend, a coach or a former manager a
 * link so they can look at the search and tell you what to chase. It is
 * modelled on the unlisted resume rather than on accounts and permissions,
 * because the person you send it to is somebody you already decided to send it
 * to — a per-viewer permission model would be ceremony protecting nothing.
 */

/** ~60 bits, the same entropy budget as a published resume's slug. */
function newSlug() {
  return randomBytes(8).toString("base64url");
}

export async function getPipelineShare(userId: string) {
  return db.pipelineShare.findUnique({ where: { userId } });
}

/** Mint a link, or return the existing one — sharing twice is not two links. */
export async function sharePipeline(userId: string, options?: { includeClosed?: boolean }) {
  const existing = await db.pipelineShare.findUnique({ where: { userId } });
  if (existing) {
    if (options?.includeClosed === undefined || options.includeClosed === existing.includeClosed) {
      return existing;
    }
    return db.pipelineShare.update({
      where: { userId },
      data: { includeClosed: options.includeClosed },
    });
  }

  // The unique index is the arbiter; retry rather than pre-checking, which
  // another request can race.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.pipelineShare.create({
        data: { userId, slug: newSlug(), includeClosed: options?.includeClosed ?? false },
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
 */
export async function unsharePipeline(userId: string) {
  await db.pipelineShare.deleteMany({ where: { userId } });
  return { shared: false as const };
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
 */
export async function getSharedPipeline(slug: string) {
  if (!slug) return null;
  const share = await db.pipelineShare.findUnique({
    where: { slug },
    select: {
      id: true,
      includeClosed: true,
      user: { select: { name: true } },
    },
  });
  if (!share) return null;

  const applications = await db.application.findMany({
    where: {
      user: { pipelineShare: { slug } },
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
    },
  });

  // Bookkeeping must never fail the page for a viewer.
  void db.pipelineShare
    .update({ where: { id: share.id }, data: { lastViewedAt: new Date() } })
    .catch(() => {});

  const now = Date.now();
  return {
    ownerName: share.user.name,
    applications: applications.map(({ activities, ...application }) => {
      const since = activities[0]?.occurredAt ?? application.createdAt;
      return {
        ...application,
        daysInStage: Math.floor((now - since.getTime()) / 86_400_000),
      };
    }),
  };
}
