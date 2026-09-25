"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDownUpIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CheckIcon,
  CircleHelpIcon,
  DownloadIcon,
  HashIcon,
  LockIcon,
  MapPinIcon,
  MessageSquareWarningIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/page-header";
import { Lift, Stagger, StaggerItem } from "@/components/motion";
import { DragHandle, SortableList, SortableRow } from "@/components/resume/sortable-list";
import { useAsk } from "@/components/assistant/ask";
import { cn, dateRange, truncate } from "@/lib/utils";
import { GROUP_LABEL, GROUP_ORDER, roleGroup, type RoleGroup } from "@/lib/timeline";
import { reorderRolesAction, resolveOpenQuestionAction } from "@/server/actions";

type RoleCard = {
  id: string;
  company: string;
  title: string;
  location: string;
  employmentType: string;
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
  /** Days since anything was written into the background. */
  daysSinceAdded: number;
};

type OpenQuestion = {
  roleId: string | null;
  role: string;
  question: string;
  kind: "background" | "start_date" | "end_date";
};

type Conflict = {
  roleId: string | null;
  role: string;
  key: string;
  figures: { raw: string; sentence: string; source: { kind: string; id: string; title: string } }[];
};

/** A current job with nothing added for this long gets a nudge on its card. */
const STALE_DAYS = 30;

export function RolesPanel({
  roles,
  openQuestions,
  conflicts,
  order,
  timeline,
}: {
  roles: RoleCard[];
  openQuestions: OpenQuestion[];
  conflicts: Conflict[];
  order: "date" | "manual";
  /** Rendered above the cards; built on the server. */
  timeline?: React.ReactNode;
}) {
  const [reordering, setReordering] = useState(false);

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

  // Grouped by kind of role when there is more than one kind: three advisory
  // seats listed between two jobs read as job-hopping; under their own
  // heading they read as what they are.
  const groups = GROUP_ORDER.map((group) => ({
    group,
    roles: roles.filter((role) => roleGroup(role.employmentType) === group),
  })).filter((entry) => entry.roles.length > 0);

  return (
    <div className="space-y-6">
      {openQuestions.length > 0 && <OpenQuestions questions={openQuestions} />}
      {conflicts.length > 0 && <Conflicts conflicts={conflicts} />}
      {timeline}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {order === "manual" && !reordering && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 text-xs"
            onClick={() => void reorderRolesAction(null).then(() => toast.success("Back in date order."))}
          >
            Back to date order
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => setReordering((value) => !value)}
        >
          {reordering ? (
            <>
              <CheckIcon className="size-3" /> Done
            </>
          ) : (
            <>
              <ArrowDownUpIcon className="size-3" /> Reorder
            </>
          )}
        </Button>
      </div>

      {reordering ? (
        <ReorderList roles={roles} />
      ) : (
        groups.map(({ group, roles: members }) => (
          <section key={group} className="space-y-3">
            {groups.length > 1 && (
              <h2 className="text-muted-foreground text-[12px] font-medium tracking-wide uppercase">
                {GROUP_LABEL[group as RoleGroup]}
                <span className="ml-1.5 tabular-nums">{members.length}</span>
              </h2>
            )}
            <RoleGrid roles={members} />
          </section>
        ))
      )}
    </div>
  );
}

function RoleGrid({ roles }: { roles: RoleCard[] }) {
  const ask = useAsk();
  return (
    <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {roles.map((role) => {
        const stale = role.isCurrent && role.daysSinceAdded >= STALE_DAYS;
        return (
          <StaggerItem key={role.id}>
            <Lift>
              <Link href={`/me/${role.id}`} className="block h-full">
                <Card className="group hover:shadow-raised relative h-full overflow-hidden transition-shadow duration-200 ease-[var(--ease-settle)]">
                  <CardContent className="relative flex h-full flex-col pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold tracking-tight">{role.title}</div>
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

                    {stale && (
                      // The job you are in is the one whose details are
                      // freshest now and gone by the time a resume is due.
                      <div className="bg-warning-tint mt-3 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs">
                        <span>Nothing added in {Math.floor(role.daysSinceAdded / 7)} weeks.</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            ask(
                              `Help me log what I've done lately in my ${role.title} role at ${role.company} (role id ${role.id}). Ask me what I worked on, shipped and learned since I last added to it, then file my answers with append_role_background. Don't invent anything I didn't say.`,
                            );
                          }}
                          className="text-primary shrink-0 font-medium hover:underline"
                        >
                          Log recent work
                        </button>
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
        );
      })}
    </Stagger>
  );
}

/**
 * Drag roles into the order you want them listed. Switching to this is
 * choosing your own order over date order; "Back to date order" undoes it.
 * reorder_roles is the same over MCP.
 */
