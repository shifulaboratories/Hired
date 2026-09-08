"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BuildingIcon,
  ClockIcon,
  CheckIcon,
  ExternalLinkIcon,
  BriefcaseIcon,
  CircleUserRoundIcon,
  FileTextIcon,
  KanbanIcon,
  ListChecksIcon,
  Trash2Icon,
  ChartNoAxesColumnIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { STAGES, STAGE_LABEL, STAGE_TONE } from "@/lib/data/pipeline";
import { linkHref } from "@/lib/social";
import {
  logFollowUpAction,
  moveStageAction,
  paletteIndexAction,
  snoozeFollowUpAction,
} from "@/server/actions";
import type { Stage } from "@prisma/client";

type Index = Awaited<ReturnType<typeof paletteIndexAction>>;
type Application = Index["applications"][number];

const EMPTY: Index = { roles: [], resumes: [], applications: [], companies: [], contacts: [] };

/**
 * Jump anywhere, and do something when you get there.
 *
 * It was a navigator: five destinations and three lists. The lists are now
 * five — companies and contacts were missing entirely — and an application can
 * be acted on without leaving the dialog, because "move Stripe to interview"
 * is a thing you know you want before you know which screen it lives on.
 *
 * Two levels, one state variable, the pattern cmdk documents as pages: Enter
 * on an application still opens it, so nothing anybody has learned changes;
 * the right arrow (or the Actions row) steps into its verbs, and Escape or
 * Backspace on an empty box steps back out.
 *
 * The index is fetched when the dialog opens. It used to be assembled in the
 * app layout, which ran three content queries on every navigation to fill a
 * dialog most of those navigations never opened.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [index, setIndex] = useState<Index>(EMPTY);
  const [target, setTarget] = useState<Application | null>(null);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let live = true;
    paletteIndexAction()
      .then((next) => {
        if (live) setIndex(next);
      })
      .catch(() => {
        // A palette that cannot read is still a palette that navigates.
      });
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTarget(null);
      setQuery("");
    }
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const act = (work: () => Promise<unknown>, done: string) => {
    startTransition(async () => {
      try {
        await work();
        toast.success(done);
        onOpenChange(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That did not work.");
      }
    });
  };

  const posting = target ? linkHref(target.jobUrl) : "";

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      // Backspace on an empty box steps back out of an application's verbs,
      // the way a path does. Escape does the same before it closes.
      // Escape steps out of an application's verbs before it closes anything.
      // Radix handles Escape in its own capture-phase listener, so this cannot
      // be done from the bubbled keydown below.
      onEscapeKeyDown={(event) => {
        if (!target) return;
        event.preventDefault();
        setTarget(null);
      }}
      onKeyDown={(event) => {
        if (target) {
          if (event.key === "Backspace" && query === "") {
            event.preventDefault();
            setTarget(null);
          }
          return;
        }
        // cmdk keeps focus in the input, so a key pressed "on a row" arrives
        // here. The highlighted row is the one cmdk marked selected.
        if (event.key !== "ArrowRight") return;
        const selected = document.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
        const id = selected?.dataset.appId;
        const found = id ? index.applications.find((item) => item.id === id) : null;
        if (!found) return;
        event.preventDefault();
        setTarget(found);
        setQuery("");
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={
          target ? `${target.company} — what do you want to do?` : "Jump to a role, resume, company…"
        }
      />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>

        {target ? (
          <>
            <CommandGroup heading={`${target.company} · ${target.roleTitle}`}>
              <CommandItem value="act-open" onSelect={() => go(`/applications/${target.id}`)}>
                <KanbanIcon /> Open it
              </CommandItem>
              <CommandItem
                value="act-chased"
                disabled={pending}
                onSelect={() => act(() => logFollowUpAction(target.id), "Logged, and back in a week")}
              >
                <CheckIcon /> Chased it — log and come back in a week
              </CommandItem>
              <CommandItem
                value="act-snooze"
                disabled={pending}
                onSelect={() => act(() => snoozeFollowUpAction(target.id, 3), "Snoozed 3 days")}
              >
                <ClockIcon /> Push the follow-up out 3 days
              </CommandItem>
              {posting && (
                <CommandItem
                  value="act-posting"
                  onSelect={() => {
                    window.open(posting, "_blank", "noreferrer,noopener");
                    onOpenChange(false);
                  }}
                >
                  <ExternalLinkIcon /> Open the posting
                </CommandItem>
              )}
            </CommandGroup>

            <CommandSeparator />
            <CommandGroup heading="Move to">
              {STAGES.filter((stage) => stage !== target.stage).map((stage) => (
                <CommandItem
                  key={stage}
                  value={`act-stage-${stage}`}
                  disabled={pending}
                  onSelect={() =>
                    act(
                      () => moveStageAction(target.id, stage as Stage),
                      `${target.company} → ${STAGE_LABEL[stage]}`,
                    )
                  }
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: STAGE_TONE[stage] }}
                  />
                  {STAGE_LABEL[stage]}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : (
          <>
            <CommandGroup heading="Go to">
              <CommandItem value="go-today tasks dashboard" onSelect={() => go("/")}>
                <ListChecksIcon /> Today
              </CommandItem>
              <CommandItem value="go-me" onSelect={() => go("/me")}>
                <CircleUserRoundIcon /> Me
              </CommandItem>
              <CommandItem value="go-resumes" onSelect={() => go("/me?tab=resumes")}>
                <FileTextIcon /> Resumes
              </CommandItem>
              <CommandItem
                value="go-board pipeline applications jobs"
                onSelect={() => go("/applications")}
              >
                <KanbanIcon /> Board
              </CommandItem>
              <CommandItem
                value="go-analytics stats funnel chart"
                onSelect={() => go("/?tab=analytics")}
              >
                <ChartNoAxesColumnIcon /> Analytics
              </CommandItem>
              <CommandItem value="go-companies crm" onSelect={() => go("/crm/companies")}>
                <BuildingIcon /> Companies
              </CommandItem>
              <CommandItem value="go-contacts people crm recruiters" onSelect={() => go("/crm/contacts")}>
                <UsersIcon /> Contacts
              </CommandItem>
              <CommandItem value="go-archive trash bin deleted" onSelect={() => go("/archive")}>
                <Trash2Icon /> Archive
              </CommandItem>
              <CommandItem
                value="go-settings connections mcp assistants claude"
                onSelect={() => go("/settings")}
              >
                <SettingsIcon /> Settings
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Create">
              <CommandItem value="new-role" onSelect={() => go("/me?new=role")}>
                <PlusIcon /> New role
              </CommandItem>
              <CommandItem value="new-resume" onSelect={() => go("/me?tab=resumes&new=1")}>
                <PlusIcon /> New resume
              </CommandItem>
              <CommandItem value="new-application" onSelect={() => go("/applications?new=1")}>
                <PlusIcon /> Track a new job
              </CommandItem>
              <CommandItem value="new-import" onSelect={() => go("/me?import=1")}>
                <PlusIcon /> Import a resume
              </CommandItem>
            </CommandGroup>

            {index.applications.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Applications">
                  {index.applications.map((item) => (
                    <CommandItem
                      key={item.id}
                      // Namespaced: a source named LinkedIn beside a company
                      // named LinkedIn both highlight when they share a value.
                      value={`app-${item.id} ${item.label} ${item.sub}`}
                      data-app-id={item.id}
                      onSelect={() => go(`/applications/${item.id}`)}
                    >
                      <BuildingIcon />
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-auto text-xs">{item.sub}</span>
                      <CommandShortcut>→</CommandShortcut>
                    </CommandItem>
                  ))}
                  {/* Searchable verbs, so the second level is reachable by
                      typing and by clicking rather than only by an arrow key
                      nobody was told about. */}
                  {index.applications.map((item) => (
                    <CommandItem
                      key={`act-${item.id}`}
                      value={`act-${item.id} act log move snooze chase ${item.label}`}
                      onSelect={() => {
                        setTarget(item);
                        setQuery("");
                      }}
                      className="text-muted-foreground"
                    >
                      <CheckIcon />
                      <span>Act on {item.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {index.companies.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Companies">
                  {index.companies.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`co-${item.id} ${item.label} ${item.sub}`}
                      onSelect={() => go(`/crm/companies/${item.id}`)}
                    >
                      <BuildingIcon />
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-auto text-xs">{item.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {index.contacts.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="People">
                  {index.contacts.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`person-${item.id} ${item.label} ${item.sub}`}
                      onSelect={() => go(`/crm/contacts/${item.id}`)}
                    >
                      <UsersIcon />
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-auto text-xs">{item.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {index.roles.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Roles">
                  {index.roles.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`role-${item.id} ${item.label} ${item.sub}`}
                      onSelect={() => go(`/me/${item.id}`)}
                    >
                      <BriefcaseIcon />
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-auto text-xs">{item.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {index.resumes.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Resumes">
                  {index.resumes.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`cv-${item.id} ${item.label} ${item.sub}`}
                      onSelect={() => go(`/resumes/${item.id}`)}
                    >
                      <FileTextIcon />
                      <span>{item.label}</span>
                      <span className="text-muted-foreground ml-auto text-xs">{item.sub}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
