import type { User, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import {
  CLAIMED,
  ensureDefaultConnection,
  generateInviteToken,
  hashPassword,
  isClaimed,
} from "@/lib/auth";
import { generatePassphrase } from "@/lib/passphrase";
import { recordAudit } from "@/lib/data/audit";
import { getSettings } from "@/lib/settings";
import { inviteEmail, sendEmail } from "@/lib/email";

const INVITE_DAYS = 14;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers() {
  const users = await db.user.findMany({
    where: CLAIMED,
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      stripeCustomerId: true,
      invitedBy: { select: { name: true, email: true } },
      // Deliberately NOT filtered on archivedAt, for the same reason
      // instanceStats is not: this is an operator looking at how much an
      // account has on disk, and a row in somebody's archive is still on disk.
      _count: {
        select: {
          roles: true,
          resumes: true,
          applications: true,
          contacts: true,
          companies: true,
          mcpConnections: true,
        },
      },
      // Whether an assistant has ever actually connected. Counts, dates and
      // connection health only — never a single word of anyone's content.
      // "Admins manage accounts, never content" is a promise the README makes,
      // and this select is where it would be broken if it ever were.
      mcpConnections: {
        select: { lastUsedAt: true },
        orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
        take: 1,
      },
    },
  });
  return users.map(({ mcpConnections, ...user }) => ({
    ...user,
    mcpLastUsedAt: mcpConnections[0]?.lastUsedAt ?? null,
  }));
}

/**
 * Reset somebody else's password to a fresh generated one, returned once.
 *
 * The reason this exists: on a hosted instance a locked-out customer has no
 * other way back in, and neither did you. It goes through `canManage`, so an
 * ADMIN cannot reset the SUPER_ADMIN's password — without that check, any
 * admin could take the instance from its owner in one click, which is a
 * privilege escalation dressed as a support feature.
 *
 * Every session that user had is destroyed, because a password reset whose
 * old sessions keep working has not actually locked anyone out.
 */
export async function adminResetPassword(actor: User, userId: string) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("No such user.");
  if (!canManage(actor, target)) throw new Error("You can't reset that user's password.");

  const password = generatePassphrase();
  await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } });
  await db.session.deleteMany({ where: { userId } });

  await recordAudit({
    actor,
    action: "user.password_reset",
    target: { id: target.id, email: target.email },
    // Deliberately not the password. This row is read by every admin and
    // outlives the account.
    detail: "Password reset and all sessions ended",
  });

  return { email: target.email, password };
}

export async function countUsers() {
  return db.user.count({ where: CLAIMED });
}

/**
 * Everything about one account, for the moment someone emails you for help.
 *
 * The list answers "who is on this instance"; this answers "what is going on
 * with this person" — when they joined, who let them in, whether the invite
 * email actually left, whether an assistant has ever connected, whether they
 * are being billed, and what has been done to their account.
 *
 * Note what is counted and what is read. Counts of roles, resumes and
 * applications tell you whether a workspace is in use; they are not its
 * contents, and nothing here selects a single word of anyone's own material. The
 * token on a connection is excluded for the same reason it is only shown once
 * to its owner: it is a credential, and an admin has no use for it.
 *
 * `canManage` is resolved here rather than in the UI so the page and the tool
 * cannot disagree about who is allowed to do what.
 */
export async function getUserDetail(actor: User, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      stripeCustomerId: true,
      invitedBy: { select: { name: true, email: true } },
      // Unfiltered on purpose, as above: row counts for an operator, not a
      // view of anyone's pipeline.
      _count: {
        select: {
          roles: true,
          resumes: true,
          applications: true,
          contacts: true,
          companies: true,
          highlights: true,
          sentInvites: true,
          sessions: true,
        },
      },
      mcpConnections: {
        select: {
          id: true,
          name: true,
          client: true,
          lastUsedAt: true,
          lastUsedFrom: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!user) return null;

  // The invite they came in on, if they came in on one. Matched by address
  // because acceptInvite consumes the token rather than keeping a relation.
  const invite = await db.invite.findFirst({
    where: { email: user.email, acceptedAt: { not: null } },
    orderBy: { acceptedAt: "desc" },
    select: { acceptedAt: true, emailSent: true, emailError: true, createdAt: true },
  });

  return {
    ...user,
    invite,
    billed: Boolean(user.stripeCustomerId),
    manageable: canManage(actor, user),
  };
}

/**
 * Rules that keep an instance from locking itself out:
 * - the super admin can never be deactivated, demoted or deleted
 * - an admin cannot act on another admin, only on members
 */
export function canManage(actor: User, target: { id: string; role: UserRole }) {
  if (actor.id === target.id) return false;
  if (target.role === "SUPER_ADMIN") return false;
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "ADMIN") return target.role === "MEMBER";
  return false;
}

