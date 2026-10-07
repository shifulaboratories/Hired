import type { User, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { sendEmail, waitlistNoticeEmail } from "@/lib/email";
import { createInvite, type InviteResult } from "@/lib/data/users";

/**
 * The waitlist: people who asked for access from hired.tools while the
 * instance is invite-only.
 *
 * Note the shape of this file against the rest of `src/lib/data/`. Everything
 * in me.ts, resumes.ts and pipeline.ts takes `userId` first because it
 * touches one person's content and the compiler has to reject a call site that
 * forgets. Nothing here is anyone's content — a signup is instance-level, like
 * Setting and Invite — so these follow users.ts instead: an `actor` where the
 * caller must be an admin, and no `userId` at all where the caller is the
 * public internet. That is the same distinction users.ts already draws, not a
 * new exception to the rule.
 *
 * `addWaitlistSignup` is the one function in the whole data layer that an
 * unauthenticated request can reach. It is safe to leave open because it
 * grants nothing: it writes a row an admin has to act on, it cannot read
 * anything back, and it answers identically whether or not the address was
 * already there.
 */

/** A signup as the admin screen and the MCP tools see it. */
export type WaitlistEntry = {
  id: string;
  email: string;
  name: string;
  context: string;
  source: string;
  notified: boolean;
  notifyError: string;
  invitedAt: Date | null;
  createdAt: Date;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Long enough to say what you're looking for, short enough not to be a payload. */
const MAX_CONTEXT = 600;
const MAX_NAME = 120;

export type SignupResult =
  /** Stored. `fresh` is false when the address was already on the list. */
  { ok: true; fresh: boolean } | { ok: false; error: string };

/**
 * Record a request for access, and tell the instance owner about it.
 *
 * Public. Called by `POST /api/waitlist` with input that came off the wire, so
 * it validates and truncates rather than trusting anything. Signing up twice is
 * not an error and does not produce a second notification — the row is updated
 * and the caller gets the same answer either way, so the endpoint can't be used
 * to find out who has already asked.
 */
export async function addWaitlistSignup(input: {
  email: string;
  name?: string;
  context?: string;
  source?: string;
}): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That doesn't look like an email address." };

  const name = (input.name ?? "").trim().slice(0, MAX_NAME);
  const context = (input.context ?? "").trim().slice(0, MAX_CONTEXT);
  const source = (input.source ?? "").trim().slice(0, 200);

  const existing = await db.waitlistSignup.findUnique({ where: { email } });
  if (existing) {
    // Keep the better answer if they filled more in the second time.
    await db.waitlistSignup.update({
      where: { email },
      data: { name: name || existing.name, context: context || existing.context },
    });
    return { ok: true, fresh: false };
  }

  const signup = await db.waitlistSignup.create({ data: { email, name, context, source } });

  const settings = await getSettings();
  const owner = await db.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { email: true },
  });

  if (owner) {
    const base = (settings.publicUrl || "").replace(/\/$/, "");
    const total = await db.waitlistSignup.count();
    const sent = await sendEmail({
      to: owner.email,
      settings,
      ...waitlistNoticeEmail({
        instanceName: settings.instanceName,
        email,
        name,
        context,
        source,
        total,
        adminUrl: base ? `${base}/admin` : "",
      }),
    });
    await db.waitlistSignup.update({
      where: { id: signup.id },
      data: { notified: sent.ok, notifyError: sent.ok ? "" : sent.error },
    });
  }

  return { ok: true, fresh: true };
}

/** Newest first, still-waiting first. Admin-only — callers must check. */
export async function listWaitlist(options?: { pendingOnly?: boolean }): Promise<WaitlistEntry[]> {
  return db.waitlistSignup.findMany({
    where: options?.pendingOnly ? { invitedAt: null } : undefined,
    orderBy: [{ invitedAt: "asc" }, { createdAt: "desc" }],
  });
}

export async function waitlistStats() {
  const [total, waiting] = await Promise.all([
    db.waitlistSignup.count(),
    db.waitlistSignup.count({ where: { invitedAt: null } }),
  ]);
  return { total, waiting, invited: total - waiting };
}

/**
 * Turn a request into an actual invite.
 *
 * This is `createInvite` plus a stamp on the request, in that order: if the
 * invite throws — bad address, already a member, a member trying to mint an
 * admin — nothing is marked, so the row stays in the list to be retried. The
 * row is kept rather than deleted so the list remains a record of who asked.
 */
export async function inviteFromWaitlist(input: {
  actor: User;
  id: string;
  role: UserRole;
  baseUrl: string;
}): Promise<InviteResult> {
  const signup = await db.waitlistSignup.findUnique({ where: { id: input.id } });
  if (!signup) throw new Error("That signup is no longer on the list.");

  const result = await createInvite({
    actor: input.actor,
    email: signup.email,
    role: input.role,
    baseUrl: input.baseUrl,
  });

  await db.waitlistSignup.update({
    where: { id: signup.id },
    data: { invitedAt: new Date() },
  });

  return result;
}

/** Drop a request entirely — spam, or someone who asked to be taken off. */
export async function removeWaitlistSignup(id: string) {
  await db.waitlistSignup.deleteMany({ where: { id } });
}

/**
 * Whether this instance takes signups at all.
 *
 * Only an instance with a marketing site in front of it can use the waitlist,
 * and on every other one the endpoint was an anonymous, database-writing
 * address that mailed the owner per signup — enough to spend a small Resend
 * quota, and with it the invites and digests. Open when a landing page is
 * configured, or when the instance has ever had a signup: that second half is
 * what keeps a site that was already posting here working without anybody
 * going back to set a variable. Closed everywhere else, and the admin screens
 * hide the section with it.
 */
export async function waitlistIsOpen(): Promise<boolean> {
  const settings = await getSettings();
  if (settings.landingUrl.trim()) return true;
  return (await db.waitlistSignup.count({ take: 1 })) > 0;
}
