"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TagPicker } from "@/components/tags/tag-picker";
import type { TagValue } from "@/components/tags/tag-chip";
import type { TagKind } from "@prisma/client";

/**
 * What you can do to a selection.
 *
 * Appears only when something is ticked — a toolbar you did not ask for is
 * clutter — and it lives inside the list component rather than beside it, so
 * filtering down to nothing does not unmount the bar and silently throw the
 * selection away.
 *
 * Tagging adds and removes rather than replacing. "Tag these nine as fintech"
 * must not mean stripping the size and location off all nine, which is what a
 * replace would do.
 */
export function SelectionBar({
  ids,
  what,
  tagKind,
  onTag,
  onArchive,
  exportHref,
  onClear,
  extra,
}: {
  ids: string[];
  what: { one: string; many: string };
  tagKind: TagKind;
  onTag: (ids: string[], change: { add?: string[]; remove?: string[] }) => Promise<unknown>;
  onArchive: (ids: string[]) => Promise<{ archived: { title: string }[] }>;
  exportHref: string;
  onClear: () => void;
  /** Anything only one of the two lists offers. */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<TagValue[]>([]);

  const noun = ids.length === 1 ? what.one : what.many;

  const act = (work: () => Promise<unknown>, done: (result: never) => string) =>
    startTransition(async () => {
      try {
        const result = await work();
        toast.success(done(result as never));
        onClear();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not do that.");
      }
    });

  const tag = (next: TagValue[]) => {
    const added = next.filter((tag) => !adding.some((had) => had.id === tag.id));
    const removed = adding.filter((had) => !next.some((tag) => tag.id === had.id));
    setAdding(next);
    if (added.length === 0 && removed.length === 0) return;
    startTransition(async () => {
      try {
        await onTag(ids, { add: added.map((t) => t.id), remove: removed.map((t) => t.id) });
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not change those tags.");
      }
    });
  };

  return (
    <div className="bg-card shadow-card mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
      <span className="nums shrink-0 text-[12.5px] font-medium">
        {ids.length} selected
      </span>

      <div className="min-w-0 flex-1 sm:max-w-56">
        <TagPicker
          kind={tagKind}
          value={adding}
          onChange={tag}
          placeholder="Tag all of them"
          className="[&>div:first-child]:hidden"
        />
      </div>

      {extra}

      <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
        <a href={exportHref} download>
          <DownloadIcon /> Export
        </a>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        disabled={pending}
        onClick={() =>
          act(
            () => onArchive(ids),
            (result: { archived: { title: string }[] }) =>
              `${result.archived.length} ${result.archived.length === 1 ? what.one : what.many} moved to the archive`,
          )
        }
      >
        <Trash2Icon /> Delete {noun}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground ml-auto"
        onClick={onClear}
        disabled={pending}
      >
        <XIcon /> Clear
      </Button>
    </div>
  );
}
