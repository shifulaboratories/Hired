import type { RevisionKind } from "@prisma/client";
import { db } from "@/lib/db";
import {
  REVISIONS_PER_RECORD,
  type RevisionKindName,
  type WriteAuthor,
} from "@/lib/data/revision-store";

/** The age sweep runs at most this often, however many replicas call it. */
const SWEEP_EVERY_MS = 6 * 3_600_000;
import { getSettings, setSetting, SETTING_KEYS } from "@/lib/settings";
import { resumeDocSchema } from "@/lib/resume-schema";
import * as resumes from "@/lib/data/resumes";
import * as me from "@/lib/data/me";

/**
 * What things looked like before they were replaced, and what each assistant did.
 *
 * `update_resume` and `update_role` REPLACE what you send. That is their
 * contract, it is the right contract, and it is the sharpest edge in the whole
 * tool surface — `append_role_background` exists because assistants kept
 * overwriting people's notes with `update_role`. Until now the only answer was
 * a tool description shouting about it. This is the copy taken on the way past.
 *
 * FIVE things decided here, each of which a future reader will otherwise get
 * wrong:
 *
 * 1. **Before images, never after.** To put something back you need the state
 *    you are going back TO, so the newest row for a record is the restore point
 *    and the current state stays in the record. A record nobody has overwritten
 *    costs nothing.
 * 2. **The snapshot is taken in the data layer, not the handler.** It can only
 *    be taken where the row is read before it is written, which is inside
 *    `updateResume` and `updateRole` — two call sites covering both the MCP
 *    tools and the editor's autosave, and which a future writer cannot forget
 *    because there is nowhere else the replace happens.
 * 3. **Coalescing.** The resume editor autosaves on a 700ms debounce. Without a
 *    window, twenty minutes of typing into a 40KB document writes two hundred
 *    revisions and eight megabytes, each differing from its neighbour by a word.
 *    So one revision per record, per author, per ten minutes — and the OLDER
 *    image survives, which is the right one: the record as it stood before this
 *    sitting of work began. The cost is stated in every tool description here:
 *    undoing a change made inside an earlier change's window takes you back past
 *    both.
 * 4. **A restore forces a revision.** Without that, an undo performed a minute
 *    after a bad write would be coalesced away and there would be no redo. With
 *    it, the forced snapshot IS the redo point, for free.
 * 5. **The two tables are joined by TIME, not a foreign key.** A write-log row
 *    carries kind, recordId and createdAt; undo means "the newest revision for
 *    that record at or before that instant". Deriving the link is what stops the
 *    handler needing to learn a revision id only the data layer knows, and it
 *    stays correct when a revision was coalesced away.
 *
 * `snapshot` and `recordWrite` live one file over in revision-store.ts, which
 * imports nothing but the client: this file reaches back into resumes.ts and
 * me.ts to perform a restore, and those two call snapshot on the way in. One
 * module for both halves would be a cycle that drags node:crypto into the
 * browser bundle, which is exactly what it did before the split.
 *
 * Deletes are NOT snapshotted. `delete_role`, `delete_resume` and the rest
 * destroy the row and their copy says so; making them recoverable would quietly
 * falsify a dozen shipped strings and enlarge the archive's deliberate
 * three-model scope. That is a separate decision.
 */

// Re-exported so the tools and the sweep have one import path for the subject,
// while me.ts and resumes.ts import the leaf directly and stay out of the
// browser bundle.
export {
  APP_AUTHOR,
  COALESCE_WINDOW_MS,
  REVISIONS_PER_RECORD,
  recordWrite,
  snapshot,
  subjectOf,
} from "@/lib/data/revision-store";
export type { RevisionKindName, WriteAuthor } from "@/lib/data/revision-store";

export type RevisionRow = {
  id: string;
  kind: RevisionKindName;
  recordId: string;
  label: string;
  writtenBy: string;
  connectionName: string;
  tool: string;
  createdAt: Date;
  /** Bytes of the stored blob, so a caller can see what it is holding. */
  size: number;
};

const rowSelect = {
  id: true,
  kind: true,
  recordId: true,
  label: true,
  writtenBy: true,
  connectionName: true,
  tool: true,
  createdAt: true,
} as const;

function sized(row: Omit<RevisionRow, "size">, data: unknown): RevisionRow {
  return { ...row, size: JSON.stringify(data ?? null).length };
}

/** Snapshots for one record, newest first. Never returns the blobs. */
export async function listRevisions(
  userId: string,
  kind: RevisionKindName,
  recordId: string,
  limit = REVISIONS_PER_RECORD,
): Promise<{ rows: RevisionRow[]; recordExists: boolean; currentLabel: string }> {
  const [rows, current] = await Promise.all([
    db.revision.findMany({
      where: { userId, kind, recordId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), REVISIONS_PER_RECORD),
      select: { ...rowSelect, data: true },
    }),
    kind === "RESUME"
      ? db.resume.findFirst({ where: { id: recordId, userId }, select: { name: true } })
      : db.role.findFirst({ where: { id: recordId, userId }, select: { title: true, company: true } }),
  ]);

  const currentLabel = current
    ? "name" in current
      ? current.name
      : `${current.title} at ${current.company}`
    : "";

  return {
    rows: rows.map(({ data, ...row }) => sized(row, data)),
    // Restoring to a record that has been deleted is not possible, and saying so
    // up front is better than a failed restore.
    recordExists: current !== null,
    currentLabel,
  };
}

