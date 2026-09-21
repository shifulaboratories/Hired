"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MoreVerticalIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BackgroundEditor } from "@/components/me/background-editor";
import { ChipInput } from "@/components/chip-input";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import {
  createHighlightAction,
  deleteHighlightAction,
  deleteRoleAction,
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
};

type Highlight = { id: string; text: string; impact: string; strength: number; tags: string[] };

export function RoleEditor({ role, highlights }: { role: Role; highlights: Highlight[] }) {
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
  });

  const { state, push } = useAutosave<typeof values>((next) =>
    updateRoleAction(role.id, next),
  );

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  const words = Math.round(values.background.length / 5.5);

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
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="text-[15px]">Background</CardTitle>
                <p className="text-muted-foreground mt-1 text-sm">
                  Everything. Projects, numbers, tech, politics, praise, screw-ups. No editing
                  needed — Claude does that part. Two headings mean something: Rules is how this
                  job gets described, Caveats is yours and never reaches a document.
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 tabular-nums">
                {words.toLocaleString()} words
              </Badge>
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

          <HighlightsCard roleId={role.id} highlights={highlights} />
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
                </div>
                <div className="space-y-1.5">
                  <Label>Ended</Label>
                  <Input
                    type="month"
                    value={values.endDate}
                    disabled={values.isCurrent}
                    onChange={(event) => set({ endDate: event.target.value })}
                  />
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
    </div>
  );
}

function HighlightsCard({ roleId, highlights }: { roleId: string; highlights: Highlight[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    startTransition(async () => {
      await createHighlightAction({ roleId, text });
      toast.success("Highlight added");
    });
  };

  const visible = highlights.filter((h) => !removed.has(h.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <SparklesIcon className="text-muted-foreground size-4" /> Highlights
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Polished, reusable bullets distilled from the background above. Ask Claude to
          &ldquo;mine this role&rdquo; and it will write these for you.
        </p>
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
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {visible.map((highlight) => (
                <HighlightRow
                  key={highlight.id}
                  highlight={highlight}
                  onRemoved={() => setRemoved((prev) => new Set(prev).add(highlight.id))}
                />
              ))}
            </AnimatePresence>
          </ul>
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
    <motion.li
      layout
      exit={{ opacity: 0, x: 16, height: 0 }}
      transition={{ duration: 0.22 }}
      className="group hover:bg-accent/40 flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors"
    >
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
    </motion.li>
  );
}
