"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  MinusIcon,
  MoreVerticalIcon,
  PrinterIcon,
  PaletteIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/resume/share-button";
import { CompareToBase } from "@/components/resume/compare-to-base";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/utils";
import {
  blankEducation,
  blankExperience,
  blankProject,
  blankSection,
  SECTION_KINDS,
  type ResumeDoc,
  type ResumeSection,
  type SectionKind,
} from "@/lib/resume-schema";
import { PageMeasure } from "@/components/resume/page-measure";
import { DragHandle, SortableList, SortableRow } from "@/components/resume/sortable-list";
import { moveWithin } from "@/lib/resume-reorder";
import { PageBreaks } from "@/components/resume/page-breaks";
import { FitPanel } from "@/components/resume/fit-panel";
import { emptyLayout, pageBox, type PageLayout } from "@/lib/resume-pagination";
import { ResumePaper, type PaperSettings } from "@/components/resume/resume-paper";
import { EvidencePanel, type LinkedApplication } from "@/components/resume/evidence-panel";
import type { CorrespondenceAccess } from "@/components/google/correspondence-card";
import {
  deleteResumeAction,
  duplicateResumeAction,
  updateResumeAction,
} from "@/server/actions";

/**
 * Everything autosave writes back. `photo` is deliberately not here: the
 * picture is the profile's, not the document's, and round-tripping fifty
 * kilobytes of base64 through every keystroke's save would be absurd. The
 * document only stores whether to show one.
 */
type Meta = Omit<PaperSettings, "photo"> & {
  name: string;
  targetRole: string;
  targetCompany: string;
  notes: string;
  isFavorite: boolean;
  showPhoto: boolean;
};

const ACCENTS = ["#000000", "#B30000", "#0C5B97", "#1f2937", "#6366f1", "#0ea5e9"];

