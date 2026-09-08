"use client";

import Link from "next/link";
import { BellIcon, CalendarClockIcon, CircleUserRoundIcon, ListChecksIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Everything that has come round, in the chrome.
 *
 * This used to be a card on the dashboard called "Needs you now", which meant
 * you only saw what was owed if you happened to be on that page. A bell in the
 * top bar is on every page, which is the whole point of a thing that is trying
 * to interrupt you.
 *
 * One count, three groups. The count is a single number because two numbers in
 * the chrome make you do arithmetic; the groups stay apart inside because
 * chasing a company, pinging a person and ticking a task are three different
 * actions and a flat list of look-alike rows hides which is which.
 *
 * Nothing here is dismissable, and that is deliberate: an item leaves this list
 * by being dealt with — logging the follow-up, moving the ping, ticking the
 * task — not by being swiped away. A dismissable notification would let the
 * bell go quiet while the work stayed undone.
 */
export type Notice = {
  kind: "APPLICATION" | "CONTACT" | "TASK";
  id: string;
  title: string;
  detail: string;
  due: string;
  overdue: boolean;
};

const GROUPS = [
  {
    key: "APPLICATION" as const,
    label: "Follow up",
    icon: CalendarClockIcon,
    href: (id: string) => `/applications/${id}`,
  },
  {
    key: "CONTACT" as const,
    label: "Ping",
    icon: CircleUserRoundIcon,
    href: (id: string) => `/crm/contacts/${id}`,
  },
  { key: "TASK" as const, label: "Due", icon: ListChecksIcon, href: () => "/" },
];

export function Notifications({ items }: { items: Notice[] }) {
  const overdue = items.filter((item) => item.overdue).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative size-9"
          aria-label={
            items.length === 0
              ? "Nothing due"
              : `${items.length} thing${items.length === 1 ? "" : "s"} due`
          }
        >
          <BellIcon />
          {items.length > 0 && (
            // The number, not just a dot: "3" and "18" are different days.
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                overdue > 0
                  ? "bg-destructive text-white"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {items.length > 99 ? "99+" : items.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-baseline justify-between border-b px-3.5 py-2.5">
          <span className="text-[13px] font-medium">Needs you now</span>
          {overdue > 0 && (
            <span className="text-destructive text-[11.5px] font-medium tabular-nums">
              {overdue} overdue
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <p className="text-muted-foreground px-3.5 py-8 text-center text-[13px]">
            Nothing has come round. Dates you set on applications, people and tasks show up here
            when they arrive.
          </p>
        ) : (
          <div className="max-h-[26rem] overflow-y-auto py-1">
            {GROUPS.map((group) => {
              const rows = items.filter((item) => item.kind === group.key);
              if (rows.length === 0) return null;
              return (
                <div key={group.key} className="py-1">
                  <div className="text-faint meta flex items-center gap-1.5 px-3.5 pt-1 pb-1.5 text-[10.5px] font-medium uppercase">
                    <group.icon className="size-3" />
                    {group.label}
                    <span className="tabular-nums">{rows.length}</span>
                  </div>
                  {rows.map((row) => (
                    <Link
                      key={`${row.kind}-${row.id}`}
                      href={group.href(row.id)}
                      className="hover:bg-accent flex items-baseline gap-2 px-3.5 py-1.5 transition-colors"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{row.title}</span>
                        {row.detail && (
                          <span className="text-muted-foreground block truncate text-[11.5px]">
                            {row.detail}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "meta shrink-0 text-[11px] tabular-nums",
                          row.overdue ? "text-destructive" : "text-faint",
                        )}
                      >
                        {row.due}
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
