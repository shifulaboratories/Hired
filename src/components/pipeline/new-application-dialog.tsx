"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LoaderCircleIcon, PlusIcon, SparklesIcon } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BOARD_STAGES, STAGE_LABEL } from "@/lib/data/pipeline";
import type { Stage } from "@prisma/client";
import { createApplicationAction, parsePostingAction } from "@/server/actions";
import { TagPicker, type TagOption } from "@/components/tags/tag-picker";
import { cn } from "@/lib/utils";
import { ValuePicker } from "@/components/pipeline/value-picker";
import type { TagValue } from "@/components/tags/tag-chip";

export function NewApplicationDialog({
  resumes,
  tagOptions,
  fieldValues,
}: {
  resumes: { id: string; name: string }[];
  /** Every source category on file, with usage counts. */
  tagOptions: TagOption[];
  /** Locations already in use, so the first application matches the others. */
  fieldValues: { location: { value: string; count: number }[] };
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fetching, startFetching] = useTransition();
  const [form, setForm] = useState({
    company: "",
    roleTitle: "",
    stage: "" as Stage | "",
    jobUrl: "",
    location: "",
    salaryRange: "",
    tags: [] as TagValue[],
    jobDescription: "",
    resumeId: "",
  });

  useEffect(() => {
    if (params.get("new")) setOpen(true);
    // "Track a role" on a company page lands here with the company filled in.
    const company = params.get("company");
    if (company) setForm((current) => (current.company ? current : { ...current, company }));
  }, [params]);

  // Paste a link, get the form filled. The fields stay editable — the page's
  // answer is a draft, not a decision.
  const fetchPosting = () => {
    const url = form.jobUrl.trim();
    if (!url) {
      toast.error("Paste the posting's link first.");
      return;
    }
    startFetching(async () => {
      const result = await parsePostingAction(url);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const parsed = result.parsed;
      setForm((current) => ({
        ...current,
        company: current.company || parsed.company,
        roleTitle: current.roleTitle || parsed.roleTitle,
        location: current.location || parsed.location,
        salaryRange: current.salaryRange || parsed.salaryRange,
        // The parser hands back a name. Only prefill it when it matches a tag
        // that already exists — a capture should not invent one from a job
        // board's own wording.
        tags:
          current.tags.length > 0 || !parsed.source
            ? current.tags
            : (tagOptions ?? []).filter(
                (option) => option.name.toLowerCase() === parsed.source.toLowerCase(),
              ),
        jobDescription: current.jobDescription || parsed.jobDescription,
      }));
      toast.success(
        parsed.roleTitle && parsed.company
          ? "Filled from the posting — check it over."
          : "Read what it could; the rest is yours to fill.",
      );
    });
  };

  /** Everything past "applied" — the rare case, behind one more click. */
  const further: Stage[] = BOARD_STAGES.filter(
    (stage) => stage !== "WISHLIST" && stage !== "APPLIED",
  );

  const submit = () => {
    if (!form.company.trim() || !form.roleTitle.trim()) {
      toast.error("Company and role are required.");
      return;
    }
    if (!form.stage) {
      toast.error("Say whether you have applied yet — it decides where the card goes.");
      return;
    }
    // Narrowed above, but the guard does not survive the spread — so the
    // stage is written explicitly rather than carried along in `rest`.
    const stage = form.stage;
    startTransition(async () => {
      // Unhandled before this: a stale resume id, a tag ownership check or a
      // server asleep on a small box rejected into nowhere. The spinner
      // stopped, everything they had typed stayed on screen, nothing was
      // saved and nothing said so — so they pressed the button again.
      try {
        const { tags, ...rest } = form;
        const id = await createApplicationAction({
          ...rest,
          stage,
          company: form.company.trim(),
          roleTitle: form.roleTitle.trim(),
          tagIds: tags.map((tag) => tag.id),
          resumeId: form.resumeId || null,
        });
        setOpen(false);
        toast.success("Tracking it");
        router.push(`/applications/${id}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not track that job.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="default" data-new-button>
          <PlusIcon /> Track a job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Track a job</DialogTitle>
          <DialogDescription>
            Paste the posting and Claude can tailor a resume against it later. No link is fine
            too — a role you&apos;re chasing through a DM, with no listing, still belongs here.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="app-url">Job link</Label>
            <div className="flex gap-2">
              <Input
                id="app-url"
                value={form.jobUrl}
                onChange={(event) => setForm({ ...form, jobUrl: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") fetchPosting();
                }}
                placeholder="https://…  — paste a posting and let it fill the form"
              />
              <Button variant="outline" onClick={fetchPosting} disabled={fetching}>
                {fetching ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
                Fill from link
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="app-company">Company</Label>
            <Input
              id="app-company"
              autoFocus
              value={form.company}
              onChange={(event) => setForm({ ...form, company: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="Stripe"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-role">Role</Label>
            <Input
              id="app-role"
              value={form.roleTitle}
              onChange={(event) => setForm({ ...form, roleTitle: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="Staff Engineer, Payments"
            />
          </div>

          {/* A question, not a dropdown of seven board columns.
              This defaulted to Wishlist, and both possible defaults were
              wrong. Left alone by somebody who HAD applied, the card sat in
              Wishlist, never entered the funnel, and their analytics said they
              had applied to nothing. Defaulting the other way invents
              applications nobody sent. So it is asked instead — two buttons,
              plain words, no default and no submit until one is picked. It is
              one click, and it is the click that makes every number downstream
              true. "Further along" opens the full ladder for the rarer case of
              somebody already interviewing when they start tracking. */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Have you applied yet?</Label>
            <div className="flex flex-wrap gap-2">
              <StageChoice
                active={form.stage === "WISHLIST"}
                onClick={() => setForm({ ...form, stage: "WISHLIST" })}
              >
                Not yet — just saving it
              </StageChoice>
              <StageChoice
                active={form.stage === "APPLIED"}
                onClick={() => setForm({ ...form, stage: "APPLIED" })}
              >
                Yes, I have applied
              </StageChoice>
              <Select
                value={further.includes(form.stage as Stage) ? form.stage : ""}
                onValueChange={(value) => setForm({ ...form, stage: value as Stage })}
              >
                <SelectTrigger
                  aria-label="Somewhere further along"
                  className={cn(
                    "h-auto w-auto min-w-0 gap-1.5 rounded-control px-3 py-1.5 text-[13px]",
                    further.includes(form.stage as Stage)
                      ? "border-primary bg-primary-tint text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <SelectValue placeholder="Further along" />
                </SelectTrigger>
                <SelectContent>
                  {further.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {STAGE_LABEL[stage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Resume used</Label>
            <Select
              value={form.resumeId || "none"}
              onValueChange={(value) => setForm({ ...form, resumeId: value === "none" ? "" : value })}
            >
              <SelectTrigger aria-label="Resume used">
                <SelectValue placeholder="None yet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None yet</SelectItem>
                {resumes.map((resume) => (
                  <SelectItem key={resume.id} value={resume.id}>
                    {resume.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Location</Label>
            <ValuePicker
              value={form.location}
              options={fieldValues.location}
              onChange={(location) => setForm({ ...form, location })}
              placeholder="Anywhere"
              ariaLabel="Location"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="app-salary">Compensation</Label>
            <Input
              id="app-salary"
              value={form.salaryRange}
              onChange={(event) => setForm({ ...form, salaryRange: event.target.value })}
              placeholder="$180k – $230k"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Tags</Label>
            <TagPicker
              kind="APPLICATION"
              value={form.tags}
              options={tagOptions}
              placeholder="Where did this come from?"
              onChange={(tags) => setForm({ ...form, tags })}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="app-description">Job description</Label>
            <Textarea
              id="app-description"
              value={form.jobDescription}
              onChange={(event) => setForm({ ...form, jobDescription: event.target.value })}
              placeholder="Paste the whole posting here."
              className="min-h-28"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {/* Nine controls and no asterisk anywhere: the button used to be live
              from the moment the dialog opened and answered a press with a
              toast in the far corner, away from the two fields it was about.
              Disabled says the same thing where the person is looking. */}
          <Button
            variant="default"
            onClick={submit}
            disabled={pending || !form.company.trim() || !form.roleTitle.trim() || !form.stage}
          >
            {pending && <LoaderCircleIcon className="animate-spin" />}
            Track it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One of the two plain answers. A button rather than a radio: it is the same
 * hit target as the Select beside it, and there is nothing to read out of a
 * group of two whose labels are already whole sentences.
 */
function StageChoice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-control border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-primary bg-primary-tint text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
