"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  HistoryIcon,
  MoreVerticalIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  StickyNoteIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BackgroundEditor } from "@/components/me/background-editor";
import { RoleHistory } from "@/components/me/role-history";
import { useAsk } from "@/components/assistant/ask";
import { DragHandle, SortableList, SortableRow } from "@/components/resume/sortable-list";
import { resumeEvidence } from "@/lib/background";
import { ChipInput } from "@/components/chip-input";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import {
  createHighlightAction,
  createNoteAction,
  deleteHighlightAction,
  deleteRoleAction,
  reorderHighlightsAction,
  updateHighlightAction,
  updateRoleAction,
} from "@/server/actions";

type Role = {
  id: string;
  company: string;
  title: string;
  employmentType: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  summary: string;
  background: string;
  tags: string[];
  startUnconfirmed: boolean;
  endUnconfirmed: boolean;
};

type Highlight = {
  id: string;
  text: string;
  impact: string;
  strength: number;
  tags: string[];
  /** Resumes carrying a bullet that says the same thing, newest first. */
  usedIn: { resumeId: string; name: string }[];
};

type LinkedNote = { id: string; title: string; body: string; kind: "NOTE" | "GUARDRAIL" };

export function RoleEditor({
  role,
  highlights,
  notes,
}: {
  role: Role;
  highlights: Highlight[];
  notes: LinkedNote[];
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [values, setValues] = useState({
    company: role.company,
    title: role.title,
    employmentType: role.employmentType,
    location: role.location,
    startDate: role.startDate,
    endDate: role.endDate,
    isCurrent: role.isCurrent,
    summary: role.summary,
    background: role.background,
    tags: role.tags,
    startUnconfirmed: role.startUnconfirmed,
    endUnconfirmed: role.endUnconfirmed,
  });

  const { state, push } = useAutosave<typeof values>((next) =>
    updateRoleAction(role.id, next),
  );

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Input
            value={values.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder="Job title"
            className="h-auto border-0 bg-transparent px-0 text-[27px] font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-[32px]"
          />
          <Input
            value={values.company}
            onChange={(event) => set({ company: event.target.value })}
            placeholder="Company"
            className="h-auto border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center gap-2">
          <SaveIndicator state={state} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                <HistoryIcon /> History
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (confirm(`Delete ${values.title} at ${values.company}? This cannot be undone.`)) {
                    void deleteRoleAction(role.id);
                  }
                }}
              >
                <Trash2Icon /> Delete role
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 space-y-6 lg:order-1">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-[15px]">Background</CardTitle>
                <p className="text-muted-foreground mt-1 text-sm">
                  Everything. Projects, numbers, tech, politics, praise, screw-ups. No editing
                  needed — Claude does that part. Three headings mean something: Rules is how
                  this job gets described, Caveats is yours, and Open questions is what you
                  haven&rsquo;t settled. The last two never reach a document.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              {/* The placeholder used to teach loose prose while every tool that
                  writes here emits markdown with headings, so people were shown
                  one format and handed back another. It shows both shapes now:
                  a line on its own is fine, and a heading groups them. */}
              <BackgroundEditor
                value={values.background}
                onChange={(next) => set({ background: next })}
                placeholder={`Rebuilt the billing pipeline in Q2 — was taking 6 hours nightly, got it to 20 min.
Ran the migration off Mongo. 400M documents. Zero downtime, took 4 months.
Manager said in my review I was "the only person who could hold the whole system in their head".

## Mentoring
- Mentored 3 juniors, two got promoted.

## Caveats
- The notifications rewrite shipped without a rollback plan. Be ready for that question.`}
              />
            </CardContent>
          </Card>

          <HighlightsCard
            roleId={role.id}
            roleName={`${values.title} at ${values.company}`}
            evidenceWords={countWords(resumeEvidence(values.background))}
            highlights={highlights}
          />
          <RoleNotesCard roleId={role.id} notes={notes} />
        </div>

        <div className="order-1 space-y-6 lg:order-2">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-[15px]">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input
                  value={values.location}
                  onChange={(event) => set({ location: event.target.value })}
                  placeholder="Remote"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Input
                  value={values.employmentType}
                  onChange={(event) => set({ employmentType: event.target.value })}
                  placeholder="Full-time"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label htmlFor="is-current">Current job</Label>
                <Switch
                  id="is-current"
                  checked={values.isCurrent}
                  onCheckedChange={(checked) => set({ isCurrent: checked })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Started</Label>
                  <Input
                    type="month"
                    value={values.startDate}
                    onChange={(event) => set({ startDate: event.target.value })}
                  />
                  <Unconfirmed
                    checked={values.startUnconfirmed}
                    onChange={(startUnconfirmed) => set({ startUnconfirmed })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Ended</Label>
                  <Input
                    type="month"
                    value={values.endDate}
                    disabled={values.isCurrent}
                    onChange={(event) => set({ endDate: event.target.value })}
                  />
                  {!values.isCurrent && (
                    <Unconfirmed
                      checked={values.endUnconfirmed}
                      onChange={(endUnconfirmed) => set({ endUnconfirmed })}
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role-tags">Tags</Label>
                <ChipInput
                  id="role-tags"
                  noun="tag"
                  values={values.tags}
                  onChange={(tags) => set({ tags })}
                  placeholder="fintech, python, leadership"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Scope summary</Label>
                <Textarea
                  value={values.summary}
                  onChange={(event) => set({ summary: event.target.value })}
                  placeholder="One or two sentences on what this job actually was."
                  className="min-h-20"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <RoleHistory roleId={role.id} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  );
}

/**
 * "I think it was March." A guessed month is kept, and never printed: resumes
 * get the year only, and the date joins the list of things to settle.
 */
function Unconfirmed({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label
      className="text-muted-foreground flex cursor-pointer items-center gap-1.5 pt-0.5 text-[11.5px]"
      title="Resumes show the year only until you confirm the month."
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-primary size-3"
      />
      Month not confirmed
    </label>
  );
}

function countWords(text: string) {
  return text.replace(/[#*_`>-]/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Notes filed against this job: STAR stories, the answer to "why did you leave". */
function RoleNotesCard({ roleId, notes }: { roleId: string; notes: LinkedNote[] }) {
  const [pending, startTransition] = useTransition();
  const add = () =>
    startTransition(async () => {
      await createNoteAction({ title: "Untitled note", roleId });
      window.location.assign("/me?tab=notes");
    });
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-[15px]">
            <StickyNoteIcon className="text-muted-foreground size-4" /> Notes about this job
          </CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            Stories, answers and anything else that belongs to this job but not in its background.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={add} disabled={pending} className="shrink-0">
          <PlusIcon /> Add
        </Button>
      </CardHeader>
      <CardContent>
        {notes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            None yet. Any note can be filed here from the Notes tab.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {notes.map((note) => (
              <li key={note.id}>
                <Link
                  href="/me?tab=notes"
                  className="hover:bg-accent/50 -mx-2 block rounded-md px-2 py-2 transition-colors"
                >
                  <div className="text-sm font-medium">
                    {note.title}
                    {note.kind === "GUARDRAIL" && (
                      <span className="text-primary ml-2 text-[11px] font-normal">standing rule</span>
                    )}
                  </div>
                  {note.body && (
                    <p className="text-muted-foreground line-clamp-2 text-[13px]">{note.body}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HighlightsCard({
  roleId,
  roleName,
  evidenceWords,
  highlights,
}: {
  roleId: string;
  roleName: string;
  evidenceWords: number;
  highlights: Highlight[];
}) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [order, setOrder] = useState<string[]>(highlights.map((h) => h.id));
  const ask = useAsk();

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    startTransition(async () => {
      await createHighlightAction({ roleId, text });
      toast.success("Highlight added");
    });
  };

  // Local order so a drag lands immediately; new rows from the server go last.
  const byId = new Map(highlights.map((h) => [h.id, h]));
  const ids = [
    ...order.filter((id) => byId.has(id)),
    ...highlights.map((h) => h.id).filter((id) => !order.includes(id)),
  ].filter((id) => !removed.has(id));
  const visible = ids.map((id) => byId.get(id) as Highlight);

  const mine = () =>
    ask(
      `Mine my ${roleName} role (role id ${roleId}) for highlights. Read it with get_role, draft highlights from its resume evidence only — nothing from rules, caveats or open questions — show them to me, and save the ones I approve with create_highlights.`,
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <SparklesIcon className="text-muted-foreground size-4" /> Highlights
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Polished, reusable bullets distilled from the background above, in the order you want
          them used. Claude can write them for you.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={mine}>
            <WandSparklesIcon className="size-3" /> Mine this role
          </Button>
          {visible.length === 0 && evidenceWords >= 60 && (
            // The nudge: a long background with nothing distilled out of it
            // contributes nothing to a resume, however good it is.
            <span className="text-muted-foreground text-xs">
              No highlights yet from {evidenceWords.toLocaleString()} words of background.
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Cut nightly billing job from 6h to 20m by rewriting the pipeline in Go"
          />
          <Button variant="outline" size="icon" onClick={add} disabled={pending || !draft.trim()}>
            <PlusIcon />
          </Button>
        </div>

        {visible.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">No highlights yet.</p>
        ) : (
          <SortableList
            ids={ids}
            className="space-y-1"
            onReorder={(from, to) => {
              const next = [...ids];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              setOrder(next);
              void reorderHighlightsAction(roleId, next).catch(() =>
                toast.error("Could not save the new order."),
              );
            }}
          >
            {visible.map((highlight) => (
              <SortableRow key={highlight.id} id={highlight.id} label={`Move ${highlight.text.slice(0, 40)}`}>
                <HighlightRow
                  highlight={highlight}
                  onRemoved={() => setRemoved((prev) => new Set(prev).add(highlight.id))}
                />
              </SortableRow>
            ))}
          </SortableList>
        )}
      </CardContent>
    </Card>
  );
}

function HighlightRow({
  highlight,
  onRemoved,
}: {
  highlight: Highlight;
  onRemoved: () => void;
}) {
  const [text, setText] = useState(highlight.text);
  const [strength, setStrength] = useState(highlight.strength);
  const { state, push } = useAutosave<{ text: string; strength: number }>((next) =>
    updateHighlightAction(highlight.id, next),
  );

  return (
    <motion.div
      exit={{ opacity: 0, x: 16, height: 0 }}
      transition={{ duration: 0.22 }}
      className="group hover:bg-accent/40 flex items-start gap-2 rounded-lg px-1 py-1.5 transition-colors"
    >
      <DragHandle className="mt-1.5 size-5" />
      <div className="mt-2 flex shrink-0 gap-0.5">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            aria-label={`Strength ${level}`}
            onClick={() => {
              setStrength(level);
              push({ text, strength: level });
            }}
            className="p-px"
          >
            <StarIcon
              className={cn(
                "size-2.5 transition-colors",
                level <= strength
                  ? "fill-primary text-primary"
                  : "text-muted-foreground/30 hover:text-muted-foreground",
              )}
            />
          </button>
        ))}
      </div>

      <Textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          push({ text: event.target.value, strength });
        }}
        className="min-h-0 resize-none border-0 bg-transparent px-0 py-1 text-[13px] leading-snug shadow-none focus-visible:ring-0"
        rows={1}
      />

      <div className="flex shrink-0 items-center gap-1 pt-1">
        {/* Where it has gone out, so a strong line nobody has seen stands out. */}
        <span
          className={cn(
            "text-[11px] whitespace-nowrap tabular-nums",
            highlight.usedIn.length === 0 && strength >= 4 ? "text-warning" : "text-muted-foreground",
          )}
          title={
            highlight.usedIn.length
              ? `In ${highlight.usedIn.map((use) => use.name).join(", ")}`
              : "Not in any resume yet"
          }
        >
          {highlight.usedIn.length ? `In ${highlight.usedIn.length}` : "Unused"}
        </span>
        <SaveIndicator state={state} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => {
            onRemoved();
            void deleteHighlightAction(highlight.id);
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
    </motion.div>
  );
}
