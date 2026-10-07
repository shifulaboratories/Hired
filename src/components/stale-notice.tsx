"use client";

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown when an editor's save was refused because the record changed since
 * the page loaded — almost always an assistant writing it in a conversation.
 * Autosave has stopped by then, so whatever is typed next goes nowhere; the
 * honest move is to say so and offer the newer version.
 */
export function StaleNotice({ what }: { what: string }) {
  return (
    <div className="border-destructive/30 bg-destructive/5 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
      <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        This {what} changed somewhere else since you opened it, so your last edit was not saved. Copy
        anything you typed, then reload to see the newer version.
      </span>
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
        <RotateCwIcon /> Reload
      </Button>
    </div>
  );
}
