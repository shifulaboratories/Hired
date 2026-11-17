import { headers } from "next/headers";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  LibraryBigIcon,
  KanbanIcon,
  PaletteIcon,
  PlugZapIcon,
  ShieldIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { requireUser, isAdmin, ensureDefaultConnection } from "@/lib/auth";
import { ConnectionsPanel } from "@/components/settings/connections-panel";
import { AccountPanel } from "@/components/settings/account-panel";
import { AppearancePanel } from "@/components/settings/appearance-panel";
import { StageChecklists } from "@/components/pipeline/stage-checklists";
import { SkillsPanel } from "@/components/settings/skills-panel";
import { listConnections } from "@/lib/data/connections";
import { getProfile } from "@/lib/data/me";
import { listSkills } from "@/lib/skills";
import { toolsFor, promptsFor } from "@/lib/mcp/tools";
import { guessClient } from "@/lib/mcp/clients";
import { MANUAL_URL } from "@/lib/links";
import {
  emailIsConfigured,
  getSettings,
  googleIsConfigured,
  microsoftIsConfigured,
} from "@/lib/settings";
import { listLinkedAccounts } from "@/lib/data/accounts";
import { getMailSweep } from "@/lib/data/mail-sweep";
import { getCaptureLink } from "@/lib/data/capture-link";
import { scheduleStates } from "@/lib/data/scheduled";
import { getOutboundSettings } from "@/lib/data/outbound";
import { listStageTemplates, stageTemplateUsage } from "@/lib/data/stage-templates";
import { isGoogleRefusal, refusalMessage } from "@/lib/google";
import { ARCHIVE_KINDS, ARCHIVE_KIND_LABEL, archiveCounts } from "@/lib/data/archive";

export const dynamic = "force-dynamic";

const TABS = ["connections", "pipeline", "account", "appearance", "archive"] as const;

