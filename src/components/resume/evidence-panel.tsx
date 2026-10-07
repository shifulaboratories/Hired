"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  GitBranchIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CorrespondenceCard, type CorrespondenceAccess } from "@/components/google/correspondence-card";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/stages";
import { resumeEvidenceAction, setResumeBaseAction } from "@/server/actions";
import type { Stage } from "@prisma/client";
import { cn } from "@/lib/utils";

type Evidence = Awaited<ReturnType<typeof resumeEvidenceAction>>;

export type LinkedApplication = {
  id: string;
  roleTitle: string;
  stage: Stage;
  company: string;
  appliedAt: string | null;
};

/**
 * What stands behind this document, and where it went.
 *
 * The compare-to-base view beside it answers "what changed"; this answers the
 * two questions it cannot — which of your own material backs each claim, and
 * which jobs this document was actually sent to. It also says what the
 * document was tailored from, which is the only place that can be set for a
 * resume that was not made by duplicating one.
 *
 * Read from what is SAVED, and the editor flushes its autosave before opening:
 * evidence for a document you are still typing is evidence for a document that
 * does not exist yet.
 */
export function EvidencePanel({
  resumeId,
  base,
  siblings,
  applications,
  googleAccess,
  onOpen,
}: {
  resumeId: string;
  base: { id: string; name: string } | null;
  /** Every other resume, for saying which one this was tailored from. */
  siblings: { id: string; name: string }[];
  applications: LinkedApplication[];
  /** Whether Gmail and Calendar are connected, for the mail behind those applications. */
  googleAccess: CorrespondenceAccess;
  /** Flush the editor's autosave. The diff reads saved data, not the screen. */
  onOpen: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [tab, setTab] = useState<"evidence" | "sent">("evidence");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const load = () => {
    startLoading(async () => {
      try {
        await onOpen();
        setEvidence(await resumeEvidenceAction(resumeId));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not read the evidence.");
      }
    });
  };

  const pickBase = (value: string) => {
    startSaving(async () => {
      try {
        await setResumeBaseAction(resumeId, value === "none" ? null : value);
        setEvidence(await resumeEvidenceAction(resumeId));
        toast.success(value === "none" ? "Unlinked" : "Base set");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not set that base.");
      }
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <GitBranchIcon /> Evidence
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-xl sm:p-6">
          <SheetTitle>Evidence</SheetTitle>
          <SheetDescription className="sr-only">
            The material behind each bullet in this resume, and the applications it was sent
            to.
          </SheetDescription>

          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-faint text-[12px]">Tailored from</span>
              <Select
                value={base?.id ?? "none"}
                onValueChange={pickBase}
                disabled={saving || loading}
              >
                <SelectTrigger size="sm" className="w-56">
                  <SelectValue placeholder="Nothing yet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nothing — this is an original</SelectItem>
                  {siblings.map((sibling) => (
                    <SelectItem key={sibling.id} value={sibling.id}>
                      {sibling.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-1 border-b">
              {(
                [
                  ["evidence", "Evidence"],
                  ["sent", `Sent to ${applications.length}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={cn(
                    "-mb-px border-b-2 px-2 py-1.5 text-[12.5px] transition-colors",
                    tab === key
                      ? "border-foreground text-foreground font-medium"
                      : "text-muted-foreground border-transparent hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading && (
              <div className="flex justify-center py-8">
                <LoaderCircleIcon className="text-faint size-5 animate-spin" />
              </div>
            )}

            {!loading && tab === "evidence" && evidence && (
              <div className="space-y-3">
                <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                  Which of your own notes stand behind each claim, matched on the words
                  themselves. {evidence.unbacked > 0 ? (
                    <>
                      <span className="text-foreground font-medium">
                        {evidence.unbacked}
                      </span>{" "}
                      of {evidence.bullets.length}{" "}
                      {evidence.unbacked === 1 ? "has" : "have"} nothing behind them yet —
                      those are the lines you cannot expand on from your own material.
                    </>
                  ) : (
                    <>Every bullet here traces back to something you wrote down.</>
                  )}
                </p>
                {evidence.bullets.map((row, index) => (
                  <div key={index} className="border-l-2 pl-3">
                    <div className="text-faint text-[11px]">{row.entry}</div>
                    <div className="text-[12.5px]">{row.bullet}</div>
                    {row.evidence.length === 0 ? (
                      <div className="text-[var(--warning)] mt-0.5 text-[11.5px]">
                        Nothing in Me says this yet
                      </div>
                    ) : (
                      row.evidence.map((hit) => (
                        <div key={hit.highlightId ?? hit.text} className="text-muted-foreground mt-0.5 text-[11.5px]">
                          {Math.round(hit.similarity * 100)}% · {hit.text}
                          {hit.role && <span className="text-faint"> · {hit.role}</span>}
                        </div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}

            {!loading && tab === "sent" && (
              <div className="space-y-2">
                {applications.length === 0 ? (
                  <p className="text-muted-foreground text-[13px]">
                    This document has not gone anywhere yet. Attach it to an application and it
                    shows up here.
                  </p>
                ) : (
                  applications.map((application) => (
                    <Link
                      key={application.id}
                      href={`/applications/${application.id}`}
                      className="bg-inset hover:bg-accent flex items-center gap-2 rounded-control p-2 transition-colors"
                    >
                      <BriefcaseIcon className="text-muted-foreground size-3.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{application.company}</div>
                        <div className="text-faint truncate text-[11.5px]">
                          {application.roleTitle}
                        </div>
                      </div>
                      <span
                        className="stage-chip shrink-0 rounded-chip px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ ["--tone" as string]: STAGE_TONE[application.stage] }}
                      >
                        {STAGE_LABEL[application.stage]}
                      </span>
                    </Link>
                  ))
                )}

                {/* The mail and meetings behind those applications — what came
                    back after this document went out. */}
                {applications.length > 0 && (
                  <div className="pt-3">
                    <p className="text-faint mb-2 text-[11.5px] font-medium tracking-wide uppercase">
                      Email &amp; calendar
                    </p>
                    <CorrespondenceCard subject={{ kind: "resume", id: resumeId }} access={googleAccess} bare />
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
