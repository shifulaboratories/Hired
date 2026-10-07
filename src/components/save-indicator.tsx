"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import type { SaveState } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";

export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  const content =
    state === "saving"
      ? { icon: <LoaderCircleIcon className="size-3 animate-spin" />, text: "Saving", tone: "text-muted-foreground" }
      : state === "saved"
        ? { icon: <CheckIcon className="size-3" />, text: "Saved", tone: "text-[var(--success)]" }
        : state === "error"
          ? { icon: <TriangleAlertIcon className="size-3" />, text: "Save failed", tone: "text-destructive" }
          : state === "conflict"
            ? { icon: <TriangleAlertIcon className="size-3" />, text: "Changed elsewhere — not saved", tone: "text-destructive" }
            : state === "dirty"
              ? { icon: <span className="bg-muted-foreground/60 size-1.5 rounded-full" />, text: "Unsaved", tone: "text-muted-foreground" }
              : null;

  return (
    <div className={cn("flex h-4 items-center", className)}>
      <AnimatePresence mode="wait">
        {content && (
          <motion.div
            key={state}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.18 }}
            className={cn("flex items-center gap-1.5 text-[11px] font-medium", content.tone)}
          >
            {content.icon}
            {content.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
