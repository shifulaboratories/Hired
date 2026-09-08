"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MailIcon,
  MoreVerticalIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  UserMinusIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { ActivityType, Stage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CorrespondenceCard, type CorrespondenceAccess } from "@/components/google/correspondence-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SaveIndicator } from "@/components/save-indicator";
import { TagPicker, type TagOption } from "@/components/tags/tag-picker";
import type { TagValue } from "@/components/tags/tag-chip";
import { CompanyChip } from "@/components/crm/company-chip";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { ValuePicker } from "@/components/pipeline/value-picker";
import { PaperThumb } from "@/components/resume/paper-thumb";
import { ResumePaper, type PaperSettings } from "@/components/resume/resume-paper";
import type { ResumeDoc } from "@/lib/resume-schema";
import { companyDomain } from "@/lib/company";
import { useAutosave } from "@/hooks/use-autosave";
import { ACTIVITY_LABEL, ACTIVITY_OPTIONS, STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import { cn, relativeDay } from "@/lib/utils";
import { DateField } from "@/components/ui/date-field";
import {
  addActivityAction,
  createContactAction,
  createTaskAction,
  deleteApplicationAction,
  listContactsForAttachAction,
  moveStageAction,
  setContactApplicationAction,
  tailorResumeForApplicationAction,
  toggleTaskAction,
  updateApplicationAction,
} from "@/server/actions";

type Application = {
  id: string;
  company: string;
  /** The CRM record behind the name, for the "everything else with them" link. */
  companyId: string | null;
  roleTitle: string;
  stage: Stage;
  jobUrl: string;
  jobDescription: string;
  location: string;
  workMode: string;
  salaryRange: string;
  tags: TagValue[];
  notes: string;
  appliedAt: string | null;
  nextFollowUpAt: string | null;
  resumeId: string | null;
};

/**
 * Everything needed to draw the attached resume here.
 *
 * ResumePaper is a pure component — no "use client", no server-only imports —
 * so the document can be rendered inside this client component from plain
 * JSON, and the page and the slide-over can show the same thing without one
 * of them rendering it on the server and passing a node.
 */
export type ResumePreview = {
  id: string;
  name: string;
  doc: ResumeDoc;
  settings: PaperSettings;
};

type Activity = { id: string; type: ActivityType; body: string; occurredAt: string };
type Contact = {
  id: string;
  name: string;
  title: string;
  email: string;
  linkedin: string;
  relationship: string;
};
type Task = { id: string; title: string; done: boolean; dueAt: string | null };

export function ApplicationDetail({
  application,
  activities,
  contacts,
  tasks,
  resumes,
  tagOptions,
  fieldValues,
  company,
  companies,
  resumePreview,
  logos,
  googleAccess,
  onServerChange,
}: {
  application: Application;
  activities: Activity[];
  contacts: Contact[];
  tasks: Task[];
  resumes: { id: string; name: string }[];
  /** Every source category on file, with usage counts. */
  tagOptions: TagOption[];
  /** Locations and work modes already in use, so the fields can offer them. */
  fieldValues: {
    location: { value: string; count: number }[];
    workMode: { value: string; count: number }[];
  };
  /** The employer's record, for the chip. Null only if the row is mid-repair. */
  company: { id: string; name: string; website: string } | null;
  /** Every company on file, so changing employer picks one rather than typing. */
  companies: { id: string; name: string; website: string }[];
  /** The attached resume, rendered. Null when none is attached. */
  resumePreview: ResumePreview | null;
  logos: boolean;
  /** Whether their Gmail and Calendar are connected, for the threads-and-meetings card. */
  googleAccess: CorrespondenceAccess;
  /**
   * Re-fetch whatever server-derived props this host holds.
   *
   * On the page these come from the RSC render, so router.refresh() is enough.
   * In the slide-over they come from a server action held in component state,
   * which refresh() cannot re-run — without this the company chip, the resume
   * thumbnail and the source list stay on the snapshot taken when it opened.
   */
  onServerChange?: () => void;
}) {
  const [values, setValues] = useState({
    company: application.company,
    roleTitle: application.roleTitle,
    jobUrl: application.jobUrl,
    jobDescription: application.jobDescription,
    location: application.location,
    workMode: application.workMode,
    salaryRange: application.salaryRange,
    tags: application.tags,
    notes: application.notes,
    nextFollowUpAt: application.nextFollowUpAt ? application.nextFollowUpAt.slice(0, 10) : "",
    resumeId: application.resumeId ?? "",
  });
  const [stage, setStage] = useState(application.stage);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const refresh = () => {
    router.refresh();
    onServerChange?.();
  };

  // The company deliberately does NOT ride along with the autosave.
  //
  // updateApplication resolves `company` through upsertCompanyByName, which
  // creates the company when the name does not exist. Autosave flushes 700ms
  // after a pause, so typing "Stripe" and hesitating after "Str" used to mint a
  // company called "Str" and move the application onto it — the machine that
  // manufactures the duplicate employers you then have to merge. It is
  // committed on blur instead, when the name is a name.
  const { state, push } = useAutosave<typeof values>((next) => {
    const { company: _company, tags, ...rest } = next;
    return updateApplicationAction(application.id, {
      ...rest,
      // Categories are rows now, so what travels is ids — and it replaces the
      // whole set, which is what ticking one off in the picker means.
      tagIds: tags.map((tag) => tag.id),
      nextFollowUpAt: next.nextFollowUpAt || null,
      resumeId: next.resumeId || null,
    });
  });

  // Read-only echo of the facts worth seeing without scrolling. Keyed by index
  // rather than by text: Location and Mode are both very often "Remote".
  const meta = [
    values.location,
    values.workMode,
    values.salaryRange,
    application.appliedAt
      ? `Applied ${new Date(application.appliedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "",
    values.nextFollowUpAt ? `Chase ${relativeDay(new Date(values.nextFollowUpAt))}` : "",
  ].filter(Boolean);

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  const changeStage = (next: Stage) => {
    setStage(next);
    startTransition(async () => {
      await moveStageAction(application.id, next);
      toast.success(`Moved to ${STAGE_LABEL[next]}`);
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* The employer is a chip you can open, not a text field you can
              rename by accident. Changing which company this job belongs to is
              still possible, but it is a deliberate act now, through a picker
              that offers the companies you already have before inventing one. */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {company ? (
              <CompanyChip company={company} logos={logos} />
            ) : (
              <span className="text-muted-foreground text-[13px]">{values.company}</span>
            )}
            <CompanyPicker
              applicationId={application.id}
              current={values.company}
              companies={companies}
              logos={logos}
              onChanged={(name) => {
                setValues((prev) => ({ ...prev, company: name }));
                refresh();
              }}
            />
          </div>

          <Input
            value={values.roleTitle}
            onChange={(event) => set({ roleTitle: event.target.value })}
            aria-label="Role title"
            className="h-auto border-0 bg-transparent px-0 text-[27px] font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-[32px]"
          />

          {/* The facts you check on open. Read-only here and editable in
              Details — in the slide-over the rail is below the fold, so
              without this the compensation is a scroll away from itself. */}
          {meta.length > 0 && (
            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px]">
              {meta.map((item, index) => (
                <span key={index} className="flex items-center gap-2">
                  {index > 0 && <span className="text-faint">·</span>}
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <SaveIndicator state={state} />
          <Select value={stage} onValueChange={(value) => changeStage(value as Stage)}>
            <SelectTrigger className="w-40">
              <span className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: STAGE_TONE[stage] }}
                />
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((option) => (
                <SelectItem key={option} value={option}>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: STAGE_TONE[option] }}
                    />
                    {STAGE_LABEL[option]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {values.jobUrl && (
            <Button asChild variant="outline" size="icon">
              <a href={values.jobUrl} target="_blank" rel="noreferrer" aria-label="Open posting">
                <ExternalLinkIcon />
              </a>
            </Button>
          )}

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
                  if (
                    confirm(
                      `Delete the ${values.company} application? Its timeline and tasks go with it, and you can restore all of it from the archive.`,
                    )
                  ) {
                    void deleteApplicationAction(application.id).then(() => {
                      window.location.href = "/applications";
                    });
                  }
                }}
              >
                <Trash2Icon /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Container query, not a viewport one. This component renders in two
          very different boxes: the page, whose content is ~720px at a 1024px
          viewport once the 15rem rail is taken out, and the slide-over, which
          is ~688px at any viewport. `lg:` measured the window, so the panel
          was being given two columns on every desktop and cramming a 21rem
          rail into 688px. 44rem is above the panel and below the page. */}
      <div className="@container">
        <div className="grid gap-6 @min-[44rem]:grid-cols-[minmax(0,1fr)_21rem]">
        {/* Tabs, not one column of eight cards.
            Everything here is about one application, but not at the same
            moment: you open it to see where it stands, or to read the posting
            before an interview, or to write down what just happened. Stacked,
            the posting and the notes sat three scrolls under the thing you
            came for. The details rail stays out of the tabs deliberately —
            stage, follow-up and salary are the answer to "where is this",
            which is true on every tab. */}
        <Tabs defaultValue="overview" className="min-w-0">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="timeline">
              Timeline
              {activities.length > 0 && (
                <span className="text-faint nums ml-1 text-[11px]">{activities.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="posting">Posting</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* People first. They are the reason the application moves, and they
                were previously last in the right rail — in the panel, two
                scrolls below the fold. */}
            <ContactsCard applicationId={application.id} company={values.company} contacts={contacts} />

            {resumePreview ? (
              <ResumeCard preview={resumePreview} />
            ) : (
              <TailorCard applicationId={application.id} company={values.company} />
            )}
          </TabsContent>

          <TabsContent value="timeline" className="space-y-6">
            <Timeline applicationId={application.id} activities={activities} />

            {/* The threads and meetings behind this application: the company's
                domain and the people attached above. The timeline is what was
                logged; this is what actually happened. */}
            <CorrespondenceCard
              subject={{ kind: "application", id: application.id }}
              access={googleAccess}
            />
          </TabsContent>

          <TabsContent value="posting">
            <JobDescriptionCard
              value={values.jobDescription}
              onChange={(jobDescription) => set({ jobDescription })}
            />
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={values.notes}
                  onChange={(event) => set({ notes: event.target.value })}
                  placeholder="Anything you want to remember about this one."
                  className="min-h-64"
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Next follow-up</Label>
                <DateField
                  value={values.nextFollowUpAt}
                  onChange={(nextFollowUpAt) => set({ nextFollowUpAt })}
                  ariaLabel="Next follow-up"
                  placeholder="Nothing scheduled"
                />
                {values.nextFollowUpAt && (
                  <p className="text-muted-foreground text-xs">
                    {relativeDay(new Date(values.nextFollowUpAt))}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Resume used</Label>
                <div className="flex gap-2">
                  <Select
                    value={values.resumeId || "none"}
                    onValueChange={(value) => {
                      set({ resumeId: value === "none" ? "" : value });
                      // The thumbnail is rendered from a server-derived prop,
                      // so it has to be re-fetched, not just re-rendered. The
                      // autosave writes it; this goes and reads it back.
                      window.setTimeout(refresh, 900);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {resumes.map((resume) => (
                        <SelectItem key={resume.id} value={resume.id}>
                          {resume.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {values.resumeId && (
                    <Button asChild variant="outline" size="icon">
                      <Link href={`/resumes/${values.resumeId}`} aria-label="Open resume">
                        <FileTextIcon />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <ValuePicker
                    value={values.location}
                    options={fieldValues.location}
                    onChange={(location) => set({ location })}
                    placeholder="Anywhere"
                    ariaLabel="Location"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Mode</Label>
                  <ValuePicker
                    value={values.workMode}
                    options={fieldValues.workMode}
                    onChange={(workMode) => set({ workMode })}
                    placeholder="Unset"
                    ariaLabel="Work mode"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Compensation</Label>
                <Input
                  value={values.salaryRange}
                  onChange={(event) => set({ salaryRange: event.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Tags</Label>
                <TagPicker
                  kind="APPLICATION"
                  value={values.tags}
                  options={tagOptions}
                  placeholder="Where did this come from?"
                  onChange={(tags) => set({ tags })}
                  onCatalogChange={refresh}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Job link</Label>
                <Input
                  value={values.jobUrl}
                  onChange={(event) => set({ jobUrl: event.target.value })}
                  placeholder="https://…"
                />
              </div>

            </CardContent>
          </Card>

          <TasksCard applicationId={application.id} tasks={tasks} />
        </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Moving an application to a different employer.
 *
 * Deliberately a picker over the companies already on file rather than a text
 * box: typing a name that does not exist creates one, which is how a workspace
 * ends up with "Stripe", "Stripe, Inc." and "Str". Creating is still possible —
 * it is the last row, and it says that it is creating.
 */
function CompanyPicker({
  applicationId,
  current,
  companies,
  logos,
  onChanged,
}: {
  applicationId: string;
  current: string;
  companies: { id: string; name: string; website: string }[];
  logos: boolean;
  onChanged: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  const move = (name: string) => {
    const clean = name.trim();
    if (!clean || clean === current) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await updateApplicationAction(applicationId, { company: clean });
        toast.success(`Moved to ${clean}`);
        setOpen(false);
        setQuery("");
        onChanged(clean);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not change the company.");
      }
    });
  };

  const typed = query.trim();
  const exists = companies.some((item) => item.name.toLowerCase() === typed.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Change company"
          title="Change company"
          className="text-faint hover:text-foreground"
          disabled={pending}
        >
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Move to which company?"
            className="h-9"
          />
          <CommandList>
            {/* Only when there is nothing to create either — a force-mounted
                item is never registered in cmdk's store, so it does not count
                towards `filtered.count` and CommandEmpty would otherwise show
                above the very "Create X" row that contradicts it. */}
            {!typed && <CommandEmpty>No company matches.</CommandEmpty>}
            {companies.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.name} ${item.id}`}
                onSelect={() => move(item.name)}
                className="flex items-center gap-2 px-2 py-1.5 text-[13px]"
              >
                <CompanyAvatar
                  name={item.name}
                  domain={logos ? companyDomain({ name: item.name, website: item.website }) : null}
                  size={18}
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.name === current && <span className="text-faint text-[11px]">current</span>}
              </CommandItem>
            ))}
            {typed && !exists && (
              <CommandItem
                forceMount
                value="±new±"
                onSelect={() => move(typed)}
                className="flex items-center gap-2 px-2 py-1.5 text-[13px]"
              >
                <PlusIcon className="size-3.5" />
                Create “{typed}”
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The posting, folded away.
 *
 * It is the longest thing on the page and the thing you look at least — you
 * pasted it once and Claude reads it from then on. Collapsed when there is one
 * to collapse, open when there is not, because an empty card that hides its
 * own paste target is a dead end.
 */
function JobDescriptionCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(!value.trim());
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
          )}
          <CardTitle className="text-[15px]">Job description</CardTitle>
          {!open && words > 0 && (
            <span className="text-faint nums text-[12px]">{words} words</span>
          )}
          {!open && words === 0 && <span className="text-faint text-[12px]">empty</span>}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Paste the full posting — this is what Claude tailors against.
          </p>
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Paste the posting here."
            className="min-h-56 font-mono text-[13px] leading-relaxed"
          />
        </CardContent>
      )}
    </Card>
  );
}

