"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CircleUserRoundIcon, FilePlus2Icon, LoaderCircleIcon, PlusIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { createResumeAction } from "@/server/actions";
import { PaperThumb } from "@/components/resume/paper-thumb";
import { ResumePaper } from "@/components/resume/resume-paper";
import { parseResumeDoc } from "@/lib/resume-schema";
import { DEFAULT_TEMPLATE, RESUME_TEMPLATES } from "@/lib/resume-templates";

// From the one catalogue. This was the fourth hand-kept copy of the same list.
const TEMPLATES = RESUME_TEMPLATES;

/**
 * One canned document, rendered through the real ResumePaper for each template
 * button — the picker shows the actual layouts, not adjectives about them.
 * Tiny type is fine: the silhouette is what differs between templates.
 */
const SAMPLE_DOC = parseResumeDoc({
  header: {
    name: "Avery Reyes",
    title: "Product Engineer",
    email: "avery@example.com",
    phone: "555 010 1234",
    location: "Portland, OR",
  },
  sections: [
    {
      id: "smp-summary",
      kind: "summary",
      heading: "Summary",
      text: "Engineer of eight years, most of it on billing and payments systems for small teams.",
    },
    {
      id: "smp-experience",
      kind: "experience",
      heading: "Experience",
      experience: [
        {
          id: "smp-exp-1",
          company: "Meridian",
          title: "Senior Engineer",
          location: "Portland, OR",
          startDate: "2021-03",
          isCurrent: true,
          bullets: [
            "Led the move to usage-based billing, cutting invoice errors 38%",
            "Mentored four engineers through their first production launches",
          ],
        },
        {
          id: "smp-exp-2",
          company: "Fieldnote",
          title: "Engineer",
          startDate: "2018-01",
          endDate: "2021-02",
          bullets: ["Built the sync layer every offline customer depends on"],
        },
      ],
    },
    {
      id: "smp-education",
      kind: "education",
      heading: "Education",
      education: [
        {
          id: "smp-edu-1",
          school: "University of Oregon",
          degree: "BSc",
          field: "Computer Science",
          startDate: "2012-09",
          endDate: "2016-06",
        },
      ],
    },
  ],
});

const ACCENTS = ["#000000", "#B30000", "#0C5B97", "#1f2937", "#6366f1", "#0ea5e9"];

export function NewResumeDialog({ hasMaterial }: { hasMaterial: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "",
    targetRole: "",
    targetCompany: "",
    template: DEFAULT_TEMPLATE,
    accent: ACCENTS[0],
    seedFromMe: true,
  });

  useEffect(() => {
    if (!params.get("new")) return;
    setOpen(true);
    // Consume the flag: the search box and sort control on this page rewrite
    // the query string, and a ?new that lingers would reopen the dialog on
    // every one of those rewrites.
    const next = new URLSearchParams(params.toString());
    next.delete("new");
    router.replace(next.toString() ? `?${next}` : "?", { scroll: false });
  }, [params, router]);

  const submit = () => {
    startTransition(async () => {
      const id = await createResumeAction({
        ...form,
        name: form.name.trim() || suggestName(form),
        seedFromMe: form.seedFromMe && hasMaterial,
      });
      setOpen(false);
      toast.success("Resume created");
      router.push(`/resumes/${id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" data-new-button>
          <PlusIcon /> New resume
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New resume</DialogTitle>
          <DialogDescription>
            Start from what is in Me and edit, or start blank and fill it in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              autoFocus
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={suggestName(form)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target role</Label>
              <Input
                value={form.targetRole}
                onChange={(event) => setForm({ ...form, targetRole: event.target.value })}
                placeholder="Staff Engineer"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Target company</Label>
              <Input
                value={form.targetCompany}
                onChange={(event) => setForm({ ...form, targetCompany: event.target.value })}
                placeholder="Stripe"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Template</Label>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  onClick={() => setForm({ ...form, template: template.key })}
                  aria-pressed={form.template === template.key}
                  className={cn(
                    "overflow-hidden rounded-lg border text-left transition-all",
                    form.template === template.key
                      ? "border-primary ring-primary/25 ring-2"
                      : "hover:border-primary/30",
                  )}
                >
                  <div className="pointer-events-none">
                    <PaperThumb className="aspect-[17/20]">
                      <ResumePaper
                        doc={SAMPLE_DOC}
                        settings={{
                          template: template.key,
                          accent: form.accent,
                          fontFamily: "serif",
                          fontSize: 10,
                          lineHeight: 1.2,
                          pageMargin: 40,
                        }}
                      />
                    </PaperThumb>
                  </div>
                  <div className="border-t px-2 py-1.5">
                    <div className="text-[12px] font-medium">{template.name}</div>
                    <div className="text-muted-foreground text-[10px] leading-tight">
                      {template.hint}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Accent</Label>
            <div className="flex gap-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  onClick={() => setForm({ ...form, accent })}
                  aria-label={`Accent ${accent}`}
                  className={cn(
                    "size-7 rounded-full transition-transform hover:scale-110",
                    form.accent === accent && "ring-foreground/40 ring-2 ring-offset-2 ring-offset-background",
                  )}
                  style={{ background: accent }}
                />
              ))}
            </div>
          </div>

          {hasMaterial && (
            <button
              onClick={() => setForm({ ...form, seedFromMe: !form.seedFromMe })}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
                form.seedFromMe
                  ? "border-primary bg-primary/8"
                  : "hover:border-primary/30 hover:bg-accent/50",
              )}
            >
              {form.seedFromMe ? (
                <CircleUserRoundIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              ) : (
                <FilePlus2Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              )}
              <div>
                <div className="text-[13px] font-medium">
                  {form.seedFromMe ? "Build from Me" : "Start blank"}
                </div>
                <div className="text-muted-foreground text-[11px]">
                  {form.seedFromMe
                    ? "Pulls in every role, its strongest highlights, education and skills."
                    : "An empty document you fill in yourself."}
                </div>
              </div>
            </button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="default" onClick={submit} disabled={pending}>
            {pending && <LoaderCircleIcon className="animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function suggestName(form: { targetCompany: string; targetRole: string }) {
  const parts = [form.targetCompany, form.targetRole].filter(Boolean);
  return parts.length ? parts.join(" — ") : "Base resume";
}
