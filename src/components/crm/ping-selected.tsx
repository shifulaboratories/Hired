"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClockIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scheduleContactPingsAction } from "@/server/actions";
import { DateField } from "@/components/ui/date-field";

/**
 * One ping date across a selection — "chase everyone I met at the conference
 * in two weeks".
 *
 * Only on the contacts list. A company has nothing to chase, and putting a
 * disabled control on both screens for symmetry would be worse than an
 * asymmetric bar that only offers what each list can do.
 */
export function PingSelected({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [pending, startTransition] = useTransition();

  const save = (value: string) =>
    startTransition(async () => {
      try {
        const result = await scheduleContactPingsAction(ids, value);
        toast.success(
          result.cleared
            ? `${result.changed} taken off the chase list`
            : `${result.changed} on the chase list`,
        );
        setOpen(false);
        onDone();
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not schedule that.");
      }
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <CalendarClockIcon /> Ping
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-2 p-3">
        <p className="text-[12.5px]">Chase all {ids.length} of them on</p>
        <DateField
          value={date}
          onChange={setDate}
          ariaLabel="When to ping them"
          placeholder="Pick a day"
          clearable={false}
        />
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" disabled={pending || !date} onClick={() => save(date)}>
            Schedule
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() => save("")}
            title="Take all of them off the chase list"
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
