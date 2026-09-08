"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2Icon,
  CircleUserRoundIcon,
  KanbanIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PurgeDialog } from "@/components/archive/purge-dialog";
import { deleteArchivedAction, restoreRecordsAction } from "@/server/actions";
import { cn } from "@/lib/utils";

export type BinRow = {
  kind: "company" | "contact" | "application";
  id: string;
  title: string;
  subtitle: string;
  withIt: string;
  archivedAgo: string;
  /** "in 23 days", "today", or "never" when retention is off. */
  goesIn: string;
  /** Days left, for colouring. Null when nothing is scheduled. */
  daysLeft: number | null;
  nameTaken: boolean;
};

const ICON = {
  company: Building2Icon,
  contact: CircleUserRoundIcon,
  application: KanbanIcon,
};

const KIND_LABEL = { company: "Company", contact: "Person", application: "Application" };

/**
 * The bin.
 *
 * Restoring acts immediately — that is not the dangerous direction. Deleting
 * for good goes through a dialog that states what will go, computed from the
 * selection rather than boilerplate, because "delete 4 items" and "delete
 * Stripe and the 3 applications archived with it" are different sentences and
 * only one of them is true.
 */
export function ArchiveList({ rows, filtered }: { rows: BinRow[]; filtered: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState(false);
  const [pending, startTransition] = useTransition();

  const key = (row: BinRow) => `${row.kind}:${row.id}`;
  const chosen = useMemo(() => rows.filter((row) => selected.has(key(row))), [rows, selected]);
  const allOn = rows.length > 0 && rows.every((row) => selected.has(key(row)));

  const toggle = (row: BinRow) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key(row))) next.delete(key(row));
      else next.add(key(row));
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (allOn) next.delete(key(row));
        else next.add(key(row));
      }
      return next;
    });

  /** Mixed selections are grouped, so it is usually one call per kind. */
  const byKind = (list: BinRow[]) => {
    const groups = new Map<BinRow["kind"], string[]>();
    for (const row of list) groups.set(row.kind, [...(groups.get(row.kind) ?? []), row.id]);
    return [...groups.entries()];
  };

  const restore = () =>
    startTransition(async () => {
      try {
        let back = 0;
        const refused: string[] = [];
        for (const [kind, ids] of byKind(chosen)) {
          const result = await restoreRecordsAction(kind, ids);
          back += result.restored.length + result.alsoRestored.length;
          refused.push(...result.skipped.map((skip) => skip.reason));
        }
        if (back > 0) toast.success(`${back} restored`);
        // Refusals are the only outcome worth a message when nothing came
        // back — a silent Restore reads as a broken button.
        if (back === 0 && refused.length === 0) toast.error("Nothing was restored.");
        for (const reason of refused.slice(0, 2)) toast.error(reason);
        setSelected(new Set());
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not restore those.");
      }
    });

  const purge = () =>
    startTransition(async () => {
      try {
        let gone = 0;
        for (const [kind, ids] of byKind(chosen)) {
          gone += (await deleteArchivedAction(kind, ids)).deleted.length;
        }
        toast.success(`${gone} deleted for good`);
        setPurging(false);
        setSelected(new Set());
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete those.");
      }
    });

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Trash2Icon}
        title={filtered ? "Nothing matches that" : "Nothing in the archive"}
        description={
          filtered
            ? "Loosen the search or pick a different kind."
            : "Deleting a company, a person or an application puts it here first, so you have time to change your mind."
        }
      />
    );
  }

  return (
    <div>
      {/* The kind chips and the search can take ticked rows off screen. Say
          what is about to happen to how many, rather than counting rows the
          buttons will not touch. */}
      {selected.size > chosen.length && (
        <p className="text-faint mb-2 text-[12.5px]">
          {selected.size - chosen.length} more selected {selected.size - chosen.length === 1 ? "is" : "are"} not on
          this screen, and will be left alone.
        </p>
      )}

      {chosen.length > 0 && (
        <div className="bg-card shadow-card mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
          <span className="nums text-[12.5px] font-medium">{chosen.length} selected</span>
          <Button variant="outline" size="sm" disabled={pending} onClick={restore}>
            <RotateCcwIcon /> Restore
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={pending}
            onClick={() => setPurging(true)}
          >
            <Trash2Icon /> Delete for good
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <XIcon /> Clear
          </Button>
        </div>
      )}

      <PurgeDialog
        open={purging}
        onOpenChange={setPurging}
        rows={chosen}
        pending={pending}
        onConfirm={purge}
      />

      <div className="bg-card shadow-card overflow-hidden rounded-xl">
        <div className="eyebrow bg-inset flex items-center gap-3 px-4 py-2">
          <Checkbox
            checked={allOn}
            onCheckedChange={toggleAll}
            aria-label="Select everything on this screen"
          />
          <div className="min-w-0 flex-1">What it was</div>
          <div className="hidden w-28 shrink-0 sm:block">Kind</div>
          <div className="hidden w-24 shrink-0 text-right md:block">Archived</div>
          <div className="w-28 shrink-0 text-right">Deleted</div>
        </div>

        <ul className="divide-y">
          {rows.map((row) => {
            const Icon = ICON[row.kind];
            return (
              <li
                key={key(row)}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  selected.has(key(row)) && "bg-accent/40",
                )}
              >
                <Checkbox
                  checked={selected.has(key(row))}
                  onCheckedChange={() => toggle(row)}
                  aria-label={`Select ${row.title}`}
                />
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{row.title}</div>
                  <div className="text-faint truncate text-[12px]">
                    {[row.subtitle, row.withIt].filter(Boolean).join(" · ") || "—"}
                  </div>
                  {row.nameTaken && (
                    <div className="text-destructive mt-0.5 text-[11.5px]">
                      A live company has taken this name. Rename that one first, or restore this
                      and merge them.
                    </div>
                  )}
                </div>
                <div className="text-muted-foreground hidden w-28 shrink-0 text-[12px] sm:block">
                  {KIND_LABEL[row.kind]}
                </div>
                <div className="nums text-faint hidden w-24 shrink-0 text-right text-[12px] md:block">
                  {row.archivedAgo}
                </div>
                <div
                  className={cn(
                    "nums w-28 shrink-0 text-right text-[12px]",
                    row.daysLeft === null
                      ? "text-faint"
                      : row.daysLeft <= 0
                        ? "text-destructive font-medium"
                        : row.daysLeft <= 7
                          ? "text-warning font-medium"
                          : "text-faint",
                  )}
                >
                  {row.goesIn}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