/**
 * The resume that actually went out, as the page it is.
 *
 * A name in a Select told you which document was attached and nothing about
 * what is on it. This is the same live thumbnail the resumes screen draws,
 * from the same components, so "what did I send them" is answered by looking.
 */
function ResumeCard({ preview }: { preview: ResumePreview }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="relative border-b">
        <PaperThumb>
          <ResumePaper doc={preview.doc} settings={preview.settings} />
        </PaperThumb>
        {/* The page is cropped, so fade the cut rather than ending it on a
            hard line mid-sentence — same treatment as the resumes grid. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
      </div>
      <CardContent className="flex items-center gap-2 py-3">
        <FileTextIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{preview.name}</span>
        <Button asChild variant="outline" size="xs">
          <Link href={`/resumes/${preview.id}`}>Open</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The four steps this used to take: copy the base, rename it for the job,
 * attach it, open it. One button, and the copy remembers what it came from so
 * the Changes panel can say what you tailored.
 */
function TailorCard({ applicationId, company }: { applicationId: string; company: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">No resume on this one yet</div>
          <div className="text-faint text-[12px]">
            Start from your base and cut it down for {company || "this job"}.
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const result = await tailorResumeForApplicationAction(applicationId);
                toast.success(
                  result.seededFromMe
                    ? "Built a first draft from what is on file"
                    : `Copied ${result.basedOn}`,
                );
                router.push(`/resumes/${result.id}`);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not start that.");
              }
            })
          }
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
          Tailor one
        </Button>
      </CardContent>
    </Card>
  );
}

