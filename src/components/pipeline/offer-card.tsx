"use client";

import { useState, useTransition } from "react";
import { HandshakeIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Stage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { SaveIndicator } from "@/components/save-indicator";
import { useAutosave } from "@/hooks/use-autosave";
import { useViewerZone } from "@/components/viewer-zone";
import { civilDay, shortCivilDay } from "@/lib/time";
import { cn } from "@/lib/utils";
import { deleteOfferAction, recordOfferAction, updateOfferAction } from "@/server/actions";

/**
 * What they actually offered, on the application it belongs to.
 *
 * Two things on this screen look like the same fact and are not. The Salary
 * field in the rail is what the POSTING advertised — a range somebody else
 * wrote, often a lie. This card is what a named human put on the table. They
 * are never merged, and the advertised range is printed here beside the real
 * number precisely so the gap is visible while you are deciding what to say.
 *
 * Editing the numbers above autosaves, like everything else in this app: that
 * is for fixing a base you typed with a digit missing. A better number is not
 * an edit — "Record a revision" writes a second version and leaves the first
 * one standing, because the distance between the opening offer and the closing
 * one is the only record anybody has that negotiating worked.
 */
export type OfferValue = {
  id: string;
  currency: string;
  baseAmount: number;
  bonusAmount: number;
  equityAmount: number;
  signOnAmount: number;
  terms: string;
  vesting: string;
  receivedAt: string;
  respondBy: string | null;
  startsOn: string | null;
};

type Draft = {
  currency: string;
  baseAmount: string;
  bonusAmount: string;
  equityAmount: string;
  signOnAmount: string;
  terms: string;
  vesting: string;
  respondBy: string;
  startsOn: string;
};

const BLANK: Draft = {
  currency: "USD",
  baseAmount: "",
  bonusAmount: "",
  equityAmount: "",
  signOnAmount: "",
  terms: "",
  vesting: "",
  respondBy: "",
  startsOn: "",
};

function draftOf(offer: OfferValue): Draft {
  const amount = (value: number) => (value === 0 ? "" : String(value));
  return {
    currency: offer.currency,
    baseAmount: amount(offer.baseAmount),
    bonusAmount: amount(offer.bonusAmount),
    equityAmount: amount(offer.equityAmount),
    signOnAmount: amount(offer.signOnAmount),
    terms: offer.terms,
    vesting: offer.vesting,
    respondBy: offer.respondBy ?? "",
    startsOn: offer.startsOn ?? "",
  };
}

/** Whole days to a deadline, negative once it has passed. Null when there is none. */
function daysUntil(value: string): number | null {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
}

/** Whole units, and an empty field means zero rather than a failed parse. */
function toNumber(value: string): number {
  const clean = value.replace(/[^0-9.]/g, "");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function totalOf(draft: Draft) {
  return (
    toNumber(draft.baseAmount) + toNumber(draft.bonusAmount) + toNumber(draft.equityAmount)
  );
}

/**
 * A figure in its own currency, whole units, no decimals.
 *
 * Falls back to the code and the digits when a browser does not know the
 * currency: an unfamiliar code should print "PLN 320,000", never throw a card
 * off the page.
 */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function OfferCard({
  applicationId,
  stage,
  advertised,
  offers,
  onServerChange,
}: {
  applicationId: string;
  stage: Stage;
  /** What the posting claimed, for the line beside the real number. */
  advertised: string;
  /** Every version, newest first. */
  offers: OfferValue[];
  onServerChange?: () => void;
}) {
  const zone = useViewerZone();
  const current = offers[0] ?? null;
  const [draft, setDraft] = useState<Draft>(current ? draftOf(current) : BLANK);
  // Which row the draft belongs to. A revision or a delete changes the row
  // under us, and without this the fields would keep editing the old id.
  const [editing, setEditing] = useState<string | null>(current?.id ?? null);
  const [pending, start] = useTransition();

  if (editing !== (current?.id ?? null)) {
    setEditing(current?.id ?? null);
    setDraft(current ? draftOf(current) : BLANK);
  }

  const save = useAutosave<Draft>(async (value) => {
    if (!current) return;
    await updateOfferAction(current.id, {
      currency: value.currency,
      baseAmount: toNumber(value.baseAmount),
      bonusAmount: toNumber(value.bonusAmount),
      equityAmount: toNumber(value.equityAmount),
      signOnAmount: toNumber(value.signOnAmount),
      terms: value.terms,
      vesting: value.vesting,
      respondBy: value.respondBy,
      startsOn: value.startsOn,
    });
  });

  const set = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (current) save.push(next);
  };

  const record = () =>
    start(async () => {
      try {
        await recordOfferAction(applicationId, {
          currency: draft.currency,
          baseAmount: toNumber(draft.baseAmount),
          bonusAmount: toNumber(draft.bonusAmount),
          equityAmount: toNumber(draft.equityAmount),
          signOnAmount: toNumber(draft.signOnAmount),
          terms: draft.terms,
          vesting: draft.vesting,
          respondBy: draft.respondBy,
          startsOn: draft.startsOn,
        });
        toast.success(current ? "Revision recorded. The first offer is still on file." : "Offer recorded.");
        onServerChange?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save that.");
      }
    });

  const remove = (id: string) =>
    start(async () => {
      try {
        await deleteOfferAction(id);
        onServerChange?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete that.");
      }
    });

  // The card appears when there is something to put in it. Before the offer
  // stage there is nothing to record, and a form for a number nobody has said
  // is an invitation to write down a number nobody has said.
  if (stage !== "OFFER" && stage !== "ACCEPTED" && offers.length === 0) return null;

  const total = totalOf(draft);
  const signOn = toNumber(draft.signOnAmount);
  const days = daysUntil(draft.respondBy);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <HandshakeIcon className="text-muted-foreground size-4" />
          Offer
          {offers.length > 1 && (
            <span className="text-faint nums text-[11px] font-normal">
              version {offers.length}
            </span>
          )}
        </CardTitle>
        <SaveIndicator state={save.state} />
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="nums text-2xl font-semibold tracking-tight">
            {total > 0 ? formatMoney(total, draft.currency) : "—"}
          </span>
          <span className="text-muted-foreground text-xs">
            a year{signOn > 0 && `, plus ${formatMoney(signOn, draft.currency)} on signing`}
          </span>
          {advertised.trim() && (
            <span className="text-faint text-xs">· the posting said {advertised.trim()}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 @min-[30rem]:grid-cols-4">
          <Money label="Base" value={draft.baseAmount} onChange={(baseAmount) => set({ baseAmount })} />
          <Money label="Bonus" value={draft.bonusAmount} onChange={(bonusAmount) => set({ bonusAmount })} />
          <Money label="Equity a year" value={draft.equityAmount} onChange={(equityAmount) => set({ equityAmount })} />
          <Money label="Sign-on" value={draft.signOnAmount} onChange={(signOnAmount) => set({ signOnAmount })} />
        </div>

        <div className="grid grid-cols-1 gap-3 @min-[30rem]:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input
              value={draft.currency}
              onChange={(event) => set({ currency: event.target.value.toUpperCase().slice(0, 3) })}
              className="nums uppercase"
              aria-label="Currency"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Answer by</Label>
            <DateField
              value={draft.respondBy}
              onChange={(respondBy) => set({ respondBy })}
              ariaLabel="Answer by"
              placeholder="No deadline"
              tone={days !== null && days < 0 ? "overdue" : undefined}
            />
            {days !== null && (
              <p className={cn("text-xs", days <= 2 ? "text-[var(--warning)]" : "text-muted-foreground")}>
                {days < 0
                  ? `${Math.abs(days)} days ago`
                  : days === 0
                    ? "Today"
                    : `${days} days left`}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Starts</Label>
            <DateField
              value={draft.startsOn}
              onChange={(startsOn) => set({ startsOn })}
              ariaLabel="Start date"
              placeholder="Not agreed"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Vesting</Label>
          <Input
            value={draft.vesting}
            onChange={(event) => set({ vesting: event.target.value })}
            placeholder="4 years, 1 year cliff, monthly after"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Terms</Label>
          <Textarea
            value={draft.terms}
            onChange={(event) => set({ terms: event.target.value })}
            placeholder="Everything the numbers can't hold: the percentage they quoted, relocation, a review at six months."
            className="min-h-20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={current ? "outline" : "default"} onClick={record} disabled={pending}>
            <PlusIcon />
            {current ? "Record a revision" : "Record this offer"}
          </Button>
          <p className="text-muted-foreground text-xs">
            {current
              ? "They came back with a better number? This keeps the first one on file."
              : "Nothing is saved until you record it."}
          </p>
        </div>

        {offers.length > 1 && (
          <div className="border-t pt-3">
            <p className="text-faint mb-2 text-[11px] font-medium tracking-wide uppercase">
              Earlier versions
            </p>
            <ul className="space-y-1">
              {offers.slice(1).map((offer) => (
                <li key={offer.id} className="group flex items-center justify-between gap-3 text-sm">
                  <span className="nums">
                    {formatMoney(
                      offer.baseAmount + offer.bonusAmount + offer.equityAmount,
                      offer.currency,
                    )}
                  </span>
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    {shortCivilDay(civilDay(new Date(offer.receivedAt), zone))}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-faint hover:text-destructive opacity-0 group-hover:opacity-100"
                      onClick={() => remove(offer.id)}
                      disabled={pending}
                      aria-label="Delete this version"
                    >
                      <Trash2Icon />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="numeric"
        placeholder="0"
        className="nums"
        aria-label={label}
      />
    </div>
  );
}
