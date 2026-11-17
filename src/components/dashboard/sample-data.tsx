"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConicalIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { loadSampleAction, wipeSampleAction } from "@/server/actions";
import { cn } from "@/lib/utils";

/**
 * The sample search, from the app rather than only from an assistant.
 *
 * Two pieces, shown on the empty Today and Board screens and nowhere else: an
 * offer while the workspace is empty, and a notice while the sample is loaded
 * that says what you are looking at and takes it away again. The wipe keeps
 * anything the person edited, so the notice says which rows it held back.
 */
export function SampleOffer({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <p className={cn("text-muted-foreground text-center text-[13px]", className)}>
      Want to see it working first?{" "}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await loadSampleAction();
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Sample search loaded. Remove it from the note at the top when you're done.");
            router.refresh();
          })
        }
        className="text-primary inline-flex items-center gap-1 font-medium hover:underline disabled:opacity-60"
      >
        {pending && <LoaderCircleIcon className="size-3 animate-spin" />}
        Look around with sample data
      </button>
    </p>
  );
}

export function SampleNotice({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div
      className={cn(
        "border-primary/30 bg-primary-tint flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
        className,
      )}
    >
      <FlaskConicalIcon className="text-primary size-4 shrink-0" />
      <p className="min-w-0 flex-1 text-[13px]">
        You&apos;re looking at a sample search. Anything you add stays when you remove it.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await wipeSampleAction();
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(
              result.kept.length === 0
                ? "Sample removed."
                : `Sample removed. Kept ${result.kept.length} you changed: ${result.kept.slice(0, 3).join(", ")}${result.kept.length > 3 ? "…" : ""}`,
            );
            router.refresh();
          })
        }
      >
        {pending && <LoaderCircleIcon className="animate-spin" />}
        Remove sample data
      </Button>
    </div>
  );
}
