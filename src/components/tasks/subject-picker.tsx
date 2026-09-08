"use client";

import { useState } from "react";
import {
  BriefcaseIcon,
  Building2Icon,
  CircleUserRoundIcon,
  FileTextIcon,
  StickyNoteIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { SUBJECT_LABEL, type TaskSubjectKind } from "@/lib/task-subject";
import { cn } from "@/lib/utils";

/**
 * What a task is about, picked from everything it could be about.
 *
 * One list across six kinds rather than a kind selector and then a record
 * selector. Nobody thinks "a contact task about Priya"; they think "about
 * Priya" — so you type Priya and the row says which kind she is. The kinds are
 * headings, and the search runs across all of them at once.
 *
 * Sending the choice up as `{kind, id}` rather than five nullable props keeps
 * the "at most one" rule in one place instead of in every caller.
 */
export type SubjectOption = {
  kind: TaskSubjectKind;
  id: string;
  label: string;
  /** Second line, where the label alone would be ambiguous. */
  hint?: string;
};

const ICON: Record<TaskSubjectKind, typeof BriefcaseIcon> = {
  application: BriefcaseIcon,
  company: Building2Icon,
  contact: CircleUserRoundIcon,
  resume: FileTextIcon,
  role: UserRoundIcon,
  note: StickyNoteIcon,
};

/** The order the groups appear in. Most-attached first. */
const ORDER: TaskSubjectKind[] = ["application", "contact", "company", "resume", "role", "note"];

export function SubjectPicker({
  value,
  options,
  onChange,
  className,
  size = "default",
}: {
  value: { kind: TaskSubjectKind; id: string } | null;
  options: SubjectOption[];
  onChange: (next: { kind: TaskSubjectKind; id: string } | null) => void;
  className?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const chosen = value
    ? (options.find((option) => option.kind === value.kind && option.id === value.id) ?? null)
    : null;
  const Icon = chosen ? ICON[chosen.kind] : null;

  const groups = ORDER.map((kind) => ({
    kind,
    rows: options.filter((option) => option.kind === kind),
  })).filter((group) => group.rows.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="What this task is about"
          className={cn(
            "min-w-0 justify-start gap-2 font-normal",
            size === "sm" ? "h-8 px-2 text-[12px]" : "h-9 px-3",
            !chosen && "text-muted-foreground",
            className,
          )}
        >
          {Icon ? <Icon className="size-3.5 shrink-0 opacity-70" /> : null}
          <span className="truncate">{chosen ? chosen.label : "About nothing"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command loop>
          <CommandInput placeholder="A job, a person, a company…" className="h-9" />
          <CommandList className="max-h-72">
            <CommandGroup>
              <CommandItem
                value="about nothing"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="text-muted-foreground px-2 py-1.5"
              >
                <XIcon className="size-3.5" />
                About nothing
              </CommandItem>
            </CommandGroup>
            {groups.map((group) => {
              const GroupIcon = ICON[group.kind];
              return (
                <div key={group.kind}>
                  <CommandSeparator />
                  <CommandGroup heading={SUBJECT_LABEL[group.kind]}>
                    {group.rows.map((option) => (
                      <CommandItem
                        // Kind in the value as well as the id: two kinds can
                        // hold the same name, and cmdk keys selection on it.
                        key={`${option.kind}:${option.id}`}
                        value={`${option.label} ${option.hint ?? ""} ${option.kind} ${option.id}`}
                        onSelect={() => {
                          onChange({ kind: option.kind, id: option.id });
                          setOpen(false);
                        }}
                        className="px-2 py-1.5"
                      >
                        <GroupIcon className="size-3.5 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                          {option.hint && (
                            <span className="text-faint"> · {option.hint}</span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The five nullable ids a server action wants, from the one thing you picked. */
export function subjectColumns(value: { kind: TaskSubjectKind; id: string } | null) {
  return {
    applicationId: value?.kind === "application" ? value.id : null,
    companyId: value?.kind === "company" ? value.id : null,
    contactId: value?.kind === "contact" ? value.id : null,
    resumeId: value?.kind === "resume" ? value.id : null,
    roleId: value?.kind === "role" ? value.id : null,
    noteId: value?.kind === "note" ? value.id : null,
  };
}