/** One revision including its blob. */
export async function getRevision(userId: string, id: string) {
  const row = await db.revision.findFirst({
    where: { id, userId },
    select: { ...rowSelect, data: true },
  });
  if (!row) return null;
  const { data, ...rest } = row;
  return { ...sized(rest, data), data };
}

/**
 * The newest revision for a record at or before an instant — the restore point
 * for a write-log row. This is the join between the two tables, derived rather
 * than stored, which is what keeps it right when a revision was coalesced away.
 */
export async function revisionAt(
  userId: string,
  kind: RevisionKindName,
  recordId: string,
  at: Date,
): Promise<RevisionRow | null> {
  const row = await db.revision.findFirst({
    where: { userId, kind, recordId, createdAt: { lte: at } },
    orderBy: { createdAt: "desc" },
    select: { ...rowSelect, data: true },
  });
  if (!row) return null;
  const { data, ...rest } = row;
  return sized(rest, data);
}

/**
 * Put a revision back.
 *
 * Goes out through `updateResume` / `updateRole`, so it re-validates and writes
 * its own forced revision — which is how a restore is itself undoable.
 *
 * THROWS rather than writing a blank document when a RESUME blob does not
 * parse. `parseResumeDoc` returns `emptyResumeDoc()` on failure rather than
 * throwing, so handing it a bad blob would silently replace the resume with an
 * empty one: the exact catastrophe this feature exists to prevent, delivered by
 * the feature itself. The check is here, before `updateResume` is ever called.
 */
