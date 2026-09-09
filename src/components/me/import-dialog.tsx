"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  DownloadIcon,
  FileTextIcon,
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
import { readPdf, type PageBoxes } from "@/lib/resume-pdf-layout";
import { buildBaseResumeAction, importResumeAction } from "@/server/actions";
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
export function ImportDialog({ hasResumes = false }: { hasResumes?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ResumeImport | null>(null);
  const [source, setSource] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notes, setNotes] = useState<ParseNote[]>([]);
  /** What happened to a dropped PDF, if one was dropped. */
  const [pdfState, setPdfState] = useState<"idle" | "reading" | "columns" | "empty" | "failed">(
    "idle",
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (params.get("import")) setOpen(true);
  }, [params]);

  const roleCount = draft?.roles?.length ?? 0;
  const summary = useMemo(() => {
    if (!draft) return "";
    const counts = [
      [draft.profile?.fullName ? 1 : 0, "name"],
      [roleCount, "job"],
      [draft.education?.length ?? 0, "school"],
      [draft.skillGroups?.reduce((sum, group) => sum + (group.skills?.length ?? 0), 0) ?? 0, "skill"],
      [draft.certifications?.length ?? 0, "certification"],
      [draft.projects?.length ?? 0, "project"],
    ] as const;
    return counts
      .filter(([n]) => n > 0)
      .map(([n, word]) => (word === "name" ? `a name` : `${n} ${word}${n > 1 ? "s" : ""}`))
      .join(", ");
  }, [draft, roleCount]);

  /**
   * Read a dropped PDF, or say why it cannot be read.
   *
   * pdfjs is imported here rather than at the top of the file so it is fetched
   * only by someone who actually has a PDF — it is a megabyte of parser, and
   * most people paste text.
   *
   * The worker is not optional. Setting workerSrc to "" to keep everything on
   * the main thread throws 'No "GlobalWorkerOptions.workerSrc" specified' —
   * pdfjs v4 has no no-worker mode. `new URL(..., import.meta.url)` is what
   * makes the bundler emit the worker as an asset and hand back its real URL,
   * so this keeps working under a hashed build rather than depending on a path
   * that happens to be right in development.
   */
  const readPdfFile = (file: File) => {
    setPdfState("reading");
    startTransition(async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          isEvalSupported: false,
          disableFontFace: true,
        }).promise;
        const pages: PageBoxes[] = [];
        for (let number = 1; number <= doc.numPages; number++) {
          const page = await doc.getPage(number);
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          pages.push({
            width: viewport.width,
            height: viewport.height,
            boxes: content.items.flatMap((item) =>
              "str" in item
                ? [{ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }]
                : [],
            ),
          });
        }
        const reading = readPdf(pages);
        if (reading.kind === "read") {
          setText(reading.text);
          setPdfState("idle");
          toast.success(`Read ${reading.pages} page${reading.pages === 1 ? "" : "s"} of ${file.name}`);
        } else if (reading.kind === "columns") {
          // Named, not hidden. A two-column PDF's text comes out interleaved —
          // a line of your jobs, a line of your sidebar — and handing that to
          // the parser produces a mess whose cause is invisible.
          setPdfState("columns");
        } else {
          setPdfState("empty");
        }
      } catch {
        setPdfState("failed");
      }
    });
  };

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

        // The point of pasting a resume is having a resume. Somebody with none
        // is put in front of one built from what just landed; somebody who
        // already has documents is topping up their material, and being thrown
        // into a new one would be the app deciding what they came for.
        if (created > 0 || merged.length > 0) {
          if (!hasResumes) {
            const base = await buildBaseResumeAction();
            router.push(`/resumes/${base.id}`);
          } else {
            toast.message("Want a resume from this?", {
              action: {
                label: "Build one",
                onClick: () => {
                  void buildBaseResumeAction().then((base) => router.push(`/resumes/${base.id}`));
                },
              },
            });
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not import that.");
      }
    });
  };

  const editProfile = (patch: Partial<NonNullable<ResumeImport["profile"]>>) =>
    setDraft((current) =>
      current ? { ...current, profile: { ...(current.profile ?? {}), ...patch } } : current,
    );

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
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="import-text">The document, as text</Label>
              <Button variant="ghost" size="xs" asChild disabled={pdfState === "reading"}>
                <label className="cursor-pointer">
                  {pdfState === "reading" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <FileTextIcon />
                  )}
                  {pdfState === "reading" ? "Reading…" : "Read a PDF"}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) readPdfFile(file);
                    }}
                  />
                </label>
              </Button>
            </div>
            <Textarea
              id="import-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste it here, or read a PDF above."
              className="min-h-64 font-mono text-[12px]"
            />
            {/* Every one of these says what happened and what to do about it.
                "It didn't work" is what this dialog used to say about PDFs, by
                not accepting them at all. */}
            {pdfState === "columns" ? (
              <p className="text-muted-foreground flex gap-1.5 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-[var(--warning)]" />
                That PDF is laid out in two columns. Its text comes out interleaved — a line of
                your jobs, then a line of your sidebar — so reading it would produce a mess you
                could not see the cause of. Open it, select all, and paste instead; or give the
                file to Claude, which reads the page rather than the text layer.
              </p>
            ) : pdfState === "empty" ? (
              <p className="text-muted-foreground flex gap-1.5 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-[var(--warning)]" />
                That PDF has no text in it — it is probably a scan or an export of images. Paste
                the text instead, or give the file to Claude.
              </p>
            ) : pdfState === "failed" ? (
              <p className="text-muted-foreground flex gap-1.5 text-xs">
                <TriangleAlertIcon className="mt-0.5 size-3 shrink-0 text-[var(--warning)]" />
                That file could not be opened as a PDF. Paste the text instead.
              </p>
            ) : (
              <p className="text-faint text-xs">
                A single-column PDF is read here. A two-column one is refused rather than
                guessed at: its text comes out interleaved, and a wrong parse you cannot see is
                worse than a paste.
              </p>
            )}
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

            {/* The header, which is the whole reason this screen says "check it
                before it lands".
                The parser takes the name from the first non-empty line, with
                the only guard being "under sixty characters and not an email
                address" — so a document that opens with RESUME, CURRICULUM
                VITAE, or whatever a two-column PDF happens to put first files
                that as the person's name. It then goes into Profile, and
                Profile is what prints at the top of every resume they build
                and publish. The review showed roles and nothing else, so the
                one screen built to catch a bad parse never showed the field
                most likely to be wrong and most expensive to leave wrong. */}
            <div className="rounded-control border p-2.5">
              <div className="text-muted-foreground mb-2 text-[11px] font-medium">
                Goes at the top of every resume
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px]" htmlFor="import-name">
                    Name
                  </Label>
                  <Input
                    id="import-name"
                    value={draft.profile?.fullName ?? ""}
                    onChange={(event) => editProfile({ fullName: event.target.value })}
                    placeholder="Nobody found — type it"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]" htmlFor="import-email">
                    Email
                  </Label>
                  <Input
                    id="import-email"
                    value={draft.profile?.email ?? ""}
                    onChange={(event) => editProfile({ email: event.target.value })}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]" htmlFor="import-phone">
                    Phone
                  </Label>
                  <Input
                    id="import-phone"
                    value={draft.profile?.phone ?? ""}
                    onChange={(event) => editProfile({ phone: event.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]" htmlFor="import-linkedin">
                    LinkedIn
                  </Label>
                  <Input
                    id="import-linkedin"
                    value={draft.profile?.linkedin ?? ""}
                    onChange={(event) => editProfile({ linkedin: event.target.value })}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <p className="text-faint mt-2 text-[11.5px]">
                Only the ones you have not filled in already are written.
              </p>
            </div>

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
