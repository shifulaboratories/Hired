import Link from "next/link";
import {
  ChartNoAxesColumnIcon,
  CircleUserRoundIcon,
  FlameIcon,
  TargetIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { AnimatedNumber } from "@/components/animated-number";
import { db } from "@/lib/db";
import {
  ACTIVITY_LABEL,
  BOARD_STAGES,
  STAGE_LABEL,
  STAGE_TONE,
  diagnoseSearch,
  funnelFlows,
  listActivities,
  pipelineStats,
} from "@/lib/data/pipeline";
import { truncate } from "@/lib/utils";
import { DiagnosisCard } from "@/components/dashboard/diagnosis";
import { FunnelSankey } from "@/components/analytics/funnel-sankey";
import { ShareFunnel } from "@/components/analytics/share-funnel";

/**
 * The search as numbers, one tab over from the search as a to-do list.
 *
 * It reads its own data rather than taking it as a prop, because it is a tab:
 * somebody working through the list every morning should not pay for a funnel,
 * a diagnosis and three counts they are not looking at. The page above renders
 * one tab or the other, never both.
 *
 * Nothing here is actionable on purpose. The moment a due date or a checkbox
 * lands on this tab it stops being the one you check monthly and starts
 * competing with the one you clear daily.
 */
export async function AnalyticsPanel({ userId }: { userId: string }) {
  const [stats, diagnosis, funnel, activities, counts] = await Promise.all([
    pipelineStats(userId),
    diagnoseSearch(userId),
    funnelFlows(userId),
    listActivities(userId, undefined, 8),
    Promise.all([
      db.role.count({ where: { userId } }),
      db.resume.count({ where: { userId } }),
      db.highlight.count({ where: { userId } }),
    ]),
  ]);

  const [roleCount, resumeCount, highlightCount] = counts;
  const maxStage = Math.max(1, ...BOARD_STAGES.map((stage) => stats.counts[stage]));

  if (roleCount === 0 && stats.total === 0 && resumeCount === 0) {
    return (
      <EmptyState
        icon={ChartNoAxesColumnIcon}
        title="Nothing to measure yet"
        description="Track an application or two and this fills in: the funnel, the response rate, and a chart of where each one ended up."
        action={
          <Button asChild>
            <Link href="/applications">Go to the pipeline</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* A wide, short band. A Sankey wants horizontal room and almost no
          vertical: it used to be a half-screen slab that pushed everything
          else below the fold, which is the wrong weight for an overview. */}
      <FadeIn>
        <Card>
          {/* Share sits on the card rather than in the page header: it shares
              this chart, and the header belongs to both tabs. */}
          <CardHeader className="flex-row items-center justify-between pb-1">
            <CardTitle className="text-[15px]">Where each application ended up</CardTitle>
            <ShareFunnel disabled={funnel.applied === 0} />
          </CardHeader>
          <CardContent className="overflow-x-auto pt-0">
            <FunnelSankey rungs={funnel.rungs} />
            {funnel.wishlist > 0 && (
              <p className="text-faint mt-1 text-[11.5px]">
                {funnel.wishlist} on the wishlist, not applied to — never entered the funnel, so
                not drawn.
              </p>
            )}
          </CardContent>
        </Card>
      </FadeIn>

      {/* Two up from the narrowest screen. One card per row made the four
          numbers a four-screen scroll on a phone, which is the opposite of
          what a summary is for. */}
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={TargetIcon}
          label="In flight"
          value={stats.active}
          hint={`${stats.total} tracked all-time`}
        />
        <StatCard
          icon={TrendingUpIcon}
          label="Response rate"
          value={stats.responseRate}
          suffix="%"
          hint={`${stats.interviews} in interviews`}
        />
        <StatCard
          icon={FlameIcon}
          label="Applied this week"
          value={stats.thisWeek}
          hint={
            stats.offers > 0
              ? `${stats.offers} offer${stats.offers > 1 ? "s" : ""} on the table`
              : "Keep the streak"
          }
        />
        <StatCard
          icon={CircleUserRoundIcon}
          label="Me"
          value={highlightCount}
          hint={`${roleCount} role${roleCount === 1 ? "" : "s"} · ${resumeCount} resume${resumeCount === 1 ? "" : "s"}`}
        />
      </Stagger>

      <FadeIn delay={0.08}>
        <DiagnosisCard diagnosis={diagnosis} />
      </FadeIn>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <FadeIn delay={0.2}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-[15px]">On the board now</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3.5">
              {BOARD_STAGES.map((stage) => (
                <div key={stage}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground text-[13px]">{STAGE_LABEL[stage]}</span>
                    <span className="nums text-[13px] font-medium">{stats.counts[stage]}</span>
                  </div>
                  <Progress
                    value={(stats.counts[stage] / maxStage) * 100}
                    indicatorClassName="bg-[var(--stage-tone)]"
                    style={{ ["--stage-tone" as string]: STAGE_TONE[stage] }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </FadeIn>

        <FadeIn delay={0.25} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-[15px]">Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">Nothing logged yet.</p>
              ) : (
                <ol className="relative space-y-4 pl-5">
                  <span className="bg-border absolute top-1.5 bottom-1.5 left-[3px] w-px" />
                  {activities.map((activity) => (
                    <li key={activity.id} className="relative">
                      <span className="bg-border ring-background absolute top-1.5 -left-5 size-[7px] rounded-full ring-4" />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link
                          href={
                            activity.applicationId
                              ? `/applications/${activity.applicationId}`
                              : `/crm/contacts/${activity.contactId}`
                          }
                          className="text-sm font-medium hover:underline"
                        >
                          {activity.application?.company.name ?? activity.contact?.name ?? "Note"}
                        </Link>
                        <Badge variant="outline" className="text-[10px]">
                          {ACTIVITY_LABEL[activity.type]}
                        </Badge>
                        <span className="text-faint meta ml-auto text-[11.5px]">
                          {activity.occurredAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 text-[13px]">
                        {truncate(activity.body, 140)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  suffix?: string;
  hint: string;
}) {
  return (
    <StaggerItem>
      <Card className="group relative overflow-hidden transition-shadow duration-200 ease-[var(--ease-settle)] hover:shadow-raised">
        <CardContent className="relative px-4 pt-3.5 pb-3.5">
          <div className="flex items-center gap-1.5">
            <Icon className="text-faint size-3.5" />
            <span className="text-muted-foreground meta text-[11px] font-medium">{label}</span>
          </div>
          {/* Tabular figures so the four numbers line up as a row rather than
              jittering against each other. */}
          <div className="nums mt-1.5 text-[26px] leading-none font-semibold tracking-tight">
            <AnimatedNumber value={value} suffix={suffix} />
          </div>
          <p className="text-faint mt-1.5 text-[11.5px]">{hint}</p>
        </CardContent>
      </Card>
    </StaggerItem>
  );
}
