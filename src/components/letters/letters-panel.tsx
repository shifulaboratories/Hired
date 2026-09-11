"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSignatureIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { LetterKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { useViewerZone } from "@/components/viewer-zone";
import { civilDay, shortCivilDay } from "@/lib/time";
import { cn } from "@/lib/utils";
import { createLetterAction, deleteLetterAction, updateLetterAction } from "@/server/actions";

/**
 * Everything you write that is not a resume, and the editor for it.
 *
 * One component, two homes: the Letters tab under Me holds the whole library,
 * and the same thing renders on an opened application filtered to that job.
 * A letter is prose, so the editor is a textarea that autosaves — there is no
 * document schema here and there should not be one.
 *
 * The list stays beside the editor rather than behind a route because the
 * reason to open this screen is usually "what did I already say to them", and
 * that is answered by reading two letters next to each other.
 */
export type LetterRow = {
  id: string;
  kind: LetterKind;
  title: string;
  body: string;
  recipient: string;
  sentAt: string | null;
  updatedAt: string;
  application: { id: string; company: string; roleTitle: string } | null;
  contact: { id: string; name: string } | null;
};

export const LETTER_LABEL: Record<LetterKind, string> = {
  COVER_LETTER: "Cover letter",
  OUTREACH: "Cold outreach",
  REFERRAL_ASK: "Referral ask",
  THANK_YOU: "Thank-you",
  REPLY: "Reply",
  OTHER: "Other",
};

const KINDS = Object.keys(LETTER_LABEL) as LetterKind[];

/** What each kind is for, as a placeholder. Shown empty, never saved. */
const PLACEHOLDER: Record<LetterKind, string> = {
  COVER_LETTER:
    "Why this employer, what you have done that bears on this job, and nothing the resume already says.",
  OUTREACH: "Short enough to read on a phone. Why them specifically, and one small ask.",
  REFERRAL_ASK:
    "Name the role, link the posting, and give them two lines they can forward without editing.",
  THANK_YOU: "One thing from the conversation, one gap you noticed, and no ask.",
  REPLY: "Answer the actual question they asked.",
  OTHER: "",
};

export function LettersPanel({
  letters,
  applicationId,
  compact = false,
  emptyHint,
}: {
  letters: LetterRow[];
  /** Set on an application: every letter written here is filed under that job. */
  applicationId?: string;
  compact?: boolean;
  emptyHint?: string;
}) {
  const zone = useViewerZone();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(letters[0]?.id ?? null);
  const [pending, start] = useTransition();

  const open = letters.find((letter) => letter.id === openId) ?? null;

  const create = (kind: LetterKind) =>
    start(async () => {
      try {
        const id = await createLetterAction({ kind, applicationId: applicationId ?? null, body: "" });
        setOpenId(id);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not start that.");
      }
    });

  const remove = (id: string) =>
    start(async () => {
      try {
        await deleteLetterAction(id);
        if (openId === id) setOpenId(null);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete that.");
      }
    });

  return (
    <div className={cn("@container", compact ? "space-y-3" : "space-y-4")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {letters.length === 0
            ? (emptyHint ?? "Nothing written yet.")
            : `${letters.length} ${letters.length === 1 ? "letter" : "letters"}`}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={compact ? "outline" : "default"} disabled={pending}>
              <PlusIcon /> Write one
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {KINDS.map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => create(kind)}>
                {LETTER_LABEL[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {letters.length === 0 ? (
        <EmptyState compact={compact} />
      ) : (
        <div
          className={cn(
            "grid gap-4",
            compact ? "grid-cols-1" : "@min-[52rem]:grid-cols-[18rem_minmax(0,1fr)]",
          )}
        >
          <ul className={cn("space-y-1", compact && "max-h-56 overflow-y-auto")}>
            {letters.map((letter) => (
              <li key={letter.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(letter.id === openId ? null : letter.id)}
                  className={cn(
                    "hover:bg-muted/60 w-full rounded-md px-2.5 py-2 text-left transition-colors",
                    letter.id === openId && "bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {letter.title || LETTER_LABEL[letter.kind]}
                    </span>
                    {letter.sentAt === null && (
                      <Badge variant="outline" className="text-[10px]">
                        Draft
                      </Badge>
                    )}
                  </div>
                  <div className="text-faint mt-0.5 truncate text-[11px]">
                    {[
                      LETTER_LABEL[letter.kind],
                      letter.application?.company,
                      letter.contact?.name,
                      shortCivilDay(civilDay(new Date(letter.updatedAt), zone)),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {open && (
            <LetterEditor
              key={open.id}
              letter={open}
              showLinks={!applicationId}
              onDelete={() => remove(open.id)}
              busy={pending}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ compact }: { compact: boolean }) {
  return (
    <div className="border-border/70 rounded-lg border border-dashed px-4 py-6 text-center">
      <FileSignatureIcon className="text-faint mx-auto mb-2 size-5" />
      <p className="text-muted-foreground mx-auto max-w-sm text-xs">
        Cover letters, cold messages, referral asks and thank-yous live here. The quickest way to
        get a good one is to ask Claude: it reads the posting, your own material and the letters
        you have already written before it drafts anything.
      </p>
      {!compact && (
        <Button asChild variant="link" size="sm" className="mt-1">
          <Link href="/docs">How to connect it</Link>
        </Button>
      )}
    </div>
  );
}

function LetterEditor({
  letter,
  showLinks,
  onDelete,
  busy,
}: {
  letter: LetterRow;
  showLinks: boolean;
  onDelete: () => void;
  busy: boolean;
}) {
  const [values, setValues] = useState({
    kind: letter.kind,
    title: letter.title,
    recipient: letter.recipient,
    body: letter.body,
    sentAt: letter.sentAt ?? "",
  });

  const save = useAutosave<typeof values>(async (next) => {
    await updateLetterAction(letter.id, {
      kind: next.kind,
      title: next.title,
      recipient: next.recipient,
      body: next.body,
      sentAt: next.sentAt,
    });
  });

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    save.push(next);
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SaveIndicator state={save.state} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-faint hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete this letter"
        >
          <Trash2Icon />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 @min-[34rem]:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={values.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder={LETTER_LABEL[values.kind]}
          />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Input
            value={values.recipient}
            onChange={(event) => set({ recipient: event.target.value })}
            placeholder="Priya, engineering manager"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 @min-[34rem]:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <Select value={values.kind} onValueChange={(kind) => set({ kind: kind as LetterKind })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {LETTER_LABEL[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Sent</Label>
          <DateField
            value={values.sentAt}
            onChange={(sentAt) => set({ sentAt })}
            ariaLabel="Date sent"
            placeholder="Still a draft"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>The letter</Label>
        <Textarea
          value={values.body}
          onChange={(event) => set({ body: event.target.value })}
          placeholder={PLACEHOLDER[values.kind]}
          className="min-h-72 leading-relaxed"
        />
      </div>

      {showLinks && (letter.application || letter.contact) && (
        <p className="text-faint text-xs">
          Filed under{" "}
          {letter.application && (
            <Link href={`/applications/${letter.application.id}`} className="hover:underline">
              {letter.application.company} — {letter.application.roleTitle}
            </Link>
          )}
          {letter.application && letter.contact && " · "}
          {letter.contact && (
            <Link href={`/crm/contacts/${letter.contact.id}`} className="hover:underline">
              {letter.contact.name}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
