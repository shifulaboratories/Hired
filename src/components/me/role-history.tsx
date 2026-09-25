"use client";

import { useEffect, useState, useTransition } from "react";
import { HistoryIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { roleHistoryAction, restoreRoleRevisionAction } from "@/server/actions";

/**
 * A role's earlier versions, readable.
 *
 * Every background edit was already kept (list_revisions / restore_revision),
 * but only an assistant could see them — so "what did Claude just change in my
 * Juggernaut role" had no answer on screen. Each version says who caused it
 * and which lines came and went after it, which is exactly what restoring it
 * would undo, so nobody restores blind.
 */

type Row = Awaited<ReturnType<typeof roleHistoryAction>>["rows"][number];

function who(row: Row) {
  if (row.writtenBy === "mcp") return row.connectionName ? `Before ${row.connectionName}` : "Before an assistant";
  return row.tool === "restore_revision" ? "Before a restore" : "Before your edit";
}

export function RoleHistory({
  roleId,
  open,
  onOpenChange,
}: {
  roleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setRows(null);
    void roleHistoryAction(roleId)
      .then((history) => setRows(history.rows))
      .catch(() => setRows([]));
  }, [open, roleId]);

  const restore = (row: Row) => {
    startTransition(async () => {
      try {
        const result = await restoreRoleRevisionAction(roleId, row.id);
        toast.success(result.summary);
        // The editor holds its own copy of every field while you type, so a
        // restore is only honest once the page has read the role again.
        window.location.reload();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not restore that version.");
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-md sm:p-6">
        <SheetTitle className="flex items-center gap-2 pr-8 text-base font-semibold">
          <HistoryIcon className="size-4" /> History
        </SheetTitle>
        <SheetDescription className="text-muted-foreground mt-1 text-sm">
          A copy is kept before each change to this role, one per sitting, up to twenty. Restoring
          one takes back the lines listed under it, and is itself undoable.
        </SheetDescription>

        <div className="mt-5 space-y-2">
          {rows === null && <p className="text-muted-foreground text-sm">Loading…</p>}
          {rows?.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No earlier versions yet. One is kept the next time this role changes.
            </p>
          )}
          {rows?.map((row) => {
            const change = row.changedSince;
            const quiet = change.addedCount === 0 && change.removedCount === 0;
            const showing = expanded === row.id;
            return (
              <div key={row.id} className="rounded-lg border px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{who(row)}</div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(row.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1 text-xs"
                    disabled={pending}
                    onClick={() => restore(row)}
                  >
                    <RotateCcwIcon className="size-3" /> Restore
                  </Button>
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(showing ? null : row.id)}
                  className="text-muted-foreground hover:text-foreground mt-1.5 text-xs tabular-nums"
                  disabled={quiet}
                >
                  {quiet
                    ? "The background has not changed since. Other fields may have."
                    : `${change.addedCount} ${change.addedCount === 1 ? "line" : "lines"} added, ${change.removedCount} removed since${showing ? "" : " — show"}`}
                </button>
                {showing && (
                  <ul className="mt-2 space-y-1 text-[12.5px] leading-snug">
                    {change.added.map((line, index) => (
                      <li key={`a${index}`} className="text-success">
                        + {line}
                      </li>
                    ))}
                    {change.removed.map((line, index) => (
                      <li key={`r${index}`} className="text-destructive">
                        − {line}
                      </li>
                    ))}
                    {change.addedCount + change.removedCount > change.added.length + change.removed.length && (
                      <li className="text-muted-foreground">And more.</li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
