"use client";

import { createContext, useContext } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A vertical list you can drag to reorder.
 *
 * Three of these nest inside each other in the editor — sections, the entries
 * in a section, the bullets in an entry — which is why the drag starts from a
 * handle rather than from the row. A row here is mostly text inputs, and a card
 * you can pick up anywhere is a card you cannot select text in. The handle also
 * gives the keyboard a way in: it is a real button, so tab to it, press space,
 * and the arrow keys move the row.
 *
 * The list is presentational. It reports "this index moved to that index" and
 * the editor does the moving, so the same `moveWithin` runs whether the order
 * changed by drag, by the arrow buttons, or by reorder_resume over MCP.
 */

type Sortable = ReturnType<typeof useSortable>;

type RowHandle = {
  attributes: Sortable["attributes"];
  listeners: Sortable["listeners"];
  setActivatorNodeRef: Sortable["setActivatorNodeRef"];
  label: string;
};

const RowContext = createContext<RowHandle | null>(null);

export function SortableList({
  ids,
  onReorder,
  className,
  children,
}: {
  /** One stable id per row, in the order they are rendered. */
  ids: string[];
  onReorder: (from: number, to: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  // Mouse and touch are split the way the pipeline board splits them: on a
  // phone a short drag is far more often the start of a scroll, so touch waits
  // for a hold before it picks anything up.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // A row can only move up and down its own list. Without these a section
      // dragged sideways drifts over the preview, and a bullet can be dropped
      // outside the job it belongs to, where nothing would catch it.
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

export function SortableRow({
  id,
  label,
  className,
  children,
}: {
  id: string;
  /** What the handle is called, for screen readers: "Reorder Experience". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 opacity-80 shadow-lg", className)}
    >
      <RowContext.Provider value={{ attributes, listeners, setActivatorNodeRef, label }}>
        {children}
      </RowContext.Provider>
    </div>
  );
}

/**
 * The grip. Rendered wherever the row's own header puts its controls, and it
 * finds its row through context rather than being handed the listeners down
 * three levels of props.
 */
export function DragHandle({ className }: { className?: string }) {
  const row = useContext(RowContext);
  if (!row) return null;
  return (
    <button
      ref={row.setActivatorNodeRef}
      {...row.attributes}
      {...row.listeners}
      type="button"
      aria-label={row.label}
      title={row.label}
      className={cn(
        "text-muted-foreground/50 hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 cursor-grab touch-none items-center justify-center rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing",
        className,
      )}
    >
      <GripVerticalIcon className="size-3.5" />
    </button>
  );
}
