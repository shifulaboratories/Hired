import Link from "next/link";
import {
  CalendarClockIcon,
  ChartNoAxesColumnIcon,
  ListChecksIcon,
  SparklesIcon,
} from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FadeIn } from "@/components/motion";
import { FollowUpList } from "@/components/dashboard/follow-up-list";
import { SetupStrip } from "@/components/dashboard/setup-strip";
import { QuickLog } from "@/components/dashboard/quick-log";
import { TaskPanel } from "@/components/tasks/task-panel";
import { PingScheduler } from "@/components/tasks/ping-scheduler";
import type { SubjectOption } from "@/components/tasks/subject-picker";
import { AnalyticsPanel } from "@/components/analytics/analytics-panel";
import { requireUser } from "@/lib/auth";
import { setupStatus } from "@/lib/data/onboarding";
import {
  contactFollowUpsDue,
  followUpsDue,
  listApplications,
  listCompanies,
  listContacts,
  listTasks,
} from "@/lib/data/pipeline";
import { listResumeNames } from "@/lib/data/resumes";
import { getProfile, listNotes, listRoles } from "@/lib/data/me";
import { taskSubjectOf } from "@/lib/task-subject";
import { relativeDay } from "@/lib/utils";
import { civilDay, clockIn } from "@/lib/time";
import { timeZoneOf } from "@/lib/data/me";
import type { Stage } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The front door: what you owe, and — one tab over — how it is going.
 *
 * Two tabs rather than two screens, because they are the same question at two
 * altitudes and a rail entry for the second one made it a place you had to
 * decide to visit. The numbers were the front door once and that was worse
 * still: you open this app to do the next thing, not to read your own
 * statistics.
 *
 * `?tab=` is an address, matching Me and Settings, so a tab can be linked to
 * and the browser's Back button walks them. It also means each tab loads only
 * its own data — the list is nine reads and the funnel is five, and nobody
 * should pay for both to look at one.
 */
const TABS = ["today", "analytics"] as const;
type Tab = (typeof TABS)[number];

