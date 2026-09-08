import Link from "next/link";
import { formatIn } from "@/lib/time";
import { timeZoneOf } from "@/lib/data/me";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ShieldIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditPanel } from "@/components/admin/audit-panel";
import { PersonActions } from "@/components/admin/person-actions";
import { SOURCE_LABEL } from "@/components/admin/health-panel";
import { requireAdmin } from "@/lib/auth";
import { getUserDetail } from "@/lib/data/users";
import { listAudit } from "@/lib/data/audit";
import { listSystemEvents } from "@/lib/data/system";
import { MCP_CLIENTS } from "@/lib/mcp/clients";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * One account, everything about it.
 *
 * The list on the Admin page answers "who is here". This answers "what is
 * going on with this person", which is the question you actually have when
 * someone emails asking why they can't get in. Everything needed to answer it
 * without asking them anything: whether the invite email left, whether they
 * ever signed in, whether an assistant ever connected, what has been done to
 * the account, and what the instance recorded against their address.
 *
 * What it deliberately does not have is a way in. Counts say whether a
 * workspace is being used; there is no link, no preview and no impersonation,
 * because "admins manage accounts, never content" is a promise this page would
 * be the natural place to break.
 */

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

const CLIENT_NAME = new Map(MCP_CLIENTS.map((client) => [client.id, client.name]));

/**
 * Both take the admin's own zone. These are instance facts, but an admin
 * reading "seen Sep 8, 2:15 PM" wants their own clock, not the container's.
 */
function when(zone: string, date: Date | null | undefined, fallback = "never") {
  if (!date) return fallback;
  return formatIn(date, zone, { month: "short", day: "numeric", year: "numeric" });
}

function whenExact(zone: string, date: Date | null | undefined, fallback = "never") {
  if (!date) return fallback;
  return formatIn(date, zone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const zone = await timeZoneOf(actor.id);
  const { id } = await params;
  const person = await getUserDetail(actor, id);
  if (!person) notFound();

  const [history, events] = await Promise.all([
    listAudit({ targetId: id, limit: 50 }),
    listSystemEvents({ limit: 25, userEmail: person.email }),
  ]);

  const facts: { label: string; value: string; tone?: "warn" }[] = [
    { label: "Joined", value: when(zone, person.createdAt) },
    { label: "Last signed in", value: whenExact(zone, person.lastLoginAt, "never") },
    {
      label: "Invited by",
      value: person.invitedBy
        ? person.invitedBy.name || person.invitedBy.email
        : "Nobody — this account claimed the instance",
    },
    person.invite
      ? person.invite.emailSent
        ? { label: "Invitation", value: `Emailed, accepted ${when(zone, person.invite.acceptedAt)}` }
        : {
            label: "Invitation",
            value: `Email never sent${person.invite.emailError ? ` — ${person.invite.emailError}` : ""}. Accepted ${when(zone, person.invite.acceptedAt)}.`,
            tone: "warn" as const,
          }
      : { label: "Invitation", value: "No invitation on record" },
    {
      label: "Billing",
      value: person.billed
        ? "Paying through Stripe"
        : "Not billed — invited free or the instance owner",
    },
    {
      label: "Signed-in devices",
      value: person._count.sessions === 0 ? "None" : `${person._count.sessions}`,
    },
  ];

  const counts: { label: string; value: number }[] = [
    { label: "Roles", value: person._count.roles },
    { label: "Highlights", value: person._count.highlights },
    { label: "Resumes", value: person._count.resumes },
    { label: "Applications", value: person._count.applications },
    { label: "Companies", value: person._count.companies },
    { label: "Contacts", value: person._count.contacts },
  ];

  return (
    <PageShell className="max-w-4xl">
      <Link
        href="/settings/admin"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex h-11 items-center gap-1.5 text-[13px] md:h-auto"
      >
        <ArrowLeftIcon className="size-3.5" />
        Admin
      </Link>

      <PageHeader
        eyebrow="Account"
        title={person.name || person.email}
        description={
          person.name
            ? person.email
            : "This person has not set a name — the address is all there is."
        }
        actions={
          <div className="flex items-center gap-2">
            {!person.isActive && <Badge variant="outline">Suspended</Badge>}
            <Badge variant={person.role === "MEMBER" ? "outline" : "default"}>
              {person.role !== "MEMBER" && <ShieldIcon className="size-2.5" />}
              {ROLE_LABEL[person.role]}
            </Badge>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-faint text-[12px]">{fact.label}</dt>
                  <dd className={cn("text-[13px]", fact.tone === "warn" && "text-warning")}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">What you can do</CardTitle>
            <p className="text-muted-foreground text-sm">
              Account administration only. There is no way from here into anyone&apos;s career history,
              resumes or applications, and no way to sign in as them.
            </p>
          </CardHeader>
          <CardContent>
            <PersonActions
              userId={person.id}
              email={person.email}
              role={person.role}
              isActive={person.isActive}
              manageable={person.manageable}
              canChangeRole={actor.role === "SUPER_ADMIN"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Workspace</CardTitle>
            <p className="text-muted-foreground text-sm">
              How much is in it, which is how you tell a workspace being used from one that was
              never started. Counts only — never the contents.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
              {counts.map((count) => (
                <div key={count.label}>
                  <div className="text-[22px] leading-none font-semibold tracking-tight tabular-nums">
                    {count.value}
                  </div>
                  <div className="text-faint mt-1 text-[12px]">{count.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Assistants</CardTitle>
            <p className="text-muted-foreground text-sm">
              Connections this person has made, and when each last called in. Tokens are never
              shown here — they are credentials, and only their owner has any use for one.
            </p>
          </CardHeader>
          <CardContent>
            {person.mcpConnections.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-[13px]">
                No connection yet. Someone who has never connected an assistant is only using
                half of this.
              </p>
            ) : (
              <ul className="divide-y">
                {person.mcpConnections.map((connection) => (
                  <li
                    key={connection.id}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5"
                  >
                    <span className="text-[13px] font-medium">{connection.name}</span>
                    <span className="text-muted-foreground text-[13px]">
                      {CLIENT_NAME.get(connection.client) ?? connection.client}
                    </span>
                    <span className="text-faint meta ml-auto shrink-0 text-[11.5px]">
                      {connection.lastUsedAt
                        ? `last used ${whenExact(zone, connection.lastUsedAt)}`
                        : "never used"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <AuditPanel
          rows={history.map((row) => ({
            id: row.id,
            actorEmail: row.actorEmail,
            action: row.action,
            targetEmail: row.targetEmail,
            detail: row.detail,
            createdAt: row.createdAt.toISOString(),
          }))}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">What the instance recorded</CardTitle>
            <p className="text-muted-foreground text-sm">
              Anything that happened to this person&apos;s requests in the last 30 days — a
              bounced invitation, a tool call that threw, a screen that failed. Usually the fastest
              answer to &ldquo;it isn&apos;t working&rdquo;.
            </p>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-[13px]">
                Nothing. No failed email, no failed tool call.
              </p>
            ) : (
              <ul className="divide-y">
                {events.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5">
                    <span
                      className={cn(
                        "shrink-0 text-[13px] font-medium",
                        event.level === "ERROR" && "text-destructive",
                        event.level === "WARN" && "text-warning",
                      )}
                    >
                      {SOURCE_LABEL[event.source] ?? event.source}
                    </span>
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-[13px]">
                      {event.message}
                    </span>
                    <span className="text-faint meta shrink-0 text-[11.5px]">
                      {whenExact(zone, event.createdAt)}
                    </span>
                    {event.detail && (
                      <div className="text-faint w-full text-[12px]">{event.detail}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