function ReorderList({ roles }: { roles: RoleCard[] }) {
  const [ids, setIds] = useState(roles.map((role) => role.id));
  const byId = new Map(roles.map((role) => [role.id, role]));
  return (
    <SortableList
      ids={ids}
      className="space-y-1.5"
      onReorder={(from, to) => {
        const next = [...ids];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setIds(next);
        void reorderRolesAction(next).catch(() => toast.error("Could not save the new order."));
      }}
    >
      {ids.map((id) => {
        const role = byId.get(id);
        if (!role) return null;
        return (
          <SortableRow key={id} id={id} label={`Move ${role.title} at ${role.company}`}>
            <div className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2">
              <DragHandle className="size-6" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {role.title} <span className="text-muted-foreground font-normal">· {role.company}</span>
                </div>
                <div className="text-muted-foreground text-xs">
                  {dateRange(role.startDate, role.endDate, role.isCurrent)} · {role.employmentType}
                </div>
              </div>
            </div>
          </SortableRow>
        );
      })}
    </SortableList>
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
 * What they have marked as not settled, across every role and the profile,
 * with the answer box right there. Answering puts the fact in as evidence
 * where the doubt was; a date is confirmed or corrected; "Drop" is for a
 * question that no longer matters. resolve_open_question is the same write.
 */
function OpenQuestions({ questions }: { questions: OpenQuestion[] }) {
  const [shownAll, setShownAll] = useState(false);
  const shown = shownAll ? questions : questions.slice(0, 6);
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
            Kept off every document until you answer. Your answer goes in where the question was.
          </p>
        </div>
        <ul className="divide-border divide-y">
          {shown.map((item) => (
            <QuestionRow key={`${item.roleId}:${item.question}`} item={item} />
          ))}
        </ul>
        {questions.length > 6 && (
          <button
            type="button"
            onClick={() => setShownAll((value) => !value)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            {shownAll ? "Show fewer" : `Show all ${questions.length}`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

function QuestionRow({ item }: { item: OpenQuestion }) {
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState("");
  const [pending, startTransition] = useTransition();
  const [gone, setGone] = useState(false);
  const isDate = item.kind !== "background";

  const settle = (reply?: string) =>
    startTransition(async () => {
      try {
        await resolveOpenQuestionAction(item.roleId, item.question, reply);
        setGone(true);
        toast.success(isDate ? "Date confirmed." : reply ? "Answered and filed." : "Dropped.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save that.");
      }
    });

  if (gone) return null;
  return (
    <li className="py-2">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
        {item.roleId ? (
          <Link
            href={`/me/${item.roleId}`}
            className="text-muted-foreground hover:text-foreground shrink-0 truncate pt-px text-xs sm:w-44"
          >
            {item.role}
          </Link>
        ) : (
          <Link
            href="/me?tab=profile"
            className="text-muted-foreground hover:text-foreground shrink-0 truncate pt-px text-xs sm:w-44"
          >
            Profile
          </Link>
        )}
        <span className="min-w-0 flex-1 text-sm leading-snug">{truncate(item.question, 200)}</span>
        {!answering && (
          <span className="flex shrink-0 gap-1">
            {isDate ? (
              <>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={pending} onClick={() => settle()}>
                  It&rsquo;s right
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAnswering(true)}>
                  Correct it
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAnswering(true)}>
                  Answer
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 text-xs"
                  disabled={pending}
                  onClick={() => settle()}
                  title="Take the question away without adding anything"
                >
                  Drop
                </Button>
              </>
            )}
          </span>
        )}
      </div>
      {answering && (
        <form
          className="mt-2 flex gap-2 sm:pl-47"
          onSubmit={(event) => {
            event.preventDefault();
            if (answer.trim()) settle(answer.trim());
          }}
        >
          <Input
            autoFocus
            type={isDate ? "month" : "text"}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder={isDate ? "" : "The answer, written as a fact: “The budget was $40K a month.”"}
            className="h-9 md:h-8"
          />
          <Button type="submit" size="sm" disabled={pending || !answer.trim()}>
            Save
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAnswering(false)}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}

/**
 * The same thing counted two ways in the same job. Candidates, not verdicts:
 * the grouping is a heuristic, which is why this lists the sentences and
 * leaves the judgement to the person. find_figure_conflicts is the same list.
 */
function Conflicts({ conflicts }: { conflicts: Conflict[] }) {
  const [open, setOpen] = useState(false);
  const shown = open ? conflicts : conflicts.slice(0, 2);
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <HashIcon className="text-muted-foreground size-4" />
            <h2 className="text-[15px] font-semibold tracking-tight">
              {conflicts.length === 1 ? "A number stated two ways" : `${conflicts.length} numbers stated two ways`}
            </h2>
          </div>
          <p className="text-muted-foreground text-xs">
            Worth a look before anything goes out. Some will be two true numbers.
          </p>
        </div>
        <ul className="space-y-3">
          {shown.map((conflict, index) => (
            <li key={index} className="space-y-1">
              <div className="text-xs">
                <span className="font-medium">{conflict.key}</span>
                <span className="text-muted-foreground"> · {conflict.role}</span>
              </div>
              <ul className="space-y-0.5">
                {conflict.figures.map((figure, figureIndex) => (
                  <li key={figureIndex} className="text-muted-foreground text-[13px] leading-snug">
                    <span className="text-foreground font-medium tabular-nums">{figure.raw}</span>{" "}
                    <span className="text-[11px]">in {figure.source.title}:</span> {truncate(figure.sentence, 160)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {conflicts.length > 2 && (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            {open ? "Show fewer" : `Show all ${conflicts.length}`}
          </button>
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
