"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  CalendarIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  MailIcon,
  RefreshCwIcon,
  VideoIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { correspondenceAction, emailThreadAction } from "@/server/actions";
import type { CorrespondenceSubject } from "@/lib/data/accounts";
import { agoDay, cn } from "@/lib/utils";

/**
 * The threads and meetings in somebody's own mail and calendar accounts that
 * touch one record — a contact, a company, an application, a resume.
 *
 * Fetched after the page paints, never during it: this is a round trip to
 * Google, and a contact page should not wait on Gmail to show a phone
 * number. Nothing shown here is stored on the instance, which is why there
 * is a refresh button and no "last synced" — every open is live.
 */

type Loaded = Extract<Awaited<ReturnType<typeof correspondenceAction>>, { ok: true }>["correspondence"];
type ThreadMessages = Extract<Awaited<ReturnType<typeof emailThreadAction>>, { ok: true }>["thread"]["messages"];

type Thread = Loaded["mail"] extends (infer T)[] | null ? T : never;
type Event = Loaded["calendar"] extends (infer T)[] | null ? T : never;

/** What the page already knows about the connection, so this can render the right empty state. */
export type CorrespondenceAccess = { mail: boolean; calendar: boolean } | null;

export function CorrespondenceCard({
  subject,
  access,
  /** Where the card is: inside a Card on a page, or bare inside a sheet. */
  bare = false,
}: {
  subject: CorrespondenceSubject;
  access: CorrespondenceAccess;
  bare?: boolean;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; error: string; notConnected: boolean }
    | { status: "ready"; data: Loaded }
  >({ status: "idle" });
  const [pending, startTransition] = useTransition();

  const load = () => {
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    startTransition(async () => {
      const result = await correspondenceAction(subject);
      if (result.ok) setState({ status: "ready", data: result.correspondence });
      else setState({ status: "error", error: result.error, notConnected: result.notConnected });
    });
  };

  useEffect(() => {
    if (access) load();
    // The subject is the identity of this card; the page remounts it when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.kind, subject.id, access?.mail, access?.calendar]);

  const body = !access ? (
    <NotConnected />
  ) : state.status === "error" ? (
    <p className="text-muted-foreground text-[13px]">
      {state.error}{" "}
      {state.notConnected && (
        <Link href="/settings?tab=connections" className="text-primary underline underline-offset-2">
          Open Settings → Connections
        </Link>
      )}
    </p>
  ) : state.status === "ready" ? (
    <LoadedView data={state.data} access={access} />
  ) : (
    <div className="space-y-2.5">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );

  if (bare) return <div className="space-y-3">{body}</div>;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-[15px]">
          Email &amp; calendar
          {state.status === "ready" && (
            <span className="text-faint nums ml-1.5 font-normal">
              {(state.data.mail?.length ?? 0) + (state.data.calendar?.length ?? 0) || ""}
            </span>
          )}
        </CardTitle>
        {access && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh"
            onClick={load}
            disabled={pending}
          >
            <RefreshCwIcon className={cn(pending && "animate-spin")} />
          </Button>
        )}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function NotConnected() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-[13px]">
        Connect your mail and calendar — Google, Microsoft 365, or any IMAP and CalDAV
        provider — and every thread and meeting with these people shows up here, read live.
        Nothing is copied to this server.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/settings?tab=connections">Connect an account</Link>
      </Button>
    </div>
  );
}

