"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createTaskAction,
  deleteTaskAction,
  toggleTaskAction,
  updateTaskAction,
} from "@/server/actions";
import { cn, relativeDay } from "@/lib/utils";
import { DateField } from "@/components/ui/date-field";
import {
  SubjectPicker,
  subjectColumns,
  type SubjectOption,
} from "@/components/tasks/subject-picker";
import { SUBJECT_LABEL, type TaskSubjectKind, type TaskSubjectView } from "@/lib/task-subject";

export type TaskRow = {
  id: string;
  title: string;
  detail: string;
  /** Full ISO, for reading a date off; empty when it has no due date. */
  dueISO: string;
  /** yyyy-mm-dd, what a date input wants. Empty when undated. */
  dueDate: string;
  done: boolean;
  /** Whatever this one is about, already resolved. Null for a loose task. */
  subject: TaskSubjectView | null;
};

/** The buckets, in the order a person works down them. */
const BUCKETS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "undated", label: "No date" },
] as const;

type BucketKey = (typeof BUCKETS)[number]["key"];

function bucketOf(dueISO: string): BucketKey {
  if (!dueISO) return "undated";
  const due = new Date(dueISO);
  const now = new Date();
  const days = Math.round(
    (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86400000,
  );
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

/**
 * Everything you owe yourself, as one worked list.
 *
 * The bell in the top bar is the glance — what has come round, five words
 * each. This is the front page, where you actually mean to clear the list, so
 * a task here can be reworded, re-dated, hooked to a role and deleted — none
 * of which was possible anywhere in the app before, tasks being write-once and
 * tick-once.
 *
 * Grouped by when rather than by what: an overdue thing and a Thursday thing
 * are different problems, and a flat list sorted by date makes you work that
 * out for yourself every time you look.
 */
export function TaskPanel({
  tasks,
  subjects,
}: {
  tasks: TaskRow[];
  /** Everything a task can be hung on, across all six kinds. */
  subjects: SubjectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [draftDetail, setDraftDetail] = useState("");
  const [draftSubject, setDraftSubject] = useState<{ kind: TaskSubjectKind; id: string } | null>(
    null,
  );
  const [showDone, setShowDone] = useState(false);

  const open = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const done = useMemo(() => tasks.filter((task) => task.done), [tasks]);

  const grouped = useMemo(() => {
    const map = new Map<BucketKey, TaskRow[]>();
    for (const task of open) {
      const key = bucketOf(task.dueISO);
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    // Soonest first inside a bucket; undated keeps the order it arrived in,
    // which is newest-created first.
    for (const [key, rows] of map) {
      if (key !== "undated") rows.sort((a, b) => a.dueISO.localeCompare(b.dueISO));
    }
    return map;
  }, [open]);

  const act = (work: () => Promise<unknown>, message?: string) => {
    startTransition(async () => {
      try {
        await work();
        if (message) toast.success(message);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not do that.");
      }
    });
  };

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    const dueAt = draftDue;
    const detail = draftDetail.trim();
    const subject = draftSubject;
    // Cleared before the write, not after: a second task typed while the first
    // is still in flight should start from an empty form.
    setDraft("");
    setDraftDue("");
    setDraftDetail("");
    setDraftSubject(null);
    act(() =>
      createTaskAction({
        title,
        detail,
        dueAt: dueAt || null,
        ...subjectColumns(subject),
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-card shadow-card space-y-2 rounded-xl p-3">
        <div className="relative">
          <PlusIcon className="text-faint pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            placeholder="Send the follow-up email, ask Priya for the intro…"
            className="h-11 pl-8 text-base md:h-9 md:text-[13px]"
            disabled={pending}
          />
        </div>
        {/* The detail only appears once there is a task to detail. An empty
            second box above an empty first box is a form; one line is a
            thing you type into. */}
        {draft.trim() && (
          <Textarea
            value={draftDetail}
            onChange={(event) => setDraftDetail(event.target.value)}
            placeholder="What it involves, who said it, what to reference…"
            className="min-h-16 text-[13px]"
            disabled={pending}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <DateField
            value={draftDue}
            onChange={setDraftDue}
            ariaLabel="Due date"
            placeholder="No due date"
            className="w-48"
          />
          <SubjectPicker
            value={draftSubject}
            options={subjects}
            onChange={setDraftSubject}
            className="w-56"
          />
          <Button size="sm" onClick={add} disabled={pending || !draft.trim()} className="ml-auto">
            Add task
          </Button>
        </div>
      </div>

      {open.length === 0 ? (
        <div className="bg-card shadow-card rounded-xl py-10 text-center">
          <p className="text-[13px] font-medium">Nothing on the list</p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Add one above, or ask your assistant to — it can see this list too.
          </p>
        </div>
      ) : (
        BUCKETS.map(({ key, label }) => {
          const rows = grouped.get(key) ?? [];
          if (rows.length === 0) return null;
          return (
            <section key={key} className="bg-card shadow-card overflow-hidden rounded-xl">
              <div className="eyebrow bg-inset flex items-center gap-2 px-4 py-2">
                <span className={cn(key === "overdue" && "text-destructive")}>{label}</span>
                <span className="text-faint nums">{rows.length}</span>
              </div>
              <ul className="divide-y">
                <AnimatePresence initial={false}>
                  {rows.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      subjects={subjects}
                      pending={pending}
                      act={act}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          );
        })
      )}

      {done.length > 0 && (
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setShowDone((value) => !value)}
          >
            {showDone ? "Hide" : "Show"} {done.length} done
          </Button>
          {showDone && (
            <ul className="bg-card shadow-card divide-y overflow-hidden rounded-xl">
              {done.map((task) => (
                <li key={task.id} className="flex items-center gap-2.5 px-4 py-2">
                  <Checkbox
                    checked
                    aria-label={`Reopen ${task.title}`}
                    disabled={pending}
                    onCheckedChange={() => act(() => toggleTaskAction(task.id, false), "Reopened")}
                  />
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px] line-through">
                    {task.title}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${task.title}`}
                    className="text-faint hover:text-destructive"
                    disabled={pending}
                    onClick={() => act(() => deleteTaskAction(task.id))}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskItem({
  task,
  subjects,
  pending,
  act,
}: {
  task: TaskRow;
  subjects: SubjectOption[];
  pending: boolean;
  act: (work: () => Promise<unknown>, message?: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [editing, setEditing] = useState(false);
  const overdue = bucketOf(task.dueISO) === "overdue";

  const rename = () => {
    setEditing(false);
    const next = title.trim();
    if (!next || next === task.title) {
      setTitle(task.title);
      return;
    }
    act(() => updateTaskAction(task.id, { title: next }));
  };

  return (
    <motion.li
      layout
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="group flex flex-wrap items-center gap-2.5 px-4 py-2.5"
    >
      <Checkbox
        aria-label={`Complete ${task.title}`}
        disabled={pending}
        onCheckedChange={() => act(() => toggleTaskAction(task.id, true), "Done")}
      />

      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === "Enter") rename();
              if (event.key === "Escape") {
                setTitle(task.title);
                setEditing(false);
              }
            }}
            className="h-8 text-[13px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="block w-full truncate text-left text-[13px]"
            title="Click to rename"
          >
            {task.title}
          </button>
        )}
        {task.detail && (
          <p className="text-faint mt-0.5 line-clamp-2 text-[12px]">{task.detail}</p>
        )}
        {task.subject && (
          <Link
            href={task.subject.href}
            className="text-faint hover:text-foreground mt-0.5 flex items-center gap-1 text-[11.5px] transition-colors"
          >
            {SUBJECT_LABEL[task.subject.kind]} · {task.subject.label}
          </Link>
        )}
      </div>

      <span
        className={cn(
          "nums hidden w-24 text-right text-[12px] sm:block",
          overdue ? "text-destructive font-medium" : "text-faint",
        )}
      >
        {task.dueISO ? relativeDay(new Date(task.dueISO)) : ""}
      </span>

      {/* The date and the role are edits, not decoration: a task that has
          slipped gets moved rather than re-typed. */}
      <div className="flex items-center gap-1">
        <DateField
          value={task.dueDate}
          onChange={(dueAt) => act(() => updateTaskAction(task.id, { dueAt: dueAt || null }))}
          ariaLabel={`Due date for ${task.title}`}
          placeholder="No due date"
          className="w-44"
        />
        <SubjectPicker
          size="sm"
          className="w-40"
          value={task.subject ? { kind: task.subject.kind, id: task.subject.id } : null}
          options={subjects}
          onChange={(next) => act(() => updateTaskAction(task.id, subjectColumns(next)))}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${task.title}`}
          className="text-faint hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          disabled={pending}
          onClick={() => act(() => deleteTaskAction(task.id))}
        >
          <Trash2Icon />
        </Button>
      </div>
    </motion.li>
  );
}
