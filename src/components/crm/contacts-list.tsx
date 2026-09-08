"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MailIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { CompanyChip } from "@/components/crm/company-chip";
import { PlatformIcon } from "@/components/crm/platform-icon";
import { TagChip, type TagValue } from "@/components/tags/tag-chip";
import { SelectionBar } from "@/components/crm/selection-bar";
import { PingSelected } from "@/components/crm/ping-selected";
import { archiveRecordsAction, tagContactsAction } from "@/server/actions";
import { ResizableColumns, useColumnStyle } from "@/components/lists/resizable-columns";
import type { StoredWidths } from "@/lib/column-widths";
import { cn } from "@/lib/utils";

export type ContactRow = {
  id: string;
  name: string;
  title: string;
  relationship: string;
  email: string;
  tags: TagValue[];
  companies: { id: string; name: string; website: string }[];
  nextPing: string;
  pingDue: boolean;
  lastTouch: string;
  best: { href: string; value: string; label: string } | null;
};

/** Same shape as the companies list, and the same reason it is one component. */
export function ContactsList({
  rows,
  filtered,
  exportHref,
  logos,
  header,
  widths,
}: {
  rows: ContactRow[];
  filtered: boolean;
  exportHref: string;
  logos: boolean;
  /**
   * The column headings, built on the server from the URL. They are
   * SortHeaders — client components — so they read their width from the
   * provider below even though the page that composed them is a server
   * component.
   */
  header: React.ReactNode;
  /** Stored column widths, already parsed and clamped by the server. */
  widths: StoredWidths;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const chosen = useMemo(
    () => rows.filter((row) => selected.has(row.id)).map((row) => row.id),
    [rows, selected],
  );
  const allOn = rows.length > 0 && rows.every((row) => selected.has(row.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (allOn) next.delete(row.id);
        else next.add(row.id);
      }
      return next;
    });

  const ids = chosen.length > 0 ? chosen : [...selected];

  return (
    <div>
      {selected.size > 0 && (
        <SelectionBar
          ids={ids}
          what={{ one: "person", many: "people" }}
          tagKind="CONTACT"
          onTag={tagContactsAction}
          onArchive={(picked) => archiveRecordsAction("contact", picked)}
          // Only the ids, not the screen's filters: the route intersects the
          // two, so exporting a selection whose rows the filter has since
          // excluded would hand back an empty file while the bar counts them.
          exportHref={`/api/export/contacts?ids=${[...selected].join(",")}`}
          onClear={() => setSelected(new Set())}
          extra={<PingSelected ids={ids} onDone={() => setSelected(new Set())} />}
        />
      )}

      {rows.length === 0 && selected.size > 0 && (
        <p className="text-faint mb-3 text-[12.5px]">
          None of the {selected.size} selected are on this screen. Clear the filters to see them.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={filtered ? "Nobody matches that" : "No contacts yet"}
          description={
            filtered
              ? "Loosen the search or the filter to see everyone again."
              : "Open an application and add the recruiter or hiring manager you are talking to, and they will show up here."
          }
          action={
            filtered ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/crm/contacts">Show everyone</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ResizableColumns list="contacts" stored={widths}>
        <div className="bg-card shadow-card overflow-hidden rounded-xl">
          <div className="eyebrow bg-inset flex items-center gap-3 px-4 py-2">
            <Checkbox
              checked={allOn}
              onCheckedChange={toggleAll}
              aria-label="Select everyone on this screen"
            />
            {header}
          </div>

          <ul className="divide-y">
            {rows.map((contact) => (
              <li
                key={contact.id}
                className={cn(
                  "hover:bg-accent/50 relative flex items-center gap-3 px-4 transition-colors duration-150",
                  selected.has(contact.id) && "bg-accent/40",
                )}
              >
                {/* z-[1], not just relative: the stretched link's ::before
                    comes later in the DOM and would otherwise paint over the
                    checkbox and eat the click. */}
                <div className="relative z-[1]">
                  <Checkbox
                    checked={selected.has(contact.id)}
                    onCheckedChange={() => toggle(contact.id)}
                    aria-label={`Select ${contact.name}`}
                  />
                </div>

                {/* One link, stretched over the row by a ::before overlay,
                    rather than an anchor wrapping the lot. The company is its
                    own destination and an anchor inside an anchor is invalid
                    HTML — but a second anchor to the contact would make every
                    row two tab stops reading the same name. The overlay keeps
                    the whole row clickable; the chip, the checkbox and the
                    buttons are positioned, so they paint above it and stay
                    clickable in their own right. */}
                <Link
                  href={`/crm/contacts/${contact.id}`}
                  data-nav-item
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 before:absolute before:inset-0"
                >
                  <CompanyAvatar name={contact.name} domain={null} size={26} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{contact.name}</div>
                    <div className="text-faint flex items-center gap-1.5 truncate text-[12px]">
                      <span className="truncate">{contact.title || "No title on file"}</span>
                      {contact.tags.slice(0, 2).map((tag) => (
                        <TagChip key={tag.id} tag={tag} className="shrink-0" />
                      ))}
                      {contact.tags.length > 2 && (
                        <span
                          className="shrink-0"
                          title={contact.tags.map((tag) => tag.name).join(", ")}
                        >
                          +{contact.tags.length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>

                <Cell
                  col="company"
                  className="relative hidden w-44 shrink-0 items-center gap-1.5 md:flex"
                >
                  {contact.companies.length > 0 ? (
                    <>
                      <CompanyChip
                        company={contact.companies[0]}
                        logos={logos}
                        size="sm"
                        className="min-w-0"
                      />
                      {contact.companies.length > 1 && (
                        <span
                          className="text-faint shrink-0 text-[11.5px]"
                          title={contact.companies.map((company) => company.name).join(", ")}
                        >
                          +{contact.companies.length - 1}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-faint text-[12px]">—</span>
                  )}
                </Cell>

                <Cell
                  col="relationship"
                  className="text-faint hidden w-32 shrink-0 truncate text-[12px] lg:block"
                >
                  {contact.relationship || "—"}
                </Cell>
                <Cell
                  col="ping"
                  className={cn(
                    "nums hidden w-24 shrink-0 text-right text-[12px] sm:block",
                    contact.pingDue ? "text-destructive font-medium" : "text-faint",
                  )}
                >
                  {contact.nextPing}
                </Cell>
                <Cell col="touch" className="nums text-faint w-24 shrink-0 text-right text-[12px]">
                  {contact.lastTouch}
                </Cell>

                <Cell
                  col="links"
                  className="relative hidden w-[60px] shrink-0 items-center justify-end gap-0.5 sm:flex"
                >
                  {contact.email && (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-sm"
                      className="text-faint hover:text-foreground"
                    >
                      <a href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>
                        <MailIcon />
                      </a>
                    </Button>
                  )}
                  {contact.best && (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-sm"
                      className="text-faint hover:text-foreground"
                    >
                      <a
                        href={contact.best.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open ${contact.name} on ${contact.best.label}`}
                      >
                        <PlatformIcon value={contact.best.value} />
                      </a>
                    </Button>
                  )}
                </Cell>
              </li>
            ))}
          </ul>
        </div>
        </ResizableColumns>
      )}
    </div>
  );
}

/**
 * A body cell at the dragged width.
 *
 * `className` keeps the Tailwind `w-*` it replaces, so the cell still has a
 * width where nothing wraps it in a provider.
 */
function Cell({
  col,
  className,
  children,
}: {
  col: string;
  className?: string;
  children: React.ReactNode;
}) {
  const style = useColumnStyle(col);
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
