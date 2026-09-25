"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowUpIcon,
  CheckIcon,
  CircleAlertIcon,
  HistoryIcon,
  Loader2Icon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  assistantThreadAction,
  assistantThreadsAction,
  deleteAssistantThreadAction,
} from "@/server/actions";

/**
 * The assistant, in a drawer beside the work.
 *
 * Deliberately not a screen. It is the same conversation somebody would have in
 * Claude Desktop, and putting it on a route would make it a place you go
 * instead of a thing you ask while looking at something — which is the whole
 * reason it exists for people who have not connected a client.
 *
 * It renders NOTHING when no key is configured: not a disabled button, not a
 * "coming soon". An instance whose people connect their own client should look
 * exactly as it did before this feature landed.
 *
 * Everything below is presentation. The tool loop is in src/lib/assistant/run.ts
 * and every act goes through the same dispatchTool an MCP client's calls do, so
 * there is no capability here that a conversation elsewhere does not have.
 */

type Turn =
  | { kind: "you"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; title: string; status: "running" | "done" | "error"; detail?: string }
  | { kind: "error"; text: string };

type Pending = { toolUseId: string; title: string; args: unknown } | null;

type ThreadRow = { id: string; title: string; messages: number };

/** A stored block, as it comes back out of the database. */
type Block = { type?: string; text?: string; name?: string; id?: string; input?: unknown };

