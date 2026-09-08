"use client";

import { useState } from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
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
 * A free-text field that offers what you have already used.
 *
 * Not a select and not a tag. Location and work mode have to stay free text —
 * "Remote (US, PST overlap)" is a real answer and no enum survives it — but
 * free text with no memory is how one workspace ends up holding "Remote",
 * "remote" and "Remote " as three values that never group together. So the box
 * lists what is already on your applications, most-used first, and typing
 * something new is still just typing: the last row creates it and says so.
 *
 * Clearing is a first-class act rather than selecting all and pressing delete,
 * because "this one is not remote after all" is a thing that happens and an
 * empty string is the honest way to say it.
 */
export function ValuePicker({
  value,
  options,
  onChange,
  placeholder = "Anything",
  ariaLabel,
}: {
  value: string;
  /** What is already in use, with how many applications carry it. */
  options: { value: string; count: number }[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const typed = query.trim();
  const matches = options.filter((option) =>
    option.value.toLowerCase().includes(typed.toLowerCase()),
  );
  // Only when it is genuinely new. Offering to create "Remote" while "Remote"
  // is the row above it is a menu arguing with itself.
  const isNew =
    typed.length > 0 && !options.some((option) => option.value.toLowerCase() === typed.toLowerCase());

  const commit = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            className={cn(
              "h-9 min-w-0 flex-1 justify-between px-3 font-normal",
              !value && "text-muted-foreground",
            )}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronDownIcon className="text-faint size-3.5 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-0">
          <Command shouldFilter={false} loop>
            <CommandInput
              placeholder="Type or pick…"
              className="h-9"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                // Enter on a box with no highlighted row still means "use what
                // I typed" — otherwise a new value needs a mouse.
                if (event.key === "Enter" && isNew && matches.length === 0) {
                  event.preventDefault();
                  commit(typed);
                }
              }}
            />
            <CommandList className="max-h-64">
              {matches.length === 0 && !isNew && (
                <p className="text-muted-foreground px-3 py-6 text-center text-[13px]">
                  Nothing used yet. Type one.
                </p>
              )}
              {matches.length > 0 && (
                <CommandGroup>
                  {matches.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => commit(option.value)}
                      className="px-2 py-1.5"
                    >
                      <CheckIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          option.value === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{option.value}</span>
                      <span className="text-faint nums text-[11px]">{option.count}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {isNew && (
                <>
                  {matches.length > 0 && <CommandSeparator />}
                  <CommandGroup>
                    <CommandItem
                      value={`__create__${typed}`}
                      onSelect={() => commit(typed)}
                      className="px-2 py-1.5"
                    >
                      <span className="text-muted-foreground truncate">
                        Use “{typed}”
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-faint hover:text-destructive shrink-0"
          aria-label={`Clear ${ariaLabel.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
