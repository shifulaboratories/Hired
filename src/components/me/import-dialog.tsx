"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  DownloadIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseResumeText, type ParseNote } from "@/lib/resume-parse";
import { importResumeAction } from "@/server/actions";
import type { ResumeImport } from "@/lib/data/me";

/**
 * Paste a resume, check what it read, keep what is right.
 *
 * The empty workspace is the reason people leave before they start, and until
 * now the only way out of it was typing a career into a form. The parse is a
 * draft and is shown as one: every role it found is editable and removable
 * here, and nothing reaches the database until the button at the bottom.
 *
 * The better path is still the conversation — an assistant reads the document
 * and calls import_resume — and the dialog says so, because a person who
 * connects Claude once never needs this screen again.
 */
export function ImportDialog() {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ResumeImport | null>(null);
  const [source, setSource] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notes, setNotes] = useState<ParseNote[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (params.get("import")) setOpen(true);
  }, [params]);

  const roleCount = draft?.roles?.length ?? 0;
  const summary = useMemo(() => {
    if (!draft) return "";
    const counts = [
      [roleCount, "job"],
      [draft.education?.length ?? 0, "school"],
      [draft.skillGroups?.reduce((sum, group) => sum + (group.skills?.length ?? 0), 0) ?? 0, "skill"],
      [draft.certifications?.length ?? 0, "certification"],
      [draft.projects?.length ?? 0, "project"],
    ] as const;
    return counts
      .filter(([n]) => n > 0)
      .map(([n, word]) => `${n} ${word}${n > 1 ? "s" : ""}`)
      .join(", ");
  }, [draft, roleCount]);

  const read = () => {
    const body = text.trim();
    if (!body) return;
    const result = parseResumeText(body);
    setDraft(result.draft);
    setSource(result.sourceText);
    setWarnings(result.warnings);
    setNotes(result.notes);
  };

  /**
   * What the parser is unsure about at this exact field.
   *
   * The notes are keyed by where the doubt is, so they can sit under the input
   * rather than in a list at the top: a warning that says "check the employer
   * on one of these" is a warning you have to go hunting with.
   */
  const noteAt = (path: string) => notes.find((note) => note.path === path)?.message;

  const commit = () => {
    if (!draft) return;
    startTransition(async () => {
      try {
        const report = await importResumeAction(draft, source);
        const created = report.roles.created.length;
        const merged = report.roles.merged;
        const addedBullets = merged.reduce((sum, role) => sum + role.bulletsAdded, 0);
        const untouched = report.roles.skipped.length;
        // A second import is the interesting case, and "3 were already here"
        // is not what happened to them: say what they gained.
        const parts = [
          created > 0 ? `Brought in ${created} job${created === 1 ? "" : "s"}` : "",
          addedBullets > 0
            ? `added ${addedBullets} bullet${addedBullets === 1 ? "" : "s"} to ${merged.length} you already had`
            : "",
          untouched > 0 ? `${untouched} already here, unchanged` : "",
        ].filter(Boolean);
        if (created === 0 && merged.length === 0 && untouched === 0) {
          // Nothing in the text was recognised as a job at all — which is not
          // the same as "nothing new", and is not a success. The raw text is
          // still kept as a note, which is worth doing; dressing that as an
          // import sent people back to a Me page that still looked empty with
          // no idea what had happened.
          toast.message("Saved as a note", {
            description:
              "Nothing in it was read as a job. Check the headings, or paste it to Claude and ask it to bring it in.",
          });
        } else {
          toast.success(parts.length ? parts.join("; ") : "Nothing new in that one");
        }
        setOpen(false);
        setText("");
        setDraft(null);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not import that.");
      }
    });
  };

  const editRole = (index: number, patch: Partial<NonNullable<ResumeImport["roles"]>[number]>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            roles: (current.roles ?? []).map((role, position) =>
              position === index ? { ...role, ...patch } : role,
            ),
          }
        : current,
    );
  };

  const editBullets = (
    index: number,
    change: (bullets: { text: string }[]) => { text: string }[],
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            roles: (current.roles ?? []).map((role, position) =>
              position === index ? { ...role, bullets: change(role.bullets ?? []) } : role,
            ),
          }
        : current,
    );
  };

  const dropRole = (index: number) => {
    setDraft((current) =>
      current ? { ...current, roles: (current.roles ?? []).filter((_, i) => i !== index) } : current,
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <DownloadIcon /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bring your history in</DialogTitle>
          <DialogDescription>
            Paste a resume or a LinkedIn export and this reads what it can. Check it before it
            lands — nothing is saved until you press the button. Connected to Claude, you can skip
            this entirely: paste the document there and ask it to import, and it reads the page
            properly rather than guessing at headings.
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-2">
            <Label htmlFor="import-text">The document, as text</Label>
            <Textarea
              id="import-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Open the PDF, select all, paste it here."
              className="min-h-64 font-mono text-[12px]"
            />
            <p className="text-faint text-xs">
              PDFs are not read directly on purpose: a two-column layout comes out interleaved and
              a wrong parse you cannot see is worse than a paste.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-inset rounded-control p-3 text-[13px]">
              Read {summary || "nothing it recognised"}. The whole document is saved as a note
              either way, so anything it missed stays searchable.
            </div>

            {warnings.length > 0 && (
              <ul className="space-y-1">
                {warnings.map((warning, index) => (
                  <li key={index} className="text-muted-foreground flex gap-1.5 text-[12px]">
                    <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-[var(--warning)]" />
                    {warning}
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-3">
              {(draft.roles ?? []).map((role, index) => (
                <div key={index} className="rounded-control border p-2.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Company</Label>
                      <Input
                        value={role.company}
                        onChange={(event) => editRole(index, { company: event.target.value })}
                      />
                      <FieldNote message={noteAt(`roles.${index}.company`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Title</Label>
                      <Input
                        value={role.title}
                        onChange={(event) => editRole(index, { title: event.target.value })}
                      />
                      <FieldNote message={noteAt(`roles.${index}.title`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">From</Label>
                      <Input
                        value={role.startDate ?? ""}
                        placeholder="2021-03"
                        onChange={(event) => editRole(index, { startDate: event.target.value })}
                      />
                      <FieldNote message={noteAt(`roles.${index}.startDate`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">To</Label>
                      <Input
                        value={role.isCurrent ? "Present" : (role.endDate ?? "")}
                        placeholder="2023-06"
                        onChange={(event) =>
                          editRole(index, {
                            endDate: event.target.value,
                            isCurrent: /present|current|now/i.test(event.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                  {/* The bullets are the point of the document, and a count of
                      them tells you nothing about whether they were read
                      right. They are the parser's shakiest output, so they are
                      the thing most worth putting in front of someone. */}
                  <div className="mt-2.5 space-y-1.5">
                    <Label className="text-[11px]">
                      What it read under this job
                      {(role.bullets?.length ?? 0) === 0 && (
                        <span className="text-faint font-normal"> — nothing</span>
                      )}
                    </Label>
                    <FieldNote message={noteAt(`roles.${index}.bullets`)} />
                    {(role.bullets ?? []).map((bullet, position) => (
                      <div key={position} className="flex items-start gap-1.5">
                        <span className="bg-muted-foreground/40 mt-3 size-1 shrink-0 rounded-full" />
                        <Textarea
                          value={bullet.text}
                          rows={1}
                          className="min-h-0 py-1.5 text-[12.5px]"
                          onChange={(event) =>
                            editBullets(index, (bullets) =>
                              bullets.map((one, at) =>
                                at === position ? { text: event.target.value } : one,
                              ),
                            )
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive mt-0.5 shrink-0"
                          aria-label="Leave this bullet out"
                          onClick={() =>
                            editBullets(index, (bullets) =>
                              bullets.filter((_, at) => at !== position),
                            )
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => editBullets(index, (bullets) => [...bullets, { text: "" }])}
                      >
                        <PlusIcon /> Bullet
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-destructive ml-auto"
                        onClick={() => dropRole(index)}
                      >
                        Leave this one out
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {draft ? (
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Back to the text
              </Button>
              <Button variant="default" onClick={commit} disabled={pending}>
                {pending && <LoaderCircleIcon className="animate-spin" />}
                {(draft.roles?.length ?? 0) === 0 ? "Save it as a note" : "Bring it in"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="default" onClick={read} disabled={!text.trim()}>
                Read it
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A parser doubt, under the field it doubts.
 *
 * Deliberately quiet: this is not an error, it is the parser saying which of
 * its guesses is worth a second look. Nothing here is wrong until the person
 * says it is.
 */
function FieldNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-muted-foreground flex gap-1.5 text-[11.5px] leading-snug">
      <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-[var(--warning)]" />
      {message}
    </p>
  );
}