/** Morning, afternoon or evening, on the server's clock. */
function greeting(timeZone: string) {
  // Their morning, not the server's. On a UTC host this used to wish somebody
  // in Los Angeles good evening over lunch.
  const { hour } = clockIn(new Date(), timeZone);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const asked = params.tab;
  const tab = Array.isArray(asked) ? asked[0] : asked;
  const active: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : "today";

  // Only what this tab needs. Analytics reads none of it, and reading it
  // anyway is how a tab strip quietly costs as much as both tabs.
  const today =
    active === "today"
      ? await Promise.all([getProfile(user.id), setupStatus(user.id)])
      : null;
  const firstName = today ? (today[0].fullName.trim().split(/\s+/)[0] ?? "") : "";
  // Analytics does not read the profile, so it asks for the one field it needs
  // rather than paying for the whole row to say "Your search".
  const zone = today ? today[0].timeZone : await timeZoneOf(user.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow={active === "today" ? greeting(zone) : "Your search"}
        title={
          active === "analytics"
            ? "How the search is going"
            : firstName
              ? `Let's go, ${firstName}.`
              : "What you owe yourself."
        }
        description={
          active === "analytics"
            ? "The shape of it, not the to-do list: what is still open, how many come back to you, and where the rest stop."
            : "The things you wrote down, and the follow-ups that have come round. Your assistant can read and write this list too."
        }
        actions={
          active === "today" ? (
            <Button asChild variant="default">
              <Link href="/me?tab=resumes&new=1">
                <SparklesIcon /> New resume
              </Link>
            </Button>
          ) : null
        }
      />

      {/* Controlled by the URL: every trigger is a link, so the browser's own
          history is the tab state and either tab can be linked to directly. */}
      <Tabs value={active}>
        <TabsList className="mb-5">
          <TabsTrigger value="today" asChild>
            <Link href="/">
              <ListChecksIcon /> Today
            </Link>
          </TabsTrigger>
          <TabsTrigger value="analytics" asChild>
            <Link href="/?tab=analytics">
              <ChartNoAxesColumnIcon /> Analytics
            </Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={active}>
          {today ? (
            <TodayTab userId={user.id} setup={today[1]} zone={zone} />
          ) : (
            <AnalyticsPanel userId={user.id} />
          )}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/**
 * Everything you owe, as one worked list.
 *
 * Two columns, deliberately not merged. Tasks are things you wrote down and
 * can tick off; the chase list is dates the app worked out for you — a
 * follow-up that has come round, a person you said you would ping. Ticking a
 * task and logging a chase mean different things, so they stay side by side
 * rather than interleaved into one column of look-alike rows.
 */
async function TodayTab({
  userId,
  setup,
  zone,
}: {
  userId: string;
  setup: Awaited<ReturnType<typeof setupStatus>>;
  /** The reader's calendar, so "Today" on this list means their today. */
  zone: string;
}) {
  const [tasks, applications, followUps, contactPings, contacts, companies, resumeNames, roles, notes] =
    await Promise.all([
      listTasks(userId, { limit: 300 }),
      listApplications(userId),
      // A week out, not just today: this is the tab you plan from, and a list
      // that only ever shows what is already late plans nothing.
      followUpsDue(userId, 7),
      contactFollowUpsDue(userId, 7),
      listContacts(userId),
      listCompanies(userId),
      listResumeNames(userId),
      listRoles(userId),
      listNotes(userId),
    ]);

  // Everything a task can be about, in one list for the picker. Built here
  // rather than in the client so the six reads happen once per page rather
  // than once per popover.
  const subjects: SubjectOption[] = [
    ...applications.map((application) => ({
      kind: "application" as const,
      id: application.id,
      label: application.roleTitle,
      hint: application.company.name,
    })),
    ...contacts.map((contact) => ({
      kind: "contact" as const,
      id: contact.id,
      label: contact.name,
      hint: contact.title || undefined,
    })),
    ...companies.map((company) => ({
      kind: "company" as const,
      id: company.id,
      label: company.name,
    })),
    ...resumeNames.map((resume) => ({
      kind: "resume" as const,
      id: resume.id,
      label: resume.name,
    })),
    ...roles.map((role) => ({
      kind: "role" as const,
      id: role.id,
      label: role.title,
      hint: role.company || undefined,
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      id: note.id,
      label: note.title || "Untitled note",
    })),
  ];

  const now = new Date();
  const chase = [
    ...followUps.map((application) => ({
      id: application.id,
      company: application.company.name,
      roleTitle: application.roleTitle,
      stage: application.stage as Stage | null,
      dueAt: application.nextFollowUpAt,
      kind: "application" as const,
    })),
    ...contactPings.map((contact) => ({
      id: contact.id,
      company: contact.name,
      roleTitle:
        [contact.title, ...contact.companies.map((company) => company.name)]
          .filter(Boolean)
          .join(" · ") || "Contact",
      stage: null,
      dueAt: contact.nextFollowUpAt,
      kind: "contact" as const,
    })),
  ]
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
    .map((item) => ({
      ...item,
      due: relativeDay(item.dueAt, zone),
      overdue: item.dueAt !== null && item.dueAt < now,
    }));

  const overdue = chase.filter((item) => item.overdue).length;

  return (
    <>
      {/* The first-run nudges belong to this tab, not to the page. Analytics
          is about the search; three onboarding cards above its tab strip
          pushed the thing you came for under the fold. */}
      {setup.outstanding && <SetupStrip status={setup} />}

      {/* Above the list, because reporting what happened is the thing you came
          here to do; the list is what you work down afterwards — but only once
          there is something to report against. It matches what you type to a
          company on the board, so on an empty account it is the most inviting
          control on the first screen and it cannot succeed. It appears on its
          own the moment the first job lands, the way the setup strip clears
          itself. */}
      {applications.length > 0 && <QuickLog />}

      <FadeIn>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <TaskPanel
            tasks={tasks.map((task) => ({
              id: task.id,
              title: task.title,
              detail: task.detail,
              dueISO: task.dueAt?.toISOString() ?? "",
              dueDate: task.dueAt ? civilDay(task.dueAt, zone) : "",
              done: task.done,
              subject: taskSubjectOf(task),
            }))}
            subjects={subjects}
          />

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-[15px]">
                  <CalendarClockIcon className="text-muted-foreground size-4" />
                  Chase
                </CardTitle>
                {overdue > 0 && (
                  <span className="text-destructive nums text-[12px] font-medium">
                    {overdue} overdue
                  </span>
                )}
              </CardHeader>
              <CardContent>
                <FollowUpList items={chase} started={applications.some((a) => a.nextFollowUpAt) || contacts.some((c) => c.nextFollowUpAt)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-[15px]">Ping someone</CardTitle>
              </CardHeader>
              <CardContent>
                <PingScheduler
                  contacts={contacts.map((contact) => ({
                    id: contact.id,
                    name: contact.name,
                    detail:
                      [contact.title, ...contact.companies.map((company) => company.name)]
                        .filter(Boolean)
                        .join(" · ") || "",
                  }))}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </FadeIn>
    </>
  );
}
