import { CheckCircle2Icon, CircleAlertIcon, CircleXIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthCheck, HealthStatus } from "@/lib/data/system";
import { cn } from "@/lib/utils";
import { formatIn } from "@/lib/time";

/**
 * Is this instance working.
 *
 * Read-only, and no controls: nothing here is a setting, it is a report. The
 * checks are ordered by how much depends on them — a database that is down
 * makes every check below it unanswerable, so it goes first.
 *
 * Events underneath are the evidence for the checks above. INFO rows are kept
 * deliberately: "the last Stripe webhook arrived four minutes ago" is the only
 * way to know deliveries have not silently stopped, and a stream of nothing but
 * errors cannot tell you that.
 */

export type EventRow = {
  id: string;
  level: "INFO" | "WARN" | "ERROR";
  source: string;
  message: string;
  detail: string;
  userEmail: string;
  createdAt: string;
};

const ICON: Record<HealthStatus, typeof CheckCircle2Icon> = {
  ok: CheckCircle2Icon,
  warn: CircleAlertIcon,
  down: CircleXIcon,
};

const TONE: Record<HealthStatus, string> = {
  ok: "text-success",
  warn: "text-warning",
  down: "text-destructive",
};

/** Shared with the account page, so one event reads the same in both places. */
export const SOURCE_LABEL: Record<string, string> = {
  "stripe.webhook": "Stripe",
  "billing.sync": "Billing",
  "email.send": "Email",
  "mcp.tool": "Assistant",
  app: "App",
};

export function HealthPanel({
  checks,
  events,
  zone,
}: {
  checks: HealthCheck[];
  events: EventRow[];
  /** The admin's own calendar. This screen is the one place a timestamp needs
      to be read against a person rather than against the machine. */
  zone: string;
}) {
  const worst: HealthStatus = checks.some((c) => c.status === "down")
    ? "down"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">
            {worst === "ok"
              ? "Everything is working"
              : worst === "warn"
                ? "Working, with something worth a look"
                : "Something is broken"}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Checked just now, when this page loaded. Ask an assistant for{" "}
            <code className="meta text-[12px]">admin_health</code> to get the same answer without
            opening a browser.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {checks.map((check) => {
              const Icon = ICON[check.status];
              return (
                <li key={check.key} className="flex items-start gap-3 py-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[check.status])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-medium">{check.label}</span>
                      <span className="text-muted-foreground text-[13px]">{check.summary}</span>
                    </div>
                    {check.detail && <p className="text-faint mt-0.5 text-[12px]">{check.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Recent activity</CardTitle>
          <p className="text-muted-foreground text-sm">
            What the instance did, newest first — emails sent and refused, Stripe deliveries, tool
            calls that threw, screens that failed. Kept for 30 days. The arguments behind a failure
            are deliberately not recorded, so nothing here is anyone&apos;s content.
          </p>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-[13px]">
              Nothing recorded yet. That is the good version of this screen.
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
                    {formatIn(new Date(event.createdAt), zone, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {(event.detail || event.userEmail) && (
                    <div className="text-faint w-full text-[12px]">
                      {[event.detail, event.userEmail].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
