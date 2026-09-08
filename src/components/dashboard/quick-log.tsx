"use client";

import { useState, useTransition } from "react";
import { CheckIcon, CornerDownLeftIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTIVITY_LABEL, STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import { isConfident, type QuickLogMatch, type QuickLogReading } from "@/lib/quick-log";
import { commitQuickLogAction, readQuickLogAction } from "@/server/actions";
import type { ActivityType, Stage } from "@prisma/client";
import { cn } from "@/lib/utils";

/**
 * One line in, one logged touch out.
 *
 * The way a person reports their week is a sentence — "recruiter called about
 * Stripe, wants a system design round" — and until now the only way to file
 * that was to find the card, open it, pick a type and type it again. The
 * matching is deterministic and it always shows its work: what it thinks you
 * meant is on screen before anything is written, because a wrong guess
 * written silently is worse than no guess.
 *
 * It is one line, one match, one write. It is not a chat box, and there is
 * nothing here an assistant should be doing instead — over MCP the same
 * sentence resolves through list_applications and log_activity, which read
 * your pipeline better than any table of stopwords can.
 */
export function QuickLog() {
  const [text, setText] = useState("");
  const [reading, setReading] = useState<QuickLogReading | null>(null);
  const [chosen, setChosen] = useState<QuickLogMatch | null>(null);
  const [withStage, setWithStage] = useState(true);
  const [reading_, startReading] = useTransition();
  const [writing, startWriting] = useTransition();

  const read = () => {
    const line = text.trim();
    if (!line) return;
    startReading(async () => {
      try {
        const result = await readQuickLogAction(line);
        setReading(result);
        setChosen(isConfident(result.matches) ? result.matches[0] : null);
        setWithStage(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not read that.");
      }
    });
  };

  const reset = () => {
    setText("");
    setReading(null);
    setChosen(null);
  };

  // Only offered when the words name a stage the application is not already in.
  const stageMove =
    reading?.stage && chosen && reading.stage !== chosen.stage ? (reading.stage as Stage) : null;

  const commit = () => {
    if (!chosen) return;
    startWriting(async () => {
      try {
        await commitQuickLogAction({
          applicationId: chosen.id,
          body: text.trim(),
          type: (reading?.type ?? "NOTE") as ActivityType,
          stage: stageMove && withStage ? stageMove : null,
        });
        toast.success(
          stageMove && withStage
            ? `Logged, and moved to ${STAGE_LABEL[stageMove]}`
            : `Logged against ${chosen.company}`,
        );
        reset();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not log that.");
      }
    });
  };

  return (
    <div className="bg-card shadow-card rounded-xl p-3">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (reading) setReading(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (reading && chosen ? commit : read)();
            if (event.key === "Escape") reset();
          }}
          placeholder="Recruiter called about Stripe — they want a system design round"
          aria-label="Log what happened"
          className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        <Button
          variant={reading && chosen ? "default" : "outline"}
          size="sm"
          disabled={!text.trim() || reading_ || writing}
          onClick={() => (reading && chosen ? commit() : read())}
        >
          {reading_ || writing ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : reading && chosen ? (
            <CheckIcon />
          ) : (
            <CornerDownLeftIcon />
          )}
          {reading && chosen ? "Log it" : "Read it"}
        </Button>
      </div>

      {reading && (
        <div className="mt-2.5 border-t pt-2.5">
          {reading.matches.length === 0 ? (
            <p className="text-muted-foreground text-[12.5px]">
              Nothing on your board matches that. Name the company in the line — &ldquo;spoke
              to Stripe today&rdquo; — or open the application and log it there.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-faint text-[11.5px]">
                  {chosen ? "Logging against" : "Which one?"}
                </span>
                {reading.matches.map((match) => (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => setChosen(chosen?.id === match.id ? null : match)}
                    className={cn(
                      "rounded-chip flex items-center gap-1.5 px-2 py-1 text-[12px] transition-colors",
                      chosen?.id === match.id
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: STAGE_TONE[match.stage as Stage] }}
                    />
                    {match.company}
                    <span className="text-faint">{match.roleTitle}</span>
                  </button>
                ))}
              </div>

              <div className="text-faint mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                <span>Filed as {ACTIVITY_LABEL[(reading.type ?? "NOTE") as ActivityType]}</span>
                {stageMove && (
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={withStage}
                      onChange={(event) => setWithStage(event.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    Also move to {STAGE_LABEL[stageMove]}
                  </label>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="hover:text-foreground ml-auto flex items-center gap-1"
                >
                  <XIcon className="size-3" /> Clear
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
