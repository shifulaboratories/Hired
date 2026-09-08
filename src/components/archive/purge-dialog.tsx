"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = { kind: "company" | "contact" | "application"; title: string; withIt: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one dialog that is not reassuring.
 *
 * Everything else about the archive is a promise that nothing is lost. This is
 * the place that stops being true, so the body is built from the selection
 * rather than from boilerplate: "delete 4 items" and "delete Stripe and the 3
 * applications archived with it" are different sentences, and only one of them
 * tells somebody what they are about to lose.
 */
export function PurgeDialog({
  open,
  onOpenChange,
  rows,
  pending,
  onConfirm,
  emptying,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Row[];
  pending: boolean;
  onConfirm: () => void;
  /** The whole-bin variant, which names no rows because there are too many. */
  emptying?: number;
}) {
  const sweeping = rows.filter((row) => row.kind === "company" && row.withIt);

  const body = emptying
    ? `${plural(emptying, "item", "items")} will be deleted for good. This cannot be undone, and there is no second bin behind it.`
    : [
        "This cannot be undone, and there is no second bin behind it.",
        sweeping.length > 0 &&
          `Deleting ${sweeping.map((row) => row.title).join(", ")} also deletes the applications archived with ${sweeping.length === 1 ? "it" : "them"}, and their timelines.`,
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {emptying
              ? "Empty the archive?"
              : `Delete ${plural(rows.length, "item", "items")} for good?`}
          </DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep them
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {emptying ? "Empty it" : "Delete for good"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
