"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CircleHelpIcon,
  DownloadIcon,
  LockIcon,
  MapPinIcon,
  MessageSquareWarningIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/page-header";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { cn, dateRange, truncate } from "@/lib/utils";

type RoleCard = {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  summary: string;
  tags: string[];
  backgroundLength: number;
  highlightCount: number;
  /** An evidence-only preview, for a role with no scope summary. */
  excerpt: string;
  rules: number;
  caveats: number;
  open: number;
};

type OpenQuestion = { roleId: string; role: string; question: string };

export function RolesPanel({
  roles,
  openQuestions,
}: {
  roles: RoleCard[];
  openQuestions: OpenQuestion[];
}) {
  if (roles.length === 0) {
    return (
      <EmptyState
        icon={BriefcaseIcon}
        title="Nothing on file yet"
        description="Paste in a resume you already have and it fills this in for you — jobs, dates, bullets. Or add one job by hand and dump everything you remember about it underneath."
        action={
          // Links rather than the dialogs themselves: both are already mounted
          // by the page above and open on a URL parameter, which is what the
          // setup strip links to as well. One button that works two ways beats
          // a second copy of a dialog.
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/me?import=1">
                <DownloadIcon /> Paste a resume
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/me?new=role">
                <PlusIcon /> Add a job by hand
              </Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {openQuestions.length > 0 && <OpenQuestions questions={openQuestions} />}
      <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <StaggerItem key={role.id}>
            <Lift>
              <Link href={`/me/${role.id}`} className="block h-full">
                <Card className="group relative h-full overflow-hidden transition-shadow duration-200 ease-[var(--ease-settle)] hover:shadow-raised">
                  <CardContent className="relative flex h-full flex-col pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold tracking-tight">
                          {role.title}
                        </div>
                        <div className="text-muted-foreground truncate text-sm font-medium">{role.company}</div>
                      </div>
                      {role.isCurrent && (
                        <Badge variant="success" className="shrink-0">
                          Current
                        </Badge>
                      )}
                    </div>

                    <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span>{dateRange(role.startDate, role.endDate, role.isCurrent)}</span>
                      {role.location && (
                        <span className="flex items-center gap-1">
                          <MapPinIcon className="size-3" />
                          {role.location}
                        </span>
                      )}
                    </div>

                    {(role.summary || role.excerpt) && (
                      <p className="text-muted-foreground mt-3 line-clamp-2 text-sm leading-relaxed">
                        {truncate(role.summary || role.excerpt, 130)}
                      </p>
                    )}

                    {role.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {role.tags.slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-5 text-xs">
                      <span className="flex items-center gap-1.5">
                        <SparklesIcon className="text-muted-foreground size-3" />
                        <span className="font-medium tabular-nums">{role.highlightCount}</span>
                        <span className="text-muted-foreground">
                          {role.highlightCount === 1 ? "highlight" : "highlights"}
                        </span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatBackground(role.backgroundLength)}
                      </span>
                      {/* What the background carries besides evidence, so a rule
                          or an unsettled fact shows from the list rather than
                          only once you open the role. */}
                      <Marks role={role} />
                      <ArrowRightIcon className="text-muted-foreground ml-auto size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </Lift>
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}

function Marks({ role }: { role: RoleCard }) {
  const marks = [
    { count: role.rules, icon: LockIcon, key: "rules", className: "text-muted-foreground" },
    { count: role.caveats, icon: MessageSquareWarningIcon, key: "caveats", className: "text-muted-foreground" },
    { count: role.open, icon: CircleHelpIcon, key: "open", className: "text-warning" },
  ].filter((mark) => mark.count > 0);
  if (marks.length === 0) return null;
  const title: Record<string, (n: number) => string> = {
    rules: (n) => `${n} ${n === 1 ? "rule" : "rules"} on how this job is described`,
    caveats: (n) => `${n} ${n === 1 ? "caveat" : "caveats"}, never written into a document`,
    open: (n) => `${n} not settled yet, kept off documents until you answer`,
  };
  return (
    <span className="flex items-center gap-2.5">
      {marks.map(({ count, icon: Icon, key, className }) => (
        <span
          key={key}
          title={title[key](count)}
          className={cn("flex items-center gap-1 tabular-nums", className)}
        >
          <Icon className="size-3" />
          {count}
          {key === "open" && " open"}
        </span>
      ))}
    </span>
  );
}

/**
 * What they have marked as not settled, across every role, in one place.
 *
 * Each of these is already kept off documents, which on its own only makes a
 * fact quietly absent from every resume. This is the list that gets them
 * answered: the role, the question as they wrote it, and a link to the role.
 * list_open_questions is the same list over MCP.
 */
function OpenQuestions({ questions }: { questions: OpenQuestion[] }) {
  const shown = questions.slice(0, 6);
  return (
    <Card className="border-warning/40 border-dashed">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <CircleHelpIcon className="text-warning size-4" />
            <h2 className="text-[15px] font-semibold tracking-tight">
              {questions.length === 1 ? "One thing to settle" : `${questions.length} things to settle`}
            </h2>
          </div>
          <p className="text-muted-foreground text-xs">
            Kept off every document until you answer. Ask Claude to go through them with you.
          </p>
        </div>
        <ul className="divide-border divide-y">
          {shown.map((item, index) => (
            <li key={index}>
              <Link
                href={`/me/${item.roleId}`}
                className="hover:bg-accent/50 -mx-2 flex flex-col gap-0.5 rounded-md px-2 py-2 transition-colors sm:flex-row sm:items-start sm:gap-3"
              >
                <span className="text-muted-foreground shrink-0 truncate pt-px text-xs sm:w-44">
                  {item.role}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  {truncate(item.question, 180)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {questions.length > shown.length && (
          <p className="text-muted-foreground text-xs">
            And {questions.length - shown.length} more, on the roles they belong to.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function formatBackground(length: number) {
  if (length === 0) return "nothing written yet";
  const words = Math.round(length / 5.5);
  if (words < 1000) return `${words} words`;
  return `${(words / 1000).toFixed(1)}k words`;
}
