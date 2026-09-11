"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Stage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import { cn } from "@/lib/utils";
import {
  createStageTemplateAction,
  deleteStageTemplateAction,
  seedStageTemplatesAction,
  updateStageTemplateAction,
} from "@/server/actions";

/**
 * What should happen when a job reaches a stage.
 *
 * A settings screen rather than something on the board, because it is a rule
 * rather than a record: you set it once and then forget it, which is the whole
 * point. The board shows what it did — the tasks appear on the job, and the
 * toast on the move names them.
 *
 * Two things this screen has to say out loud, because both are surprising:
 * a line fires ONCE per application ever, so going back a stage does not
 * re-add what you ticked; and adding a line never reaches backwards onto jobs
 * that are already there.
 */
export type ChecklistLine = {
  id: string;
  stage: Stage;
  title: string;
  detail: string;
  dueInDays: number | null;
  enabled: boolean;
  firedFor: number;
};

export function StageChecklists({ lines }: { lines: ChecklistLine[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const seed = () =>
    start(async () => {
      try {
        const created = await seedStageTemplatesAction();
        toast.success(
          created === 0
            ? "You already have a checklist on every stage."
            : `Added ${created} ${created === 1 ? "line" : "lines"}. Edit or delete any of them.`,
        );
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not do that.");
      }
    });

  const add = (stage: Stage) =>
    start(async () => {
      try {
        await createStageTemplateAction({ stage, title: "New step", dueInDays: 0 });
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not add that.");
      }
    });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-[15px]">Stage checklists</CardTitle>
          <p className="text-muted-foreground max-w-xl text-xs">
            When a job reaches a stage, put these on your list. Each line fires once per job,
            ever — moving back a stage and forward again does not re-add what you already
            ticked off — and adding a line never reaches backwards onto jobs already there.
          </p>
        </div>
        {lines.length === 0 && (
          <Button size="sm" variant="outline" onClick={seed} disabled={pending}>
            <SparklesIcon /> Use a starting set
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {STAGES.map((stage) => {
          const own = lines.filter((line) => line.stage === stage);
          return (
            <div key={stage} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: STAGE_TONE[stage] }}
                    aria-hidden
                  />
                  {STAGE_LABEL[stage]}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => add(stage)}
                  disabled={pending}
                >
                  <PlusIcon /> Add a step
                </Button>
              </div>

              {own.length === 0 ? (
                <p className="text-faint pl-4 text-xs">Nothing happens at this stage.</p>
              ) : (
                <ul className="space-y-1.5">
                  {own.map((line) => (
                    <LineRow key={line.id} line={line} busy={pending} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function LineRow({ line, busy }: { line: ChecklistLine; busy: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState({
    title: line.title,
    detail: line.detail,
    days: line.dueInDays === null ? "" : String(line.dueInDays),
    enabled: line.enabled,
  });
  const [pending, start] = useTransition();

  const save = useAutosave<typeof values>(async (next) => {
    await updateStageTemplateAction(line.id, {
      title: next.title,
      detail: next.detail,
      dueInDays: next.days.trim() === "" ? null : Math.max(0, Math.round(Number(next.days) || 0)),
      enabled: next.enabled,
    });
  });

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    save.push(next);
  };

  const remove = () =>
    start(async () => {
      try {
        await deleteStageTemplateAction(line.id);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete that.");
      }
    });

  return (
    <li
      className={cn(
        "bg-muted/40 space-y-2 rounded-md px-3 py-2.5",
        !values.enabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <Input
          value={values.title}
          onChange={(event) => set({ title: event.target.value })}
          className="h-8 flex-1 bg-transparent text-[13px]"
          aria-label="What to do"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Input
            value={values.days}
            onChange={(event) => set({ days: event.target.value.replace(/[^0-9]/g, "") })}
            className="nums h-8 w-14 bg-transparent text-center text-[13px]"
            placeholder="—"
            inputMode="numeric"
            aria-label="Days after the move"
          />
          <span className="text-faint w-20 text-[11px]">
            {values.days.trim() === ""
              ? "no due date"
              : values.days === "0"
                ? "days · same day"
                : "days later"}
          </span>
        </div>
        <Switch
          checked={values.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          aria-label="Fire this step"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-faint hover:text-destructive"
          onClick={remove}
          disabled={busy || pending}
          aria-label="Delete this step"
        >
          <Trash2Icon />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={values.detail}
          onChange={(event) => set({ detail: event.target.value })}
          className="h-7 flex-1 bg-transparent text-[11.5px]"
          placeholder="A line of context, shown under it on your list."
          aria-label="Detail"
        />
        <SaveIndicator state={save.state} />
      </div>

      {line.firedFor > 0 && (
        <p className="text-faint text-[11px]">
          Already on {line.firedFor} {line.firedFor === 1 ? "job" : "jobs"}. Editing this line
          leaves those alone, and deleting it leaves them on your list.
        </p>
      )}
    </li>
  );
}