export async function setUserRole(actor: User, userId: string, role: UserRole) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("No such user.");
  if (!canManage(actor, target)) throw new Error("You can't change that user's role.");
  if (role === "SUPER_ADMIN") throw new Error("There can only be one super admin.");
  const updated = await db.user.update({ where: { id: userId }, data: { role } });
  await recordAudit({
    actor,
    action: "user.role",
    target: { id: target.id, email: target.email },
    detail: `${target.role} → ${role}`,
  });
  return updated;
}

export async function setUserActive(actor: User, userId: string, isActive: boolean) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("No such user.");
  if (!canManage(actor, target)) throw new Error("You can't change that user.");
  if (!isActive) await db.session.deleteMany({ where: { userId } });
  const updated = await db.user.update({ where: { id: userId }, data: { isActive } });
  await recordAudit({
    actor,
    action: isActive ? "user.reactivate" : "user.suspend",
    target: { id: target.id, email: target.email },
    detail: isActive ? "Account reactivated" : "Account suspended and sessions ended",
  });
  return updated;
}

/** Deletes the user and, by cascade, everything they owned. */
export async function deleteUser(actor: User, userId: string) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("No such user.");
  if (!canManage(actor, target)) throw new Error("You can't delete that user.");
  const deleted = await db.user.delete({ where: { id: userId } });
  // Written after the row is gone, from values captured before — which is the
  // whole reason the audit table stores emails as text rather than joining.
  await recordAudit({
    actor,
    action: "user.delete",
    target: { id: target.id, email: target.email },
    detail: "Account and all of its content deleted",
  });
  return deleted;
}

export async function changePassword(userId: string, password: string) {
  await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } });
  // Every other device gets signed out; the caller re-establishes its own session.
  await db.session.deleteMany({ where: { userId } });
}

export async function updateOwnAccount(userId: string, patch: { name?: string; email?: string }) {
  const data: { name?: string; email?: string; emailProvenAt?: Date | null } = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase();
    const clash = await db.user.findFirst({ where: { email, id: { not: userId } } });
    if (clash) throw new Error("That email is already in use.");
    data.email = email;
    // Nothing here proves the person owns the address they just typed, so the
    // instance stops vouching for it. Google sign-in reads this: without it,
    // changing your email to somebody else's would capture their sign-in.
    data.emailProvenAt = null;
  }
  return db.user.update({ where: { id: userId }, data });
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function listInvites() {
  return db.invite.findMany({
    where: { acceptedAt: null },
    orderBy: { createdAt: "desc" },
    include: { invitedBy: { select: { name: true, email: true } } },
  });
}

export type InviteResult = {
  invite: { id: string; email: string; token: string; expiresAt: Date };
  acceptUrl: string;
  emailSent: boolean;
  emailError: string;
};

/**
 * Create an invite and try to email it. If email isn't configured or Resend
 * rejects it, the invite is still valid — the caller shows the link to copy by
 * hand, so the platform is usable before Resend is set up.
 */
