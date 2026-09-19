"use client";

import { useState, useTransition } from "react";
import { CalendarIcon, ChevronDownIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { InterviewFormat, InterviewOutcome, QuestionKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { useViewerZone } from "@/components/viewer-zone";
import { civilDay, shortCivilDay } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  addInterviewQuestionAction,
  deleteInterviewAction,
  deleteInterviewQuestionAction,
  scheduleInterviewAction,
  updateInterviewAction,
  updateInterviewQuestionAction,
} from "@/server/actions";

/**
 * Rounds, on the application they belong to.
 *
 * One tab, not a screen: an interview is a fact about one job, and the reason
 * to look at it is always "what is coming up here" or "what did they ask me
 * last time". Both of those are questions about the thing already open.
 *
 * The questions are the point. Everything else on this panel is scaffolding for
 * getting them written down while somebody still remembers them, which is the
 * hour after an interview and never again.
 */

export type InterviewQuestionValue = {
  id: string;
  kind: QuestionKind;
  question: string;
  answer: string;
  confidence: number;
  better: string;
};

export type InterviewValue = {
  id: string;
  round: number;
  label: string;
  format: InterviewFormat;
  outcome: InterviewOutcome;
  scheduledAt: string | null;
  durationMins: number;
  location: string;
  prep: string;
  debrief: string;
  interviewers: { id: string; name: string }[];
  questions: InterviewQuestionValue[];
};

const FORMAT_LABEL: Record<InterviewFormat, string> = {
  PHONE: "Phone",
  VIDEO: "Video call",
  ONSITE: "Onsite",
  TAKE_HOME: "Take-home",
  PAIRING: "Pairing",
  PANEL: "Panel",
  OTHER: "Other",
};

const OUTCOME_LABEL: Record<InterviewOutcome, string> = {
  SCHEDULED: "Scheduled",
  HELD: "Held, no word yet",
  PASSED: "Passed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  NO_SHOW: "They did not show",
};

const QUESTION_LABEL: Record<QuestionKind, string> = {
  BEHAVIOURAL: "Behavioural",
  TECHNICAL: "Technical",
  SYSTEM_DESIGN: "System design",
  ROLE: "About the role",
  CULTURE: "Culture",
  COMPENSATION: "Money",
  MINE: "You asked them",
  OTHER: "Other",
};

const FORMATS = Object.keys(FORMAT_LABEL) as InterviewFormat[];
const OUTCOMES = Object.keys(OUTCOME_LABEL) as InterviewOutcome[];
const KINDS = Object.keys(QUESTION_LABEL) as QuestionKind[];

/** Outcomes that mean it is over, so the badge can stop looking hopeful. */
const TONE: Record<InterviewOutcome, string> = {
  SCHEDULED: "border-primary/40 text-primary",
  HELD: "border-warning/40 text-warning",
  PASSED: "border-success/40 text-success",
  REJECTED: "border-destructive/40 text-destructive",
  CANCELLED: "text-muted-foreground",
  NO_SHOW: "text-muted-foreground",
};

export function InterviewsPanel({
  applicationId,
  interviews,
}: {
  applicationId: string;
  interviews: InterviewValue[];
}) {
  const zone = useViewerZone();
  const [openId, setOpenId] = useState<string | null>(interviews[0]?.id ?? null);
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      try {
        const id = await scheduleInterviewAction(applicationId, {});
        setOpenId(id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not add that round.");
      }
    });

  const remove = (id: string, questions: number) =>
    start(async () => {
      const warning =
        questions > 0
          ? `Delete this round and the ${questions} question${questions === 1 ? "" : "s"} recorded against it? There is no archive for interviews.`
          : "Delete this round? There is no archive for interviews.";
      if (!window.confirm(warning)) return;
      try {
        await deleteInterviewAction(id);
        if (openId === id) setOpenId(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete that.");
      }
    });

  return (
    <div className="@container space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {interviews.length === 0
            ? "No rounds recorded. Add one when a date is agreed, and write down what they asked straight afterwards — that is what makes the next one easier."
            : `${interviews.length} round${interviews.length === 1 ? "" : "s"}`}
        </p>
        <Button size="sm" onClick={add} disabled={pending}>
          <PlusIcon /> Add a round
        </Button>
      </div>

      {interviews.map((interview) => {
        const open = interview.id === openId;
        const day = interview.scheduledAt
          ? shortCivilDay(civilDay(new Date(interview.scheduledAt), zone))
          : "No date";
        return (
          <div key={interview.id} className="border-border/70 rounded-lg border">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : interview.id)}
              className="hover:bg-muted/40 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
            >
              <ChevronDownIcon
                className={cn("text-faint size-4 shrink-0 transition-transform", !open && "-rotate-90")}
              />
              <span className="truncate text-[13px] font-medium">
                {interview.label || `Round ${interview.round}`}
              </span>
              <Badge variant="outline" className={cn("text-[10px]", TONE[interview.outcome])}>
                {OUTCOME_LABEL[interview.outcome]}
              </Badge>
              <span className="text-faint ml-auto flex items-center gap-1.5 text-[11px] whitespace-nowrap">
                <CalendarIcon className="size-3" />
                {day}
                {interview.questions.length > 0 && (
                  <span className="nums">
                    · {interview.questions.length} q{interview.questions.length === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            </button>

            {open && (
              <InterviewEditor
                key={interview.id}
                interview={interview}
                onDelete={() => remove(interview.id, interview.questions.length)}
                busy={pending}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InterviewEditor({
  interview,
  onDelete,
  busy,
}: {
  interview: InterviewValue;
  onDelete: () => void;
  busy: boolean;
}) {
  const [values, setValues] = useState({
    label: interview.label,
    format: interview.format,
    outcome: interview.outcome,
    scheduledAt: interview.scheduledAt ?? "",
    durationMins: interview.durationMins,
    location: interview.location,
    prep: interview.prep,
    debrief: interview.debrief,
  });
  const [asking, setAsking] = useState("");
  const [pending, start] = useTransition();

  const save = useAutosave<typeof values>(async (next) => {
    await updateInterviewAction(interview.id, {
      label: next.label,
      format: next.format,
      outcome: next.outcome,
      scheduledAt: next.scheduledAt,
      durationMins: next.durationMins,
      location: next.location,
      prep: next.prep,
      debrief: next.debrief,
    });
  });

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    save.push(next);
  };

  const addQuestion = () => {
    const question = asking.trim();
    if (!question) return;
    setAsking("");
    start(async () => {
      try {
        await addInterviewQuestionAction(interview.id, { question });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not add that question.");
      }
    });
  };

  return (
    <div className="border-border/70 space-y-4 border-t px-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <SaveIndicator state={save.state} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-faint hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete this round"
        >
          <Trash2Icon />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 @min-[34rem]:grid-cols-2">
        <div className="space-y-1.5">
          <Label>What it is called</Label>
          <Input
            value={values.label}
            placeholder={`Round ${interview.round}`}
            onChange={(event) => set({ label: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Format</Label>
          <Select value={values.format} onValueChange={(format) => set({ format: format as InterviewFormat })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map((format) => (
                <SelectItem key={format} value={format}>
                  {FORMAT_LABEL[format]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>When</Label>
          <DateField
            value={values.scheduledAt}
            ariaLabel="When this round is"
            onChange={(scheduledAt) => set({ scheduledAt })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>How it went</Label>
          <Select
            value={values.outcome}
            onValueChange={(outcome) => set({ outcome: outcome as InterviewOutcome })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((outcome) => (
                <SelectItem key={outcome} value={outcome}>
                  {OUTCOME_LABEL[outcome]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Where, or the link</Label>
          <Input
            value={values.location}
            placeholder="Zoom, or their office"
            onChange={(event) => set({ location: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>How long, in minutes</Label>
          <Input
            type="number"
            min={0}
            value={values.durationMins || ""}
            onChange={(event) => set({ durationMins: Number(event.target.value) || 0 })}
          />
        </div>
      </div>

      {interview.interviewers.length > 0 && (
        <div className="space-y-1.5">
          <Label>In the room</Label>
          <div className="flex flex-wrap gap-1.5">
            {interview.interviewers.map((person) => (
              <Badge key={person.id} variant="secondary" className="text-[11px]">
                {person.name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Before — what to say, what to ask</Label>
        <Textarea
          value={values.prep}
          rows={3}
          placeholder="What to bring up, what to avoid, what to ask them."
          onChange={(event) => set({ prep: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>After — how it actually went</Label>
        <Textarea
          value={values.debrief}
          rows={3}
          placeholder="Write this within the hour. Nobody remembers an interview two days later."
          onChange={(event) => set({ debrief: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>What they asked</Label>
        {interview.questions.map((question) => (
          <QuestionRow key={question.id} question={question} busy={pending} />
        ))}

        <div className="flex gap-2">
          <Input
            value={asking}
            placeholder="Add a question they asked, in their words"
            onChange={(event) => setAsking(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addQuestion();
              }
            }}
          />
          <Button variant="outline" onClick={addQuestion} disabled={pending || !asking.trim()}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionRow({ question, busy }: { question: InterviewQuestionValue; busy: boolean }) {
  const [values, setValues] = useState({
    kind: question.kind,
    question: question.question,
    answer: question.answer,
    confidence: question.confidence,
    better: question.better,
  });
  const [, start] = useTransition();

  const save = useAutosave<typeof values>(async (next) => {
    await updateInterviewQuestionAction(question.id, next);
  });

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    save.push(next);
  };

  return (
    <div className="bg-muted/30 space-y-2 rounded-md p-2.5">
      <div className="flex items-start gap-2">
        <Input
          value={values.question}
          className="h-8 text-[13px]"
          onChange={(event) => set({ question: event.target.value })}
        />
        <Select value={values.kind} onValueChange={(kind) => set({ kind: kind as QuestionKind })}>
          <SelectTrigger className="h-8 w-40 shrink-0 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {QUESTION_LABEL[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-faint hover:text-destructive shrink-0"
          disabled={busy}
          onClick={() => start(async () => void (await deleteInterviewQuestionAction(question.id)))}
          aria-label="Remove this question"
        >
          <Trash2Icon />
        </Button>
      </div>
      <Textarea
        value={values.answer}
        rows={2}
        placeholder="What you actually said — not a better version. The better version goes below."
        className="text-[13px]"
        onChange={(event) => set({ answer: event.target.value })}
      />
      <div className="flex items-center gap-3">
        <Label className="text-[11px]">How it went</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={score}
              type="button"
              onClick={() => set({ confidence: values.confidence === score ? 0 : score })}
              className={cn(
                "size-6 rounded text-[11px] transition-colors",
                values.confidence >= score
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-faint hover:bg-muted",
              )}
              aria-label={`Rate this answer ${score} out of 5`}
            >
              {score}
            </button>
          ))}
        </div>
      </div>
      <Textarea
        value={values.better}
        rows={2}
        placeholder="What you wish you had said. This is the field that turns a bad round into the next one."
        className="text-[13px]"
        onChange={(event) => set({ better: event.target.value })}
      />
    </div>
  );
}
