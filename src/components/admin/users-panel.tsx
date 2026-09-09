"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { KeyRoundIcon, MoreVerticalIcon, ShieldIcon, Trash2Icon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import type { UserRole } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ResetPasswordDialog } from "@/components/admin/reset-password-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, initials } from "@/lib/utils";
import { useViewerZone } from "@/components/viewer-zone";
import { formatIn, shortDay } from "@/lib/time";
import {
  deleteUserAction,
  setUserActiveAction,
  setUserRoleAction,
} from "@/server/actions";

type Row = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  invitedBy: string | null;
  counts: {
    roles: number;
    resumes: number;
    applications: number;
    contacts: number;
    companies: number;
    mcpConnections: number;
  };
  /** When an assistant last called in, or null if one never has. */
  mcpLastUsedAt: string | null;
  billed: boolean;
};

const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export function UsersPanel({
  actor,
  users,
}: {
  actor: { id: string; role: UserRole };
  users: Row[];
}) {
  const zone = useViewerZone();
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Which account the reset dialog is open on, null when it is shut. The
  // dialog owns the password it hands back — shown once and never stored
  // anywhere it could be read again, the same contract as the owner password
  // printed at boot — so this panel never sees it.
  const [resetting, setResetting] = useState<{ id: string; email: string } | null>(null);

  // Mirrors canManage() on the server; the server still enforces it.
  const canManage = (target: Row) =>
    target.id !== actor.id &&
    target.role !== "SUPER_ADMIN" &&
    (actor.role === "SUPER_ADMIN" || target.role === "MEMBER");

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(label);
      else toast.error(result.error ?? "That didn't work.");
    });

  const visible = users.filter((user) => !removed.has(user.id));

  return (
    <div className="space-y-2">
      <ResetPasswordDialog
        open={Boolean(resetting)}
        onOpenChange={(open: boolean) => !open && setResetting(null)}
        userId={resetting?.id ?? ""}
        email={resetting?.email ?? ""}
      />

      <AnimatePresence initial={false}>
        {visible.map((user) => (
          <motion.div key={user.id} layout exit={{ opacity: 0, height: 0 }}>
            <Card>
              <CardContent className="flex flex-wrap items-center gap-4 py-3.5">
                <div
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                    user.isActive
                      ? "bg-primary-tint text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {initials(user.name || user.email)}
                </div>

                {/* The name is the way in to the account's own page. The row
                    itself stays a row rather than becoming one big link,
                    because the menu at the end of it is not a navigation. */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/settings/admin/people/${user.id}`}
                      className="hover:text-primary truncate text-sm font-medium"
                    >
                      {user.name || user.email.split("@")[0]}
                    </Link>
                    {user.id === actor.id && (
                      <Badge variant="secondary" className="text-[10px]">
                        you
                      </Badge>
                    )}
                    {!user.isActive && (
                      <Badge variant="warning" className="text-[10px]">
                        suspended
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {user.email}
                    {user.invitedBy && <span> · invited by {user.invitedBy}</span>}
                  </div>
                </div>

                <div className="text-muted-foreground hidden text-xs tabular-nums md:block">
                  {user.counts.roles} roles · {user.counts.resumes} resumes ·{" "}
                  {user.counts.applications} apps · {user.counts.contacts} people
                </div>

                {/* Whether their assistant is actually connected. An account
                    that has never called in is the one to check on — it is
                    usually somebody who never finished setting up. */}
                <div
                  className="text-muted-foreground hidden w-24 text-right text-xs lg:block"
                  title={
                    user.mcpLastUsedAt
                      ? `Assistant last called ${formatIn(new Date(user.mcpLastUsedAt), zone, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}`
                      : "No assistant has ever connected"
                  }
                >
                  {user.mcpLastUsedAt
                    ? `AI ${shortDay(new Date(user.mcpLastUsedAt), zone)}`
                    : user.counts.mcpConnections > 0
                      ? "AI unused"
                      : "no AI"}
                </div>

                <div className="text-muted-foreground hidden w-28 text-right text-xs lg:block">
                  {user.lastLoginAt
                    ? `seen ${shortDay(new Date(user.lastLoginAt), zone)}`
                    : "never signed in"}
                </div>

                <Badge
                  variant={user.role === "MEMBER" ? "outline" : "default"}
                  className="shrink-0"
                >
                  {user.role !== "MEMBER" && <ShieldIcon className="size-2.5" />}
                  {ROLE_LABEL[user.role]}
                </Badge>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canManage(user) || pending}
                      aria-label={`Manage ${user.email}`}
                    >
                      <MoreVerticalIcon />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {user.role === "MEMBER" && actor.role === "SUPER_ADMIN" && (
                      <DropdownMenuItem
                        onSelect={() =>
                          run("Promoted to admin", () => setUserRoleAction(user.id, "ADMIN"))
                        }
                      >
                        <ShieldIcon /> Make admin
                      </DropdownMenuItem>
                    )}
                    {user.role === "ADMIN" && actor.role === "SUPER_ADMIN" && (
                      <DropdownMenuItem
                        onSelect={() =>
                          run("Changed to member", () => setUserRoleAction(user.id, "MEMBER"))
                        }
                      >
                        <UserIcon /> Make member
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() =>
                        run(user.isActive ? "Suspended" : "Reactivated", () =>
                          setUserActiveAction(user.id, !user.isActive),
                        )
                      }
                    >
                      {user.isActive ? "Suspend access" : "Reactivate"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setResetting({ id: user.id, email: user.email })}
                    >
                      <KeyRoundIcon /> Reset password
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        if (
                          confirm(
                            `Delete ${user.email}? This permanently removes their career history, resumes and applications.`,
                          )
                        ) {
                          setRemoved((prev) => new Set(prev).add(user.id));
                          void deleteUserAction(user.id).then((result) => {
                            if (result.ok) toast.success("Account deleted");
                            else toast.error(result.error ?? "Could not delete.");
                          });
                        }
                      }}
                    >
                      <Trash2Icon /> Delete account
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
