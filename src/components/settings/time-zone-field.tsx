"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ClockIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { setTimeZoneAction } from "@/server/actions";

/**
 * Every zone this browser knows, or a short useful list where it does not.
 *
 * `Intl.supportedValuesOf` has been in every current browser for years but is
 * still the newest thing this app leans on, so the fallback is a handful of
 * zones rather than an empty list — somebody on an old browser can still pick
 * the right continent.
 */
function everyZone(): string[] {
  const supported = (
    Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  const zones = supported ? supported("timeZone") : [];
  if (zones.length) return zones;
  return [
    "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
    "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Moscow",
    "Africa/Lagos", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata",
    "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney",
    "Pacific/Auckland", "UTC",
  ];
}

/** "2:15 PM" where it is now, so the right row is recognisable at a glance. */
function clockAt(zone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return "";
  }
}

/**
 * Which calendar this person's dates are read against.
 *
 * Almost nobody should ever have to open this: the browser fills the zone in
 * the first time they load the app, and it is right. It exists for the case
 * the browser cannot know about — searching for work in a city you are not
 * sitting in — and for putting the answer somewhere a person can check when a
 * date looks wrong.
 */
export function TimeZoneField({ zone }: { zone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const zones = useMemo(everyZone, []);
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const current = zone || device;

  const choose = (next: string) => {
    setOpen(false);
    if (next === zone) return;
    startTransition(async () => {
      try {
        await setTimeZoneAction(next);
        toast.success(`Dates now read in ${next.replace(/_/g, " ")}.`);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That zone was not recognised.");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">Your time zone</div>
        <p className="text-muted-foreground text-[12.5px]">
          What counts as today, when a follow-up is overdue, and the 9am a new one is set
          for. {clockAt(current) ? `It is ${clockAt(current)} there now.` : ""}
        </p>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending} className="max-w-full">
            {pending ? <LoaderCircleIcon className="animate-spin" /> : <ClockIcon />}
            <span className="truncate">{current.replace(/_/g, " ")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search cities and zones…" />
            <CommandList>
              <CommandEmpty>No zone by that name.</CommandEmpty>
              <CommandGroup>
                {device && (
                  <CommandItem value={`this device ${device}`} onSelect={() => choose(device)}>
                    <CheckIcon
                      className={cn("size-3.5", current === device ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">Match this device</span>
                    <span className="text-faint ml-auto shrink-0 text-[11.5px]">
                      {device.replace(/_/g, " ")}
                    </span>
                  </CommandItem>
                )}
                {zones.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => choose(option)}>
                    <CheckIcon
                      className={cn("size-3.5", current === option ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{option.replace(/_/g, " ")}</span>
                    <span className="text-faint ml-auto shrink-0 text-[11.5px]">
                      {clockAt(option)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
