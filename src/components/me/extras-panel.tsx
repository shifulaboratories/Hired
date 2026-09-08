"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AwardIcon, FolderGitIcon, GraduationCapIcon, PlusIcon, Trash2Icon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import {
  createCertificationAction,
  createEducationAction,
  createProjectAction,
  createSkillGroupAction,
  deleteCertificationAction,
  deleteEducationAction,
  deleteProjectAction,
  deleteSkillGroupAction,
  updateEducationAction,
  updateProjectAction,
  updateSkillGroupAction,
} from "@/server/actions";

type Education = {
  id: string;
  school: string;
  degree: string;
  field: string;
  location: string;
  startDate: string;
  endDate: string;
  gpa: string;
  details: string;
};
type Project = { id: string; name: string; role: string; url: string; description: string; tags: string[] };
type SkillGroup = { id: string; name: string; skills: string[] };
type Certification = { id: string; name: string; issuer: string; date: string; url: string };

export function ExtrasPanel({
  education,
  projects,
  skills,
  certifications,
}: {
  education: Education[];
  projects: Project[];
  skills: SkillGroup[];
  certifications: Certification[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SkillsCard skills={skills} />
      <EducationCard education={education} />
      <ProjectsCard projects={projects} />
      <CertificationsCard certifications={certifications} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SkillsCard({ skills }: { skills: SkillGroup[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <WrenchIcon className="text-muted-foreground size-4" /> Skills
        </CardTitle>
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await createSkillGroupAction({ name: "New group", skills: [] });
              toast.success("Group added");
            })
          }
        >
          <PlusIcon /> Group
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {skills.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Group your skills, e.g. &ldquo;Languages&rdquo;, &ldquo;Infrastructure&rdquo;.
          </p>
        )}
        <AnimatePresence initial={false}>
          {skills
            .filter((group) => !removed.has(group.id))
            .map((group) => (
              <SkillGroupRow
                key={group.id}
                group={group}
                onRemoved={() => setRemoved((prev) => new Set(prev).add(group.id))}
              />
            ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function SkillGroupRow({ group, onRemoved }: { group: SkillGroup; onRemoved: () => void }) {
  const [values, setValues] = useState({ name: group.name, skills: group.skills.join(", ") });
  const { state, push } = useAutosave<{ name: string; skills: string }>((next) =>
    updateSkillGroupAction(group.id, {
      name: next.name,
      skills: next.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    }),
  );

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  return (
    <motion.div layout exit={{ opacity: 0, height: 0 }} className="group space-y-1.5">
      <div className="flex items-center gap-1">
        <Input
          value={values.name}
          onChange={(event) => set({ name: event.target.value })}
          className="h-9 border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0 md:h-7 md:text-[13px]"
        />
        <SaveIndicator state={state} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => {
            onRemoved();
            void deleteSkillGroupAction(group.id);
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      <Input
        value={values.skills}
        onChange={(event) => set({ skills: event.target.value })}
        placeholder="Python, Go, Rust, TypeScript"
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function EducationCard({ education }: { education: Education[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <GraduationCapIcon className="text-muted-foreground size-4" /> Education
        </CardTitle>
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await createEducationAction({ school: "New school" });
              toast.success("Entry added");
            })
          }
        >
          <PlusIcon /> Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {education.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Where you studied, what in, and when. Resumes draw on this after the roles.
          </p>
        )}
        <AnimatePresence initial={false}>
          {education
            .filter((item) => !removed.has(item.id))
            .map((item) => (
              <EducationRow
                key={item.id}
                item={item}
                onRemoved={() => setRemoved((prev) => new Set(prev).add(item.id))}
              />
            ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function EducationRow({ item, onRemoved }: { item: Education; onRemoved: () => void }) {
  const [values, setValues] = useState({
    school: item.school,
    degree: item.degree,
    field: item.field,
    startDate: item.startDate,
    endDate: item.endDate,
    details: item.details,
  });
  const { state, push } = useAutosave<typeof values>((next) => updateEducationAction(item.id, next));

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  return (
    <motion.div layout exit={{ opacity: 0, height: 0 }} className="group space-y-2">
      <div className="flex items-center gap-1">
        <Input
          value={values.school}
          onChange={(event) => set({ school: event.target.value })}
          className="h-9 border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0 md:h-7 md:text-[13px]"
        />
        <SaveIndicator state={state} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => {
            onRemoved();
            void deleteEducationAction(item.id);
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={values.degree}
          onChange={(event) => set({ degree: event.target.value })}
          placeholder="B.S."
        />
        <Input
          value={values.field}
          onChange={(event) => set({ field: event.target.value })}
          placeholder="Computer Science"
        />
        <Input
          type="month"
          value={values.startDate}
          onChange={(event) => set({ startDate: event.target.value })}
        />
        <Input
          type="month"
          value={values.endDate}
          onChange={(event) => set({ endDate: event.target.value })}
        />
      </div>
      <Input
        value={values.details}
        onChange={(event) => set({ details: event.target.value })}
        placeholder="Honours, coursework, activities"
      />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function ProjectsCard({ projects }: { projects: Project[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <FolderGitIcon className="text-muted-foreground size-4" /> Projects
        </CardTitle>
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await createProjectAction({ name: "New project" });
              toast.success("Project added");
            })
          }
        >
          <PlusIcon /> Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {projects.length === 0 && (
          <p className="text-muted-foreground py-4 text-center text-sm">
            Side projects, open source, things you shipped outside a job.
          </p>
        )}
        <AnimatePresence initial={false}>
          {projects
            .filter((item) => !removed.has(item.id))
            .map((item) => (
              <ProjectRow
                key={item.id}
                item={item}
                onRemoved={() => setRemoved((prev) => new Set(prev).add(item.id))}
              />
            ))}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function ProjectRow({ item, onRemoved }: { item: Project; onRemoved: () => void }) {
  const [values, setValues] = useState({
    name: item.name,
    role: item.role,
    url: item.url,
    description: item.description,
  });
  const { state, push } = useAutosave<typeof values>((next) => updateProjectAction(item.id, next));

  const set = (patch: Partial<typeof values>) => {
    const next = { ...values, ...patch };
    setValues(next);
    push(next);
  };

  return (
    <motion.div layout exit={{ opacity: 0, height: 0 }} className="group space-y-2">
      <div className="flex items-center gap-1">
        <Input
          value={values.name}
          onChange={(event) => set({ name: event.target.value })}
          className="h-9 border-0 bg-transparent px-0 text-base font-semibold shadow-none focus-visible:ring-0 md:h-7 md:text-[13px]"
        />
        <SaveIndicator state={state} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => {
            onRemoved();
            void deleteProjectAction(item.id);
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          value={values.role}
          onChange={(event) => set({ role: event.target.value })}
          placeholder="Creator"
        />
        <Input
          value={values.url}
          onChange={(event) => set({ url: event.target.value })}
          placeholder="github.com/…"
        />
      </div>
      <Textarea
        value={values.description}
        onChange={(event) => set({ description: event.target.value })}
        placeholder="What it is and why it mattered"
        className="min-h-16"
      />
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function CertificationsCard({ certifications }: { certifications: Certification[] }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ name: "", issuer: "", date: "" });

  const add = () => {
    if (!form.name.trim()) return;
    startTransition(async () => {
      await createCertificationAction(form);
      setForm({ name: "", issuer: "", date: "" });
      toast.success("Certification added");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <AwardIcon className="text-muted-foreground size-4" /> Certifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <AnimatePresence initial={false}>
          {certifications
            .filter((item) => !removed.has(item.id))
            .map((item) => (
              <motion.div
                key={item.id}
                layout
                exit={{ opacity: 0, height: 0 }}
                className="group flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{item.name}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {[item.issuer, item.date].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => {
                    setRemoved((prev) => new Set(prev).add(item.id));
                    void deleteCertificationAction(item.id);
                  }}
                >
                  <Trash2Icon />
                </Button>
              </motion.div>
            ))}
        </AnimatePresence>

        <div className="space-y-2 border-t pt-4">
          <Label>Add one</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="AWS Solutions Architect"
            />
            <Input
              value={form.issuer}
              onChange={(event) => setForm({ ...form, issuer: event.target.value })}
              placeholder="Amazon"
            />
            <Input
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
              onKeyDown={(event) => event.key === "Enter" && add()}
              placeholder="2024"
            />
          </div>
          <Button variant="outline" size="sm" onClick={add} disabled={pending || !form.name.trim()}>
            <PlusIcon /> Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
