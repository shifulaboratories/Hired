"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  BuildingIcon,
  CalendarClockIcon,
  ChevronsLeftRightIcon,
  ChevronsRightLeftIcon,
  FileTextIcon,
  MapPinIcon,
  MessageSquareIcon,
  MoonIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Stage } from "@prisma/client";
import { BOARD_STAGES, STAGE_LABEL, STAGE_TONE, TERMINAL_STAGES } from "@/lib/data/pipeline";
import { SHOW_QUIET_AFTER, STALE_AFTER, hasGoneQuiet } from "@/lib/quiet";
import { ApplicationActions } from "@/components/pipeline/application-actions";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { TagChip } from "@/components/tags/tag-chip";
import { useOpenApplication } from "@/components/pipeline/application-panel";
import { cn, relativeDay } from "@/lib/utils";
import { moveStageAction } from "@/server/actions";

/** Which columns you have folded away. A preference, not a filter. */
const COLLAPSED_KEY = "hired:board-collapsed";

export type Card = {
  id: string;
  company: string;
  roleTitle: string;
  stage: Stage;
  location: string;
  salaryRange: string;
  nextFollowUpAt: string | null;
  resumeName: string | null;
  activityCount: number;
  /** Days since anything at all happened here. */
  quietDays: number;
  /** The posting, for the card's own actions. Empty when there never was one. */
  jobUrl: string;
  /** Null when logos are off, or no domain could be worked out. */
  domain: string | null;
  /** Off by default on a card: a board is scanned, not read. */
  tags: { id: string; name: string; color: string }[];
};

/**
 * Which optional fields a card draws, as context rather than a prop.
 *
 * A card is four components deep — board, column, draggable, card — and
 * threading a set through all four to be read only at the bottom is four
 * signatures changed for one value that never varies within a render.
 */
const VisibleFields = createContext<Set<string>>(new Set());
const useVisibleFields = () => useContext(VisibleFields);

