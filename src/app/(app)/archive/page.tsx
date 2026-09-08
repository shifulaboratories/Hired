import Link from "next/link";
import { PageHeader, PageShell } from "@/components/page-header";
import { FadeIn } from "@/components/motion";
import { SearchBox } from "@/components/crm/search-box";
import { ArchiveList, type BinRow } from "@/components/archive/archive-list";
import { EmptyArchiveButton } from "@/components/archive/empty-archive-button";
import { requireUser } from "@/lib/auth";
import {
  ARCHIVE_KINDS,
  ARCHIVE_KIND_LABEL,
  listArchive,
  purgeExpiredFor,
  type ArchiveKind,
} from "@/lib/data/archive";
import { agoDay, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function parseKind(value: string | undefined): ArchiveKind | undefined {
  return (ARCHIVE_KINDS as string[]).includes(value ?? "") ? (value as ArchiveKind) : undefined;
}

/** "in 23 days", "today", or "never" when this instance keeps everything. */
function goesIn(purgeAt: Date | null, now: number) {
  if (!purgeAt) return { label: "never", daysLeft: null };
  const days = Math.ceil((purgeAt.getTime() - now) / 86400000);
  if (days <= 0) return { label: "today", daysLeft: 0 };
  if (days === 1) return { label: "tomorrow", daysLeft: 1 };
  return { label: `in ${days} days`, daysLeft: days };
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const kind = parseKind(one("kind"));
  const search = one("q")?.trim() ?? "";

  // Awaited, not fired and forgotten. A row showing "in 2 days" that has
  // already passed its window and vanishes on the next refresh is a screen
  // that lied; everywhere else the sweep can run in the background.
  await purgeExpiredFor(user.id);
  const { entries, counts, total, retentionDays, capped } = await listArchive(user.id, {
    kind,
    search: search || undefined,
  });

  const now = Date.now();
  const rows: BinRow[] = entries.map((entry) => {
    const { label, daysLeft } = goesIn(entry.purgeAt, now);
    return {
      kind: entry.kind,
      id: entry.id,
      title: entry.title,
      subtitle: entry.subtitle,
      withIt: entry.withIt,
      archivedAgo: agoDay(entry.archivedAt),
      goesIn: label,
      daysLeft,
      nameTaken: entry.nameTaken,
    };
  });

  const href = (next: ArchiveKind | undefined) => {
    const query = new URLSearchParams();
    if (next) query.set("kind", next);
    if (search) query.set("q", search);
    const string = query.toString();
    return string ? `/archive?${string}` : "/archive";
  };

  const chips: { key: ArchiveKind | undefined; label: string; count: number }[] = [
    { key: undefined, label: "Everything", count: total },
    ...ARCHIVE_KINDS.map((value) => ({
      key: value,
      label: ARCHIVE_KIND_LABEL[value].many.replace(/^./, (c) => c.toUpperCase()),
      count: counts[value],
    })),
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Account"
        title="Archive"
        // Read live from the setting, so the promise on screen can never be one
        // this instance is not keeping.
        description={
          retentionDays > 0
            ? `Anything you delete lands here first. It is deleted for good ${retentionDays} days after it was archived — restore what you want back before then.`
            : "Anything you delete lands here first. Nothing is deleted automatically on this instance, so clear it out when you are done with it."
        }
        actions={total > 0 ? <EmptyArchiveButton total={total} /> : undefined}
      />

      <FadeIn>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchBox placeholder="Search the archive…" className="w-full sm:w-72" />
          {/* The counts come from unfiltered queries, so with a search on
              they are the whole bin rather than what is on screen. Say both
              rather than printing the larger one where every other list on the
              site prints the smaller. */}
          <span className="text-faint nums ml-auto text-[12px]">
            {search || kind
              ? `${rows.length} of ${total} ${total === 1 ? "item" : "items"}`
              : `${total} ${total === 1 ? "item" : "items"}`}
          </span>
        </div>

        <div className="no-scrollbar -mx-1 mb-3 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
          {chips.map((chip) => {
            const active = kind === chip.key;
            return (
              <Link
                key={chip.label}
                href={href(chip.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "touch-target flex h-11 shrink-0 items-center gap-1.5 rounded-chip px-2 text-[12.5px] transition-colors duration-150 md:h-7",
                  active
                    ? "bg-accent text-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  // A kind with nothing in it stays visible but dimmed, so the
                  // shape of the bin is legible rather than shifting about.
                  chip.count === 0 && !active && "text-faint",
                )}
              >
                {chip.label}
                <span className="text-faint nums">{chip.count}</span>
              </Link>
            );
          })}
        </div>

        <ArchiveList rows={rows} filtered={Boolean(kind || search)} />

        {capped.length > 0 && (
          <p className="text-faint mt-3 text-[12px]">
            Showing the 200 most recently archived of each kind.
          </p>
        )}
      </FadeIn>
    </PageShell>
  );
}