export function ResumeEditor({
  id,
  doc: initialDoc,
  meta: initialMeta,
  shareUrl,
  base,
  photo,
  siblings,
  applications,
  googleAccess,
}: {
  id: string;
  doc: ResumeDoc;
  meta: Meta;
  /** Every other resume, for saying which one it came from. */
  siblings: { id: string; name: string }[];
  /** The jobs this document was actually sent to. */
  applications: LinkedApplication[];
  /** Whether Gmail and Calendar are connected, for the mail behind those jobs. */
  googleAccess: CorrespondenceAccess;
  /**
   * The resume this one was tailored from, or null. Drives the live
   * compare-to-base view in the toolbar; the diff recomputes as you type.
   */
  base: { id: string; name: string; doc: ResumeDoc } | null;
  /**
   * The owner's headshot, whether or not this document shows it. Held here so
   * the toggle is instant — flipping it repaints the preview rather than
   * waiting for a save and a refetch.
   */
  photo: string;
  /**
   * The public link, or null when unpublished. Deliberately NOT part of `meta`:
   * meta is what autosave writes back through updateResumeAction, and a public
   * URL must never be created or destroyed as a side effect of typing.
   */
  shareUrl: string | null;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState(initialDoc);
  const [meta, setMeta] = useState(initialMeta);
  const [zoom, setZoom] = useState(0.78);
  const [pending, startTransition] = useTransition();

  const { state, push, flush } = useAutosave<{ doc: ResumeDoc; meta: Meta }>((next) =>
    updateResumeAction(id, { ...next.meta, data: next.doc }),
  );

  const commit = (nextDoc: ResumeDoc, nextMeta: Meta = meta) => {
    setDoc(nextDoc);
    setMeta(nextMeta);
    push({ doc: nextDoc, meta: nextMeta });
  };

  const setMetaValue = <K extends keyof Meta>(key: K, value: Meta[K]) => {
    const next = { ...meta, [key]: value };
    setMeta(next);
    push({ doc, meta: next });
  };

  // Measured, not estimated: PageMeasure lays the real document out in
  // page-sized columns and reports where the browser breaks it. The old gauge
  // assumed 110 characters a line and never saw the type size, leading or
  // margin, all of which are two clicks away in Design.
  const [layout, setLayout] = useState<PageLayout>(() => emptyLayout(pageBox(initialMeta.pageMargin)));

  // By position, not by id. Ids are healed on parse now, but a section's
  // place in the list is the one address that cannot be blank or repeated,
  // and this is the code that used to edit every section at once.
  const updateSection = (index: number, patch: Partial<ResumeSection>) => {
    commit({
      ...doc,
      sections: doc.sections.map((section, at) =>
        at === index ? { ...section, ...patch } : section,
      ),
    });
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= doc.sections.length) return;
    commit({ ...doc, sections: moveWithin(doc.sections, index, target) });
  };

  const addSection = (kind: SectionKind) => {
    commit({ ...doc, sections: [...doc.sections, blankSection(kind)] });
  };

  const removeSection = (index: number) => {
    commit({ ...doc, sections: doc.sections.filter((_, at) => at !== index) });
  };

  return (
    <div className="flex h-[calc(100svh-4rem)] flex-col">
      {/* Toolbar */}
      <div className="glass flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2.5 md:px-6">
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
          <Link href="/me?tab=resumes">
            <ArrowLeftIcon />
          </Link>
        </Button>

        <Input
          value={meta.name}
          onChange={(event) => setMetaValue("name", event.target.value)}
          className="h-9 w-auto min-w-[10rem] max-w-[22rem] border-0 bg-transparent px-1 text-base font-semibold shadow-none focus-visible:ring-0 md:h-8 md:text-sm"
        />

        <SaveIndicator state={state} />

        {/* The page count is where "how do I cut this down" gets asked, so it
            is also where it gets answered. */}
        <FitPanel doc={doc} layout={layout} onChange={(next) => commit(next)} />

        {base && <CompareToBase base={base} doc={doc} />}

        <div className="ml-auto flex items-center gap-1.5">
          {/* What this document is against what it came from, what backs each
              claim, and where it was sent. Reads saved data, so the autosave
              is flushed first. */}
          <EvidencePanel
            resumeId={id}
            base={base ? { id: base.id, name: base.name } : null}
            siblings={siblings}
            applications={applications}
            googleAccess={googleAccess}
            onOpen={flush}
          />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setMetaValue("isFavorite", !meta.isFavorite)}
            aria-label="Favourite"
          >
            <StarIcon className={cn(meta.isFavorite && "fill-primary text-primary")} />
          </Button>

          <DesignPopover meta={meta} onChange={setMetaValue} hasPhoto={Boolean(photo)} />

          <div className="hidden items-center gap-1 md:flex">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.08).toFixed(2)))}
              aria-label="Zoom out"
            >
              <MinusIcon />
            </Button>
            <span className="text-muted-foreground w-9 text-center text-xs tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setZoom((z) => Math.min(1.4, +(z + 0.08).toFixed(2)))}
              aria-label="Zoom in"
            >
              <PlusIcon />
            </Button>
          </div>

          <ShareButton id={id} initialUrl={shareUrl} />

          {/* Server-rendered: no print dialog, no margin settings to get wrong.
              The print page stays one menu item away for hosts without a
              headless browser, and the route says so if it can't render. */}
          <Button asChild variant="default" size="sm">
            <a href={`/api/resumes/${id}/pdf`}>
              <DownloadIcon /> PDF
            </a>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={pending}
                onSelect={() =>
                  startTransition(async () => {
                    const copyId = await duplicateResumeAction(id);
                    toast.success("Duplicated");
                    router.push(`/resumes/${copyId}`);
                  })
                }
              >
                <CopyIcon /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/print/${id}`} target="_blank" rel="noreferrer">
                  <PrinterIcon /> Open print view
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  if (confirm(`Delete "${meta.name}"? This cannot be undone.`)) {
                    void deleteResumeAction(id);
                  }
                }}
              >
                <Trash2Icon /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Split pane */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto border-r px-4 py-5 md:px-5">
          <div className="space-y-5">
            <TargetCard meta={meta} onChange={setMetaValue} />

            <HeaderCard doc={doc} onChange={(header) => commit({ ...doc, header })} />

            <SortableList
              className="space-y-3"
              ids={doc.sections.map((section) => section.id)}
              onReorder={(from, to) =>
                commit({ ...doc, sections: moveWithin(doc.sections, from, to) })
              }
            >
              {doc.sections.map((section, index) => (
                <SortableRow
                  key={section.id}
                  id={section.id}
                  label={`Reorder ${section.heading || section.kind}`}
                >
                  <SectionCard
                    section={section}
                    index={index}
                    total={doc.sections.length}
                    onChange={(patch) => updateSection(index, patch)}
                    onMove={(direction) => moveSection(index, direction)}
                    onRemove={() => removeSection(index)}
                  />
                </SortableRow>
              ))}
            </SortableList>

            <AddSectionMenu onAdd={addSection} existing={doc.sections.map((s) => s.kind)} />

            <div className="space-y-1.5 pt-2">
              <Label>Private notes</Label>
              <Textarea
                value={meta.notes}
                onChange={(event) => setMetaValue("notes", event.target.value)}
                placeholder="What you tailored and why. Never printed."
                className="min-h-20"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-muted/40 min-h-0 overflow-auto p-6">
          <motion.div
            className="mx-auto origin-top"
            style={{ width: `calc(8.5in * ${zoom})` }}
            animate={{ scale: 1 }}
          >
            <div
              className="relative origin-top-left shadow-2xl"
              style={{ transform: `scale(${zoom})`, width: "8.5in" }}
            >
              <ResumePaper doc={doc} settings={{ ...meta, photo: meta.showPhoto ? photo : "" }} />
              {/* Inside the scaled box on purpose: the lines are positioned in
                  the paper's own pixels, so they scale with it and need no
                  arithmetic against the zoom. */}
              <PageBreaks layout={layout} />
            </div>
          </motion.div>
        </div>
      </div>

      <PageMeasure
        doc={doc}
        settings={{ ...meta, photo: meta.showPhoto ? photo : "" }}
        onLayout={setLayout}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function TargetCard({
  meta,
  onChange,
}: {
  meta: Meta;
  onChange: <K extends keyof Meta>(key: K, value: Meta[K]) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1.5">
        <Label>Target role</Label>
        <Input
          value={meta.targetRole}
          onChange={(event) => onChange("targetRole", event.target.value)}
          placeholder="Staff Engineer"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Target company</Label>
        <Input
          value={meta.targetCompany}
          onChange={(event) => onChange("targetCompany", event.target.value)}
          placeholder="Stripe"
        />
      </div>
    </div>
  );
}

function HeaderCard({
  doc,
  onChange,
}: {
  doc: ResumeDoc;
  onChange: (header: ResumeDoc["header"]) => void;
}) {
  const { header } = doc;
  const set = (patch: Partial<ResumeDoc["header"]>) => onChange({ ...header, ...patch });

  return (
    <Collapsible title="Header" defaultOpen>
      <div className="space-y-2.5">
        <Input
          value={header.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Full name"
        />
        <Input
          value={header.title}
          onChange={(event) => set({ title: event.target.value })}
          placeholder="Headline"
        />
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={header.email}
            onChange={(event) => set({ email: event.target.value })}
            placeholder="Email"
          />
          <Input
            value={header.phone}
            onChange={(event) => set({ phone: event.target.value })}
            placeholder="Phone"
          />
        </div>
        <Input
          value={header.location}
          onChange={(event) => set({ location: event.target.value })}
          placeholder="Location"
        />

        <div className="space-y-2">
          {header.links.map((link, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={link.label}
                onChange={(event) => {
                  const links = [...header.links];
                  links[index] = { ...link, label: event.target.value };
                  set({ links });
                }}
                placeholder="Label"
                className="w-28"
              />
              <Input
                value={link.url}
                onChange={(event) => {
                  const links = [...header.links];
                  links[index] = { ...link, url: event.target.value };
                  set({ links });
                }}
                placeholder="https://…"
              />
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => set({ links: header.links.filter((_, i) => i !== index) })}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => set({ links: [...header.links, { label: "", url: "" }] })}
          >
            <PlusIcon /> Add link
          </Button>
        </div>
      </div>
    </Collapsible>
  );
}

function SectionCard({
  section,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  section: ResumeSection;
  index: number;
  total: number;
  onChange: (patch: Partial<ResumeSection>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <Collapsible
      title={section.heading || section.kind}
      dimmed={!section.visible}
      badge={countLabel(section)}
      controls={
        <>
          <DragHandle className="mr-0.5 size-7" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange({ visible: !section.visible })}
            aria-label="Toggle visibility"
          >
            {section.visible ? <EyeIcon /> : <EyeOffIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move up"
          >
            <ChevronUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move down"
          >
            <ChevronDownIcon />
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={section.heading}
            onChange={(event) => onChange({ heading: event.target.value })}
            placeholder="Section heading"
          />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={onRemove}
            aria-label="Remove section"
          >
            <Trash2Icon />
          </Button>
        </div>

        {section.kind === "summary" && (
          <Textarea
            value={section.text}
            onChange={(event) => onChange({ text: event.target.value })}
            placeholder="Two or three lines that frame you for this specific job."
            className="min-h-24"
          />
        )}

        {section.kind === "experience" && (
          <ItemList
            items={section.experience}
            onAdd={() => onChange({ experience: [...section.experience, blankExperience()] })}
            addLabel="Add job"
            onRemove={(i) =>
              onChange({ experience: section.experience.filter((_, index) => index !== i) })
            }
            onMove={(i, dir) => onChange({ experience: moveWithin(section.experience, i, i + dir) })}
            onReorderTo={(from_, to) => onChange({ experience: moveWithin(section.experience, from_, to) })}
            renderTitle={(item) => item.title || item.company || "New role"}
            render={(item, i) => {
              const set = (patch: Partial<typeof item>) => {
                const experience = [...section.experience];
                experience[i] = { ...item, ...patch };
                onChange({ experience });
              };
              return (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={item.title}
                      onChange={(event) => set({ title: event.target.value })}
                      placeholder="Title"
                    />
                    <Input
                      value={item.company}
                      onChange={(event) => set({ company: event.target.value })}
                      placeholder="Company"
                    />
                    <Input
                      value={item.location}
                      onChange={(event) => set({ location: event.target.value })}
                      placeholder="Location"
                    />
                    <label className="flex items-center gap-2 px-1 text-[13px]">
                      <input
                        type="checkbox"
                        checked={item.isCurrent}
                        onChange={(event) => set({ isCurrent: event.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      Current
                    </label>
                    <Input
                      type="month"
                      value={item.startDate}
                      onChange={(event) => set({ startDate: event.target.value })}
                    />
                    <Input
                      type="month"
                      value={item.endDate}
                      disabled={item.isCurrent}
                      onChange={(event) => set({ endDate: event.target.value })}
                    />
                  </div>
                  <Textarea
                    value={item.summary}
                    onChange={(event) => set({ summary: event.target.value })}
                    placeholder="Optional scope line"
                    className="min-h-14"
                  />
                  <BulletEditor
                    bullets={item.bullets}
                    onChange={(bullets) => set({ bullets })}
                  />
                </div>
              );
            }}
          />
        )}

        {section.kind === "education" && (
          <ItemList
            items={section.education}
            onAdd={() => onChange({ education: [...section.education, blankEducation()] })}
            addLabel="Add school"
            onRemove={(i) =>
              onChange({ education: section.education.filter((_, index) => index !== i) })
            }
            onMove={(i, dir) => onChange({ education: moveWithin(section.education, i, i + dir) })}
            onReorderTo={(from_, to) => onChange({ education: moveWithin(section.education, from_, to) })}
            renderTitle={(item) => item.school || "New entry"}
            render={(item, i) => {
              const set = (patch: Partial<typeof item>) => {
                const education = [...section.education];
                education[i] = { ...item, ...patch };
                onChange({ education });
              };
              return (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={item.school}
                    onChange={(event) => set({ school: event.target.value })}
                    placeholder="School"
                    className="col-span-2"
                  />
                  <Input
                    value={item.degree}
                    onChange={(event) => set({ degree: event.target.value })}
                    placeholder="Degree"
                  />
                  <Input
                    value={item.field}
                    onChange={(event) => set({ field: event.target.value })}
                    placeholder="Field"
                  />
                  <Input
                    type="month"
                    value={item.startDate}
                    onChange={(event) => set({ startDate: event.target.value })}
                  />
                  <Input
                    type="month"
                    value={item.endDate}
                    onChange={(event) => set({ endDate: event.target.value })}
                  />
                  <div className="col-span-2">
                    <BulletEditor
                      bullets={item.details}
                      onChange={(details) => set({ details })}
                      placeholder="Honours, coursework…"
                    />
                  </div>
                </div>
              );
            }}
          />
        )}

        {section.kind === "projects" && (
          <ItemList
            items={section.projects}
            onAdd={() => onChange({ projects: [...section.projects, blankProject()] })}
            addLabel="Add project"
            onRemove={(i) =>
              onChange({ projects: section.projects.filter((_, index) => index !== i) })
            }
            onMove={(i, dir) => onChange({ projects: moveWithin(section.projects, i, i + dir) })}
            onReorderTo={(from_, to) => onChange({ projects: moveWithin(section.projects, from_, to) })}
            renderTitle={(item) => item.name || "New project"}
            render={(item, i) => {
              const set = (patch: Partial<typeof item>) => {
                const projects = [...section.projects];
                projects[i] = { ...item, ...patch };
                onChange({ projects });
              };
              return (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={item.name}
                      onChange={(event) => set({ name: event.target.value })}
                      placeholder="Name"
                    />
                    <Input
                      value={item.role}
                      onChange={(event) => set({ role: event.target.value })}
                      placeholder="Your role"
                    />
                  </div>
                  <Input
                    value={item.url}
                    onChange={(event) => set({ url: event.target.value })}
                    placeholder="https://…"
                  />
                  <Textarea
                    value={item.description}
                    onChange={(event) => set({ description: event.target.value })}
                    placeholder="One line on what it is"
                    className="min-h-14"
                  />
                  <BulletEditor bullets={item.bullets} onChange={(bullets) => set({ bullets })} />
                </div>
              );
            }}
          />
        )}

        {section.kind === "skills" && (
          <div className="space-y-2">
            {section.skills.map((group, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={group.name}
                  onChange={(event) => {
                    const skills = [...section.skills];
                    skills[i] = { ...group, name: event.target.value };
                    onChange({ skills });
                  }}
                  placeholder="Group"
                  className="w-32 shrink-0"
                />
                <Input
                  value={group.skills.join(", ")}
                  onChange={(event) => {
                    const skills = [...section.skills];
                    skills[i] = {
                      ...group,
                      skills: event.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    };
                    onChange({ skills });
                  }}
                  placeholder="Python, Go, Rust"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onChange({ skills: section.skills.filter((_, index) => index !== i) })}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onChange({ skills: [...section.skills, { name: "", skills: [] }] })}
            >
              <PlusIcon /> Add group
            </Button>
          </div>
        )}

        {section.kind === "certifications" && (
          <div className="space-y-2">
            {section.certifications.map((cert, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={cert.name}
                  onChange={(event) => {
                    const certifications = [...section.certifications];
                    certifications[i] = { ...cert, name: event.target.value };
                    onChange({ certifications });
                  }}
                  placeholder="Name"
                />
                <Input
                  value={cert.issuer}
                  onChange={(event) => {
                    const certifications = [...section.certifications];
                    certifications[i] = { ...cert, issuer: event.target.value };
                    onChange({ certifications });
                  }}
                  placeholder="Issuer"
                  className="w-28"
                />
                <Input
                  value={cert.date}
                  onChange={(event) => {
                    const certifications = [...section.certifications];
                    certifications[i] = { ...cert, date: event.target.value };
                    onChange({ certifications });
                  }}
                  placeholder="2024"
                  className="w-20"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() =>
                    onChange({
                      certifications: section.certifications.filter((_, index) => index !== i),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  certifications: [...section.certifications, { name: "", issuer: "", date: "" }],
                })
              }
            >
              <PlusIcon /> Add certification
            </Button>
          </div>
        )}

        {section.kind === "custom" && (
          <ItemList
            items={section.items}
            onAdd={() =>
              onChange({
                items: [...section.items, { title: "", subtitle: "", meta: "", bullets: [""] }],
              })
            }
            addLabel="Add item"
            onRemove={(i) => onChange({ items: section.items.filter((_, index) => index !== i) })}
            onMove={(i, dir) => onChange({ items: moveWithin(section.items, i, i + dir) })}
            onReorderTo={(from_, to) => onChange({ items: moveWithin(section.items, from_, to) })}
            renderTitle={(item) => item.title || "New item"}
            render={(item, i) => {
              const set = (patch: Partial<typeof item>) => {
                const items = [...section.items];
                items[i] = { ...item, ...patch };
                onChange({ items });
              };
              return (
                <div className="space-y-2">
                  <Input
                    value={item.title}
                    onChange={(event) => set({ title: event.target.value })}
                    placeholder="Title"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={item.subtitle}
                      onChange={(event) => set({ subtitle: event.target.value })}
                      placeholder="Subtitle"
                    />
                    <Input
                      value={item.meta}
                      onChange={(event) => set({ meta: event.target.value })}
                      placeholder="Date / meta"
                    />
                  </div>
                  <BulletEditor bullets={item.bullets} onChange={(bullets) => set({ bullets })} />
                </div>
              );
            }}
          />
        )}
      </div>
    </Collapsible>
  );
}

function BulletEditor({
  bullets,
  onChange,
  placeholder = "Strong verb, specific scope, measurable outcome",
}: {
  bullets: string[];
  onChange: (bullets: string[]) => void;
  placeholder?: string;
}) {
  return (
    <SortableList
      className="space-y-1.5"
      ids={bullets.map((_, index) => `bullet-${index}`)}
      onReorder={(from, to) => onChange(moveWithin(bullets, from, to))}
    >
      {bullets.map((bullet, index) => (
        <SortableRow
          key={index}
          id={`bullet-${index}`}
          label={`Reorder bullet ${index + 1}`}
          className="flex items-start gap-1.5"
        >
          <DragHandle className="mt-1.5 size-6" />
          <Textarea
            value={bullet}
            onChange={(event) => {
              const next = [...bullets];
              next[index] = event.target.value;
              onChange(next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const next = [...bullets];
                next.splice(index + 1, 0, "");
                onChange(next);
              }
              if (event.key === "Backspace" && bullet === "" && bullets.length > 1) {
                event.preventDefault();
                onChange(bullets.filter((_, i) => i !== index));
              }
            }}
            placeholder={placeholder}
            className="min-h-0 py-1.5 text-[13px]"
            rows={1}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive mt-0.5 shrink-0"
            onClick={() => onChange(bullets.filter((_, i) => i !== index))}
            aria-label="Remove bullet"
          >
            <Trash2Icon />
          </Button>
        </SortableRow>
      ))}
      <Button variant="ghost" size="xs" onClick={() => onChange([...bullets, ""])}>
        <PlusIcon /> Bullet
      </Button>
    </SortableList>
  );
}

function ItemList<T>({
  items,
  render,
  renderTitle,
  onAdd,
  onRemove,
  onMove,
  onReorderTo,
  addLabel,
}: {
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
  renderTitle: (item: T) => string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  /** A drag landed: this entry moved to that position. */
  onReorderTo: (from: number, to: number) => void;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      <SortableList
        className="space-y-2"
        ids={items.map((_, index) => `row-${index}`)}
        onReorder={onReorderTo}
      >
      {items.map((item, index) => (
        <SortableRow key={index} id={`row-${index}`} label={`Reorder ${renderTitle(item)}`}>
        <Collapsible
          title={renderTitle(item)}
          nested
          controls={
            <>
              <DragHandle className="mr-0.5 size-7" />
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={index === 0}
                onClick={() => onMove(index, -1)}
                aria-label="Move up"
              >
                <ChevronUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={index === items.length - 1}
                onClick={() => onMove(index, 1)}
                aria-label="Move down"
              >
                <ChevronDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(index)}
                aria-label="Remove"
              >
                <Trash2Icon />
              </Button>
            </>
          }
        >
          {render(item, index)}
        </Collapsible>
        </SortableRow>
      ))}
      </SortableList>
      <Button variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon /> {addLabel}
      </Button>
    </div>
  );
}

function Collapsible({
  title,
  children,
  controls,
  badge,
  defaultOpen = false,
  nested = false,
  dimmed = false,
}: {
  title: string;
  children: React.ReactNode;
  controls?: React.ReactNode;
  badge?: string;
  defaultOpen?: boolean;
  nested?: boolean;
  dimmed?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        nested ? "bg-background/40" : "bg-card",
        dimmed && "opacity-55",
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-left"
        >
          <ChevronDownIcon
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="truncate text-[13px] font-medium capitalize">{title}</span>
          {badge && (
            <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">{badge}</span>
          )}
        </button>
        <div className="flex shrink-0 items-center">{controls}</div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pt-1 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AddSectionMenu({
  onAdd,
  existing,
}: {
  onAdd: (kind: SectionKind) => void;
  existing: SectionKind[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <PlusIcon /> Add section
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {SECTION_KINDS.map((kind) => (
          <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)} className="capitalize">
            {kind}
            {existing.includes(kind) && kind !== "custom" && (
              <span className="text-muted-foreground ml-auto text-[11px]">added</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DesignPopover({
  meta,
  onChange,
  hasPhoto,
}: {
  meta: Meta;
  onChange: <K extends keyof Meta>(key: K, value: Meta[K]) => void;
  hasPhoto: boolean;
}) {
  // Harvard is a format, not a style: it does not take a photo, so the switch
  // says so rather than doing nothing when flipped.
  const templateTakesPhoto = meta.template !== "harvard";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Design">
          <PaletteIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-1.5">
          <Label>Template</Label>
          <Select value={meta.template} onValueChange={(value) => onChange("template", value)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="harvard">Harvard</SelectItem>
              <SelectItem value="classic">Classic</SelectItem>
              <SelectItem value="modern">Modern</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
              <SelectItem value="editorial">Editorial</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Font</Label>
          <Select value={meta.fontFamily} onValueChange={(value) => onChange("fontFamily", value)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inter">Sans</SelectItem>
              <SelectItem value="serif">Serif</SelectItem>
              <SelectItem value="mono">Mono</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Photo</Label>
          <button
            type="button"
            role="switch"
            aria-checked={meta.showPhoto && templateTakesPhoto}
            disabled={!templateTakesPhoto || !hasPhoto}
            onClick={() => onChange("showPhoto", !meta.showPhoto)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-control border px-2.5 py-2 text-left text-[13px] transition-colors",
              meta.showPhoto && templateTakesPhoto && hasPhoto
                ? "border-primary/50 bg-accent"
                : "hover:bg-accent/60",
              (!templateTakesPhoto || !hasPhoto) && "cursor-not-allowed opacity-60 hover:bg-transparent",
            )}
          >
            <span className="flex items-center gap-2">
              <UserRoundIcon className="size-3.5 shrink-0" />
              {meta.showPhoto && templateTakesPhoto && hasPhoto ? "Showing" : "Hidden"}
            </span>
            <span
              className={cn(
                "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
                meta.showPhoto && templateTakesPhoto && hasPhoto ? "bg-primary" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "size-3 rounded-full bg-white transition-transform",
                  meta.showPhoto && templateTakesPhoto && hasPhoto && "translate-x-3",
                )}
              />
            </span>
          </button>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {!hasPhoto ? (
              <>
                Add one in{" "}
                <Link href="/settings?tab=account" className="underline underline-offset-2">
                  Settings
                </Link>{" "}
                and every resume can use it.
              </>
            ) : !templateTakesPhoto ? (
              "Harvard format doesn't take a photo. Switch template to use yours."
            ) : (
              "Your profile photo. Replace it once and every resume follows."
            )}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Accent</Label>
          <div className="flex gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                onClick={() => onChange("accent", accent)}
                aria-label={`Accent ${accent}`}
                className={cn(
                  "size-6 rounded-full transition-transform hover:scale-110",
                  meta.accent === accent &&
                    "ring-foreground/40 ring-2 ring-offset-2 ring-offset-popover",
                )}
                style={{ background: accent }}
              />
            ))}
          </div>
        </div>

        <Separator />

        <Slider
          label="Text size"
          value={meta.fontSize}
          min={8}
          max={13}
          step={0.5}
          suffix="pt"
          onChange={(value) => onChange("fontSize", value)}
        />
        <Slider
          label="Line height"
          value={meta.lineHeight}
          min={1.1}
          max={1.7}
          step={0.05}
          onChange={(value) => onChange("lineHeight", value)}
        />
        <Slider
          label="Margins"
          value={meta.pageMargin}
          min={24}
          max={80}
          step={2}
          suffix="px"
          onChange={(value) => onChange("pageMargin", value)}
        />
      </PopoverContent>
    </Popover>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-muted-foreground text-xs tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-[var(--primary)] w-full"
      />
    </div>
  );
}

function countLabel(section: ResumeSection) {
  switch (section.kind) {
    case "experience":
      return `${section.experience.length}`;
    case "education":
      return `${section.education.length}`;
    case "projects":
      return `${section.projects.length}`;
    case "skills":
      return `${section.skills.length}`;
    case "certifications":
      return `${section.certifications.length}`;
    case "custom":
      return `${section.items.length}`;
    default:
      return undefined;
  }
}
