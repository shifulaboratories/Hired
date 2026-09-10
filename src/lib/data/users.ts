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
      // Answers the support question this page exists for: "they say the app
      // won't let them in" — a standing must-change is the reason, not a bug.
      mustChangePassword: true,
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
 * The one rule about what a password may be, so the accept page, the reset
 * dialog, the settings form and every MCP tool all refuse the same things.
 * Ten characters, which is what the sign-up field has always asked for.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function assertUsablePassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

/**
 * Reset somebody else's password, to one you chose or to a fresh generated
 * passphrase, returned once.
 *
 * The reason this exists: on a hosted instance a locked-out customer has no
 * other way back in, and neither did you. It goes through `canManage`, so an
 * ADMIN cannot reset the SUPER_ADMIN's password — without that check, any
 * admin could take the instance from its owner in one click, which is a
 * privilege escalation dressed as a support feature.
 *
 * Every session that user had is destroyed, because a password reset whose
 * old sessions keep working has not actually locked anyone out.
 *
 * `password` is the one you typed; leave it out and a passphrase is generated,
 * which is what this always did. `mustChange` closes the app to them until they
 * set their own — the point being that after either kind of reset you know a
 * password that opens somebody else's workspace, and the flag is the only thing
 * that takes it back out of your hands.
 *
 * It defaults OFF, and that is a deliberate choice rather than an oversight:
 * the caller is an admin doing this for a person who is usually on the phone to
 * them, and forcing a second password step on somebody you just unlocked is the
 * kind of help nobody asked for. The UI and the tool both put the switch in
 * front of you instead of guessing.
 */
export async function adminResetPassword(
  actor: User,
  userId: string,
  options: { password?: string; mustChange?: boolean } = {},
) {
  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) throw new Error("No such user.");
  if (!canManage(actor, target)) throw new Error("You can't reset that user's password.");

  const chosen = (options.password ?? "").trim();
  if (chosen) assertUsablePassword(chosen);
  const password = chosen || generatePassphrase();
  const mustChange = options.mustChange ?? false;

  await db.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(password), mustChangePassword: mustChange },
  });
  await db.session.deleteMany({ where: { userId } });

  await recordAudit({
    actor,
    action: "user.password_reset",
    target: { id: target.id, email: target.email },
    // Deliberately not the password. This row is read by every admin and
    // outlives the account. Whether it was chosen or generated is safe to say
    // and is the thing you want to know reading this back six months later.
    detail: `${chosen ? "Password set by admin" : "Password reset to a generated one"}${
      mustChange ? ", must be changed at next sign-in" : ""
    }, and all sessions ended`,
  });

  return { email: target.email, password, mustChange };
}

/**
 * Who to ask when you are locked out.
 *
 * There is no self-serve password reset — an admin does it — and the sign-in
 * page said "ask an admin" without naming one, to a person who by definition
 * cannot get in to find out who that is. This is instance-level like everything
 * else in this file's header comment explains: it returns the owner's name and
 * address and nothing else, and it is read on a page nobody has signed in to,
 * so it deliberately carries no other field.
 */
