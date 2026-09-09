import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { AUDIT_GROUPS, type AuditGroup } from "@/lib/audit-groups";

/**
 * A record of what an admin did to whose account.
 *
 * This is the one table in the app that is deliberately not scoped to a user —
 * it is instance-level, and only admins can read it. It exists because a
 * service holding other people's career data should be able to answer "who
 * suspended this account, and when", and because an admin who can reset
 * passwords without leaving a trace is an admin nobody can audit.
 *
 * Emails are copied in as text rather than joined, so a row still makes sense
 * after the account it describes is deleted. Deleting a user is exactly the
 * moment you most want the log to remember.
 */

export type AuditAction =
  | "user.invite"
  | "user.invite_revoke"
  | "user.invite_password"
  | "user.role"
  | "user.suspend"
  | "user.reactivate"
  | "user.delete"
  | "user.password_reset"
  | "billing.link"
  | "billing.unlink"
  | "settings.change";

export async function recordAudit(input: {
  actor: Pick<User, "id" | "email">;
  action: AuditAction;
  target?: { id?: string | null; email?: string | null };
  detail?: string;
}) {
  return db.adminAudit.create({
    data: {
      actorId: input.actor.id,
      actorEmail: input.actor.email,
      action: input.action,
      targetId: input.target?.id ?? null,
      targetEmail: input.target?.email ?? "",
      // Never a password, a token or any other secret — this is read by every
      // admin and kept after the account is gone.
      detail: input.detail ?? "",
    },
  });
}

/**
 * Read the log, newest first.
 *
 * Filtering is done here rather than in the browser because the log outlives
 * everything else on the instance: paging through it a hundred rows at a time
 * only works if the filter is applied before the page is cut, not after.
 */
export async function listAudit(options?: {
  limit?: number;
  offset?: number;
  targetId?: string;
  /** One of AUDIT_GROUPS. Anything unrecognised means no filter. */
  group?: string;
  /** Matches either side of the row — who did it, or who it was done to. */
  search?: string;
}) {
  const actions = options?.group
    ? (AUDIT_GROUPS[options.group as AuditGroup] as readonly AuditAction[] | undefined)
    : undefined;
  const search = options?.search?.trim();
  return db.adminAudit.findMany({
    where: {
      ...(options?.targetId ? { targetId: options.targetId } : {}),
      ...(actions ? { action: { in: [...actions] } } : {}),
      ...(search
        ? {
            OR: [
              { actorEmail: { contains: search, mode: "insensitive" as const } },
              { targetEmail: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(options?.limit ?? 100, 500),
    skip: options?.offset ?? 0,
  });
}
