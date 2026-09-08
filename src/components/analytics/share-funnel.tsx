"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CopyIcon, DownloadIcon, ImageIcon, Loader2Icon, ShareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Getting the chart out of the app.
 *
 * The SVG is a plain download link, because nothing about it can fail. The PNG
 * is fetched rather than linked: a host with no Chromium answers 503 with a
 * sentence explaining itself, and an anchor would navigate the person to a page
 * of JSON instead of telling them to take the SVG. Fetching lets the answer
 * arrive as a toast and leaves them where they were.
 *
 * "Copy image" only appears where the browser can actually do it — Firefox has
 * no ClipboardItem for PNGs — so the menu never offers something that silently
 * does nothing.
 */
export function ShareFunnel({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState<null | "download" | "copy">(null);

  async function fetchPng() {
    const response = await fetch("/api/funnel/png");
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? "Could not render that image.");
    }
    return response.blob();
  }

  /** A blob to the downloads folder, without a round trip through the server. */
  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPng() {
    setBusy("download");
    try {
      save(await fetchPng(), `hired-funnel-${new Date().toISOString().slice(0, 10)}.png`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not render that image.");
    } finally {
      setBusy(null);
    }
  }

  async function copyPng() {
    setBusy("copy");
    try {
      // The write has to be started from this click, so the promise goes into
      // ClipboardItem rather than being awaited first: Safari drops the
      // permission the moment an await lands between gesture and write.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": fetchPng() })]);
      toast.success("Copied. Paste it anywhere that takes an image.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy that image.");
    } finally {
      setBusy(null);
    }
  }

  const canCopy = typeof window !== "undefined" && typeof ClipboardItem !== "undefined";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled || busy !== null}>
          {busy ? <Loader2Icon className="animate-spin" /> : <ShareIcon />}
          Share chart
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-faint text-[11px] font-normal">
          Your funnel as a picture. No names, no companies — just the shape.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canCopy && (
          <DropdownMenuItem onSelect={() => void copyPng()}>
            <CopyIcon /> Copy image
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void downloadPng()}>
          <ImageIcon /> Download PNG
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/api/funnel/svg" download>
            <DownloadIcon /> Download SVG
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
