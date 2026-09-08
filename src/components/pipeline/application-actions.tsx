"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ClockIcon,
  ExternalLinkIcon,
  MessageSquarePlusIcon,
  MoreVerticalIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVITY_LABEL, ACTIVITY_OPTIONS, STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import type { ActivityType, Stage } from "@prisma/client";
import {
  addActivityAction,
  deleteApplicationAction,
  logFollowUpAction,
  moveStageAction,
  snoozeFollowUpAction,
} from "@/server/actions";
import { cn } from "@/lib/utils";
import { linkHref } from "@/lib/social";

export type ActionTarget = {
  id: string;
  company: string;
  roleTitle: string;
  stage: Stage;
  jobUrl: string;
};

/**
 * The verbs, on the object you are already looking at.
 *
 * The board had none at all: moving a stage meant dragging, and logging what
 * happened meant opening the panel, finding the box and closing it again. One
 * component for the board card and the list row, because two menus offering
 * different things on the same application is how a product starts feeling
 * arbitrary.
 *
 * Every handler stops the event rather than preventing it. Radix composes its
 * own trigger handler after the child's and skips it entirely when the event
 * is already defaultPrevented, so preventDefault here would open nothing —
 * and the failure is silent.
 */
export function ApplicationActions({
  application,
  onDone,
  className,
}: {
  application: ActionTarget;
  /** Called after any write, so a board can refresh without a full reload. */
  onDone?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [logging, setLogging] = useState(false);
  const [body, setBody] = useState("");
  const [type, setType] = useState<ActivityType>("NOTE");
  const posting = linkHref(application.jobUrl);

  const run = (work: () => Promise<unknown>, done: string) => {
    startTransition(async () => {
      try {
        await work();
        toast.success(done);
        onDone?.();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That did not work.");
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${application.company}`}
            className={cn("text-faint hover:text-foreground", className)}
            // The board's sensors are MouseSensor and TouchSensor, which
            // listen for mousedown and touchstart — not pointerdown — so
            // stopping only the pointer event let a press on the menu start a
            // drag. Stopped rather than prevented: Radix skips its own trigger
            // handler when the event is already defaultPrevented, and the
            // menu would silently never open.
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        {/* The menu and the dialog portal out of the card, but React's
            synthetic events still bubble through the React tree — so a press
            inside either would reach the draggable that rendered them. */}
        <DropdownMenuContent
          align="end"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {STAGES.map((stage) => (
                <DropdownMenuItem
                  key={stage}
                  disabled={pending || stage === application.stage}
                  onSelect={() =>
                    run(
                      () => moveStageAction(application.id, stage),
                      `${application.company} → ${STAGE_LABEL[stage]}`,
                    )
                  }
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: STAGE_TONE[stage] }}
                  />
                  {STAGE_LABEL[stage]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem onSelect={() => setLogging(true)}>
            <MessageSquarePlusIcon /> Log what happened
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ClockIcon /> Follow-up
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                disabled={pending}
                onSelect={() =>
                  run(() => logFollowUpAction(application.id), "Logged, and back in a week")
                }
              >
                Chased it — log and come back in a week
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {[3, 7, 14].map((days) => (
                <DropdownMenuItem
                  key={days}
                  disabled={pending}
                  onSelect={() =>
                    run(() => snoozeFollowUpAction(application.id, days), `Snoozed ${days} days`)
                  }
                >
                  Push out {days} days
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {posting && (
            <DropdownMenuItem asChild>
              <a href={posting} target="_blank" rel="noreferrer noopener">
                <ExternalLinkIcon /> Open the posting
              </a>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (
                !confirm(
                  `Delete the ${application.company} application? Its timeline and tasks go with it, and you can restore all of it from the archive.`,
                )
              )
                return;
              run(() => deleteApplicationAction(application.id), "Deleted");
            }}
          >
            <Trash2Icon /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={logging} onOpenChange={setLogging}>
        <DialogContent
          className="max-w-lg"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Log what happened</DialogTitle>
            <DialogDescription>
              {application.company} — {application.roleTitle}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (body.trim()) {
                    run(
                      () => addActivityAction({ applicationId: application.id, type, body: body.trim() }),
                      "Logged",
                    );
                    setBody("");
                    setLogging(false);
                  }
                }
              }}
              placeholder="Recruiter call went well — they want a system design round next week."
              className="min-h-24"
            />
            <Select value={type} onValueChange={(value) => setType(value as ActivityType)}>
              <SelectTrigger size="sm" className="w-40" aria-label="Kind of touch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ACTIVITY_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLogging(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={!body.trim() || pending}
              onClick={() => {
                run(
                  () => addActivityAction({ applicationId: application.id, type, body: body.trim() }),
                  "Logged",
                );
                setBody("");
                setLogging(false);
              }}
            >
              Log it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
