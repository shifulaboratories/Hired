"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { completeTourAction } from "@/server/actions";
import { cn } from "@/lib/utils";

/**
 * The first ninety seconds.
 *
 * Most people arriving here have never used an applicant tracking system or a
 * CRM, and have never tracked a job search as anything but a browser tab and a
 * bad feeling. So this teaches four words — board, Me, resume, assistant — and
 * nothing else. No forms, no accounts to link, no decisions: reading it is the
 * whole job, and the setup strip underneath is where the doing happens.
 *
 * Four rules it is built on, in order of how easily they get broken:
 *
 * 1. One sentence a card. If a card needs a paragraph the app needs fixing,
 *    not the paragraph.
 * 2. Skippable from the first frame, and closing counts. Someone who has run a
 *    search before should be out in one click, and never asked twice.
 * 3. It never blocks. Escape, the X and the overlay all close it, because a
 *    modal you cannot leave is the thing people remember about an app.
 * 4. It is recoverable. Settings → Account brings it back, and so does asking
 *    an assistant, which is why `restart_tour` exists.
 *
 * The pictures are deliberately crude — a few rectangles standing in for the
 * screen behind them. A screenshot would be out of date within a release, and
 * a person who has never seen the app cannot tell a stale screenshot from a
 * current one.
 */
const STEPS = [
  {
    title: "Welcome. This is where the search lives.",
    body: "Every job you go for, everything you have ever done, and every resume you send — one place instead of six browser tabs and a spreadsheet.",
    art: <ArtWelcome />,
  },
  {
    title: "Every job you apply to is a card.",
    body: "Drag it along as things happen — applied, phone screen, interview, offer. One glance tells you where everything stands.",
    art: <ArtBoard />,
  },
  {
    title: "Today shows what you owe.",
    body: "Things you wrote down, and the people you meant to chase. Clear the list and close the laptop.",
    art: <ArtToday />,
  },
  {
    title: "Write your history once.",
    body: "Dump everything you have done into Me — messy is fine, long is better. Every resume you build gets assembled out of it.",
    art: <ArtMe />,
  },
  {
    title: "Or just talk to it.",
    body: "Connect Claude and you can say “I applied to Figma yesterday” and it fills the card in. Optional — everything here works without it.",
    art: <ArtAssistant />,
  },
] as const;

export function WelcomeTour({ open: initiallyOpen }: { open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [index, setIndex] = useState(0);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // A change of props means Settings just asked for it back, or a fresh
  // account arrived. Either way the dialog's own state is stale.
  useEffect(() => {
    setOpen(initiallyOpen);
    if (initiallyOpen) setIndex(0);
  }, [initiallyOpen]);

  const last = index === STEPS.length - 1;

  /** Finishing and skipping are the same write; only the wording differs. */
  const close = () => {
    setOpen(false);
    startTransition(async () => {
      await completeTourAction();
      // So the setup strip and anything else keyed on it re-render without a
      // reload — the tour is gone, the app underneath is not.
      router.refresh();
    });
  };

  const step = STEPS[index];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="max-w-md gap-0 p-0"
        // Focus belongs on Next, not on the close button in the corner.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {/* The picture fits the box rather than setting it: a viewBox given
            its natural width pushed the whole dialog off the side of a
            phone. */}
        <div className="bg-inset flex h-40 items-center justify-center overflow-hidden rounded-t-2xl px-5 py-4 sm:h-44">
          {step.art}
        </div>

        <div className="px-6 pt-5 pb-6">
          <DialogTitle className="text-[17px] leading-snug font-semibold tracking-tight">
            {step.title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">
            {step.body}
          </DialogDescription>

          <div className="mt-6 flex items-center gap-3">
            {/* Where you are, without a "3 of 5" to read. */}
            <div className="flex items-center gap-1.5" aria-hidden>
              {STEPS.map((_, dot) => (
                <span
                  key={dot}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    dot === index ? "bg-primary w-4" : "bg-border w-1.5",
                  )}
                />
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {index > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
                  <ArrowLeftIcon /> Back
                </Button>
              )}
              {!last && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={close}>
                  Skip
                </Button>
              )}
              <Button size="sm" autoFocus onClick={() => (last ? close() : setIndex(index + 1))}>
                {last ? "Start" : "Next"}
                {!last && <ArrowRightIcon />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The pictures
//
// Rectangles, not screenshots. Each one is the shape of the screen it stands
// for, at a glance and from across the room — enough to recognise the real
// thing when it appears, and nothing that goes stale when the real thing moves.
// ---------------------------------------------------------------------------

function ArtWelcome() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" role="img" aria-label="">
      <g className="fill-primary/20">
        <rect x="6" y="18" width="58" height="74" rx="8" />
      </g>
      <g className="fill-foreground/10">
        <rect x="72" y="18" width="66" height="74" rx="8" />
        <rect x="146" y="18" width="68" height="74" rx="8" />
      </g>
      <g className="fill-primary">
        <rect x="16" y="30" width="34" height="5" rx="2.5" />
      </g>
      <g className="fill-foreground/35">
        <rect x="16" y="42" width="26" height="4" rx="2" />
        <rect x="16" y="52" width="38" height="4" rx="2" />
        <rect x="82" y="30" width="30" height="5" rx="2.5" />
        <rect x="82" y="42" width="46" height="4" rx="2" />
        <rect x="82" y="52" width="34" height="4" rx="2" />
        <rect x="156" y="30" width="26" height="5" rx="2.5" />
        <rect x="156" y="42" width="48" height="4" rx="2" />
        <rect x="156" y="52" width="30" height="4" rx="2" />
      </g>
    </svg>
  );
}

