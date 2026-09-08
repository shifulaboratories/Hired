"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2Icon } from "lucide-react";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CompanyAvatar } from "@/components/pipeline/company-avatar";
import { TagChip, type TagValue } from "@/components/tags/tag-chip";
import { SelectionBar } from "@/components/crm/selection-bar";
import { NewCompanyDialog } from "@/components/crm/new-company-dialog";
import { ResizableColumns, useColumnStyle } from "@/components/lists/resizable-columns";
import type { StoredWidths } from "@/lib/column-widths";
import { archiveRecordsAction, tagCompaniesAction } from "@/server/actions";
import { cn } from "@/lib/utils";

export type CompanyRow = {
  id: string;
  name: string;
  website: string;
  domain: string | null;
  industry: TagValue[];
  location: TagValue[];
  lastApplied: string;
  applications: number;
  openApplications: number;
  contacts: number;
};

/**
 * The companies table, its selection and its empty state.
 *
 * All three live in one client component on purpose. The obvious split — server
 * page renders the table, client component renders the bar — breaks on the one
 * path that matters most: filter down to no matches and the table subtree
 * unmounts, taking the selection with it, so "9 selected" vanishes the moment
 * you narrow the list you were selecting from.
 */
export function CompaniesList({
  rows,
  filtered,
  exportHref,
  header,
  widths,
}: {
  rows: CompanyRow[];
  /** Anything at all is narrowing the list, so the empty state says so. */
  filtered: boolean;
  exportHref: string;
  /**
   * The column headings, built on the server from the URL. They are
   * SortHeaders, which are client components, so they read their width from
   * the provider below even though the page that composed them is a server
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

  // Only what is on screen. Ticking the header while a filter is on must not
  // quietly select the rows the filter removed.
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (allOn) next.delete(row.id);
        else next.add(row.id);
      }
      return next;
    });

  return (
    <div>
      {selected.size > 0 && (
        <SelectionBar
          ids={chosen.length > 0 ? chosen : [...selected]}
          what={{ one: "company", many: "companies" }}
          tagKind="COMPANY"
          onTag={tagCompaniesAction}
          onArchive={(ids) => archiveRecordsAction("company", ids)}
          // Only the ids, not the screen's filters: the route intersects the
          // two, so exporting a selection whose rows the filter has since
          // excluded would hand back an empty file while the bar counts them.
          exportHref={`/api/export/companies?ids=${[...selected].join(",")}`}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* The selection can outlive the rows it was made from — tick nine, then
          search for something none of them match. Say so rather than showing an
          empty screen with a bar on it claiming nine. */}
      {rows.length === 0 && selected.size > 0 && (
        <p className="text-faint mb-3 text-[12.5px]">
          None of the {selected.size} selected are on this screen. Clear the filters to see them.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title={filtered ? "Nothing matches that" : "No companies yet"}
          description={
            filtered
              ? "Loosen the search or the filter to see everything again."
              : "Track a job and its company appears here, or add one now to keep research somewhere before you apply."
          }
          action={
            filtered ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/crm/companies">Show everything</Link>
              </Button>
            ) : (
              <NewCompanyDialog />
            )
          }
        />
      ) : (
        <ResizableColumns list="companies" stored={widths}>
        <div className="bg-card shadow-card overflow-hidden rounded-xl">
          <div className="eyebrow bg-inset flex items-center gap-3 px-4 py-2">
            <Checkbox
              checked={allOn}
              onCheckedChange={toggleAll}
              aria-label="Select every company on this screen"
            />
            {header}
          </div>

          <ul className="divide-y">
            {rows.map((company) => (
              <li
                key={company.id}
                className={cn(
                  "hover:bg-accent/50 relative flex items-center gap-3 px-4 transition-colors duration-150",
                  selected.has(company.id) && "bg-accent/40",
                )}
              >
                {/* Above the stretched link, so ticking a row never navigates.
                    `relative` alone is not enough: the overlay is the Link's
                    ::before, the Link comes later in the DOM, and two
                    positioned things with no z-index are painted in DOM
                    order — so the overlay swallowed every click on the box. */}
                <div className="relative z-[1]">
                  <Checkbox
                    checked={selected.has(company.id)}
                    onCheckedChange={() => toggle(company.id)}
                    aria-label={`Select ${company.name}`}
                  />
                </div>

                <Link
                  href={`/crm/companies/${company.id}`}
                  data-nav-item
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 before:absolute before:inset-0"
                >
                  <CompanyAvatar name={company.name} domain={company.domain} size={26} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{company.name}</div>
                    <div className="text-faint truncate text-[12px]">
                      {company.website || "No website on file"}
                    </div>
                  </div>
                </Link>

                <TagCell col="industry" tags={company.industry} className="md:flex" />
                <TagCell col="location" tags={company.location} className="xl:flex" />

                <Cell
                  col="lastApplied"
                  className="nums text-muted-foreground hidden w-24 shrink-0 text-right text-[12px] sm:block"
                >
                  {company.lastApplied}
                </Cell>
                <Cell
                  col="applications"
                  className="nums text-muted-foreground w-24 shrink-0 text-right text-[12px]"
                >
                  {company.applications || "—"}
                  {company.openApplications > 0 && (
                    <span className="text-faint"> · {company.openApplications} open</span>
                  )}
                </Cell>
                <Cell col="contacts" className="nums text-faint w-16 shrink-0 text-right text-[12px]">
                  {company.contacts || "—"}
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

/**
 * One column of tags, clipped to the width the header reserved.
 *
 * Industry and location were single strings and are lists now, so a cell that
 * truncated text has to wrap chips instead — and stay one line, because the row
 * next to it is a fixed-height link.
 */
function TagCell({
  col,
  tags,
  className,
}: {
  col: string;
  tags: TagValue[];
  className?: string;
}) {
  const style = useColumnStyle(col);
  return (
    <div
      className={cn("hidden w-36 shrink-0 items-center gap-1 overflow-hidden", className)}
      style={style}
    >
      {tags.length === 0 ? (
        <span className="text-faint text-[12px]">—</span>
      ) : (
        tags.map((tag) => <TagChip key={tag.id} tag={tag} className="shrink-0" />)
      )}
    </div>
  );
}
