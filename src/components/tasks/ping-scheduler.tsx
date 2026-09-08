"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { scheduleContactPingAction } from "@/server/actions";
import { DateField } from "@/components/ui/date-field";

export type PingCandidate = { id: string; name: string; detail: string };

/**
 * Put someone on the chase list.
 *
 * This used to be a date box on the contact record, which is the wrong place
 * twice over: you were reading about a person, not planning your week, and
 * scheduling anything meant remembering who to open first. Here the question
 * is the other way round — who am I chasing, and when — which is the question
 * this page exists to answer.
 */
export function PingScheduler({ contacts }: { contacts: PingCandidate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<PingCandidate | null>(null);
  const [date, setDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();

  const schedule = () => {
    if (!person) return;
    startTransition(async () => {
      try {
        await scheduleContactPingAction(person.id, date);
        toast.success(`${person.name} is on the list`);
        setPerson(null);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not schedule that.");
      }
    });
  };

  if (contacts.length === 0) {
    return (
      <p className="text-faint text-[12.5px] leading-snug">
        Nobody on file yet. Add people under CRM and you can line up who to chase from here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 justify-start font-normal"
              aria-label="Who to ping"
            >
              <UserPlusIcon />
              <span className="truncate">{person ? person.name : "Pick someone"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search people…" />
              <CommandList>
                <CommandEmpty>Nobody by that name.</CommandEmpty>
                {contacts.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={`${contact.name} ${contact.detail}`}
                    onSelect={() => {
                      setPerson(contact);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{contact.name}</div>
                      {contact.detail && (
                        <div className="text-faint truncate text-[11.5px]">{contact.detail}</div>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <DateField
          value={date}
          onChange={setDate}
          ariaLabel="When to ping them"
          placeholder="Pick a day"
          className="w-44"
          clearable={false}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={pending || !person}
        onClick={schedule}
      >
        Schedule the ping
      </Button>
    </div>
  );
}
