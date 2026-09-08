import Link from "next/link";
import { CircleUserRoundIcon, FileTextIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FadeIn } from "@/components/motion";
import {
  getProfile,
  listCertifications,
  listEducation,
  listNotes,
  listProjects,
  listRoles,
  listSkillGroups,
} from "@/lib/data/me";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { RolesPanel } from "@/components/me/roles-panel";
import { ProfileForm } from "@/components/me/profile-form";
import { NotesPanel } from "@/components/me/notes-panel";
import { ExtrasPanel } from "@/components/me/extras-panel";
import { ImportDialog } from "@/components/me/import-dialog";
import { NewRoleDialog } from "@/components/me/new-role-dialog";
import { NewResumeDialog } from "@/components/resume/new-resume-dialog";
import { ResumesPanel } from "@/components/resume/resumes-panel";

export const dynamic = "force-dynamic";

/**
 * Me: the record of a career, and the documents built out of it.
 *
 * The tabs are addresses rather than client state, which is what lets the
 * resume grid live here at all — it carries its own ?q= and ?sort=, and a
 * search box writing those to a URL that did not also name the tab would
 * bounce you back to Roles on every keystroke. `?tab=` matches the Settings
 * page, and it means each panel loads only its own data: the resume grid is
 * a join plus a rendered document per card, and nobody editing a role should
 * pay for that.
 */
const TABS = ["roles", "profile", "notes", "extras", "resumes"] as const;
type Tab = (typeof TABS)[number];

const HEADER: Record<Tab, string> = {
  roles: "Everything you know about your own career. Dump it here raw and unfiltered — length is a feature. Claude reads all of it when it writes.",
  profile: "Your name, how to reach you, and the long-form account of what you want next. This is the header of every resume you build.",
  notes: "Anything that belongs to no single job — and the standing rules Claude follows whenever it writes for you.",
  extras: "Education, projects, skills and certifications: the supporting material a resume draws on after the roles.",
  resumes: "One base resume, then a tailored variant per job. Ask Claude to build them from what is in Me — it will save them straight here.",
};

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const tab = one("tab");
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : "roles";

  // The counts sit on the tab strip, so they are needed whichever panel is
  // showing. Counts rather than lists: the panel below loads what it renders.
  const [roleCount, noteCount, resumeCount] = await Promise.all([
    db.role.count({ where: { userId: user.id } }),
    db.note.count({ where: { userId: user.id } }),
    db.resume.count({ where: { userId: user.id } }),
  ]);

  const sortParam = one("sort");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Me"
        title="Everything about you"
        description={HEADER[active]}
        // Import stays on every tab: pasting a resume is how a new account
        // fills in Me, and the Resumes tab is exactly where someone arrives
        // wanting one. The second button follows the tab.
        actions={
          <>
            <ImportDialog hasResumes={resumeCount > 0} />
            {active === "resumes" ? (
              <NewResumeDialog hasMaterial={roleCount > 0} />
            ) : (
              <NewRoleDialog />
            )}
          </>
        }
      />

      {/* Controlled by the URL: every trigger is a link, so the browser's own
          history is the tab state and a panel can be linked to directly. */}
      <Tabs value={active}>
        <TabsList className="mb-6">
          <TabsTrigger value="roles" asChild>
            <Link href="/me">
              <CircleUserRoundIcon /> Roles
              <span className="text-muted-foreground ml-1 text-xs tabular-nums">{roleCount}</span>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="profile" asChild>
            <Link href="/me?tab=profile">Profile</Link>
          </TabsTrigger>
          <TabsTrigger value="notes" asChild>
            <Link href="/me?tab=notes">
              Notes
              <span className="text-muted-foreground ml-1 text-xs tabular-nums">{noteCount}</span>
            </Link>
          </TabsTrigger>
          <TabsTrigger value="extras" asChild>
            <Link href="/me?tab=extras">Education &amp; more</Link>
          </TabsTrigger>
          <TabsTrigger value="resumes" asChild>
            <Link href="/me?tab=resumes">
              <FileTextIcon /> Resumes
              <span className="text-muted-foreground ml-1 text-xs tabular-nums">{resumeCount}</span>
            </Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={active}>
          {active === "roles" && <RolesPanelTab userId={user.id} />}
          {active === "profile" && <ProfileTab userId={user.id} />}
          {active === "notes" && <NotesTab userId={user.id} />}
          {active === "extras" && <ExtrasTab userId={user.id} />}
          {active === "resumes" && (
            <ResumesPanel
              userId={user.id}
              search={one("q")?.trim() ?? ""}
              sort={sortParam === "name" || sortParam === "used" ? sortParam : "recent"}
              hasMaterial={roleCount > 0}
            />
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

async function RolesPanelTab({ userId }: { userId: string }) {
  const roles = await listRoles(userId);
  return (
    <RolesPanel
      roles={roles.map((role) => ({
        id: role.id,
        company: role.company,
        title: role.title,
        location: role.location,
        startDate: role.startDate,
        endDate: role.endDate,
        isCurrent: role.isCurrent,
        summary: role.summary,
        tags: role.tags,
        backgroundLength: role.background.length,
        highlightCount: role._count.highlights,
      }))}
    />
  );
}

async function ProfileTab({ userId }: { userId: string }) {
  const profile = await getProfile(userId);
  return (
    <FadeIn>
      <ProfileForm profile={profile} />
    </FadeIn>
  );
}

async function NotesTab({ userId }: { userId: string }) {
  const notes = await listNotes(userId);
  return (
    <FadeIn>
      <NotesPanel
        notes={notes.map((note) => ({
          id: note.id,
          title: note.title,
          body: note.body,
          tags: note.tags,
          pinned: note.pinned,
          kind: note.kind,
        }))}
      />
    </FadeIn>
  );
}

async function ExtrasTab({ userId }: { userId: string }) {
  const [education, projects, skills, certifications] = await Promise.all([
    listEducation(userId),
    listProjects(userId),
    listSkillGroups(userId),
    listCertifications(userId),
  ]);
  return (
    <FadeIn>
      <ExtrasPanel
        education={education}
        projects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          url: p.url,
          description: p.description,
          tags: p.tags,
        }))}
        skills={skills}
        certifications={certifications}
      />
    </FadeIn>
  );
}