export function PipelineBoard({
  open,
  closed,
  // Which columns to draw. Filtering to one stage should show that column on
  // its own rather than five empty ones beside it.
  columns = BOARD_STAGES,
  fields,
}: {
  open: Card[];
  closed: Card[];
  columns?: Stage[];
  /** What each card shows. Every key of BOARD_FIELDS that is turned on. */
  fields: string[];
}) {
  const shows = useMemo(() => new Set(fields), [fields]);
  const openPanel = useOpenApplication();
  const [cards, setCards] = useState(open);
  const [dragging, setDragging] = useState<Card | null>(null);
  const [, startTransition] = useTransition();
  // Mouse and touch are separated deliberately. One PointerSensor covered both,
  // and on a phone every gesture is a pointer gesture: a 6px movement is the
  // start of a scroll far more often than the start of a drag, so the board
  // grabbed a card whenever you tried to scroll past it and the column could
  // not be scrolled at all. Touch now needs a 220ms hold before a card moves,
  // which is the gesture a person already expects for "pick this up", and a
  // swipe below that threshold scrolls the way it should. Tapping a card still
  // opens the panel, where the stage Select moves it without any dragging.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  // Which stages are folded to a spine. Kept in localStorage rather than the
  // URL: it is how you like to look at the board, not what you are looking at,
  // so it should survive a navigation and should not travel in a shared link.
  // Read after mount so the server and the first client render agree.
  const [collapsed, setCollapsed] = useState<Set<Stage>>(new Set());
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLLAPSED_KEY);
      if (saved) setCollapsed(new Set(JSON.parse(saved) as Stage[]));
    } catch {
      // A malformed or unreadable value just means no collapsed columns.
    }
  }, []);

  const toggleColumn = (stage: Stage) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: the preference just does not persist.
      }
      return next;
    });

  // Re-seed when the filter changes: `open` is a prop, and useState only reads
  // its initial value, so without this the board keeps showing the last cut.
  const [seed, setSeed] = useState(open);
  if (seed !== open) {
    setSeed(open);
    setCards(open);
  }

  const byStage = useMemo(() => {
    const map = new Map<Stage, Card[]>();
    for (const stage of columns) map.set(stage, []);
    for (const card of cards) map.get(card.stage)?.push(card);
    return map;
  }, [cards, columns]);

  const onDragStart = (event: DragStartEvent) => {
    setDragging(cards.find((card) => card.id === event.active.id) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const target = event.over?.id as Stage | undefined;
    const id = String(event.active.id);
    if (!target) return;
    const card = cards.find((item) => item.id === id);
    if (!card || card.stage === target) return;

    // Optimistic: the card lands where you dropped it before the server replies.
    setCards((prev) => prev.map((item) => (item.id === id ? { ...item, stage: target } : item)));
    startTransition(async () => {
      try {
        await moveStageAction(id, target);
        toast.success(`${card.company} → ${STAGE_LABEL[target]}`);
      } catch {
        setCards((prev) =>
          prev.map((item) => (item.id === id ? { ...item, stage: card.stage } : item)),
        );
        toast.error("Could not move that card.");
      }
    });
  };

  return (
    <VisibleFields.Provider value={shows}>
    <div className="space-y-8">
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {columns.length > 0 && (
          <div className="no-scrollbar group/board -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
            {columns.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                cards={byStage.get(stage) ?? []}
                collapsed={collapsed.has(stage)}
                onToggle={() => toggleColumn(stage)}
              />
            ))}
          </div>
        )}

        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.16,1,0.3,1)" }}>
          {dragging && (
            <div className="w-[15.5rem] rotate-2 opacity-95">
              <ApplicationCard card={dragging} overlay />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {closed.length > 0 && (
        <section>
          <h2 className="text-muted-foreground mb-3 text-[11px] font-semibold tracking-[0.14em] uppercase">
            Closed · {closed.length}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {closed.map((card) => (
              <Link
                key={card.id}
                href={`/applications/${card.id}`}
                onClick={(event) => {
                  if (!openPanel || event.metaKey || event.ctrlKey || event.shiftKey) return;
                  event.preventDefault();
                  openPanel(card.id);
                }}
              >
                <div className="bg-card shadow-hairline hover:bg-accent/40 flex items-center gap-2.5 rounded-card px-3 py-2 transition-colors duration-150">
                  <CompanyAvatar name={card.company} domain={card.domain} size={24} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{card.company}</div>
                    <div className="text-faint truncate text-[12px]">{card.roleTitle}</div>
                  </div>
                  <span
                    className="stage-chip shrink-0 rounded-chip px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ ["--tone" as string]: STAGE_TONE[card.stage] }}
                  >
                    {STAGE_LABEL[card.stage]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
    </VisibleFields.Provider>
  );
}

function Column({
  stage,
  cards,
  collapsed,
  onToggle,
}: {
  stage: Stage;
  cards: Card[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  // A collapsed column is still a drop target — the reason to collapse a stage
  // is that you are not working it, not that nothing may ever land there, and
  // a card dragged onto the spine should go in rather than snap back.
  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl py-2 transition-colors duration-200",
          isOver ? "bg-primary-tint shadow-[0_0_0_1px_var(--primary)]" : "bg-canvas shadow-hairline",
        )}
      >
        <button
          onClick={onToggle}
          aria-label={`Expand ${STAGE_LABEL[stage]}`}
          className="text-muted-foreground hover:text-foreground touch-target"
        >
          <ChevronsLeftRightIcon className="size-3.5" />
        </button>
        <span className="text-faint meta text-[12px]">{cards.length}</span>
        <span
          className="text-[12px] font-semibold whitespace-nowrap [writing-mode:vertical-rl]"
          style={{ color: STAGE_TONE[stage] }}
        >
          {STAGE_LABEL[stage]}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-[16rem] shrink-0 flex-col">
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <span
          className="stage-chip rounded-chip px-1.5 py-0.5 text-[12px] font-semibold"
          style={{ ["--tone" as string]: STAGE_TONE[stage] }}
        >
          {STAGE_LABEL[stage]}
        </span>
        <span className="text-faint meta text-[12px]">{cards.length}</span>
        <button
          onClick={onToggle}
          aria-label={`Collapse ${STAGE_LABEL[stage]}`}
          className="text-faint hover:text-foreground touch-target ml-auto opacity-0 transition-opacity group-hover/board:opacity-100"
        >
          <ChevronsRightLeftIcon className="size-3.5" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "bg-canvas flex min-h-[11rem] flex-1 flex-col gap-2 rounded-xl p-2 transition-[background-color,box-shadow] duration-200 ease-[var(--ease-settle)]",
          isOver ? "bg-primary-tint shadow-[0_0_0_1px_var(--primary)]" : "shadow-hairline",
        )}
      >
        <AnimatePresence initial={false}>
          {cards.map((card) => (
            <DraggableCard key={card.id} card={card} />
          ))}
        </AnimatePresence>

        {cards.length === 0 && (
          <div className="text-faint flex flex-1 items-center justify-center text-[12px]">
            {isOver ? "Drop here" : "Empty"}
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ card }: { card: Card }) {
  // tabIndex -1 on the draggable, because the card inside it is already a
  // link and therefore already focusable. Without this every card is two tab
  // stops, the outer one announced as a draggable button that no registered
  // sensor can actually drag — the sensors below are mouse and touch only.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    attributes: { tabIndex: -1 },
  });
  // A drop is followed by a click on the element that was dragged — the
  // browser fires it on the pointerup regardless. Without this guard, filing a
  // card away would then open the panel for it. Armed during the drag, spent
  // on the click that follows, and re-cleared on the next press so a cancelled
  // drag (Escape) cannot leave it swallowing a genuine click later.
  const wasDragged = useRef(false);
  if (isDragging) wasDragged.current = true;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isDragging ? 0.35 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerDownCapture={() => {
        wasDragged.current = false;
      }}
      // Enter on the card's link synthesizes a click with no pointerdown, so a
      // drag that ended off the card (its click landed elsewhere) would leave
      // the guard armed and eat the next keyboard activation.
      onKeyDownCapture={() => {
        wasDragged.current = false;
      }}
      onClickCapture={(event) => {
        if (!wasDragged.current) return;
        wasDragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      // touch-none here meant "the browser may not scroll from this element",
      // and since the cards cover the board, that disabled scrolling over the
      // whole thing — vertically as well as sideways. touch-manipulation gives
      // scrolling back and still suppresses double-tap zoom; the TouchSensor's
      // 220ms hold is what distinguishes a drag now, so the browser no longer
      // has to be locked out to make dragging possible. select-none stops the
      // hold from starting a text selection instead of picking the card up.
      // The card is an anchor now, and iOS Safari answers a still ~500ms press
      // on a link with its native preview sheet — which fires touchcancel and
      // kills the drag the 220ms hold just started. touch-callout is the one
      // switch that suppresses it (contextmenu never fires for touch on iOS),
      // and it inherits down to the anchor from here.
      className="touch-manipulation select-none [-webkit-touch-callout:none]"
    >
      <ApplicationCard card={card} />
    </motion.div>
  );
}

function ApplicationCard({ card, overlay = false }: { card: Card; overlay?: boolean }) {
  const shows = useVisibleFields();
  const overdue = card.nextFollowUpAt ? new Date(card.nextFollowUpAt) < new Date() : false;
  const openPanel = useOpenApplication();

  // The WHOLE card is the way in, not just the company's name. Opening a card
  // is what you do to it far more often than dragging it, so the click target
  // is the full surface: a plain click opens the panel, cmd/ctrl/shift-click
  // opens the page in a new tab, and a press that moves 6px is still a drag —
  // the sensors' activation thresholds are what keep the two gestures apart.
  const className = cn(
    "group bg-card relative block overflow-hidden rounded-card p-3 pr-8 pl-3.5 transition-shadow duration-200 ease-[var(--ease-settle)]",
    // A stripe of the stage's colour down the edge, so a column reads as
    // one thing at a glance and a mis-dropped card is obvious.
    "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[var(--tone)]",
    // The link is a transparent overlay, so the focus ring has to be drawn by
    // the card around it or keyboard focus would be invisible.
    "has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-[var(--ring)] has-[a:focus-visible]:outline-none",
    overlay
      ? "shadow-overlay"
      : "shadow-card hover:shadow-raised cursor-pointer active:cursor-grabbing",
  );
  const tone = { ["--tone" as string]: STAGE_TONE[card.stage] };

  const body = (
    <>
      <div className="flex items-start gap-2">
        <CompanyAvatar name={card.company} domain={card.domain} size={26} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold group-hover:underline">
            {card.company}
          </div>
          <div className="text-faint truncate text-[12px]">{card.roleTitle}</div>
        </div>
      </div>

      {((shows.has("location") && card.location) ||
        (shows.has("salary") && card.salaryRange) ||
        (shows.has("tags") && card.tags.length > 0)) && (
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
          {shows.has("location") && card.location && (
            <span className="flex items-center gap-1">
              <MapPinIcon className="size-2.5" />
              {card.location}
            </span>
          )}
          {shows.has("salary") && card.salaryRange && (
            <span className="flex items-center gap-1">
              <BuildingIcon className="size-2.5" />
              {card.salaryRange}
            </span>
          )}
          {shows.has("tags") &&
            card.tags.map((tag) => <TagChip key={tag.id} tag={tag} className="text-[10.5px]" />)}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {shows.has("followUp") && card.nextFollowUpAt && (
          <span
            className={cn(
              "flex items-center gap-1 text-[11px]",
              overdue ? "text-destructive font-medium" : "text-muted-foreground",
            )}
          >
            <CalendarClockIcon className="size-2.5" />
            {relativeDay(new Date(card.nextFollowUpAt))}
          </span>
        )}
        {/* How long since anything happened, which is the question the board
            existed to answer and could not. Below a week it is noise, so it
            says nothing; past the stage's own threshold it turns the colour
            of the diagnosis that agrees with it. */}
        {shows.has("quiet") &&
          card.quietDays >= SHOW_QUIET_AFTER &&
          STALE_AFTER[card.stage] !== undefined && (
          <span
            className={cn(
              "flex items-center gap-1 text-[11px]",
              hasGoneQuiet(card.stage, card.quietDays, TERMINAL_STAGES)
                ? "text-[var(--warning)] font-medium"
                : "text-muted-foreground",
            )}
            title={`Nothing logged for ${card.quietDays} days`}
          >
            <MoonIcon className="size-2.5" />
            {card.quietDays}d quiet
          </span>
          )}
        <div className="text-muted-foreground ml-auto flex items-center gap-2 text-[11px]">
          {shows.has("resume") && card.resumeName && <FileTextIcon className="size-2.5" />}
          {shows.has("activity") && card.activityCount > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageSquareIcon className="size-2.5" />
              {card.activityCount}
            </span>
          )}
        </div>
      </div>
    </>
  );

  // The overlay copy that follows the pointer is decoration, not a control.
  if (overlay) {
    return (
      <div style={tone} className={className}>
        {body}
      </div>
    );
  }

  // The card is a div with a stretched link inside rather than a link wrapping
  // everything, because the actions menu is a button and a button inside an
  // anchor is invalid — the same arrangement the contacts list uses. The
  // overlay keeps the whole surface clickable; the menu is positioned, so it
  // paints above the overlay and stays clickable in its own right.
  return (
    <div style={tone} className={className}>
      <Link
        href={`/applications/${card.id}`}
        // An anchor is natively draggable, and the browser's link-drag would
        // wrestle dnd-kit for the gesture.
        draggable={false}
        data-nav-item
        aria-label={`${card.company} — ${card.roleTitle}`}
        onClick={(event) => {
          if (!openPanel || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          openPanel(card.id);
        }}
        className="absolute inset-0 z-0"
      />
      <div className="pointer-events-none relative">{body}</div>
      <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <ApplicationActions
          application={{
            id: card.id,
            company: card.company,
            roleTitle: card.roleTitle,
            stage: card.stage,
            jobUrl: card.jobUrl,
          }}
        />
      </div>
    </div>
  );
}

export { TERMINAL_STAGES };
