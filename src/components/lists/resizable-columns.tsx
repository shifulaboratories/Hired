"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { COLUMNS, widthsFor, type ColumnList, type StoredWidths } from "@/lib/column-widths";
import { setColumnWidthsAction } from "@/server/actions";
import { cn } from "@/lib/utils";

/**
 * Column widths a person can drag, shared by a table's header and its rows.
 *
 * Context rather than props because the header cell that carries the handle
 * and the body cell that has to match it are in different components and often
 * different files, and threading a width through every row of a table is how
 * you end up with two of them that disagree by a pixel.
 *
 * **What is dragged.** Every one of these tables has a name column that flexes
 * to fill what the fixed columns leave, so the row always spans the card. A
 * handle sits on the LEFT edge of each fixed column and changes that column's
 * width — dragging it left widens the column and narrows the name, which is the
 * "divider between these two cells" a person expects. There is no handle on the
 * name column, because giving every column a width means the table needs a
 * horizontal scrollbar and that is a different design.
 *
 * **When it saves.** On release, not on move. A drag fires pointermove at the
 * frame rate; saving there would be sixty writes a second. During the drag the
 * width lives in local state, so the table tracks the pointer with no server in
 * the loop, and the release posts one width.
 */

type Ctx = {
  widths: Record<string, number>;
  begin: (key: string, event: React.PointerEvent) => void;
  dragging: string | null;
};

const ColumnCtx = createContext<Ctx | null>(null);

export function ResizableColumns({
  list,
  stored,
  children,
}: {
  list: ColumnList;
  /** What the server has, already parsed and clamped. */
  stored: StoredWidths;
  children: React.ReactNode;
}) {
  const server = useMemo(() => widthsFor(list, stored), [list, stored]);
  const [local, setLocal] = useState<Record<string, number> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A ref as well as state: the pointermove handler is registered once and
  // would otherwise close over the widths as they were when the drag began.
  const live = useRef<Record<string, number>>(server);

  // Adopt the server's widths only when they actually change.
  //
  // Clearing the local override whenever a drag ended looked right and was
  // wrong: setColumnWidthsAction deliberately does not revalidate the route, so
  // the `stored` prop still holds the OLD width for the rest of the visit — and
  // the column visibly snapped back to where it started the moment the pointer
  // came up, then corrected itself on the next navigation. Measured in a real
  // browser, which is the only way this shows up at all.
  //
  // So the local width stands until something genuinely different arrives:
  // another navigation, or another tab. Comparing the serialised map rather
  // than the object because `stored` is a fresh literal on every render.
  const serverKey = JSON.stringify(server);
  const lastServerKey = useRef(serverKey);
  useEffect(() => {
    if (lastServerKey.current === serverKey) return;
    lastServerKey.current = serverKey;
    // Never yank a column out from under a pointer that is holding it.
    if (dragging !== null) return;
    live.current = server;
    setLocal(null);
  }, [serverKey, server, dragging]);

  const widths = local ?? server;
  const defs = useMemo(() => new Map(COLUMNS[list].map((c) => [c.key, c])), [list]);

  const begin = useCallback(
    (key: string, event: React.PointerEvent) => {
      const column = defs.get(key);
      if (!column) return;
      // Only the primary button, and never a touch that is really a scroll.
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = live.current[key] ?? column.width;
      setDragging(key);

      const move = (moveEvent: PointerEvent) => {
        // Inverted: the handle is on the column's left edge, so dragging left
        // (a negative delta) makes the column wider.
        const next = Math.round(
          Math.min(column.max, Math.max(column.min, startWidth - (moveEvent.clientX - startX))),
        );
        live.current = { ...live.current, [key]: next };
        setLocal(live.current);
      };

      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        setDragging(null);
        const final = live.current[key];
        if (final === undefined || final === startWidth) return;
        // Fire and forget, but not silently: a width that did not save would
        // otherwise come back on the next load with no explanation.
        void setColumnWidthsAction(list, { [key]: final }).catch(() => {
          toast.error("Could not save that column width.");
        });
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
    [defs, list],
  );

  // While a column is held, the whole document shows the resize cursor and
  // stops selecting text — otherwise a drag across the table highlights every
  // row it passes.
  useEffect(() => {
    if (!dragging) return;
    const style = document.body.style;
    const cursor = style.cursor;
    const select = style.userSelect;
    style.cursor = "col-resize";
    style.userSelect = "none";
    return () => {
      style.cursor = cursor;
      style.userSelect = select;
    };
  }, [dragging]);

  return (
    <ColumnCtx.Provider value={{ widths, begin, dragging }}>{children}</ColumnCtx.Provider>
  );
}

/**
 * One cell's width, as a style object.
 *
 * Returns an empty object outside a provider, so a table that has not been
 * wrapped renders at its Tailwind width rather than collapsing — the print
 * page and the shared pipeline both reuse row components and neither has a
 * person to drag anything.
 */
export function useColumnStyle(key: string): React.CSSProperties {
  const ctx = useContext(ColumnCtx);
  const width = ctx?.widths[key];
  return width === undefined ? {} : { width, flex: "0 0 auto" };
}

/**
 * The grab handle, drawn on a header cell's left edge.
 *
 * Rendered inside the header cell and pulled half its width to the left so it
 * straddles the gap between two columns. Eight pixels wide with a one-pixel
 * line: a two-pixel target is a target nobody hits.
 */
export function ColumnGrip({ column }: { column: string }) {
  const ctx = useContext(ColumnCtx);
  if (!ctx) return null;
  const held = ctx.dragging === column;
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize this column`}
      onPointerDown={(event) => ctx.begin(column, event)}
      // Stops the header's own sort link from firing on the way down.
      onClick={(event) => event.preventDefault()}
      className={cn(
        "group absolute inset-y-0 -left-1.5 z-[2] hidden w-3 cursor-col-resize touch-none items-center justify-center md:flex",
        held && "flex",
      )}
    >
      <span
        className={cn(
          "h-4 w-px transition-colors duration-150",
          held ? "bg-primary" : "bg-transparent group-hover:bg-border",
        )}
      />
    </span>
  );
}
