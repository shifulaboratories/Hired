"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, Share2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { sharePipelineAction, unsharePipelineAction } from "@/server/actions";

/**
 * Hand someone a link to the pipeline.
 *
 * The copy here does real work: a person about to send this needs to know
 * exactly what the other end will see, and "read-only" alone does not answer
 * that. Naming what is withheld — salary, notes, contacts — is the difference
 * between sharing confidently and not sharing at all.
 *
 * Two links, not one. When a saved view is open there is a second button that
 * shares only what that view shows, and it is usually the one somebody wants:
 * "everything I have from a referral" is a reasonable thing to send a friend
 * and the whole board is not. They are separate addresses with separate
 * switches, so revoking one leaves the other alone.
 */
export function SharePipeline({
  initial,
  view,
}: {
  initial: { url: string; includeClosed: boolean } | null;
  /** The saved view currently open, and its own link if it has one. */
  view?: { id: string; name: string; share: { url: string; includeClosed: boolean } | null };
}) {
  const router = useRouter();
  const [share, setShare] = useState(initial);
  const [viewShare, setViewShare] = useState(view?.share ?? null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The open view changes as you click around behind the menu.
  const [seenView, setSeenView] = useState(view?.id ?? null);
  if (seenView !== (view?.id ?? null)) {
    setSeenView(view?.id ?? null);
    setViewShare(view?.share ?? null);
  }

  const create = (includeClosed: boolean, savedViewId?: string) =>
    startTransition(async () => {
      try {
        const result = await sharePipelineAction(includeClosed, savedViewId ?? null);
        const next = { url: result.url, includeClosed: result.includeClosed };
        if (savedViewId) setViewShare(next);
        else setShare(next);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not create that link.");
      }
    });

  const revoke = (savedViewId?: string) => {
    if (
      !confirm(
        "Stop sharing? The link stops working for everyone who has it, and sharing again later gives a different address.",
      )
    )
      return;
    startTransition(async () => {
      await unsharePipelineAction(savedViewId ?? null);
      if (savedViewId) setViewShare(null);
      else setShare(null);
      toast.success("Link revoked");
      router.refresh();
    });
  };

  const copy = (which: string, url: string) => {
    if (!url) return;
    void navigator.clipboard?.writeText(url);
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Share2Icon className="size-3.5" />
          {share || viewShare ? "Shared" : "Share"}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80 space-y-3 p-3">
        <LinkPanel
          title="Your whole pipeline"
          share={share}
          pending={pending}
          copied={copied === "all"}
          onCopy={() => copy("all", share?.url ?? "")}
          onCreate={(closed) => create(closed)}
          onRevoke={() => revoke()}
          blurb="Give a friend, a coach or a former manager a read-only link to your whole pipeline so they can help you work out what to chase. No account needed at their end."
        />

        {view && (
          <>
            <div className="border-t" />
            <LinkPanel
              title={`Only "${view.name}"`}
              share={viewShare}
              pending={pending}
              copied={copied === "view"}
              onCopy={() => copy("view", viewShare?.url ?? "")}
              onCreate={(closed) => create(closed, view.id)}
              onRevoke={() => revoke(view.id)}
              blurb={`Share only what this view shows. Everything the view filters out is not in the page at all — it is a narrower link, not a hidden one.`}
            />
          </>
        )}

        <p className="text-muted-foreground text-[12px] leading-snug">
          Whoever opens either link sees companies, roles, stages and follow-up dates. They do
          not see your salaries, notes, contacts or job descriptions, and they cannot change
          anything.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One link and its switches. Two of these, or one on a board with no view
 * open — the alternative was a component that branched on which link it was
 * drawing in six places.
 */
function LinkPanel({
  title,
  blurb,
  share,
  pending,
  copied,
  onCopy,
  onCreate,
  onRevoke,
}: {
  title: string;
  blurb: string;
  share: { url: string; includeClosed: boolean } | null;
  pending: boolean;
  copied: boolean;
  onCopy: () => void;
  onCreate: (includeClosed: boolean) => void;
  onRevoke: () => void;
}) {
  if (!share) {
    return (
      <div className="space-y-2">
        <div className="text-[13px] font-medium">{title}</div>
        <p className="text-muted-foreground text-[12.5px] leading-snug">{blurb}</p>
        <Button size="sm" className="w-full" onClick={() => onCreate(false)} disabled={pending}>
          Create a link
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-medium">{title}</div>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={share.url}
          onFocus={(event) => event.currentTarget.select()}
          className="border-input bg-inset shadow-field rounded-control h-9 min-w-0 flex-1 border px-2 text-[12px] outline-none md:h-8"
        />
        <Button variant="outline" size="sm" onClick={onCopy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>

      <label className="flex items-center gap-2.5 text-[13px]">
        <Switch
          checked={share.includeClosed}
          onCheckedChange={(checked) => onCreate(checked)}
          disabled={pending}
        />
        Include closed applications
      </label>

      <Button
        variant="ghost"
        size="sm"
        className="text-destructive w-full"
        onClick={onRevoke}
        disabled={pending}
      >
        Stop sharing
      </Button>
    </div>
  );
}
