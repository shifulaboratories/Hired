"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, FilterIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/**
 * Everything a chip row cannot hold, on any screen.
 *
 * Two levels, not one list. The first version stacked every group in one
 * scroller, which is fine at three dimensions and unusable at seven: a person
 * looking for a location scrolled past forty companies to find it, and the
 * dimensions themselves — the thing you actually pick first — were invisible
 * headings between walls of rows. So the menu opens on the dimensions, each
 * saying how many of its values are on, and you step into one.
 *
 * Search still spans everything. Typing filters across all values in all
 * dimensions at once and shows which dimension each match came from, because
 * "I want the Fintech one and I don't care which list it lives on" is the
 * request that a drill-down would otherwise make worse rather than better.
 *
 * The shell only. Each screen builds its own groups and its own hrefs, so the
 * pipeline's URL grammar and the CRM's stay separate while the popover, the
 * drill-down, the keyboard behaviour and the "Clear these" row are defined once.
 */
export type FacetRow = {
  /**
   * Unique across the whole list. cmdk keys selection on an item's `value`, so
   * two rows sharing one — a tag and a company both called "LinkedIn", which
   * is the likely case here — would both highlight and Enter would fire
   * whichever is first in the DOM.
   */
  id: string;
  label: string;
  /** Where clicking it goes. Built by the caller, in that screen's grammar. */
  href: string;
  on: boolean;
  count?: number;
  /** A resolved CSS colour, so this file never imports the tags module. */
  dot?: string;
};

export type FacetGroup = {
  heading: string;
  rows: FacetRow[];
  /** Draw a rule above this group. Only used in the searching view. */
  separated?: boolean;
};

export function FacetMenu({
  groups,
  activeCount,
  clearHref,
  placeholder,
  note,
  label = "Filter",
  ariaLabel,
}: {
  groups: FacetGroup[];
  activeCount: number;
  clearHref: string;
  placeholder: string;
  /** Shown above the groups when the current view cannot honour all of them. */
  note?: string;
  label?: string;
  ariaLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [inside, setInside] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Rows navigate through the router rather than being anchors: cmdk's
  // CommandItem has no `asChild`, so a Link inside one is not a thing that can
  // exist.
  const go = (href: string) => startTransition(() => router.push(href));

  // Reopening lands on the dimensions rather than wherever the last visit
  // ended. A menu that remembers a drill-down is a menu that opens showing
  // five locations and no way to see that it is not the top level.
  useEffect(() => {
    if (!open) {
      setInside(null);
      setQuery("");
    }
  }, [open]);

  const filled = groups.filter((group) => group.rows.length > 0);
  const current = inside ? (filled.find((group) => group.heading === inside) ?? null) : null;
  const searching = query.trim().length > 0;

  // Backspace on an empty box steps out, the way a path-shaped menu should.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Backspace" && query === "" && current) {
      event.preventDefault();
      setInside(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={activeCount > 0 ? "default" : "outline"}
          size="sm"
          className="shrink-0"
          aria-label={ariaLabel}
          aria-busy={pending}
        >
          <FilterIcon />
          {label}
          {activeCount > 0 && <span className="nums ml-0.5">{activeCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {/* shouldFilter off: the rows shown are already the ones that match,
            because search deliberately reaches across every dimension rather
            than only the one being looked at. */}
        <Command loop shouldFilter={false}>
          <CommandInput
            placeholder={current && !searching ? `Search ${current.heading.toLowerCase()}…` : placeholder}
            className="h-9"
            value={query}
            onValueChange={setQuery}
            onKeyDown={onKeyDown}
          />
          <CommandList className="max-h-[22rem]">
            {note && (
              <p className="text-muted-foreground border-b px-3 py-2 text-[12px]">{note}</p>
            )}

            {searching ? (
              <SearchResults groups={filled} query={query} onPick={go} />
            ) : current ? (
              <>
                <CommandGroup>
                  <CommandItem
                    value="back to all filters"
                    onSelect={() => setInside(null)}
                    className="text-muted-foreground px-2 py-1.5"
                  >
                    <ChevronLeftIcon className="size-3.5" />
                    All filters
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading={current.heading}>
                  {current.rows.map((row) => (
                    <ValueRow key={row.id} row={row} onPick={go} />
                  ))}
                </CommandGroup>
              </>
            ) : (
              <CommandGroup>
                {filled.map((group) => {
                  const on = group.rows.filter((row) => row.on).length;
                  return (
                    <CommandItem
                      key={group.heading}
                      value={group.heading}
                      onSelect={() => setInside(group.heading)}
                      className="px-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate">{group.heading}</span>
                      {on > 0 && (
                        <span className="bg-primary text-primary-foreground nums rounded-full px-1.5 text-[10.5px] leading-4">
                          {on}
                        </span>
                      )}
                      <ChevronRightIcon className="text-faint size-3.5" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {activeCount > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="clear these filters"
                    onSelect={() => go(clearHref)}
                    className="px-2 py-1.5"
                  >
                    <XIcon className="size-3.5" />
                    Clear these
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

/**
 * Every dimension at once, for a search.
 *
 * The heading is kept on each group rather than flattened, because two
 * dimensions can hold the same word — a company called Remote and a location
 * called Remote — and a flat list of matches would offer the same row twice
 * with no way to tell which is which.
 */
function SearchResults({
  groups,
  query,
  onPick,
}: {
  groups: FacetGroup[];
  query: string;
  onPick: (href: string) => void;
}) {
  const needle = query.trim().toLowerCase();
  const hits = groups
    .map((group) => ({
      heading: group.heading,
      rows: group.rows.filter((row) => row.label.toLowerCase().includes(needle)),
    }))
    .filter((group) => group.rows.length > 0);

  // An explicit message rather than CommandEmpty: with shouldFilter off, cmdk
  // counts every rendered item, and the "Clear these" row below is one — so a
  // search matching nothing would quietly show a menu with one unrelated row
  // in it and no explanation.
  if (hits.length === 0) {
    return <p className="text-muted-foreground px-3 py-6 text-center text-[13px]">Nothing matches.</p>;
  }

  return (
    <>
      {hits.map((group, index) => (
        <div key={group.heading}>
          {index > 0 && <CommandSeparator />}
          <CommandGroup heading={group.heading}>
            {group.rows.map((row) => (
              <ValueRow key={row.id} row={row} onPick={onPick} />
            ))}
          </CommandGroup>
        </div>
      ))}
    </>
  );
}

function ValueRow({ row, onPick }: { row: FacetRow; onPick: (href: string) => void }) {
  return (
    <CommandItem
      value={`${row.label} ${row.id}`}
      onSelect={() => onPick(row.href)}
      className="px-2 py-1.5"
    >
      <span
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
          row.on && "bg-primary border-primary text-primary-foreground",
        )}
      >
        {row.on && <span className="text-[9px] leading-none">✓</span>}
      </span>
      {row.dot && (
        <span className="size-2 shrink-0 rounded-full" style={{ background: row.dot }} />
      )}
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {row.count !== undefined && (
        <span className="text-faint nums text-[11px]">{row.count}</span>
      )}
    </CommandItem>
  );
}
