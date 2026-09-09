import type { AuditAction } from "@/lib/data/audit";

/**
 * The cuts worth taking through the audit log.
 *
 * Kept in its own module with no database import so the Log tab — a client
 * component — can render the filter chips without dragging Prisma into the
 * browser bundle. `src/lib/data/audit.ts` imports these to build the query, so
 * a filter means exactly the same thing on both sides.
 *
 * `settings` is the one that did not exist before. Account actions were
 * audited from the start; configuration changes were not, which left the
 * instance's quietest destructive click — clearing the Resend key, after which
 * every invitation silently fails to send — as the one thing nothing recorded.
 */
export const AUDIT_GROUPS = {
  accounts: ["user.role", "user.suspend", "user.reactivate", "user.delete"],
  invites: ["user.invite", "user.invite_revoke", "user.invite_password"],
  passwords: ["user.password_reset"],
  billing: ["billing.link", "billing.unlink"],
  settings: ["settings.change"],
} as const satisfies Record<string, readonly AuditAction[]>;

export type AuditGroup = keyof typeof AUDIT_GROUPS;

export const AUDIT_GROUP_LABEL: Record<AuditGroup, string> = {
  accounts: "Accounts",
  invites: "Invitations",
  passwords: "Passwords",
  billing: "Billing",
  settings: "Settings",
};

/** How each action reads in a list. Shared by every screen that shows a row. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "user.invite": "Invited",
  "user.invite_revoke": "Invitation revoked",
  "user.invite_password": "Invitation password",
  "user.role": "Role changed",
  "user.suspend": "Suspended",
  "user.reactivate": "Reactivated",
  "user.delete": "Deleted",
  "user.password_reset": "Password reset",
  "billing.link": "Billing linked",
  "billing.unlink": "Billing unlinked",
  "settings.change": "Settings changed",
};

/** The ones that took something away. Worth spotting in a wall of rows. */
export const AUDIT_SEVERE = new Set(["user.delete", "user.suspend", "user.password_reset"]);
