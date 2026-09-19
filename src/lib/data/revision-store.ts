import type { Prisma, RevisionKind } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Taking the before image, and logging that a write happened.
 *
 * A leaf on purpose. `src/lib/data/me.ts` and `src/lib/data/resumes.ts` both
 * call `snapshot` on their replacing writes, and `pipeline.ts` imports `me.ts`,
 * and client components import `pipeline.ts` for its labels and tones. So
 * anything this file imports lands in the browser bundle — and revisions.ts,
 * which reaches back into resumes.ts to perform a restore, pulls `node:crypto`
 * behind it and fails the build.
 *
 * Same split, and the same reason, as schedule.ts sitting beside pipeline.ts
 * rather than inside it. The read-and-restore half is revisions.ts; this is the
 * write half, and it imports nothing but the client.
 *
 * Both functions here SWALLOW their own failures. A person losing an edit to a
 * bookkeeping error would be strictly worse than losing the history of it, and
 * a log row that fails to write must not turn a successful tool call into an
 * error the model sees.
 */

export type RevisionKindName = RevisionKind;

/** Who caused a write, threaded down from the tool handler or a server action. */
export type WriteAuthor = {
  /** "mcp" when a tool call caused it, "app" when one of this app's own screens did. */
  writtenBy: "mcp" | "app";
  connectionId?: string;
  connectionName?: string;
  tool?: string;
  /** A restore sets this, so the write it performs is itself undoable. */
  force?: boolean;
};

/** The default every server action gets: the person, at a keyboard, in this app. */
export const APP_AUTHOR: WriteAuthor = { writtenBy: "app" };

/** One revision per record, per author, per ten minutes. See the header. */
export const COALESCE_WINDOW_MS = 10 * 60_000;

/**
 * How many versions of one record are kept.
 *
 * Enforced at write time with one extra bounded `deleteMany` against the
 * composite index, rather than by a global sweep that would have to scan the
 * table by group. Twenty large backgrounds is a few hundred kilobytes per
 * record, which is the ceiling worth having.
 */
export const REVISIONS_PER_RECORD = 20;

/**
 * Take the before image, unless one was taken recently by the same author.
 *
 * Returns the row written, or null when it was coalesced away. Never throws:
 * failing to take a copy must not fail the write the copy is about, because a
 * person losing their edit to a bookkeeping error would be strictly worse than
 * losing the history.
 */
export async function snapshot(
  userId: string,
  kind: RevisionKindName,
  recordId: string,
  data: unknown,
  label: string,
  author: WriteAuthor,
): Promise<{ id: string; createdAt: Date } | null> {
  try {
    if (!author.force) {
      const newest = await db.revision.findFirst({
        where: { userId, kind, recordId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, writtenBy: true, connectionId: true },
      });
      // Same author, same sitting: the older image is the one worth keeping.
      if (
        newest &&
        newest.writtenBy === author.writtenBy &&
        newest.connectionId === (author.connectionId ?? "") &&
        Date.now() - newest.createdAt.getTime() < COALESCE_WINDOW_MS
      ) {
        return null;
      }
    }

    const written = await db.revision.create({
      data: {
        userId,
        kind,
        recordId,
        data: data as Prisma.InputJsonValue,
        label,
        writtenBy: author.writtenBy,
        connectionId: author.connectionId ?? "",
        connectionName: author.connectionName ?? "",
        tool: author.tool ?? "",
      },
      select: { id: true, createdAt: true },
    });

    // The cap, at write time. One bounded query against the composite index.
    const keep = await db.revision.findMany({
      where: { userId, kind, recordId },
      orderBy: { createdAt: "desc" },
      skip: REVISIONS_PER_RECORD,
      select: { id: true },
    });
    if (keep.length > 0) {
      await db.revision.deleteMany({ where: { id: { in: keep.map((row) => row.id) } } });
    }

    return written;
  } catch {
    // Deliberately swallowed. See the doc comment.
    return null;
  }
}

/** The nouns a tool name can carry, longest first so "saved_view" beats "view". */
const SUBJECTS: [string, string][] = [
  ["resume", "resume"],
  ["role", "role"],
  ["application", "application"],
  ["company", "company"],
  ["companies", "company"],
  ["contact", "contact"],
  ["interview", "interview"],
  ["question", "question"],
  ["offer", "offer"],
  ["letter", "letter"],
  ["task", "task"],
  ["note", "note"],
  ["highlight", "highlight"],
  ["tag", "tag"],
  ["proposal", "proposal"],
  ["view", "saved view"],
];

/** What a tool touched, guessed from its name. "other" is an honest answer. */
export function subjectOf(tool: string): string {
  for (const [needle, noun] of SUBJECTS) {
    if (tool.includes(needle)) return noun;
  }
  return "other";
}

/**
 * Record one mutating tool call.
 *
 * Awaited by the handler but never allowed to be fatal: a log row that fails to
 * write must not turn a successful tool call into an error the model sees.
 */
export async function recordWrite(input: {
  userId: string;
  connectionId: string;
  connectionName: string;
  tool: string;
  summary: string;
  kind?: string;
  recordId?: string;
}): Promise<void> {
  try {
    await db.writeLog.create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId,
        connectionName: input.connectionName,
        tool: input.tool,
        kind: input.kind ?? subjectOf(input.tool),
        recordId: input.recordId ?? "",
        summary: input.summary.slice(0, 500),
      },
    });
  } catch {
    // Deliberately swallowed. See the doc comment.
  }
}

