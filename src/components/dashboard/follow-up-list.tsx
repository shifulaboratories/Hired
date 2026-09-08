"use client";

import Link from "next/link";
import { useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClockIcon, CheckIcon, ClockIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import type { Stage } from "@prisma/client";
import {
  logContactFollowUpAction,
  logFollowUpAction,
  snoozeContactFollowUpAction,
  snoozeFollowUpAction,
} from "@/server/actions";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  company: string;
  roleTitle: string;
  /** Null for a person — contacts have no pipeline stage. */
  stage: Stage | null;
  due: string;
  overdue: boolean;
  /** Where the row goes and which snooze applies. */
  kind: "application" | "contact";
};

export function FollowUpList({
  items,
  started = true,
}: {
  items: Item[];
  /**
   * Whether there is anything that COULD be chased. An empty list means two
   * different things and the card was only ever saying one of them: a brand-new
   * account got a green tick and "Every follow-up is scheduled for later",
   * which is a congratulation for work nobody has done, on the same screen as
   * a setup strip saying they have not started.
   */
  started?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const snooze = (item: Item, days: number) => {
    startTransition(async () => {
      if (item.kind === "contact") await snoozeContactFollowUpAction(item.id, days);
      else await snoozeFollowUpAction(item.id, days);
      toast.success(days === 1 ? "Snoozed to tomorrow" : `Snoozed ${days} days`);
    });
  };

  // The other half, and the honest one: snoozing records nothing, so a list
  // cleared by snoozing looks exactly like one that was worked.
  const logged = (item: Item) => {
    startTransition(async () => {
      try {
        if (item.kind === "contact") await logContactFollowUpAction(item.id);
        else await logFollowUpAction(item.id);
        toast.success("Logged, and back in a week");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not log that.");
      }
    });
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="bg-success-tint text-success mb-3 flex size-10 items-center justify-center rounded-xl">
          <AlarmClockIcon className="size-4" />
        </div>
        <p className="text-[13px] font-medium">
          {started ? "Nothing to chase" : "Nothing to chase yet"}
        </p>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {started
            ? "Every follow-up is scheduled for later."
            : "Move a job along on the board and its next follow-up date sets itself."}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.li
            key={item.id}
            layout
            exit={{ opacity: 0, height: 0 }}
            className="group flex flex-wrap items-center gap-3 py-2 first:pt-0"
          >
            <div
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                item.overdue ? "bg-destructive" : "bg-warning",
              )}
            />
            <Link
              href={item.kind === "contact" ? `/crm/contacts/${item.id}` : `/applications/${item.id}`}
              className="min-w-0 flex-1"
            >
              <div className="truncate text-[13px] font-medium group-hover:underline">
                {item.company}
              </div>
              <div className="text-faint truncate text-[12px]">{item.roleTitle}</div>
            </Link>
            {item.stage ? (
              <span
                className="stage-chip shrink-0 rounded-chip px-1.5 py-0.5 text-[11px] font-medium"
                style={{ ["--tone" as string]: STAGE_TONE[item.stage] }}
              >
                {STAGE_LABEL[item.stage]}
              </span>
            ) : (
              <span className="text-faint shrink-0 rounded-chip px-1.5 py-0.5 text-[11px]">
                Ping
              </span>
            )}
            <span
              className={cn(
                "nums w-20 text-right text-[12px]",
                item.overdue ? "text-destructive font-medium" : "text-muted-foreground",
              )}
            >
              {item.due}
            </span>
            {/* Not hidden until hover any more. These are the only actions on
                the dashboard's main card, and a touch device has no hover: the
                primary verb was unreachable on a phone. */}
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="xs"
                disabled={pending}
                onClick={() => logged(item)}
                title="Log that you chased it, and come back in a week"
              >
                <CheckIcon /> Logged it
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                disabled={pending}
                onClick={() => snooze(item, 3)}
                title="Push it out three days without logging anything"
              >
                <ClockIcon /> 3d
              </Button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
