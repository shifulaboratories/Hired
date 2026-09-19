"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SendIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  approveOutboundAction,
  cancelOutboundAction,
  sendOutboundAction,
} from "@/server/actions";

/**
 * The outbox, and the click no tool can make.
 *
 * This is the whole reason "approve each one" means anything: `approveOutbound`
 * is reachable from a server action and from nowhere else, so a connected
 * assistant can write a message and cannot put it in front of anybody. The
 * button below is that gate, and it draws nothing on a day with no drafts —
 * which is most days.
 *
 * Approving and sending are one click on purpose. Two clicks for "yes I meant
 * it" is the shape people learn to double-tap through, and the confirmation
 * that matters is reading the message, which is printed right here.
 */
export type OutboxRow = {
  id: string;
  subject: string;
  body: string;
  toEmail: string;
  contactName: string;
  fromEmail: string;
  application: string;
  status: string;
  error: string;
};

export function Outbox({ rows, blockedBecause }: { rows: OutboxRow[]; blockedBecause: string }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const act = (id: string, what: "send" | "cancel") =>
    startTransition(async () => {
      try {
        if (what === "cancel") {
          await cancelOutboundAction(id);
          toast.success("Called off");
          return;
        }
        // Approve and send in one move: the person has read it, which is the
        // confirmation that matters.
        await approveOutboundAction(id).catch(() => undefined);
        const result = await sendOutboundAction(id);
        if (result.sent) toast.success("Sent from your mailbox");
        else toast.error(result.reason);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not do that.");
      }
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px]">
          Waiting to go
          <span className="text-muted-foreground ml-1.5 text-[13px] font-normal">
            {rows.length === 1 ? "1 message" : `${rows.length} messages`}
          </span>
        </CardTitle>
        <p className="text-muted-foreground text-[13px]">
          Written for you, and not sent. Nothing leaves until you press Send here — an
          assistant cannot make this click, which is what makes it worth having.
        </p>
        {blockedBecause && <p className="text-faint text-[12px]">{blockedBecause}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border px-3 py-2.5">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => setOpen(open === row.id ? null : row.id)}
            >
              <div className="text-[13.5px] font-medium">{row.subject}</div>
              <div className="text-muted-foreground text-[12.5px]">
                To {row.contactName} ({row.toEmail}) from {row.fromEmail}
                {row.application ? ` · ${row.application}` : ""}
              </div>
            </button>
            {open === row.id && (
              <pre className="text-muted-foreground mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-[12.5px]">
                {row.body}
              </pre>
            )}
            {row.error && <p className="text-destructive mt-1 text-[12px]">{row.error}</p>}
            <div className="mt-2 flex items-center gap-1.5">
              <Button size="xs" disabled={pending} onClick={() => act(row.id, "send")}>
                <SendIcon className="size-3" /> Send it
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                disabled={pending}
                onClick={() => act(row.id, "cancel")}
              >
                <XIcon className="size-3" /> Call it off
              </Button>
              {open !== row.id && (
                <button
                  type="button"
                  className="text-faint hover:text-foreground ml-1 text-[12px] underline underline-offset-2"
                  onClick={() => setOpen(row.id)}
                >
                  Read it first
                </button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
