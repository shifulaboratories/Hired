"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PurgeDialog } from "@/components/archive/purge-dialog";
import { emptyArchiveAction } from "@/server/actions";

/** Hidden entirely when the bin is empty: there is nothing to empty. */
export function EmptyArchiveButton({ total }: { total: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const empty = () =>
    startTransition(async () => {
      try {
        const result = await emptyArchiveAction();
        toast.success(`${result.total} deleted for good`);
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not empty the archive.");
      }
    });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2Icon /> Empty the archive
      </Button>
      <PurgeDialog
        open={open}
        onOpenChange={setOpen}
        rows={[]}
        emptying={total}
        pending={pending}
        onConfirm={empty}
      />
    </>
  );
}