export async function createInvite(input: {
  actor: User;
  email: string;
  role: UserRole;
  baseUrl: string;
}): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address.");
  if (input.role === "SUPER_ADMIN") throw new Error("There can only be one super admin.");
  if (input.role === "ADMIN" && input.actor.role !== "SUPER_ADMIN") {
    throw new Error("Only the super admin can invite other admins.");
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing && isClaimed(existing)) throw new Error("Someone with that email is already a member.");

  // Re-inviting the same address replaces the outstanding invite.
  await db.invite.deleteMany({ where: { email, acceptedAt: null } });

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);
  const invite = await db.invite.create({
    data: { email, token, role: input.role, invitedById: input.actor.id, expiresAt },
  });

  const settings = await getSettings();
  const base = (settings.publicUrl || input.baseUrl).replace(/\/$/, "");
  const acceptUrl = `${base}/invite/${token}`;

  const message = inviteEmail({
    instanceName: settings.instanceName,
    inviterName: input.actor.name || input.actor.email,
    acceptUrl,
    expiresInDays: INVITE_DAYS,
  });
  const sent = await sendEmail({ to: email, ...message, settings });

  await db.invite.update({
    where: { id: invite.id },
    data: { emailSent: sent.ok, emailError: sent.ok ? "" : sent.error },
  });

  await recordAudit({
    actor: input.actor,
    action: "user.invite",
    target: { email },
    // Never the token: the audit log is readable by every admin, and the token
    // is the credential that accepts the invitation.
    detail: `Invited as ${input.role ?? "MEMBER"}${sent.ok ? "" : " (email failed)"}`,
  });

  return {
    invite: { id: invite.id, email, token, expiresAt },
    acceptUrl,
    emailSent: sent.ok,
    emailError: sent.ok ? "" : sent.error,
  };
}

export async function revokeInvite(actor: User, id: string) {
  const invite = await db.invite.findUnique({ where: { id } });
  if (invite) {
    await recordAudit({
      actor,
      action: "user.invite_revoke",
      target: { email: invite.email },
      detail: `Invitation to ${invite.email} revoked`,
    });
  }
  return revokeInviteRow(id);
}

async function revokeInviteRow(id: string) {
  return db.invite.deleteMany({ where: { id, acceptedAt: null } });
}

export async function getInviteByToken(token: string) {
  const invite = await db.invite.findUnique({
    where: { token },
    include: { invitedBy: { select: { name: true, email: true } } },
  });
  if (!invite) return { status: "missing" as const, invite: null };
  if (invite.acceptedAt) return { status: "used" as const, invite };
  if (invite.expiresAt < new Date()) return { status: "expired" as const, invite };
  return { status: "valid" as const, invite };
}

export async function acceptInvite(input: { token: string; name: string; password: string }) {
  const result = await getInviteByToken(input.token);
  if (result.status !== "valid" || !result.invite) {
    throw new Error(
      result.status === "expired"
        ? "That invitation has expired. Ask for a new one."
        : result.status === "used"
          ? "That invitation has already been used."
          : "That invitation link isn't valid.",
    );
  }
  const invite = result.invite;

  const clash = await db.user.findUnique({ where: { email: invite.email } });
  if (clash && isClaimed(clash)) throw new Error("An account with that email already exists.");

  const user = await db.$transaction(async (tx) => {
    const created = clash
      ? await tx.user.update({
          where: { id: clash.id },
          data: {
            name: input.name.trim(),
            passwordHash: hashPassword(input.password),
            role: invite.role,
            isActive: true,
            emailProvenAt: new Date(),
            invitedById: invite.invitedById,
            // A checkout-created invite carries the payer's Stripe customer
            // id; landing it here is what lets billing find them later.
            ...(invite.stripeCustomerId ? { stripeCustomerId: invite.stripeCustomerId } : {}),
          },
        })
      : await tx.user.create({
          data: {
            email: invite.email,
            name: input.name.trim(),
            passwordHash: hashPassword(input.password),
            role: invite.role,
            emailProvenAt: new Date(),
            invitedById: invite.invitedById,
            ...(invite.stripeCustomerId ? { stripeCustomerId: invite.stripeCustomerId } : {}),
          },
        });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return created;
  });

  await ensureDefaultConnection(user.id);
  return user;
}

// ---------------------------------------------------------------------------
// Instance overview, for the admin dashboard and the MCP admin tools
// ---------------------------------------------------------------------------

export async function instanceStats() {
  const [users, active, admins, pendingInvites, roles, resumes, applications] = await Promise.all([
    db.user.count({ where: CLAIMED }),
    db.user.count({ where: { ...CLAIMED, isActive: true } }),
    db.user.count({ where: { ...CLAIMED, role: { in: ["ADMIN", "SUPER_ADMIN"] } } }),
    db.invite.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
    db.role.count(),
    db.resume.count(),
    // Deliberately NOT filtered on archivedAt, unlike every content read in
    // this app. These are an operator's row counts across the instance — how
    // much is on disk — and something in somebody's archive is still on disk.
    db.application.count(),
  ]);
  return { users, active, admins, pendingInvites, roles, resumes, applications };
}
