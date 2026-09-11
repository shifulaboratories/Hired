"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, InboxIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acceptProposalAction,
  dismissAllProposalsAction,
  dismissProposalAction,
} from "@/server/actions";

/**
 * What an assistant thinks should happen, waiting for a yes.
 *
 * The inbox review reads a week of mail and finds six things the pipeline does
 * not know. Answering them in the conversation works only if you are at the
 * conversation; this is the same six on the dashboard, one line each, accepted
 * or dismissed whenever you get to it.
 *
 * Every row shows its evidence — the line from the email that produced it —
 * because the whole question a person is answering is "is that actually true".
 * A proposal you cannot check is a proposal you should not accept, and hiding
 * the quote behind a click would mean most people never read it.
 */
export type ProposalRow = {
  id: string;
  kind: string;
  label: string;
  summary: string;
  evidence: string;
  source: string;
  /** Set when a previous accept failed, so the row says why it is still here. */
  outcome: string;
  application: { id: string; company: string; roleTitle: string } | null;
  contact: { id: string; name: string } | null;
};

export function ReviewQueue({ proposals }: { proposals: ProposalRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  if (proposals.length === 0) return null;

  const act = (id: string, run: () => Promise<unknown>, done?: (result: unknown) => void) => {
    setBusy(id);
    start(async () => {
      try {
        done?.(await run());
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not do that.");
      } finally {
        setBusy(null);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <InboxIcon className="text-muted-foreground size-4" />
          Waiting for a yes
          <span className="text-faint nums text-[11px] font-normal">{proposals.length}</span>
        </CardTitle>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          disabled={busy !== null}
          onClick={() =>
            act("all", dismissAllProposalsAction, (count) =>
              toast.success(`Cleared ${count as number}.`),
            )
          }
        >
          Dismiss all
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {proposals.map((proposal) => (
          <div
            key={proposal.id}
            className="border-border/70 flex items-start gap-3 rounded-md border px-3 py-2.5"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {proposal.label}
                </Badge>
                <span className="text-[13px] font-medium">{proposal.summary}</span>
              </div>

              {proposal.evidence && (
                <p className="text-muted-foreground border-border/70 border-l-2 pl-2 text-xs italic">
                  {proposal.evidence}
                </p>
              )}

              <p className="text-faint text-[11px]">
                {[
                  proposal.application && (
                    <Link
                      key="app"
                      href={`/applications/${proposal.application.id}`}
                      className="hover:underline"
                    >
                      {proposal.application.company} — {proposal.application.roleTitle}
                    </Link>
                  ),
                  proposal.contact && (
                    <Link
                      key="contact"
                      href={`/crm/contacts/${proposal.contact.id}`}
                      className="hover:underline"
                    >
                      {proposal.contact.name}
                    </Link>
                  ),
                  proposal.source ? <span key="src">from {proposal.source}</span> : null,
                ]
                  .filter(Boolean)
                  .map((node, index) => (
                    <span key={index}>
                      {index > 0 && " · "}
                      {node}
                    </span>
                  ))}
              </p>

              {proposal.outcome && (
                <p className="text-[var(--warning)] text-[11px]">
                  Could not do that: {proposal.outcome}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-[var(--success)]"
                disabled={busy !== null}
                aria-label="Do it"
                onClick={() =>
                  act(
                    proposal.id,
                    () => acceptProposalAction(proposal.id),
                    (outcome) => toast.success(String(outcome)),
                  )
                }
              >
                <CheckIcon />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-faint hover:text-destructive"
                disabled={busy !== null}
                aria-label="No"
                onClick={() => act(proposal.id, () => dismissProposalAction(proposal.id))}
              >
                <XIcon />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