export async function instanceOwnerContact(): Promise<{ name: string; email: string } | null> {
  const owner = await db.user.findFirst({
    where: {
      role: "SUPER_ADMIN",
      isActive: true,
      // Not merely the first super admin: bootstrap leaves a placeholder row
      // with an empty password and a setup-pending address, and naming THAT as
      // the person to email is worse than saying nothing. Same test as
      // isClaimed — somebody has actually taken the account.
      OR: [{ passwordHash: { not: "" } }, { googleId: { not: null } }],
    },
    select: { name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  return owner ? { name: owner.name, email: owner.email } : null;
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
      mustChangePassword: true,
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
  assertUsablePassword(password);
  await db.user.update({
    where: { id: userId },
    // Setting your own password is the only thing that lifts the gate, and it
    // lifts it here rather than in the one screen that happens to be behind it
    // — otherwise changing it from Settings would leave the flag standing.
    data: { passwordHash: hashPassword(password), mustChangePassword: false },
  });
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

/**
 * Outstanding invitations.
 *
 * The select is explicit rather than a bare findMany because the row now
 * carries `passwordHash`, and `admin_list_invites` hands whatever this returns
 * straight to a connected assistant. A scrypt hash is not a password, but it is
 * also not something an admin tool has any reason to emit — so what leaves here
 * is the boolean the callers actually want.
 */
export async function listInvites() {
  const rows = await db.invite.findMany({
    where: { acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      token: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      emailSent: true,
      emailError: true,
      mustChangePassword: true,
      passwordHash: true,
      invitedBy: { select: { name: true, email: true } },
    },
  });
  return rows.map(({ passwordHash, ...invite }) => ({
    ...invite,
    /** Whether the inviter set the password rather than leaving it to the invitee. */
    passwordSet: Boolean(passwordHash),
  }));
}

/**
 * Put a password on an invitation that has already gone out — or take one off.
 *
 * Re-inviting the same address would also do this: `createInvite` replaces the
 * outstanding invite. But it mints a fresh token, so the link you already sent
 * stops working, which is exactly wrong when the reason you are here is that
 * you sent the link and then decided to hand them the password too. This edits
 * the invitation in place and the link keeps working.
 *
 * An empty `password` clears it, putting the invitation back to the normal
 * flow where the accept page asks them to choose one. `mustChange` is only
 * meaningful with a password, and is cleared alongside it.
 *
 * Accepted invitations are not editable here: once somebody has accepted, the
 * invite is spent and the thing you want is `adminResetPassword` on their
 * account, which ends their sessions as well.
 */
export async function setInvitePassword(
  actor: User,
  id: string,
  options: { password?: string; mustChange?: boolean } = {},
) {
  const invite = await db.invite.findUnique({ where: { id } });
  if (!invite) throw new Error("No such invitation.");
  if (invite.acceptedAt) {
    throw new Error("That invitation has been accepted. Reset the password on their account instead.");
  }
  // Same rule as creating one: an ADMIN invitation is the super admin's to
  // issue, so it is also theirs to put a credential on. Without this an admin
  // could set a known password on a pending admin invitation whose link is
  // sitting on the same screen.
  if (invite.role === "ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new Error("Only the super admin can change an admin invitation.");
  }

  const chosen = (options.password ?? "").trim();
  if (chosen) assertUsablePassword(chosen);
  const mustChange = chosen ? (options.mustChange ?? false) : false;

  await db.invite.update({
    where: { id },
    data: { passwordHash: chosen ? hashPassword(chosen) : "", mustChangePassword: mustChange },
  });

  await recordAudit({
    actor,
    action: "user.invite_password",
    target: { email: invite.email },
    // Never the password, and never the token: this row is read by every admin.
    detail: chosen
      ? `Password set on the invitation to ${invite.email}${
          mustChange ? ", must be changed at first sign-in" : ""
        }`
      : `Password removed from the invitation to ${invite.email} — they choose their own again`,
  });

  return { email: invite.email, passwordSet: Boolean(chosen), mustChangePassword: mustChange };
}

export type InviteResult = {
  invite: { id: string; email: string; token: string; expiresAt: Date };
  acceptUrl: string;
  emailSent: boolean;
  emailError: string;
  /** Whether the inviter set the password rather than leaving it to the invitee. */
  passwordSet: boolean;
  mustChangePassword: boolean;
};

/**
 * Create an invite and try to email it. If email isn't configured or Resend
 * rejects it, the invite is still valid — the caller shows the link to copy by
 * hand, so the platform is usable before Resend is set up.
 *
 * `password` is optional and changes what the accept page asks for: without
 * one it asks for a name and a password, the way it always has; with one it
 * asks only for a name, because you already told them the password some other
 * way. It is hashed here and never stored or returned in the clear — the copy
 * you typed is the only copy, which is the same deal as `adminResetPassword`.
 *
 * `mustChangePassword` is off unless you ask for it, matching
 * `adminResetPassword`. On, they replace the password you chose the moment they
 * are through the door, which is what stops you keeping a way into their
 * workspace; off, the password you handed them is simply theirs now.
 */
export async function createInvite(input: {
  actor: User;
  email: string;
  role: UserRole;
  baseUrl: string;
  password?: string;
  mustChangePassword?: boolean;
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

  const chosen = (input.password ?? "").trim();
  if (chosen) assertUsablePassword(chosen);
  const mustChangePassword = input.mustChangePassword ?? false;

  const token = generateInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000);
  const invite = await db.invite.create({
    data: {
      email,
      token,
      role: input.role,
      invitedById: input.actor.id,
      expiresAt,
      passwordHash: chosen ? hashPassword(chosen) : "",
      // Only meaningful with a password on the invite: with none, the invitee
      // picks their own on the accept page and there is nothing to change.
      mustChangePassword: chosen ? mustChangePassword : false,
    },
  });

  const settings = await getSettings();
  const base = (settings.publicUrl || input.baseUrl).replace(/\/$/, "");
  const acceptUrl = `${base}/invite/${token}`;

  const message = inviteEmail({
    instanceName: settings.instanceName,
    inviterName: input.actor.name || input.actor.email,
    acceptUrl,
    expiresInDays: INVITE_DAYS,
    // The email never carries the password — it is the one thing about this
    // invitation that must travel by a different route than the link does.
    // It only says a password is waiting, so the invitee knows to go looking
    // for it rather than assuming the accept page will ask.
    passwordSet: Boolean(chosen),
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
    detail: `Invited as ${input.role ?? "MEMBER"}${
      chosen
        ? `, password set by admin${mustChangePassword ? " and must be changed at first sign-in" : ""}`
        : ""
    }${sent.ok ? "" : " (email failed)"}`,
  });

  return {
    invite: { id: invite.id, email, token, expiresAt },
    acceptUrl,
    emailSent: sent.ok,
    emailError: sent.ok ? "" : sent.error,
    passwordSet: Boolean(chosen),
    mustChangePassword: Boolean(chosen) && mustChangePassword,
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

  // Two ways to arrive here. Either the invitation carries a password the
  // inviter chose and typed the invitee's name is all this page collects, or it
  // does not and they pick one now. Falling back to the invite's hash rather
  // than trusting a blank field is what stops an empty password creating an
  // account nobody can sign in to but everybody can see.
  const passwordHash = input.password
    ? (assertUsablePassword(input.password), hashPassword(input.password))
    : invite.passwordHash;
  if (!passwordHash) throw new Error("Choose a password of at least 10 characters.");
  // A password they chose here is theirs; only one handed to them has to go.
  const mustChangePassword = input.password ? false : invite.mustChangePassword;

  const clash = await db.user.findUnique({ where: { email: invite.email } });
  if (clash && isClaimed(clash)) throw new Error("An account with that email already exists.");

  const user = await db.$transaction(async (tx) => {
    const created = clash
      ? await tx.user.update({
          where: { id: clash.id },
          data: {
            name: input.name.trim(),
            passwordHash,
            mustChangePassword,
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
            passwordHash,
            mustChangePassword,
            role: invite.role,
            emailProvenAt: new Date(),
            invitedById: invite.invitedById,
            ...(invite.stripeCustomerId ? { stripeCustomerId: invite.stripeCustomerId } : {}),
          },
        });
    // The name and address they just typed are the header of every resume they
    // will ever build, and they used to stop at the User row — so a brand-new
    // account opened the resume editor with a blank name and had to type it a
    // second time to find out why. This is now the only thing that puts them on
    // the Profile at signup, since reading one no longer creates it. An empty
    // `update` so a re-run never overwrites something they have since edited by
    // hand.
    await tx.profile.upsert({
      where: { userId: created.id },
      create: { userId: created.id, fullName: input.name.trim(), email: invite.email },
      update: {},
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