function ArtBoard() {
  const columns = [
    { x: 6, tone: "fill-foreground/10", cards: 3 },
    { x: 60, tone: "fill-foreground/10", cards: 2 },
    { x: 114, tone: "fill-foreground/10", cards: 1 },
    { x: 168, tone: "fill-primary/20", cards: 1 },
  ];
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" role="img" aria-label="">
      {columns.map((column) => (
        <g key={column.x}>
          <rect x={column.x} y={10} width={46} height={90} rx={7} className={column.tone} />
          {Array.from({ length: column.cards }).map((_, card) => (
            <rect
              key={card}
              x={column.x + 6}
              y={18 + card * 24}
              width={34}
              height={18}
              rx={4}
              className={column.x === 168 ? "fill-primary" : "fill-foreground/30"}
            />
          ))}
        </g>
      ))}
      {/* The move that makes it a board rather than four lists. */}
      <path
        d="M104 30 C 124 30, 138 22, 158 22"
        className="stroke-primary"
        strokeWidth={2}
        strokeDasharray="4 4"
        fill="none"
      />
      <path d="M154 18 L161 22 L154 26 Z" className="fill-primary" />
    </svg>
  );
}

function ArtToday() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" role="img" aria-label="">
      <rect x="14" y="10" width="192" height="90" rx="8" className="fill-foreground/10" />
      {[0, 1, 2].map((row) => (
        <g key={row}>
          <rect
            x={26}
            y={24 + row * 24}
            width={12}
            height={12}
            rx={3.5}
            className={row === 0 ? "fill-primary" : "fill-foreground/25"}
          />
          <rect
            x={46}
            y={28 + row * 24}
            width={row === 1 ? 96 : 74}
            height={5}
            rx={2.5}
            className="fill-foreground/35"
          />
          <rect
            x={166}
            y={27 + row * 24}
            width={28}
            height={7}
            rx={3.5}
            className={row === 0 ? "fill-destructive/60" : "fill-foreground/20"}
          />
        </g>
      ))}
    </svg>
  );
}

function ArtMe() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" role="img" aria-label="">
      {/* The pile of raw material… */}
      <rect x="12" y="20" width="96" height="72" rx="8" className="fill-foreground/10" />
      {[0, 1, 2, 3, 4].map((line) => (
        <rect
          key={line}
          x={22}
          y={30 + line * 12}
          width={line % 2 === 0 ? 76 : 58}
          height={5}
          rx={2.5}
          className="fill-foreground/30"
        />
      ))}
      {/* …becoming one page. */}
      <path d="M116 56 H 136" className="stroke-foreground/40" strokeWidth={2} fill="none" />
      <path d="M133 52 L140 56 L133 60 Z" className="fill-foreground/40" />
      <rect x="148" y="14" width="60" height="84" rx="6" className="fill-primary/20" />
      <rect x="158" y="26" width="30" height="6" rx="3" className="fill-primary" />
      {[0, 1, 2, 3].map((line) => (
        <rect
          key={line}
          x={158}
          y={42 + line * 12}
          width={line === 3 ? 26 : 40}
          height={4}
          rx={2}
          className="fill-foreground/30"
        />
      ))}
    </svg>
  );
}

function ArtAssistant() {
  return (
    <svg viewBox="0 0 220 110" className="h-full w-full" role="img" aria-label="">
      {/* What you say… */}
      <rect x="10" y="24" width="104" height="34" rx="10" className="fill-foreground/10" />
      <path d="M26 58 L26 70 L40 58 Z" className="fill-foreground/10" />
      <rect x="22" y="34" width="72" height="5" rx="2.5" className="fill-foreground/35" />
      <rect x="22" y="45" width="52" height="5" rx="2.5" className="fill-foreground/35" />
      {/* …becomes a card on the board. */}
      <path d="M122 52 H 142" className="stroke-primary" strokeWidth={2} fill="none" />
      <path d="M139 48 L146 52 L139 56 Z" className="fill-primary" />
      <rect x="152" y="28" width="58" height="52" rx="8" className="fill-primary/20" />
      <rect x="162" y="40" width="34" height="6" rx="3" className="fill-primary" />
      <rect x="162" y="54" width="24" height="4" rx="2" className="fill-foreground/35" />
      <rect x="162" y="63" width="38" height="4" rx="2" className="fill-foreground/35" />
    </svg>
  );
}