export async function restoreRevision(
  userId: string,
  id: string,
  author: WriteAuthor,
): Promise<{
  kind: RevisionKindName;
  recordId: string;
  restoredFrom: Date;
  redoRevisionId: string | null;
  changed: boolean;
  summary: string;
}> {
  const revision = await getRevision(userId, id);
  if (!revision) throw new Error(`No revision with id ${id}`);

  const restoring: WriteAuthor = { ...author, force: true, tool: author.tool || "restore_revision" };

  if (revision.kind === "RESUME") {
    const blob = revision.data as { name?: string; doc?: unknown } | null;
    const parsed = resumeDocSchema.safeParse(blob?.doc);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `That stored version does not parse as a resume (${issue?.path.join(".") || "document"}: ${issue?.message || "invalid"}), so restoring it would replace the resume with a blank one. Nothing was changed.`,
      );
    }
    const current = await resumes.getResume(userId, revision.recordId);
    if (!current) {
      throw new Error("That resume has been deleted, so there is nothing to restore it to.");
    }
    const same = JSON.stringify(current.doc) === JSON.stringify(parsed.data);
    const before = await db.revision.findFirst({
      where: { userId, kind: "RESUME", recordId: revision.recordId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    await resumes.updateResume(userId, revision.recordId, { data: parsed.data }, restoring);
    const after = await db.revision.findFirst({
      where: { userId, kind: "RESUME", recordId: revision.recordId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return {
      kind: "RESUME",
      recordId: revision.recordId,
      restoredFrom: revision.createdAt,
      // The forced snapshot that update just took holds the document as it was
      // a moment ago, which makes it the redo point.
      redoRevisionId: after && after.id !== before?.id ? after.id : null,
      changed: !same,
      summary: same
        ? `${current.name} already matched that version; nothing changed.`
        : `Put ${current.name} back to how it was on ${revision.createdAt.toISOString().slice(0, 10)}.`,
    };
  }

  const current = await me.getRole(userId, revision.recordId);
  if (!current) {
    throw new Error("That role has been deleted, so there is nothing to restore it to.");
  }
  const blob = (revision.data ?? {}) as Record<string, unknown>;
  const before = await db.revision.findFirst({
    where: { userId, kind: "ROLE", recordId: revision.recordId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  // `pick(patch, ROLE_COLUMNS)` inside updateRole is the narrowing. A tampered
  // blob naming another userId is dropped before Prisma sees it, which is why
  // this goes out through the ordinary path rather than db.role.update.
  await me.updateRole(userId, revision.recordId, blob as Parameters<typeof me.updateRole>[2], restoring);
  const after = await db.revision.findFirst({
    where: { userId, kind: "ROLE", recordId: revision.recordId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const same = ROLE_SNAPSHOT_KEYS.every(
    (key) => JSON.stringify((current as Record<string, unknown>)[key]) === JSON.stringify(blob[key]),
  );
  return {
    kind: "ROLE",
    recordId: revision.recordId,
    restoredFrom: revision.createdAt,
    redoRevisionId: after && after.id !== before?.id ? after.id : null,
    changed: !same,
    summary: same
      ? `${current.title} at ${current.company} already matched that version; nothing changed.`
      : `Put ${current.title} at ${current.company} back to how it was on ${revision.createdAt.toISOString().slice(0, 10)}.`,
  };
}

/** Mirrors ROLE_COLUMNS in me.ts. Only used to decide whether a restore changed anything. */
const ROLE_SNAPSHOT_KEYS = [
  "company",
  "title",
  "employmentType",
  "location",
  "startDate",
  "endDate",
  "isCurrent",
  "summary",
  "background",
  "tags",
] as const;

// ---------------------------------------------------------------------------
// The change log
// ---------------------------------------------------------------------------

export type ChangeRow = {
  id: string;
  tool: string;
  kind: string;
  recordId: string;
  summary: string;
  connectionName: string;
  createdAt: Date;
  /**
   * When this row can be undone, the instant the record would go back to.
   * Null when nothing was snapshotted — every kind but resume and role, and a
   * write that happened before any version existed.
   */
  restorePointAt: Date | null;
  undoable: boolean;
};

/** What the connections did, newest first. */
export async function listChanges(
  userId: string,
  options?: { connectionId?: string; tool?: string; kind?: string; recordId?: string; limit?: number },
): Promise<ChangeRow[]> {
  const rows = await db.writeLog.findMany({
    where: {
      userId,
      ...(options?.connectionId ? { connectionId: options.connectionId } : {}),
      ...(options?.tool ? { tool: options.tool } : {}),
      ...(options?.kind ? { kind: options.kind } : {}),
      ...(options?.recordId ? { recordId: options.recordId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options?.limit ?? 50, 1), 500),
  });

  // Undoable rows resolve their restore point; the rest cost nothing.
  return Promise.all(
    rows.map(async (row) => {
      const kind = row.kind === "resume" ? "RESUME" : row.kind === "role" ? "ROLE" : null;
      const point =
        kind && row.recordId ? await revisionAt(userId, kind, row.recordId, row.createdAt) : null;
      return {
        id: row.id,
        tool: row.tool,
        kind: row.kind,
        recordId: row.recordId,
        summary: row.summary,
        connectionName: row.connectionName,
        createdAt: row.createdAt,
        restorePointAt: point?.createdAt ?? null,
        undoable: point !== null,
      };
    }),
  );
}

/**
 * Put back whatever one logged change replaced.
 *
 * Only resume and role writes are undoable, because they are the only two that
 * replace a record wholesale and therefore the only two that are snapshotted.
 * Everything else in the log is a line for the eye — and a deleted application
 * is the archive's job, not this one.
 */
export async function undoChange(
  userId: string,
  writeLogId: string,
  author: WriteAuthor,
): Promise<ReturnType<typeof restoreRevision> extends Promise<infer T> ? T : never> {
  const row = await db.writeLog.findFirst({ where: { id: writeLogId, userId } });
  if (!row) throw new Error(`No change with id ${writeLogId}`);

  const kind: RevisionKindName | null =
    row.kind === "resume" ? "RESUME" : row.kind === "role" ? "ROLE" : null;
  if (!kind || !row.recordId) {
    throw new Error(
      `${row.tool} cannot be undone: only writes that replace a resume or a role are versioned. Deleting a company, a person or an application is undone from the archive with restore_records; everything else has to be put back by hand.`,
    );
  }

  const point = await revisionAt(userId, kind, row.recordId, row.createdAt);
  if (!point) {
    throw new Error(
      "There is no stored version from before that change, so there is nothing to put back. It may have been swept, or it may predate version history on this instance.",
    );
  }
  return restoreRevision(userId, point.id, author);
}

/**
 * Age sweep, instance-wide.
 *
 * No `userId`, for the reason archive.ts gives about its own: this takes no
 * content in and returns none out, and a per-user sweep would be a hundred
 * queries to do one table's housekeeping. There is no cron and no worker in
 * this app, so it is called opportunistically and throttles itself through a
 * Setting row rather than a process timer, because the transport is stateless
 * and may be running as more than one replica.
 */
export async function sweepRevisions(now = new Date()): Promise<{ purged: number; skipped: boolean }> {
  const settings = await getSettings();
  if (settings.revisionRetentionDays <= 0) return { purged: 0, skipped: true };

  const last = await db.setting.findUnique({ where: { key: SETTING_KEYS.revisionsSweptAt } });
  const lastRun = last ? Number.parseInt(last.value, 10) : 0;
  if (Number.isFinite(lastRun) && now.getTime() - lastRun < SWEEP_EVERY_MS) {
    return { purged: 0, skipped: true };
  }
  await setSetting(SETTING_KEYS.revisionsSweptAt, String(now.getTime()));

  const cutoff = new Date(now.getTime() - settings.revisionRetentionDays * 86_400_000);
  const revisions = (await db.revision.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  const changes = (await db.writeLog.deleteMany({ where: { createdAt: { lt: cutoff } } })).count;
  return { purged: revisions + changes, skipped: false };
}