function Timeline({
  applicationId,
  activities,
}: {
  applicationId: string;
  activities: Activity[];
}) {
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [type, setType] = useState<ActivityType>("NOTE");

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    setBody("");
    startTransition(async () => {
      await addActivityAction({ applicationId, type, body: text });
      toast.success("Logged");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
            }}
            placeholder="Recruiter call went well — they want a system design round next week…"
            className="min-h-20"
          />
          <div className="flex items-center gap-2">
            <Select value={type} onValueChange={(value) => setType(value as ActivityType)}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {ACTIVITY_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={submit} disabled={pending || !body.trim()} className="ml-auto">
              {pending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
              Log it
            </Button>
          </div>
        </div>

        {activities.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">Nothing logged yet.</p>
        ) : (
          <ol className="relative space-y-4 pl-5">
            <span className="bg-border absolute top-1.5 bottom-1.5 left-[3px] w-px" />
            <AnimatePresence initial={false}>
              {activities.map((activity) => (
                <motion.li
                  key={activity.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative"
                >
                  <span className="bg-primary ring-background absolute top-1.5 -left-5 size-[7px] rounded-full ring-4" />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {ACTIVITY_LABEL[activity.type]}
                    </Badge>
                    <span className="text-muted-foreground ml-auto text-xs">
                      {new Date(activity.occurredAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-wrap">{activity.body}</p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TasksCard({ applicationId, tasks }: { applicationId: string; tasks: Task[] }) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    startTransition(async () => {
      await createTaskAction({ title, applicationId });
      toast.success("Task added");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Tasks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && add()}
            placeholder="Send thank-you note"
          />
          <Button variant="outline" size="icon" onClick={add} disabled={pending || !draft.trim()}>
            <PlusIcon />
          </Button>
        </div>

        {tasks.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-sm">No tasks.</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((task) => {
              const isDone = task.done || done.has(task.id);
              return (
                <li key={task.id} className="flex items-start gap-2.5 py-0.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={isDone}
                    onCheckedChange={(checked) => {
                      const next = Boolean(checked);
                      setDone((prev) => {
                        const copy = new Set(prev);
                        if (next) copy.add(task.id);
                        else copy.delete(task.id);
                        return copy;
                      });
                      void toggleTaskAction(task.id, next);
                    }}
                  />
                  <span
                    className={cn(
                      "text-[13px] leading-snug",
                      isDone && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </span>
                  {task.dueAt && (
                    <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
                      {relativeDay(new Date(task.dueAt))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type AttachCandidate = {
  id: string;
  name: string;
  title: string;
  company: string;
  attachedTo: string | null;
};

/**
 * The people on this application — who you messaged, who referred you, who is
 * interviewing you. "Add" offers everyone already in the CRM before the blank
 * form, because half the time the person is already on file from another
 * thread. Removing someone only DETACHES them: they stay in the CRM with their
 * whole history, because taking a person off an application must never delete
 * them from your life.
 */
function ContactsCard({
  applicationId,
  company,
  contacts,
}: {
  applicationId: string;
  company: string;
  contacts: Contact[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // People attached this session, so they appear without a round-trip.
  const [added, setAdded] = useState<Contact[]>([]);
  const [candidates, setCandidates] = useState<AttachCandidate[] | null>(null);
  const [form, setForm] = useState({ name: "", title: "", email: "", relationship: "" });

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && candidates === null) {
      listContactsForAttachAction(applicationId)
        .then(setCandidates)
        .catch(() => setCandidates([]));
    }
  };

  const attach = (candidate: AttachCandidate) => {
    setCandidates((prev) => (prev ?? []).filter((item) => item.id !== candidate.id));
    setAdded((prev) => [
      ...prev,
      {
        id: candidate.id,
        name: candidate.name,
        title: candidate.title,
        email: "",
        linkedin: "",
        relationship: "",
      },
    ]);
    setRemoved((prev) => {
      const copy = new Set(prev);
      copy.delete(candidate.id);
      return copy;
    });
    startTransition(async () => {
      await setContactApplicationAction(candidate.id, applicationId);
      toast.success(`${candidate.name} attached`);
      router.refresh();
    });
  };

  const detach = (contact: Contact) => {
    setRemoved((prev) => new Set(prev).add(contact.id));
    startTransition(async () => {
      await setContactApplicationAction(contact.id, null);
      toast.success(`${contact.name} removed — still in your contacts`);
      router.refresh();
    });
  };

  const add = () => {
    if (!form.name.trim()) return;
    startTransition(async () => {
      await createContactAction({ ...form, applicationId, company });
      setForm({ name: "", title: "", email: "", relationship: "" });
      setOpen(false);
      toast.success("Contact saved");
      router.refresh();
    });
  };

  // The server copy wins over the optimistic stub: after router.refresh() the
  // contacts prop carries the full record (email, relationship), and keeping
  // the stub would hide the mailto button on the person just attached.
  const visible = [
    ...contacts,
    ...added.filter((item) => !contacts.some((contact) => contact.id === item.id)),
  ].filter((contact) => !removed.has(contact.id));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-[15px]">People</CardTitle>
        <Button variant="ghost" size="xs" onClick={toggleOpen}>
          <UserPlusIcon /> Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="space-y-3 overflow-hidden"
            >
              {candidates && candidates.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-faint text-[11px] font-medium tracking-[0.08em] uppercase">
                    Already in your contacts
                  </p>
                  <Command loop className="bg-inset rounded-lg">
                    {candidates.length > 4 && (
                      <CommandInput placeholder="Find someone…" className="h-8" />
                    )}
                    <CommandList className="max-h-44">
                      <CommandEmpty>No one matches.</CommandEmpty>
                      {candidates.map((candidate) => (
                        <CommandItem
                          key={candidate.id}
                          // The id keeps two people with the same name distinct
                          // for cmdk; it never renders.
                          value={`${candidate.name} ${candidate.company} ${candidate.id}`}
                          onSelect={() => attach(candidate)}
                          className="px-2 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px]">{candidate.name}</div>
                            <div className="text-faint truncate text-[11px]">
                              {[candidate.title, candidate.company].filter(Boolean).join(" · ") ||
                                "No details on file"}
                              {candidate.attachedTo ? ` · currently on ${candidate.attachedTo}` : ""}
                            </div>
                          </div>
                          <PlusIcon className="size-3.5 shrink-0" />
                        </CommandItem>
                      ))}
                    </CommandList>
                  </Command>
                  <p className="text-faint text-[11px] font-medium tracking-[0.08em] uppercase">
                    Or someone new
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Name"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    placeholder="Title"
                  />
                  <Input
                    value={form.relationship}
                    onChange={(event) => setForm({ ...form, relationship: event.target.value })}
                    placeholder="Recruiter"
                  />
                </div>
                <Input
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  onKeyDown={(event) => event.key === "Enter" && add()}
                  placeholder="Email"
                />
                <Button size="sm" onClick={add} disabled={pending || !form.name.trim()}>
                  Save contact
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {visible.length === 0 ? (
          <p className="text-muted-foreground py-3 text-center text-sm">
            No one yet. The recruiter you replied to, the friend who referred you, the hiring
            manager you messaged — they all belong here.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((contact) => (
              <li key={contact.id} className="group flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/crm/contacts/${contact.id}`}
                    className="text-[13px] font-medium hover:underline"
                  >
                    {contact.name}
                  </Link>
                  <div className="text-muted-foreground truncate text-xs">
                    {[contact.title, contact.relationship].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {contact.email && (
                  <Button asChild variant="ghost" size="icon-sm">
                    <a href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>
                      <MailIcon />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${contact.name} from this application`}
                  title="Remove from this application (stays in your contacts)"
                  className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => detach(contact)}
                >
                  <UserMinusIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
