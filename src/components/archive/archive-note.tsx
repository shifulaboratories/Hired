import Link from "next/link";
import { Trash2Icon } from "lucide-react";
import { ARCHIVE_KIND_LABEL, type ArchiveKind } from "@/lib/data/archive";

/**
 * One quiet line under a list, when that kind has anything in the bin.
 *
 * This is the come-back-a-week-later path, and it matters more than the nav
 * slot: somebody looking for a company they deleted goes to the company list
 * first, not to a menu they have never opened.
 */
export function ArchiveNote({ kind, count }: { kind: ArchiveKind; count: number }) {
  if (count === 0) return null;
  const label = ARCHIVE_KIND_LABEL[kind];
  return (
    <p className="text-faint mt-3 flex items-center gap-1.5 text-[12px]">
      <Trash2Icon className="size-3" />
      <Link href={`/archive?kind=${kind}`} className="hover:text-foreground transition-colors">
        {count} {count === 1 ? label.one : label.many} in the archive
      </Link>
    </p>
  );
}
