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
  listOpenQuestions,
  listProjects,
  listRoles,
  listSkillGroups,
} from "@/lib/data/me";
import { figureConflicts, unbackedSkills } from "@/lib/data/me-checks";
import { careerTimeline } from "@/lib/timeline";
import { CareerTimeline } from "@/components/me/career-timeline";
import { db } from "@/lib/db";
import { backgroundExcerpt, writingGuidance } from "@/lib/background";
import { standingRulesFit } from "@/lib/mcp/briefing-head";
import { requireUser } from "@/lib/auth";
import { RolesPanel } from "@/components/me/roles-panel";
import { ProfileForm } from "@/components/me/profile-form";
import { NotesPanel } from "@/components/me/notes-panel";
import { ExtrasPanel } from "@/components/me/extras-panel";
import { KeywordPolicyPanel } from "@/components/me/keyword-policy-panel";
import { listTransferables } from "@/lib/data/transferables";
import { readPolicy } from "@/lib/keyword-policy";
import { ImportDialog } from "@/components/me/import-dialog";
import { NewRoleDialog } from "@/components/me/new-role-dialog";
import { NewResumeDialog } from "@/components/resume/new-resume-dialog";
import { ResumesPanel } from "@/components/resume/resumes-panel";
import { LettersPanel } from "@/components/letters/letters-panel";
import { letterForUi, listLetters } from "@/lib/data/letters";

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
const TABS = ["roles", "profile", "notes", "extras", "resumes", "letters"] as const;
type Tab = (typeof TABS)[number];

const HEADER: Record<Tab, string> = {
  roles: "Everything you know about your own career. Dump it here raw and unfiltered — length is a feature. Claude reads all of it when it writes.",
  profile: "Your name, how to reach you, and the long-form account of what you want next. This is the header of every resume you build.",
  notes: "Anything that belongs to no single job — and the standing rules Claude follows whenever it writes for you.",
  extras: "Education, projects, skills and certifications: the supporting material a resume draws on after the roles.",
  resumes: "One base resume, then a tailored variant per job. Ask Claude to build them from what is in Me — it will save them straight here.",
  letters: "Cover letters, cold messages, referral asks and thank-yous. Ask Claude for one and it reads the posting, your own material and the letters you have already written before it drafts anything.",
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
  const [roleCount, noteCount, resumeCount, letterCount] = await Promise.all([
    db.role.count({ where: { userId: user.id } }),
    db.note.count({ where: { userId: user.id } }),
    db.resume.count({ where: { userId: user.id } }),
    db.letter.count({ where: { userId: user.id } }),
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
          <TabsTrigger value="letters" asChild>
            <Link href="/me?tab=letters">
              Letters
              <span className="text-muted-foreground ml-1 text-xs tabular-nums">{letterCount}</span>
            </Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={active}>
          {active === "roles" && <RolesPanelTab userId={user.id} />}
          {active === "profile" && <ProfileTab userId={user.id} />}
          {active === "notes" && <NotesTab user={user} />}
          {active === "extras" && <ExtrasTab userId={user.id} />}
          {active === "resumes" && (
            <ResumesPanel
              userId={user.id}
              search={one("q")?.trim() ?? ""}
              sort={sortParam === "name" || sortParam === "used" ? sortParam : "recent"}
              hasMaterial={roleCount > 0}
            />
          )}
          {active === "letters" && <LettersTab userId={user.id} />}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

async function LettersTab({ userId }: { userId: string }) {
  const rows = await listLetters(userId);
  return (
    <LettersPanel
      letters={rows.map(letterForUi)}
      emptyHint="Nothing written yet."
    />
  );
}

async function RolesPanelTab({ userId }: { userId: string }) {
  const [roles, openQuestions, conflicts, profile] = await Promise.all([
    listRoles(userId),
    listOpenQuestions(userId),
    figureConflicts(userId, 10),
    db.profile.findUnique({ where: { userId }, select: { roleOrder: true } }),
  ]);
  const now = new Date();
  const laid = careerTimeline(roles, now);
  const unconfirmed = new Set(
    roles.filter((role) => role.startUnconfirmed || role.endUnconfirmed).map((role) => role.id),
  );
  return (
    <RolesPanel
      order={profile?.roleOrder === "manual" ? "manual" : "date"}
      openQuestions={openQuestions}
      conflicts={conflicts}
      timeline={
        laid.span && (
          <CareerTimeline
            range={laid.span}
            gaps={laid.gaps}
            rows={laid.roles.map((role) => ({
              id: role.id,
              title: role.title,
              company: role.company,
              group: role.group,
              start: role.start,
              end: role.end,
              isCurrent: role.isCurrent,
              unconfirmed: unconfirmed.has(role.id),
            }))}
          />
        )
      }
      roles={roles.map((role) => {
        const guidance = writingGuidance(role.background);
        return {
          id: role.id,
          company: role.company,
          title: role.title,
          location: role.location,
          employmentType: role.employmentType,
          startDate: role.startDate,
          endDate: role.endDate,
          isCurrent: role.isCurrent,
          summary: role.summary,
          tags: role.tags,
          backgroundLength: role.background.length,
          highlightCount: role._count.highlights,
          excerpt: role.summary ? "" : backgroundExcerpt(role.background, 160),
          rules: guidance.rules.length,
          caveats: guidance.caveats.length,
          open: openQuestions.filter((item) => item.roleId === role.id).length,
          daysSinceAdded: Math.floor((now.getTime() - role.backgroundUpdatedAt.getTime()) / 86_400_000),
        };
      })}
    />
  );
}

async function ProfileTab({ userId }: { userId: string }) {
  const [profile, transferables] = await Promise.all([
    getProfile(userId),
    listTransferables(userId),
  ]);
  return (
    <FadeIn>
      <div className="space-y-6">
        <ProfileForm profile={profile} />
        {/* On the profile tab rather than a screen of its own: it is a standing
            decision about how you are described, which is what this tab is. */}
        <KeywordPolicyPanel
          policy={readPolicy(profile.keywordPolicy)}
          transferables={transferables.map((row) => ({
            id: row.id,
            have: row.have,
            covers: row.covers,
            note: row.note,
          }))}
        />
      </div>
    </FadeIn>
  );
}

async function NotesTab({ user }: { user: Awaited<ReturnType<typeof requireUser>> }) {
  const [notes, fit, roles] = await Promise.all([
    listNotes(user.id),
    standingRulesFit(user.id, user),
    listRoles(user.id),
  ]);
  const inBriefing = new Set(fit.rules.filter((rule) => rule.inBriefing).map((rule) => rule.id));
  return (
    <FadeIn>
      <NotesPanel
        briefing={{ budget: fit.budget, used: fit.used }}
        roles={roles.map((role) => ({ id: role.id, label: `${role.title} · ${role.company}` }))}
        notes={notes.map((note) => ({
          inBriefing: inBriefing.has(note.id),
          roleId: note.roleId,
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
  const [education, projects, skills, certifications, evidence] = await Promise.all([
    listEducation(userId),
    listProjects(userId),
    listSkillGroups(userId),
    listCertifications(userId),
    unbackedSkills(userId),
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
        unbacked={evidence.unbacked.map((row) => row.skill)}
      />
    </FadeIn>
  );
}
