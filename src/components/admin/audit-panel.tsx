"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/filter-chip";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_GROUPS,
  AUDIT_GROUP_LABEL,
  AUDIT_SEVERE,
  type AuditGroup,
} from "@/lib/audit-groups";
import { loadAuditAction } from "@/server/actions";
import { cn } from "@/lib/utils";
import { useViewerZone } from "@/components/viewer-zone";
import { formatIn } from "@/lib/time";

export type AuditRow = {
  id: string;
  actorEmail: string;
  action: string;
  targetEmail: string;
  detail: string;
  createdAt: string;
};

/**
 * What admins have done to accounts, and to the instance's configuration.
 *
 * Read-only by design and with no delete control: a log an admin can edit
 * answers nothing. Rows outlive the accounts they describe, which is why a
 * deleted user still appears here by address.
 *
 * Two modes. On one person's page it is a plain list of what happened to them,
 * already filtered by the server. On the Log tab it is `filterable`, and then
 * every cut and every extra page is another server round-trip — the log is the
 * longest-lived table on an instance, so filtering rows already in the browser
 * would quietly show you the wrong hundred.
 */
export function AuditPanel({
  rows,
  filterable = false,
}: {
  rows: AuditRow[];
  filterable?: boolean;
}) {
  if (!filterable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">Account activity</CardTitle>
          <p className="text-muted-foreground text-sm">
            Every administrative change to this account, newest first. Nothing here touches
            anyone&apos;s career history, resumes or applications — admins never see those.
          </p>
        </CardHeader>
        <CardContent>
          <RowList rows={rows} empty="Nothing yet. Role changes, suspensions and password resets are recorded here as they happen." />
        </CardContent>
      </Card>
    );
  }
  return <FilterableLog initial={rows} />;
}

const GROUPS = Object.keys(AUDIT_GROUPS) as AuditGroup[];
const PAGE = 100;

function FilterableLog({ initial }: { initial: AuditRow[] }) {
  const [group, setGroup] = useState<AuditGroup | null>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(initial);
  const [more, setMore] = useState(initial.length >= PAGE);
  const [pending, startTransition] = useTransition();
  // The first render already has the server's page; re-fetching it on mount
  // would be a wasted round-trip and a flash of the same rows.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await loadAuditAction({
          group: group ?? undefined,
          search: search.trim() || undefined,
          limit: PAGE,
        });
        setRows(result.rows);
        setMore(result.more);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [group, search]);

  const loadMore = () =>
    startTransition(async () => {
      const result = await loadAuditAction({
        group: group ?? undefined,
        search: search.trim() || undefined,
        offset: rows.length,
        limit: PAGE,
      });
      setRows((prev) => [...prev, ...result.rows]);
      setMore(result.more);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Administrative activity</CardTitle>
        <p className="text-muted-foreground text-sm">
          Every change an admin made to an account or to how this instance is configured, newest
          first. Nothing here touches anyone&apos;s career history, resumes or applications — admins never
          see those, and a secret is recorded as having been set, never as its value.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1">
            <FilterChip active={group === null} onClick={() => setGroup(null)}>
              Everything
            </FilterChip>
            {GROUPS.map((key) => (
              <FilterChip
                key={key}
                active={group === key}
                onClick={() => setGroup(group === key ? null : key)}
              >
                {AUDIT_GROUP_LABEL[key]}
              </FilterChip>
            ))}
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by email…"
            className="w-full sm:ml-auto sm:w-56"
            aria-label="Filter the log by email address"
          />
        </div>

        <div className={cn(pending && "opacity-60 transition-opacity")}>
          <RowList
            rows={rows}
            empty={
              group || search
                ? "Nothing matches that."
                : "Nothing yet. Invitations, role changes, suspensions, password resets and configuration changes are recorded here as they happen."
            }
          />
        </div>

        {more && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
              Show more
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RowList({ rows, empty }: { rows: AuditRow[]; empty: string }) {
  const zone = useViewerZone();
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-[13px]">{empty}</p>;
  }
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5">
          <span
            className={cn(
              "shrink-0 text-[13px] font-medium",
              AUDIT_SEVERE.has(row.action) && "text-destructive",
            )}
          >
            {AUDIT_ACTION_LABEL[row.action] ?? row.action}
          </span>
          {row.targetEmail && (
            <span className="text-muted-foreground truncate text-[13px]">{row.targetEmail}</span>
          )}
          <span className="text-faint meta ml-auto shrink-0 text-[11.5px]">
            {formatIn(new Date(row.createdAt), zone, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <div className="text-faint w-full text-[12px]">
            {row.detail ? `${row.detail} · ` : ""}by {row.actorEmail}
          </div>
        </li>
      ))}
    </ul>
  );
}