export function AssistantDrawer({
  open,
  onOpenChange,
  seed = null,
  onSeedTaken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A request handed over by a button elsewhere, put in the box unsent. */
  seed?: string | null;
  onSeedTaken?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  // Put in the box rather than sent: they see exactly what is being asked
  // and can add to it — "mine this role, and skip the 2022 project".
  useEffect(() => {
    if (!open || !seed) return;
    setDraft(seed);
    onSeedTaken?.();
  }, [open, seed, onSeedTaken]);

  useEffect(() => {
    if (!open) return;
    boxRef.current?.focus();
    void assistantThreadsAction().then(setThreads).catch(() => {});
  }, [open]);

  // Following the stream, unless they have scrolled up to read something.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, pending]);

  const send = useCallback(
    async (body: Record<string, unknown>, echo?: string) => {
      setBusy(true);
      setPending(null);
      if (echo) setTurns((old) => [...old, { kind: "you", text: echo }]);

      let response: Response;
      try {
        response = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, page: pathname, ...body }),
        });
      } catch {
        setTurns((old) => [...old, { kind: "error", text: "Could not reach the server." }]);
        setBusy(false);
        return;
      }

      // The three refusals come back as JSON rather than as a stream, because
      // they are about the request rather than about the conversation.
      if (!response.ok || !response.body) {
        const message = await response
          .json()
          .then((payload: { error?: string }) => payload.error)
          .catch(() => null);
        setTurns((old) => [...old, { kind: "error", text: message ?? "Something went wrong." }]);
        setBusy(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let refresh = false;

      const apply = (event: Record<string, unknown>) => {
        if (event.type === "thread") {
          setThreadId(String(event.threadId));
          void assistantThreadsAction().then(setThreads).catch(() => {});
          return;
        }
        if (event.type === "text") {
          const delta = String(event.delta ?? "");
          setTurns((old) => {
            const last = old[old.length - 1];
            if (last?.kind === "assistant") {
              return [...old.slice(0, -1), { kind: "assistant", text: last.text + delta }];
            }
            return [...old, { kind: "assistant", text: delta }];
          });
          return;
        }
        if (event.type === "tool") {
          // A tool that wrote something means the page behind the drawer is
          // now stale. Noted here and refreshed once at the end rather than
          // on every call, which would fight the stream for the main thread.
          refresh = true;
          setTurns((old) => [
            ...old,
            {
              kind: "tool",
              title: String(event.title ?? event.name ?? "Tool"),
              status: event.status as "running" | "done" | "error",
              detail: event.detail ? String(event.detail) : undefined,
            },
          ]);
          return;
        }
        if (event.type === "confirm") {
          setPending({
            toolUseId: String(event.toolUseId),
            title: String(event.title ?? event.name ?? "This action"),
            args: event.args,
          });
          return;
        }
        if (event.type === "error") {
          setTurns((old) => [...old, { kind: "error", text: String(event.message ?? "") }]);
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((part) => part.startsWith("data: "));
          if (!line) continue;
          try {
            apply(JSON.parse(line.slice(6)) as Record<string, unknown>);
          } catch {
            // A half-written frame is not worth a visible error.
          }
        }
      }

      setBusy(false);
      if (refresh) router.refresh();
    },
    [pathname, router, threadId],
  );

  const submit = () => {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft("");
    void send({ message }, message);
  };

  const openThread = async (id: string) => {
    const thread = await assistantThreadAction(id);
    if (!thread) return;
    setThreadId(thread.id);
    setTurns(replay(thread.messages));
    // A thread can have been left mid-question. Reopening it puts the question
    // back rather than silently dropping it — the run settles it either way,
    // but somebody who closed the drawer to think about it should find it
    // where they left it.
    setPending(unanswered(thread.messages));
  };

  const startNew = () => {
    setThreadId(null);
    setTurns([]);
    setPending(null);
    boxRef.current?.focus();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-[34rem]" showClose={false}>
        <div className="flex items-center gap-1 border-b px-4 py-3">
          <SparklesIcon className="text-muted-foreground size-4" />
          <SheetTitle className="text-sm font-semibold">Assistant</SheetTitle>
          <SheetDescription className="sr-only">
            Ask this app about your search. It uses the same tools an assistant connected over MCP
            would.
          </SheetDescription>
          <div className="ml-auto flex items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Earlier conversations">
                  <HistoryIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Earlier</DropdownMenuLabel>
                {threads.length === 0 && (
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">Nothing yet.</div>
                )}
                {threads.map((thread) => (
                  <DropdownMenuItem
                    key={thread.id}
                    className="group gap-2"
                    onSelect={() => void openThread(thread.id)}
                  >
                    <span className="truncate">{thread.title}</span>
                    <button
                      type="button"
                      aria-label={`Delete ${thread.title}`}
                      className="text-muted-foreground hover:text-destructive ml-auto opacity-0 group-hover:opacity-100"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void deleteAssistantThreadAction(thread.id).then(() => {
                          setThreads((old) => old.filter((row) => row.id !== thread.id));
                          if (threadId === thread.id) startNew();
                          toast.success("Conversation deleted.");
                        });
                      }}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon-sm" onClick={startNew} aria-label="New conversation">
              <PlusIcon />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[13.5px]">
          {turns.length === 0 && !busy && (
            <div className="text-muted-foreground space-y-3 py-6 text-sm">
              <p>
                Ask about your search. It reads and writes the same things an assistant connected
                over MCP does — so &ldquo;what has gone quiet&rdquo;, &ldquo;file what I did this
                week&rdquo; and &ldquo;tailor my resume to this posting&rdquo; all work.
              </p>
              <p className="text-xs">
                Connecting your own Claude from Settings is usually better, and costs this instance
                nothing.
              </p>
            </div>
          )}

          {turns.map((turn, index) => (
            <TurnRow key={index} turn={turn} />
          ))}

          {pending && (
            <div className="border-warning/40 bg-warning-tint space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{pending.title}</p>
              <p className="text-muted-foreground text-xs">
                This cannot be undone. Nothing has run yet.
              </p>
              <pre className="bg-inset text-muted-foreground max-h-32 overflow-auto rounded p-2 text-[11px] leading-relaxed">
                {JSON.stringify(pending.args, null, 2)}
              </pre>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void send({ approve: { toolUseId: pending.toolUseId } })}
                >
                  <CheckIcon /> Do it
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void send({ approve: { toolUseId: pending.toolUseId, decline: true } })
                  }
                >
                  Leave it
                </Button>
              </div>
            </div>
          )}

          {busy && !pending && (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2Icon className="size-3.5 animate-spin" /> Thinking
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t p-3">
          <div className="relative">
            <Textarea
              ref={boxRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder="Ask about your search…"
              className="resize-none pr-11"
            />
            <Button
              size="icon-sm"
              className="absolute right-2 bottom-2"
              disabled={busy || !draft.trim()}
              onClick={submit}
              aria-label="Send"
            >
              <ArrowUpIcon />
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.kind === "you") {
    return (
      <div className="bg-inset ml-8 rounded-lg px-3 py-2 whitespace-pre-wrap">{turn.text}</div>
    );
  }
  if (turn.kind === "assistant") {
    return <div className="whitespace-pre-wrap">{turn.text}</div>;
  }
  if (turn.kind === "error") {
    return (
      <div className="text-destructive flex items-start gap-2 text-xs">
        <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>{turn.text}</span>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "text-muted-foreground flex items-center gap-2 text-xs",
        turn.status === "error" && "text-destructive",
      )}
    >
      <WrenchIcon className="size-3.5 shrink-0" />
      <span>{turn.title}</span>
      {turn.detail && <span className="truncate">— {turn.detail}</span>}
    </div>
  );
}

/**
 * The irreversible act a stored thread is still waiting on, if any.
 *
 * The last message being the assistant's means nothing answered it. Only the
 * first gated call is offered, which is the same rule the run follows: one
 * click approves one thing.
 */
function unanswered(messages: { role: string; content: unknown[] }[]): Pending {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return null;
  for (const block of (last.content ?? []) as Block[]) {
    if (block.type === "tool_use" && block.id && block.name) {
      return { toolUseId: block.id, title: block.name, args: block.input ?? {} };
    }
  }
  return null;
}

/**
 * A stored transcript, as turns.
 *
 * Only what a person said and what came back. Tool results are stored under the
 * role "tool" and the loop's own out-of-budget nudge under "system" — both of
 * them go to the model as user messages, and showing somebody the JSON their
 * own question produced is noise. The tool line above already says what ran.
 */
function replay(messages: { role: string; content: unknown[] }[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const blocks = (message.content ?? []) as Block[];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        turns.push({ kind: message.role === "assistant" ? "assistant" : "you", text: block.text });
      }
      if (block.type === "tool_use" && block.name) {
        turns.push({ kind: "tool", title: block.name, status: "done" });
      }
    }
  }
  return turns;
}