function LoadedView({ data, access }: { data: Loaded; access: NonNullable<CorrespondenceAccess> }) {
  const mailCount = data.mail?.length ?? 0;
  const calendarCount = data.calendar?.length ?? 0;
  const [tab, setTab] = useState<"mail" | "calendar">(
    mailCount === 0 && calendarCount > 0 ? "calendar" : "mail",
  );

  return (
    <div className="space-y-3">
      {data.notes.map((note) => (
        <p key={note} className="text-faint text-[12.5px] leading-snug">
          {note}
        </p>
      ))}
      <Tabs value={tab} onValueChange={(value) => setTab(value as "mail" | "calendar")}>
        <TabsList className="mb-3">
          <TabsTrigger value="mail">
            <MailIcon className="size-3.5" /> Email
            <span className="text-muted-foreground ml-0.5 text-[11px] tabular-nums">{mailCount}</span>
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarIcon className="size-3.5" /> Calendar
            <span className="text-muted-foreground ml-0.5 text-[11px] tabular-nums">
              {calendarCount}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mail">
          {!access.mail ? (
            <Hint>
              None of your connected accounts provides mail.{" "}
              <Link href="/settings?tab=connections" className="text-primary underline underline-offset-2">
                Connections
              </Link>
            </Hint>
          ) : data.mail === null ? (
            <Hint>{data.warnings.find((w) => w.startsWith("Mail:")) ?? "Mail did not answer."}</Hint>
          ) : data.mail.length === 0 ? (
            <Hint>No threads in the last year match.</Hint>
          ) : (
            <ul className="divide-border/60 -mx-1 divide-y">
              {data.mail.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="calendar">
          {!access.calendar ? (
            <Hint>
              None of your connected accounts provides a calendar.{" "}
              <Link href="/settings?tab=connections" className="text-primary underline underline-offset-2">
                Connections
              </Link>
            </Hint>
          ) : data.calendar === null ? (
            <Hint>
              {data.warnings.find((w) => w.startsWith("Calendar:")) ?? "Calendar did not answer."}
            </Hint>
          ) : data.calendar.length === 0 ? (
            <Hint>No meetings with anyone here, past or upcoming.</Hint>
          ) : (
            <ul className="divide-border/60 -mx-1 divide-y">
              {data.calendar.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-2 text-center text-[13px]">{children}</p>;
}

function ThreadRow({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; messages: ThreadMessages }
  >({ status: "idle" });
  const [, startTransition] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && messages.status === "idle") {
      setMessages({ status: "loading" });
      startTransition(async () => {
        const result = await emailThreadAction(thread.id);
        if (result.ok) setMessages({ status: "ready", messages: result.thread.messages });
        else setMessages({ status: "error", error: result.error });
      });
    }
  };

  const who = thread.lastFrom?.name || thread.lastFrom?.email || "";
  return (
    <li className="px-1">
      <button
        type="button"
        onClick={toggle}
        className="hover:bg-accent/50 -mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 rounded-control px-1 py-2 text-left transition-colors duration-150"
      >
        <ChevronDownIcon
          className={cn(
            "text-faint mt-1 size-3.5 shrink-0 transition-transform duration-150",
            !open && "-rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn("truncate text-[13px]", thread.unread ? "font-semibold" : "font-medium")}>
              {thread.subject}
            </span>
            {thread.messageCount > 1 && (
              <span className="text-faint nums shrink-0 text-[11px]">{thread.messageCount}</span>
            )}
            <span className="text-faint meta ml-auto shrink-0 text-[11.5px]">
              {agoDay(thread.lastMessageAt)}
            </span>
          </div>
          <div className="text-muted-foreground truncate text-[12.5px]">
            {who && <span className="text-foreground/80">{who}</span>}
            {who && thread.snippet && " — "}
            {thread.snippet}
          </div>
        </div>
      </button>

      {open && (
        <div className="mb-2 ml-5 space-y-3 border-l pl-3">
          {messages.status === "loading" && (
            <div className="space-y-2 py-1">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          )}
          {messages.status === "error" && (
            <p className="text-muted-foreground text-[12.5px]">{messages.error}</p>
          )}
          {messages.status === "ready" &&
            messages.messages.map((message) => (
              <div key={message.id}>
                <div className="flex items-baseline gap-2 text-[12px]">
                  <span className="font-medium">{message.from?.name || message.from?.email}</span>
                  <span className="text-faint truncate">
                    to {message.to.map((p) => p.name || p.email).join(", ") || "—"}
                  </span>
                  <span className="text-faint meta ml-auto shrink-0 text-[11px]">
                    {new Date(message.date).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-[12.5px] leading-relaxed whitespace-pre-wrap">
                  {message.body || "(no text)"}
                </p>
              </div>
            ))}
          <a
            href={thread.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary inline-flex items-center gap-1 text-[12px] underline underline-offset-2"
          >
            Open in Gmail <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      )}
    </li>
  );
}

function EventRow({ event }: { event: Event }) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const past = end.getTime() < Date.now();
  const when = event.allDay
    ? start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    : `${start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}–${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  const others = event.attendees.filter((attendee) => !attendee.self);

  return (
    <li className={cn("flex items-start gap-2 px-1 py-2", past && "opacity-70")}>
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full"
        style={{ background: past ? "var(--muted-foreground)" : "var(--stage-interview)" }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-medium">{event.title}</span>
          <span className="text-faint meta ml-auto shrink-0 text-[11.5px]">{when}</span>
        </div>
        <div className="text-muted-foreground truncate text-[12.5px]">
          {others.length > 0
            ? others.map((attendee) => attendee.name || attendee.email).join(", ")
            : event.organizer?.name || event.organizer?.email || ""}
          {event.location && <span className="text-faint"> · {event.location}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
          {event.meetingUrl && !past && (
            <a
              href={event.meetingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary inline-flex items-center gap-1 underline underline-offset-2"
            >
              <VideoIcon className="size-3" /> Join
            </a>
          )}
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
            >
              Open in Calendar <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
