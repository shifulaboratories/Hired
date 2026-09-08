"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Sorting, as a control rather than only a column heading.
 *
 * The headings still sort — clicking "Salary" is the fastest way when you can
 * see it. The problem is that you often cannot: every one of these tables hides
 * columns below `md`, so on a phone half the sort keys had no heading to click
 * and were simply unreachable. This lists all of them, on every width, and says
 * which way the current one is pointing.
 *
 * Each row carries both directions. One click sets a key ascending, clicking
 * the key you are already on flips it — the same behaviour as the heading, so
 * the two controls cannot disagree.
 */
export type SortOption = {
  key: string;
  label: string;
  /** Where clicking it goes. Built by the caller, in that screen's grammar. */
  href: string;
  /** Where the opposite direction goes, for the two arrows on the active row. */
  ascHref: string;
  descHref: string;
};

export function SortMenu({
  options,
  active,
  desc,
  ariaLabel,
}: {
  options: SortOption[];
  active: string;
  desc: boolean;
  ariaLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (href: string) => startTransition(() => router.push(href));
  const current = options.find((option) => option.key === active);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0" aria-label={ariaLabel} aria-busy={pending}>
          <ArrowUpDownIcon />
          {/* The key, not the word "Sort": a control that says what it is doing
              beats one that says what it is for. */}
          <span className="hidden sm:inline">{current?.label ?? "Sort"}</span>
          {desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command loop>
          <CommandList>
            <CommandGroup heading="Sort by">
              {options.map((option) => {
                const on = option.key === active;
                return (
                  <CommandItem
                    key={option.key}
                    value={option.label}
                    onSelect={() => go(option.href)}
                    className="px-2 py-1.5"
                  >
                    <span className={cn("min-w-0 flex-1 truncate", on && "font-medium")}>
                      {option.label}
                    </span>
                    {on &&
                      (desc ? (
                        <ArrowDownIcon className="size-3.5" />
                      ) : (
                        <ArrowUpIcon className="size-3.5" />
                      ))}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {current && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Direction">
                  <CommandItem
                    value="ascending"
                    onSelect={() => go(current.ascHref)}
                    className="px-2 py-1.5"
                  >
                    <ArrowUpIcon className="size-3.5" />
                    <span className={cn("flex-1", !desc && "font-medium")}>Ascending</span>
                  </CommandItem>
                  <CommandItem
                    value="descending"
                    onSelect={() => go(current.descHref)}
                    className="px-2 py-1.5"
                  >
                    <ArrowDownIcon className="size-3.5" />
                    <span className={cn("flex-1", desc && "font-medium")}>Descending</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