/**
 * Tabs rather than one column of cards.
 *
 * The page used to open on roughly twelve hundred pixels of connection
 * reference material, with the account you came to edit below all of it. Every
 * tab is now one subject, and the reference — the tool catalogue, the workflow
 * list, the example sentences — lives at docs.hired.tools, generated from the
 * same tools array, because two renderings of one generated list is one
 * rendering that goes stale. What stays here is what only this instance can
 * answer: which assistants are wired up, and the skill files it serves.
 *
 * Connections is the default. A new user's first ten minutes are the point of
 * this product, and they are spent pasting a URL into an assistant — not
 * changing a password.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; account?: string; connect?: string }>;
}) {
  const user = await requireUser();
  const headerList = await headers();
  const { tab, account: accountOutcome, connect } = await searchParams;

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${proto}://${host}`;

  // Nobody should ever land here with nothing to copy.
  await ensureDefaultConnection(user.id);
  const [connections, profile, skills, settings, linkedAccounts, sweep, capture, outboundSettings, schedules, archived] = await Promise.all([
    listConnections(user.id),
    getProfile(user.id),
    listSkills(),
    getSettings(),
    listLinkedAccounts(user.id),
    getMailSweep(user.id),
    getCaptureLink(user.id, baseUrl),
    getOutboundSettings(user.id),
    scheduleStates(),
    archiveCounts(user.id),
  ]);

  // What the consent screen came back with, as a fixed code — never text from
  // the query string, for the same reason the sign-in page refuses it.
  const accountNotice =
    accountOutcome === "connected"
      ? { ok: true, message: "Account connected. Every contact, company and application page now shows its email and calendar." }
      : accountOutcome === "not_set_up"
        ? { ok: false, message: "That is not set up here yet. Whoever runs this can add it under Admin → Configuration." }
        : accountOutcome && isGoogleRefusal(accountOutcome)
          ? { ok: false, message: refusalMessage(accountOutcome) }
          : null;

  const visibleTools = toolsFor(user);
  const visiblePrompts = promptsFor(user);
  const admin = isAdmin(user);

  // ?tab= so other screens can send someone to the right one — the resume
  // editor points at the photo, which lives under Account. `google` was a tab
  // of its own for one release and is a tile on Connections now; the old
  // address falls through to Connections.
  const active = TABS.includes(tab as (typeof TABS)[number])
    ? (tab as (typeof TABS)[number])
    : "connections";

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title="You and your assistants"
        description="Your account, how the app looks, and everything wired to it: the assistants that read and write your search, and the mail accounts it reads on your behalf. Each connection is yours alone — nobody else's data is reachable through one."
        actions={
          admin ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/admin">
                <ShieldIcon className="size-3.5" /> Admin
                <ArrowUpRightIcon className="size-3.5" />
              </Link>
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue={active}>
        <TabsList className="mb-6">
          <TabsTrigger value="connections">
            <PlugZapIcon className="hidden size-4 sm:block" /> Connections
            <span className="text-muted-foreground ml-0.5 text-[11px] tabular-nums">
              {connections.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            <KanbanIcon className="hidden size-4 sm:block" /> Pipeline
          </TabsTrigger>
          <TabsTrigger value="account">
            <UserRoundIcon className="hidden size-4 sm:block" /> Account
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <PaletteIcon className="hidden size-4 sm:block" /> Appearance
          </TabsTrigger>
          <TabsTrigger value="archive">
            <Trash2Icon className="hidden size-4 sm:block" /> Archive
            {archived.total > 0 && (
              <span className="text-muted-foreground ml-0.5 text-[11px] tabular-nums">
                {archived.total}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections">
          <div className="space-y-4">
            <FadeIn>
              <ConnectionsPanel
                baseUrl={baseUrl}
                autoConnect={connect === "1"}
                connections={connections.map((connection) => ({
                  id: connection.id,
                  name: connection.name,
                  client: connection.client,
                  token: connection.token,
                  scope: connection.scope,
                  lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
                  lastUsedFrom: guessClient(connection.lastUsedFrom),
                }))}
                toolCount={visibleTools.length}
                adminToolCount={visibleTools.filter((tool) => tool.adminOnly).length}
                isAdmin={admin}
                promptCount={visiblePrompts.length}
                accounts={{
                  list: linkedAccounts.map((account) => ({
                    id: account.id,
                    provider: account.provider,
                    providerLabel: account.providerLabel,
                    email: account.email,
                    label: account.label,
                    mail: account.mail,
                    calendar: account.calendar,
                    imapHost: account.imapHost,
                    caldavUrl: account.caldavUrl,
                    connectedAt: account.connectedAt.toISOString(),
                    lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
                    lastError: account.lastError,
                  })),
                  googleReady: googleIsConfigured(settings),
                  microsoftReady: microsoftIsConfigured(settings),
                  notice: accountNotice,
                  sweep: {
                    on: sweep.on,
                    lastRunAt: sweep.lastRunAt?.toISOString() ?? null,
                    note: sweep.note,
                    mailConnected: sweep.mailConnected,
                    calendarConnected: sweep.calendarConnected,
                    scheduleNote: sweep.scheduleNote,
                  },
                }}
                captureLink={{
                  exists: capture.exists,
                  url: capture.url,
                  bookmarklet: capture.bookmarklet,
                  captured: capture.captured,
                  lastUsedAt: capture.lastUsedAt?.toISOString() ?? null,
                  note: capture.note,
                }}
              />
            </FadeIn>

            {/* The skills are here rather than on a page of their own because
                this instance has to serve them: they are the files in its own
                skills/ directory, and a static manual cannot hand you a zip
                built from a folder on someone else's server. Everything else
                /docs used to carry is written out at docs.hired.tools. */}
            <FadeIn delay={0.06}>
              <SkillsPanel skills={skills} />
            </FadeIn>

            <FadeIn delay={0.12}>
              <a
                href={MANUAL_URL}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:border-border hover:text-foreground flex items-start gap-2.5 rounded-xl border border-dashed px-4 py-3 text-[13px] transition-colors"
              >
                <LibraryBigIcon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block font-medium">The docs</span>
                  Every one of those {visibleTools.length} tools written out with its arguments, plus
                  getting connected, filling in Me, tailoring a resume and running the search —
                  at docs.hired.tools.
                </span>
                <ArrowUpRightIcon className="mt-0.5 size-3.5 shrink-0" />
              </a>
            </FadeIn>
          </div>
        </TabsContent>

        <TabsContent value="account">
          <FadeIn>
            <AccountPanel
              user={{
                name: user.name,
                email: user.email,
                role: user.role,
                photo: profile.photo,
                googleLinked: Boolean(user.googleId),
                hasPassword: Boolean(user.passwordHash),
                timeZone: profile.timeZone,
              }}
              googleReady={googleIsConfigured(settings)}
              digest={{
                weeklyDigest: profile.weeklyDigest,
                dailyNudge: profile.dailyNudge,
                digestHour: profile.digestHour,
                emailConfigured: emailIsConfigured(settings),
                scheduleNote: schedules.digest.note,
              }}
              outbound={{
                instanceEnabled: outboundSettings.instanceEnabled,
                dailyLimit: outboundSettings.dailyLimit,
                approval: outboundSettings.approval,
                accounts: outboundSettings.accounts.length,
                sentToday: outboundSettings.sentToday,
              }}
            />
          </FadeIn>
        </TabsContent>

        <TabsContent value="pipeline">
          <FadeIn>
            <ChecklistsTab userId={user.id} />
          </FadeIn>
        </TabsContent>

        <TabsContent value="appearance">
          <FadeIn>
            <AppearancePanel />
          </FadeIn>
        </TabsContent>

        <TabsContent value="archive">
          <FadeIn>
            <ArchiveTab counts={archived} retentionDays={settings.archiveRetentionDays} />
          </FadeIn>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

async function ChecklistsTab({ userId }: { userId: string }) {
  const [lines, usage] = await Promise.all([
    listStageTemplates(userId),
    stageTemplateUsage(userId),
  ]);
  return (
    <StageChecklists
      lines={lines.map((line) => ({
        id: line.id,
        stage: line.stage,
        title: line.title,
        detail: line.detail,
        dueInDays: line.dueInDays,
        enabled: line.enabled,
        firedFor: usage.get(line.id) ?? 0,
      }))}
    />
  );
}

/**
 * A pointer to /archive, not a second copy of it. The archive page already
 * restores and deletes; people looked for it under Settings, so it is listed
 * here with what is in it and one way through.
 */
function ArchiveTab({
  counts,
  retentionDays,
}: {
  counts: Awaited<ReturnType<typeof archiveCounts>>;
  retentionDays: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-xl">
            <Trash2Icon className="size-[18px]" />
          </div>
          <div>
            <CardTitle className="text-[15px]">Archive</CardTitle>
            <p className="text-muted-foreground text-sm">
              {retentionDays > 0
                ? `Companies, people and applications you delete wait here for ${retentionDays} days. Restore them or delete them for good.`
                : "Companies, people and applications you delete wait here until you restore them or delete them for good."}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {ARCHIVE_KINDS.map((kind) => (
            <Link
              key={kind}
              href={`/archive?kind=${kind}`}
              className="text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-between rounded-lg border px-3 py-2 text-[13px] transition-colors"
            >
              {ARCHIVE_KIND_LABEL[kind].many.replace(/^./, (c) => c.toUpperCase())}
              <span className="text-foreground tabular-nums">{counts[kind]}</span>
            </Link>
          ))}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/archive">
            Open the archive <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
