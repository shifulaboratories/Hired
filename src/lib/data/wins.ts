import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { appendToRoleBackground, timeZoneOf } from "@/lib/data/me";
import { civilDay, formatIn, SERVER_ZONE, toDate } from "@/lib/time";
import type { DigestContent } from "@/lib/data/digest";

/**
 * What you did after you got the job.
 *
 * The search ends, Me stops growing, and two years later the next search starts
 * from a role with an empty background — which is the state this whole product
 * exists to prevent and the one it has never done anything about. This file is
 * the smallest thing that fixes it: one call that puts a sentence where
 * search_me will find it, and the read the monthly mail is built from.
 *
 * A win is an APPEND to the current role's background, under a dated heading.
 *
 * Not a highlight. A highlight is a polished bullet with an impact figure, and
 * inventing that figure out of one sentence is exactly what invariant six
 * forbids — `mine_role_background` exists to do that distillation deliberately,
 * later, with the person in the room.
 *
 * Not a note. A note is material NOT tied to a role, and a win at your current
 * job is the definition of tied to one. The background is also what search_me
 * indexes, so a win logged in September is findable by `search_me` in March.
 */

export type WinTarget = {
  roleId: string;
  company: string;
  title: string;
};

/**
 * Which role a win lands on, or a refusal that names the fix.
 *
 * The common case right after accepting is that Me has no row for the new job
 * yet — which is why "add this job to Me as your current role" is day one of the
 * first-90-days checklist. When that is the situation this hands back the
 * accepted application it found, so the caller can say "you accepted Northwind
 * on the 3rd; shall I add it?" rather than "no current role".
 */
export async function resolveWinTarget(
  userId: string,
  roleId?: string,
): Promise<
  | { ok: true; target: WinTarget }
  | { ok: false; reason: string; suggested: { company: string; roleTitle: string } | null }
> {
  if (roleId) {
    const named = await db.role.findFirst({
      where: { id: roleId, userId },
      select: { id: true, company: true, title: true },
    });
    if (!named) return { ok: false, reason: `No role with id ${roleId}.`, suggested: null };
    return { ok: true, target: { roleId: named.id, company: named.company, title: named.title } };
  }

  const current = await db.role.findFirst({
    where: { userId, isCurrent: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, company: true, title: true },
  });
  if (current) {
    return { ok: true, target: { roleId: current.id, company: current.company, title: current.title } };
  }

  // The one archive filter in this file, spelled by hand.
  const accepted = await db.application.findFirst({
    where: { userId, stage: "ACCEPTED", archivedAt: null },
    orderBy: { closedAt: "desc" },
    select: { roleTitle: true, company: { select: { name: true } } },
  });

  return {
    ok: false,
    reason: accepted
      ? "Nothing in Me is marked as the current role yet, so there is nowhere for this to land."
      : "Nothing in Me is marked as the current role, and there is no accepted application to guess from.",
    suggested: accepted ? { company: accepted.company.name, roleTitle: accepted.roleTitle } : null,
  };
}

/** Append one win. Additive, never overwriting, and it resets the quiet counter. */
export async function logWin(
  userId: string,
  input: { text: string; roleId?: string; occurredOn?: Date | string | null },
): Promise<{ role: Role; heading: string; target: WinTarget }> {
  const text = input.text.trim();
  if (!text) throw new Error("A win needs some words.");

  const resolved = await resolveWinTarget(userId, input.roleId);
  if (!resolved.ok) throw new Error(resolved.reason);

  const zone = await timeZoneOf(userId);
  const when = toDate(zone, input.occurredOn) ?? new Date();
  // The civil month, so repeated wins in one month collect under one heading
  // rather than twelve.
  const heading = formatIn(when, zone, { month: "long", year: "numeric" });

  // Only write the heading when it is not already the LAST one on the
  // background. appendToRoleBackground stamps whatever heading it is given, so
  // logging three wins in September without this check produces three
  // "## September 2026" headings — which is the opposite of the point, since
  // the heading exists to group a month's work rather than to date each line.
  const existing = await db.role.findFirst({
    where: { id: resolved.target.roleId, userId },
    select: { background: true },
  });
  const headings = [...(existing?.background ?? "").matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const alreadyOpen = headings.at(-1) === heading;

  const role = await appendToRoleBackground(
    userId,
    resolved.target.roleId,
    text,
    alreadyOpen ? undefined : heading,
  );
  // They answered, so the mail has not been ignored. Start the count again.
  await db.profile.updateMany({ where: { userId }, data: { winsQuiet: 0 } });

  return { role, heading, target: resolved.target };
}

/**
 * Has anything landed on a current role since this civil day?
 *
 * Compares the role's `updatedAt`, which is approximate on purpose: any edit to
 * the role counts as "they are still curating this", and the cost of being
 * generous is one more month of a mail they can switch off in one call.
 */
export async function winsSince(userId: string, sinceDay: string): Promise<boolean> {
  const roles = await db.role.findMany({
    where: { userId, isCurrent: true },
    select: { updatedAt: true },
  });
  if (roles.length === 0) return false;
  const zone = await timeZoneOf(userId);
  return roles.some((role) => civilDay(role.updatedAt, zone) >= sinceDay);
}

/**
 * What the monthly mail says.
 *
 * Deliberately short and deliberately not a report. It asks one question, names
 * the role it would land on, and gets out of the way — a monthly mail carrying
 * a dashboard is a monthly mail people filter, which is the same argument the
 * nudge makes about saying nothing on an empty day.
 */
export async function winsContent(userId: string): Promise<DigestContent> {
  const resolved = await resolveWinTarget(userId);
  if (!resolved.ok) {
    return {
      kind: "wins",
      subject: "One thing that went well",
      intro: resolved.reason,
      sections: [],
      // Nothing to land it on, so nothing is sent. The checklist's day-one line
      // is what fixes this, and nagging about it monthly would not.
      empty: true,
    };
  }

  const zone = await timeZoneOf(userId);
  const month = formatIn(new Date(), zone || SERVER_ZONE, { month: "long" });

  return {
    kind: "wins",
    subject: "One thing that went well this month",
    intro:
      `It is the end of ${month}. Name one thing that went well at ${resolved.target.company} — ` +
      `a project that shipped, a number that moved, something somebody thanked you for — and it ` +
      `goes into ${resolved.target.title} while you still remember the detail.`,
    sections: [
      {
        heading: "Why this matters more than it looks",
        lines: [
          "The next search starts from what is written down, and nobody can reconstruct two years of work from memory.",
          "Reply to this, or tell your assistant: log a win.",
        ],
      },
    ],
    empty: false,
  };
}
