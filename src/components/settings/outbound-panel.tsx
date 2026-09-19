"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { setOutboundSettingsAction } from "@/server/actions";

/**
 * The switch that lets one message leave, and the number that is the same
 * switch.
 *
 * There is deliberately no state where sending is on and the cap is undefined:
 * zero means off, and any other number is both the permission and the ceiling.
 * Nobody but the person themselves can set it — no admin, and no MCP tool.
 */
export type OutboundPanelProps = {
  instanceEnabled: boolean;
  dailyLimit: number;
  approval: "each" | "trusted";
  accounts: number;
  sentToday: number;
};

const DEFAULT_LIMIT = 5;

export function OutboundPanel({ initial }: { initial: OutboundPanelProps }) {
  const [limit, setLimit] = useState(initial.dailyLimit);
  const [approval, setApproval] = useState(initial.approval);
  const [pending, startTransition] = useTransition();

  const save = (patch: { dailyLimit?: number; approval?: "each" | "trusted" }) =>
    startTransition(async () => {
      try {
        await setOutboundSettingsAction(patch);
      } catch (error) {
        setLimit(initial.dailyLimit);
        setApproval(initial.approval);
        toast.error(error instanceof Error ? error.message : "Could not save that.");
      }
    });

  const inert = !initial.instanceEnabled || initial.accounts === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="outbound-on" className="text-[13.5px] font-medium">
            Let this app send from your mailbox
          </Label>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            Off. On, an assistant can draft a follow-up and it goes out{" "}
            <strong>from your own account</strong>, so it arrives from you and lands in your
            Sent folder — this app never sends as itself on your behalf. It can only write to
            somebody already on your pipeline: there is no way to give it an address.
          </p>
          {!initial.instanceEnabled && (
            <p className="text-faint mt-1 text-[12px]">
              Whoever runs this instance has not allowed it. Admin → Configuration → Email.
            </p>
          )}
          {initial.instanceEnabled && initial.accounts === 0 && (
            <p className="text-faint mt-1 text-[12px]">
              No mailbox here can send. Reconnect a Google or Microsoft account and grant the
              send permission — an IMAP account cannot send at all.
            </p>
          )}
        </div>
        <Switch
          id="outbound-on"
          checked={limit > 0}
          disabled={inert || pending}
          onCheckedChange={(next) => {
            const value = next ? DEFAULT_LIMIT : 0;
            setLimit(value);
            save({ dailyLimit: value });
          }}
        />
      </div>

      {limit > 0 && (
        <div className="space-y-3 border-l-2 pl-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="outbound-limit" className="text-[13px]">
              At most
            </Label>
            <Input
              id="outbound-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              disabled={pending}
              className="h-8 w-20"
              onChange={(event) => setLimit(Number(event.target.value))}
              onBlur={() => save({ dailyLimit: limit })}
            />
            <span className="text-muted-foreground text-[13px]">
              a day{initial.sentToday > 0 ? ` · ${initial.sentToday} sent today` : ""}
            </span>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="outbound-trusted" className="text-[13px] font-medium">
                Send without asking me each time
              </Label>
              <p className="text-muted-foreground mt-0.5 text-[13px]">
                Off, every message waits on your dashboard for you to press Send, and{" "}
                <strong>no assistant can make that click</strong>. On, a connected assistant
                can send within the number above without one. That is a real thing to hand
                over: it can then put a message in somebody else&apos;s inbox, in your name,
                without you seeing it first.
              </p>
            </div>
            <Switch
              id="outbound-trusted"
              checked={approval === "trusted"}
              disabled={pending}
              onCheckedChange={(next) => {
                const value = next ? "trusted" : "each";
                setApproval(value);
                save({ approval: value });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
