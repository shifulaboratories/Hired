"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BriefcaseIcon, PinIcon, PlusIcon, ScissorsIcon, SearchIcon, ShieldIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/page-header";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { splitIntoRules, type RuleDraft } from "@/lib/note-rules";
import {
  createNoteAction,
  deleteNoteAction,
  splitNoteIntoRulesAction,
  updateNoteAction,
} from "@/server/actions";
import { StickyNoteIcon } from "lucide-react";

type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  kind: "NOTE" | "GUARDRAIL";
  /** For a standing rule: whether it fits in the briefing every client reads. */
  inBriefing: boolean;
  /** The job this note is filed against, if any. */
  roleId: string | null;
};

type RoleOption = { id: string; label: string };

/** Sent down from the panel so each card can offer "about a job" without its own fetch. */
const NO_ROLE = "none";

/**
 * A title that reads like an instruction. Deliberately narrow — it only ever
 * produces a suggestion, never a change — but narrow matters anyway, because a
 * suggestion on every third note is one people learn to ignore.
 */
const RULE_LIKE = /\b(?:rules?|guardrails?|never|do not|don'?t|must not|off[- ]limits)\b/i;

export function NotesPanel({
  notes,
  briefing,
  roles,
}: {
  notes: Note[];
  /** Room for standing rules in the briefing, and how much of it is used. */
  briefing: { budget: number; used: number };
  roles: RoleOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const add = () => {
    startTransition(async () => {
      await createNoteAction({ title: "Untitled note" });
      toast.success("Note added");
    });
  };

  const kept = notes.filter((note) => !removed.has(note.id));
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? kept.filter((note) =>
        `${note.title}\n${note.body}\n${note.tags.join(" ")}`.toLowerCase().includes(needle),
      )
    : kept;
  // Standing rules first and on their own, because they are a different kind
  // of thing: every connected client is handed them before it does anything.
  const rules = visible.filter((note) => note.kind === "GUARDRAIL");
  const others = visible.filter((note) => note.kind !== "GUARDRAIL");
  const overflowing = rules.filter((note) => !note.inBriefing).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground min-w-0 flex-1 text-sm">
          Anything that isn&apos;t tied to one job: STAR stories, interview answers, references,
          salary history, the thing you always forget to mention.
        </p>
        <div className="flex items-center gap-2">
          {kept.length > 6 && (
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a note"
                aria-label="Find a note"
                className="h-9 w-44 pl-8 md:h-8"
              />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={add} disabled={pending}>
            <PlusIcon /> New note
          </Button>
        </div>
      </div>

      {rules.length > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <ShieldIcon className="text-primary size-3.5" />
              Standing rules
              <span className="text-muted-foreground font-normal tabular-nums">{rules.length}</span>
            </h2>
            <p className="text-muted-foreground text-xs">
              {overflowing > 0
                ? `${overflowing} too long to travel with every connection — clients are told to fetch ${overflowing === 1 ? "it" : "them"}. `
                : "Every connected client gets these before it does anything. "}
              <span className="tabular-nums">
                {briefing.used.toLocaleString()} of {briefing.budget.toLocaleString()}
              </span>{" "}
              characters used. One short rule per note fits best.
            </p>
          </div>
          <div className="columns-1 gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
            <AnimatePresence initial={false}>
              {rules.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  roles={roles}
                  onRemoved={() => setRemoved((prev) => new Set(prev).add(note.id))}
                />
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {kept.length > 0 && visible.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nothing matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : kept.length === 0 ? (
        <EmptyState
          icon={StickyNoteIcon}
          title="No notes yet"
          description="Notes are free-form. Claude searches them alongside your roles when it writes."
          action={
            <Button variant="default" onClick={add} disabled={pending}>
              <PlusIcon /> New note
            </Button>
          }
        />
      ) : others.length === 0 ? null : (
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          <AnimatePresence initial={false}>
            {others.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                roles={roles}
                onRemoved={() => setRemoved((prev) => new Set(prev).add(note.id))}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  roles,
  onRemoved,
}: {
  note: Note;
  roles: RoleOption[];
  onRemoved: () => void;
}) {
  const [values, setValues] = useState({
    title: note.title,
    body: note.body,
    pinned: note.pinned,
    kind: note.kind,
    roleId: note.roleId,
  });
  const [splitting, setSplitting] = useState(false);
  // Only offered when the body really holds several rules; splitting one rule
  // into one rule is not a thing anybody wants a button for.
  const splittable = splitIntoRules(values.body).length >= 2 && RULE_LIKE.test(`${values.title} ${values.kind === "GUARDRAIL" ? "rule" : ""}`);
  const { state, push } = useAutosave<typeof values>((next) => updateNoteAction(note.id, next));
  const isRule = values.kind === "GUARDRAIL";
  // Only while it is still a note: once it is a rule, the suggestion is done.
  const readsLikeRule = !isRule && RULE_LIKE.test(values.title);

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  return (
    <motion.div layout exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.2 }}>
      <Card className={cn("group", isRule && "border-primary/40")}>
        <CardContent className="space-y-2 pt-5">
          {isRule &&
            (note.inBriefing || note.kind !== "GUARDRAIL" ? (
              <div className="text-primary flex items-center gap-1.5 text-[11px] font-medium">
                <ShieldIcon className="size-3" />
                Sent to every AI on connect
              </div>
            ) : (
              // Measured on the server against the real briefing, so it is
              // right as of the last save rather than while typing.
              <div className="text-warning flex items-start gap-1.5 text-[11px] leading-snug font-medium">
                <ShieldIcon className="mt-px size-3 shrink-0" />
                Too long to send with every connection. Clients are told it exists and to fetch it;
                a shorter rule, or several short ones, reaches them from the first message.
              </div>
            ))}
          {readsLikeRule && (
            <div className="bg-inset flex items-start gap-2 rounded-md px-2.5 py-2 text-[12px] leading-snug">
              <span className="text-muted-foreground min-w-0 flex-1">
                This reads like a rule, but it is a note: Claude only sees it if it goes looking.
              </span>
              <button
                type="button"
                onClick={() => set({ kind: "GUARDRAIL" })}
                className="text-primary shrink-0 font-medium hover:underline"
              >
                Make it a standing rule
              </button>
            </div>
          )}
          <div className="flex items-start gap-1">
            <Input
              value={values.title}
              onChange={(event) => set({ title: event.target.value })}
              className="h-auto border-0 bg-transparent px-0 py-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
              placeholder="Note title"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                isRule && "text-primary opacity-100",
              )}
              onClick={() => set({ kind: isRule ? "NOTE" : "GUARDRAIL" })}
              title={
                isRule
                  ? "A standing rule. Every AI client is given this before it does anything."
                  : "Make this a standing rule, given to every AI client on connect"
              }
              aria-label={isRule ? "Stop sending this as a standing rule" : "Make this a standing rule"}
            >
              <ShieldIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                values.pinned && "text-primary opacity-100",
              )}
              onClick={() => set({ pinned: !values.pinned })}
              aria-label="Pin note"
            >
              <PinIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => {
                onRemoved();
                void deleteNoteAction(note.id);
              }}
              aria-label="Delete note"
            >
              <Trash2Icon />
            </Button>
          </div>

          <Textarea
            value={values.body}
            onChange={(event) => set({ body: event.target.value })}
            placeholder="Write anything…"
            className="min-h-24 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />

          {splittable && (
            <button
              type="button"
              onClick={() => setSplitting(true)}
              className="text-primary flex items-center gap-1.5 text-[12px] font-medium hover:underline"
            >
              <ScissorsIcon className="size-3" /> Split into separate standing rules
            </button>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {note.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {roles.length > 0 && (
                <Select
                  value={values.roleId ?? NO_ROLE}
                  onValueChange={(value) => set({ roleId: value === NO_ROLE ? null : value })}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Which job this note is about"
                    className="text-muted-foreground h-7 max-w-52 gap-1 border-dashed px-2 text-[11.5px]"
                  >
                    <BriefcaseIcon className="size-3" />
                    <SelectValue placeholder="About a job" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ROLE}>Not about one job</SelectItem>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <SaveIndicator state={state} />
          </div>
        </CardContent>
      </Card>
      {splitting && <SplitDialog noteId={note.id} title={values.title} onClose={() => setSplitting(false)} />}
    </motion.div>
  );
}

/**
 * Preview, then split. The drafts come from the server's own dry run, so what
 * is shown is exactly what will be created; unticking one leaves it out. The
 * note itself is kept, as an ordinary note.
 */
function SplitDialog({ noteId, title, onClose }: { noteId: string; title: string; onClose: () => void }) {
  const [drafts, setDrafts] = useState<RuleDraft[] | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  // Held in a ref so the dry run runs once, not every time the parent renders
  // a fresh onClose.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    void splitNoteIntoRulesAction(noteId, { dryRun: true })
      .then((result) => {
        setDrafts(result.rules);
        setKeep(new Set(result.rules.map((_, index) => index)));
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Could not read that note.");
        closeRef.current();
      });
  }, [noteId]);

  const create = () =>
    startTransition(async () => {
      try {
        const result = await splitNoteIntoRulesAction(noteId, { only: [...keep].sort((a, b) => a - b) });
        toast.success(`${result.created.length} standing rules created. The original is kept as a note.`);
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not split that note.");
      }
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Split &ldquo;{title}&rdquo;</DialogTitle>
          <DialogDescription>
            One rule per note fits in the briefing every AI client reads on connect. Untick anything
            that is not really a rule. The original stays, as an ordinary note.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {drafts === null && <p className="text-muted-foreground text-sm">Reading it…</p>}
          {drafts?.map((draft, index) => (
            <label key={index} className="hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5">
              <input
                type="checkbox"
                className="accent-primary mt-1 size-3.5"
                checked={keep.has(index)}
                onChange={(event) =>
                  setKeep((old) => {
                    const next = new Set(old);
                    if (event.target.checked) next.add(index);
                    else next.delete(index);
                    return next;
                  })
                }
              />
              <span className="text-sm leading-snug">
                {draft.title}
                {draft.body && <span className="text-muted-foreground"> — {draft.body}</span>}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={pending || !drafts || keep.size === 0}>
            Create {keep.size} {keep.size === 1 ? "rule" : "rules"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
