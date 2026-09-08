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

  // Applications are the honest gate. This used to also require zero roles and
  // zero resumes, so the moment somebody did what the setup strip told them to
  // — paste their old resume, which writes Role rows — the tab flipped from a
  // clean "nothing to measure yet" to a wall of zeros: an empty chart, 0%, 0,
  // and a card headed "What's working" that had nothing to work with. Every
  // card here except the Me tile is derived from applications.
  if (stats.total === 0) {
    return (
      <EmptyState
        icon={ChartNoAxesColumnIcon}
        title="Nothing to measure yet"
        description="Add a job or two and this fills in: how far each one got, how many came back to you, and where the rest stopped."
        action={
          <Button asChild>
            <Link href="/applications">Go to the board</Link>
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
        {/* A percentage is a verdict, and at three applications it is a verdict
            on nothing. This used to read "Response rate 0%" in 26px directly
            above a card saying "Too early to tell you anything useful" — the
            two disagreeing, and the big one winning, on the screen where
            somebody who has done exactly the right thing goes to see how they
            are doing. `confident` is the diagnosis's own rule (ten applications
            in), reused rather than re-decided: one threshold, one place. */}
        {diagnosis.confident ? (
          <StatCard
            icon={TrendingUpIcon}
            label="Response rate"
            value={stats.responseRate}
            suffix="%"
            hint={interviewHint(stats.interviews, stats.screening)}
          />
        ) : (
          <QuietStat
            icon={TrendingUpIcon}
            label="Response rate"
            hint={
              stats.interviews > 0
                ? `${interviewHint(stats.interviews, stats.screening)}. A rate needs about ten applications behind it.`
                : "Needs about ten applications behind it to mean anything."
            }
          />
        )}
        <StatCard
          icon={FlameIcon}
          label="Applied this week"
          value={stats.thisWeek}
          hint={
            stats.offers > 0
              ? `${stats.offers} offer${stats.offers > 1 ? "s" : ""} on the table`
              : stats.thisWeek > 0
                ? "Keep the streak"
                : "Nothing sent yet this week"
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

/**
 * A number that is not worth showing yet.
 *
 * Same box, same weight, an em dash where the figure goes. Hiding the card
 * would be worse: the row would reflow as soon as the tenth application landed,
 * and somebody would wonder what they had done to make a card appear.
 */
function QuietStat({
  icon: Icon,
  label,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <StaggerItem>
      <Card className="relative overflow-hidden">
        <CardContent className="relative px-4 pt-3.5 pb-3.5">
          <div className="flex items-center gap-1.5">
            <Icon className="text-faint size-3.5" />
            <span className="text-muted-foreground meta text-[11px] font-medium">{label}</span>
          </div>
          <div className="text-faint nums mt-1.5 text-[26px] leading-none font-semibold tracking-tight">
            &mdash;
          </div>
          <p className="text-faint mt-1.5 text-[11.5px]">{hint}</p>
        </CardContent>
      </Card>
    </StaggerItem>
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

/**
 * "2 in interviews, 1 at a phone screen".
 *
 * These were one number under the word "interviews", which counted phone
 * screens as interviews — the one distinction the whole funnel is built on,
 * flattened in the summary above it.
 */
function interviewHint(interviews: number, screening: number) {
  const parts = [
    interviews > 0 ? `${interviews} in interviews` : "",
    screening > 0 ? `${screening} at a phone screen` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing in play yet";
}
