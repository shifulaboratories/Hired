"use client";

import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { ColumnGrip, useColumnStyle } from "@/components/lists/resizable-columns";
import { cn } from "@/lib/utils";

/**
 * A column heading: its width, its grab handle, and its sort link.
 *
 * It renders the cell rather than sitting inside one. That looks like a
 * component doing two jobs and is the only arrangement that works: the width
 * comes from a client context the drag handle writes to, and the pages that
 * build these headers are server components, so a `<div style={width}>` in the
 * page could never follow a drag. Making the heading itself the client cell
 * puts the header and the body on one source of truth.
 *
 * `href` is optional, because a column that does not sort still needs a width
 * and a handle. The href is built by the page from the filters it is already
 * holding, so sorting a filtered list keeps the filters — the bug this shape
 * exists to prevent is a fresh query string that silently throws them away.
 */
export function SortHeader({
  href,
  label,
  active = false,
  desc = false,
  col,
  className,
  align,
}: {
  href?: string;
  label: string;
  active?: boolean;
  desc?: boolean;
  /** Its key in the width catalogue. Omit for a column that cannot be dragged. */
  col?: string;
  className?: string;
  align?: "right";
}) {
  const style = useColumnStyle(col ?? "");
  const inner = (
    <>
      {label}
      {active && (desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
    </>
  );
  return (
    <div className={cn("relative", className)} style={style}>
      {col && <ColumnGrip column={col} />}
      {href ? (
        <Link
          href={href}
          className={cn(
            "hover:text-foreground flex items-center gap-1 transition-colors",
            align === "right" && "justify-end",
            active && "text-foreground",
          )}
          aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
        >
          {inner}
        </Link>
      ) : (
        <span className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
          {inner}
        </span>
      )}
    </div>
  );
}
