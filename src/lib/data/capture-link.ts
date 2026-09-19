import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { generateCaptureToken, isClaimed } from "@/lib/auth";

/**
 * The link that turns a job posting into an application from a phone.
 *
 * A connection URL is full read and write over a workspace, and a bookmark bar
 * is the wrong place for one. This credential does exactly one thing —
 * "capture this URL as an application" — resolves to one person, is revocable
 * on its own, is rate-limited on its own, and never puts the fetched page's
 * contents in its own response, because the person holding it is not signed in.
 *
 * It is NOT minted for everybody, deliberately unlike `ensureDefaultConnection`.
 * An unwanted connection URL sits unused in a settings panel; an unwanted
 * capture URL is an unauthenticated write endpoint nobody asked to exist.
 */

/** Generous for a person, useless to anyone who found the link. */
const CAPTURES_PER_HOUR = 30;
const WINDOW_MS = 60 * 60 * 1000;
/** Once a minute per link is enough resolution for "last used". */
const LAST_USED_RESOLUTION_MS = 60 * 1000;

export type CaptureLinkView = {
  exists: boolean;
  /** The full URL, built from the instance's public address. Empty when none. */
  url: string;
  /** The javascript: one-liner, ready to paste into a bookmark. Empty when none. */
  bookmarklet: string;
  captured: number;
  lastUsedAt: Date | null;
  lastUsedFrom: string;
  createdAt: Date | null;
  /** Set when the instance has no public URL configured, so the link has no host. */
  note: string;
};

const NO_HOST =
  "This instance has no public URL set, so there is no address to build the link from. An admin sets it under Admin → Configuration.";

function view(
  row: { token: string; captured: number; lastUsedAt: Date | null; lastUsedFrom: string; createdAt: Date } | null,
  baseUrl: string,
): CaptureLinkView {
  if (!row) {
    return {
      exists: false,
      url: "",
      bookmarklet: "",
      captured: 0,
      lastUsedAt: null,
      lastUsedFrom: "",
      createdAt: null,
      note: "",
    };
  }
  const base = baseUrl.trim().replace(/\/+$/, "");
  const url = base ? `${base}/api/capture/${row.token}` : "";
  return {
    exists: true,
    url,
    bookmarklet: url
      ? `javascript:(()=>{location.href='${url}?url='+encodeURIComponent(location.href)})()`
      : "",
    captured: row.captured,
    lastUsedAt: row.lastUsedAt,
    lastUsedFrom: row.lastUsedFrom,
    createdAt: row.createdAt,
    note: url ? "" : NO_HOST,
  };
}

export async function getCaptureLink(userId: string, baseUrl: string): Promise<CaptureLinkView> {
  const row = await db.captureLink.findUnique({ where: { userId } });
  return view(row, baseUrl);
}

/** Mints one, or replaces the token on the row that exists. The old URL dies at once. */
export async function mintCaptureLink(userId: string, baseUrl: string): Promise<CaptureLinkView> {
  const token = generateCaptureToken();
  const row = await db.captureLink.upsert({
    where: { userId },
    create: { userId, token },
    // A rotation resets the rate-limit window too: the old URL is dead, and the
    // new one should not arrive already half spent.
    update: { token, windowStartedAt: new Date(), windowCount: 0 },
  });
  return view(row, baseUrl);
}

export async function revokeCaptureLink(userId: string): Promise<{ revoked: boolean }> {
  const { count } = await db.captureLink.deleteMany({ where: { userId } });
  return { revoked: count > 0 };
}

/**
 * The endpoint's way in. No userId argument — resolving one is its whole job,
 * exactly as `userByMcpToken` does, and it is the only function in this
 * directory that takes a token instead.
 */
export async function userByCaptureToken(
  token: string | null | undefined,
  userAgent = "",
): Promise<{ user: User; linkId: string } | null> {
  if (!token || !token.startsWith("cap_")) return null;

  const link = await db.captureLink.findUnique({ where: { token }, include: { user: true } });
  if (!link) return null;
  const { user } = link;
  if (!user.isActive || !isClaimed(user)) return null;

  const now = Date.now();
  const stale = !link.lastUsedAt || now - link.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS;
  if (stale) {
    // Never let bookkeeping fail a real request.
    void db.captureLink
      .update({
        where: { id: link.id },
        data: { lastUsedAt: new Date(now), lastUsedFrom: userAgent.slice(0, 200) },
      })
      .catch(() => {});
  }

  return { user, linkId: link.id };
}

/**
 * Fixed-window limit, checked and incremented in one update.
 *
 * Fixed rather than sliding because it is cheap and precise enough for a limit
 * whose job is to stop a leaked token being used as a fetch engine, not to
 * smooth traffic.
 */
export async function claimCaptureSlot(linkId: string, now = new Date()): Promise<boolean> {
  const link = await db.captureLink.findUnique({
    where: { id: linkId },
    select: { windowStartedAt: true, windowCount: true },
  });
  if (!link) return false;

  const expired = now.getTime() - link.windowStartedAt.getTime() >= WINDOW_MS;
  if (expired) {
    await db.captureLink.update({
      where: { id: linkId },
      data: { windowStartedAt: now, windowCount: 1 },
    });
    return true;
  }
  if (link.windowCount >= CAPTURES_PER_HOUR) return false;
  await db.captureLink.update({ where: { id: linkId }, data: { windowCount: { increment: 1 } } });
  return true;
}

/** One more posting captured. Separate from the slot so a failed parse is not counted. */
export async function countCapture(linkId: string) {
  await db.captureLink.update({ where: { id: linkId }, data: { captured: { increment: 1 } } }).catch(() => {});
}

export const CAPTURE_RATE_LIMIT = CAPTURES_PER_HOUR;
