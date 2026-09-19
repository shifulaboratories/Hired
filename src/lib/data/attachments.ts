import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import {
  attachmentFromUrl,
  humanBytes,
  normalizeAttachmentDataUri,
  type AttachmentBytes,
} from "@/lib/attachment-bytes";

/**
 * Files somebody kept, with the bytes in the row.
 *
 * The cost of that decision is the thing to remember while reading this file: a
 * `bytea` lives in the row's TOAST table and is not read unless a query selects
 * it, so EVERY read here names its columns and NONE of them names `data` except
 * `getAttachmentBytes`, which serves the download. One `findMany` that forgets
 * pulls the whole workspace's files into memory to count them.
 *
 * EXACTLY ONE SUBJECT, ALWAYS. `attachmentSubject` refuses zero and refuses two,
 * modelled on `taskSubject` in pipeline.ts — but unlike a task, an attachment
 * must have one: a file with no home is megabytes nobody can find, nobody
 * deletes and nothing cascades away.
 *
 * Attachments carry no `archivedAt`; they follow their subject. Four reads have
 * to spell the filter by hand and they are numbered at the line.
 */

export const ATTACHMENT_SUBJECTS = ["application", "offer", "letter", "contact", "company"] as const;
export type AttachmentSubject = (typeof ATTACHMENT_SUBJECTS)[number];
export type AttachmentSubjectInput = Partial<Record<`${AttachmentSubject}Id`, string>>;

/** Metadata only. `data` is never in this shape, which is the point of the type. */
export type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  caption: string;
  createdAt: Date;
  subject: { kind: AttachmentSubject; id: string; label: string };
};

export type AttachmentInput = {
  filename: string;
  /** A data URI or raw base64. One of this and `url`. */
  dataUri?: string;
  /** An https link the server fetches. Much the cheaper of the two. */
  url?: string;
  caption?: string;
} & AttachmentSubjectInput;

/**
 * A file whose subject is in the bin is not a file any list should show.
 *
 * This relies on EXACTLY ONE parent ever being set, so exactly one branch can
 * match. If the "exactly one subject" rule is ever relaxed, this clause
 * silently becomes an OR over two parents and a file whose job is binned but
 * whose company is live stays visible.
 *
 * The letter branch also allows a null applicationId, because a Letter with no
 * application is legal — it would otherwise match no branch and vanish from
 * every list. That is the shape listProposals already uses.
 */
const LIVE_SUBJECT = {
  OR: [
    { application: { archivedAt: null } },
    { contact: { archivedAt: null } },
    { company: { archivedAt: null } },
    { offer: { application: { archivedAt: null } } },
    { letter: { OR: [{ applicationId: null }, { application: { archivedAt: null } }] } },
  ],
};

const rowSelect = {
  id: true,
  filename: true,
  mimeType: true,
  size: true,
  caption: true,
  createdAt: true,
  applicationId: true,
  offerId: true,
  letterId: true,
  contactId: true,
  companyId: true,
  application: { select: { roleTitle: true, company: { select: { name: true } } } },
  offer: { select: { currency: true, baseAmount: true } },
  letter: { select: { title: true } },
  contact: { select: { name: true } },
  company: { select: { name: true } },
  // `data` is DELIBERATELY absent. See the file header.
} as const;

type RawRow = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  caption: string;
  createdAt: Date;
  applicationId: string | null;
  offerId: string | null;
  letterId: string | null;
  contactId: string | null;
  companyId: string | null;
  application: { roleTitle: string; company: { name: string } } | null;
  offer: { currency: string; baseAmount: number } | null;
  letter: { title: string } | null;
  contact: { name: string } | null;
  company: { name: string } | null;
};

function toRow(row: RawRow): AttachmentRow {
  const subject = row.applicationId
    ? {
        kind: "application" as const,
        id: row.applicationId,
        label: row.application
          ? `${row.application.roleTitle} at ${row.application.company.name}`
          : "an application",
      }
    : row.offerId
      ? {
          kind: "offer" as const,
          id: row.offerId,
          label: row.offer ? `${row.offer.currency} ${row.offer.baseAmount} offer` : "an offer",
        }
      : row.letterId
        ? { kind: "letter" as const, id: row.letterId, label: row.letter?.title || "a letter" }
        : row.contactId
          ? { kind: "contact" as const, id: row.contactId, label: row.contact?.name || "a person" }
          : {
              kind: "company" as const,
              id: row.companyId ?? "",
              label: row.company?.name || "a company",
            };
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    caption: row.caption,
    createdAt: row.createdAt,
    subject,
  };
}

/**
 * Exactly one subject, and it has to be live and theirs.
 *
 * You cannot attach a file to something in the bin: the file would be invisible
 * the moment it was written.
 */
async function attachmentSubject(userId: string, input: AttachmentSubjectInput) {
  const given = ATTACHMENT_SUBJECTS.filter((kind) => input[`${kind}Id`]);
  if (given.length === 0) {
    throw new Error(
      `A file has to hang off exactly one thing. Pass one of ${ATTACHMENT_SUBJECTS.map((kind) => `${kind}_id`).join(", ")}.`,
    );
  }
  if (given.length > 1) {
    throw new Error(`A file hangs off one thing, and you named ${given.length}: ${given.join(", ")}.`);
  }
  const kind = given[0];
  const id = input[`${kind}Id`]!;

  if (kind === "application") {
    const found = await db.application.findFirst({ where: { id, userId, archivedAt: null }, select: { id: true } });
    if (!found) throw new Error("No live application with that id.");
    return { applicationId: id };
  }
  if (kind === "contact") {
    const found = await db.contact.findFirst({ where: { id, userId, archivedAt: null }, select: { id: true } });
    if (!found) throw new Error("No live person with that id.");
    return { contactId: id };
  }
  if (kind === "company") {
    const found = await db.company.findFirst({ where: { id, userId, archivedAt: null }, select: { id: true } });
    if (!found) throw new Error("No live company with that id.");
    return { companyId: id };
  }
  if (kind === "offer") {
    // Through its application, which is the shape listOffers established.
    const found = await db.offer.findFirst({
      where: { id, userId, application: { archivedAt: null } },
      select: { id: true },
    });
    if (!found) throw new Error("No offer with that id on a live application.");
    return { offerId: id };
  }
  const found = await db.letter.findFirst({
    where: { id, userId, OR: [{ applicationId: null }, { application: { archivedAt: null } }] },
    select: { id: true },
  });
  if (!found) throw new Error("No letter with that id on a live application.");
  return { letterId: id };
}

export async function attachmentUsage(
  userId: string,
): Promise<{ files: number; bytes: number; capBytes: number; fileCapBytes: number }> {
  const settings = await getSettings();
  // DELIBERATELY UNFILTERED. Bytes in the bin are bytes on disk, and a usage
  // number that hid them would let somebody hit the cap with no way to see why.
  const totals = await db.attachment.aggregate({
    where: { userId },
    _count: { _all: true },
    _sum: { size: true },
  });
  return {
    files: totals._count._all,
    bytes: totals._sum.size ?? 0,
    capBytes: settings.attachmentWorkspaceBytes,
    fileCapBytes: settings.attachmentMaxBytes,
  };
}

export async function createAttachment(
  userId: string,
  input: AttachmentInput,
): Promise<{ attachment: AttachmentRow; reused: boolean; usedBytes: number; capBytes: number }> {
  const filename = input.filename.trim();
  if (!filename) throw new Error("A file needs a name.");
  if (Boolean(input.dataUri?.trim()) === Boolean(input.url?.trim())) {
    throw new Error("Pass exactly one of data_uri and url.");
  }

  const subject = await attachmentSubject(userId, input);
  const usage = await attachmentUsage(userId);

  let bytes: AttachmentBytes;
  if (input.url?.trim()) {
    bytes = await attachmentFromUrl(input.url, usage.fileCapBytes);
  } else {
    bytes = normalizeAttachmentDataUri(input.dataUri!, usage.fileCapBytes);
  }

  // Idempotence before the cap: attaching the same file twice must not be
  // refused for space it is not about to take.
  const existing = await db.attachment.findUnique({
    where: { userId_digest: { userId, digest: bytes.digest } },
    select: rowSelect,
  });
  if (existing) {
    return {
      attachment: toRow(existing as RawRow),
      reused: true,
      usedBytes: usage.bytes,
      capBytes: usage.capBytes,
    };
  }

  if (usage.bytes + bytes.size > usage.capBytes) {
    throw new Error(
      `This workspace is holding ${humanBytes(usage.bytes)} of files and the limit is ${humanBytes(usage.capBytes)}, so a ${humanBytes(bytes.size)} file does not fit. Delete something with delete_attachment, or ask an admin to raise "Attachments per workspace".`,
    );
  }

  const created = await db.attachment.create({
    data: {
      userId,
      filename,
      mimeType: bytes.mimeType,
      size: bytes.size,
      digest: bytes.digest,
      caption: input.caption?.trim() ?? "",
      data: new Uint8Array(bytes.data),
      ...subject,
    },
    select: rowSelect,
  });

  return {
    attachment: toRow(created as RawRow),
    reused: false,
    usedBytes: usage.bytes + bytes.size,
    capBytes: usage.capBytes,
  };
}

export async function listAttachments(
  userId: string,
  options?: AttachmentSubjectInput & { limit?: number },
): Promise<AttachmentRow[]> {
  const narrowing = Object.fromEntries(
    ATTACHMENT_SUBJECTS.map((kind) => [`${kind}Id`, options?.[`${kind}Id`]]).filter(
      ([, id]) => typeof id === "string" && id,
    ),
  );
  // ARCHIVE FILTER 1 of 4: without it, a list with no subject given returns
  // files hanging off binned jobs.
  const rows = await db.attachment.findMany({
    where: { userId, ...LIVE_SUBJECT, ...narrowing },
    select: { ...rowSelect },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options?.limit ?? 100, 1), 500),
  });
  return rows.map((row) => toRow(row as RawRow));
}

export async function getAttachment(userId: string, id: string): Promise<AttachmentRow | null> {
  // ARCHIVE FILTER 2 of 4.
  const row = await db.attachment.findFirst({
    where: { id, userId, ...LIVE_SUBJECT },
    select: rowSelect,
  });
  return row ? toRow(row as RawRow) : null;
}

/** How much of a text file a tool result should ever carry. */
const TEXT_LIMIT = 40_000;

/**
 * The text of a text-ish file, for an assistant that has to read one.
 *
 * Returns null for anything binary — NEVER a base64 fallback. A four-megabyte
 * base64 string in a tool result is a context window somebody else paid for.
 */
export async function readAttachmentText(
  userId: string,
  id: string,
  limit = TEXT_LIMIT,
): Promise<{ attachment: AttachmentRow; text: string | null; truncated: boolean }> {
  // ARCHIVE FILTER 3 of 4.
  const row = await db.attachment.findFirst({
    where: { id, userId, ...LIVE_SUBJECT },
    select: { ...rowSelect, data: true },
  });
  if (!row) throw new Error("No file with that id.");
  const meta = toRow(row as RawRow);

  const textual = /^text\//.test(row.mimeType) || row.mimeType === "application/json";
  if (!textual) return { attachment: meta, text: null, truncated: false };

  const whole = Buffer.from(row.data).toString("utf8");
  const cap = Math.min(Math.max(limit, 500), TEXT_LIMIT);
  return {
    attachment: meta,
    text: whole.length > cap ? whole.slice(0, cap) : whole,
    truncated: whole.length > cap,
  };
}

/**
 * The ONLY function that selects `data` for a download. Used by the route.
 *
 * DELIBERATELY UNFILTERED for the archive, for the reason offers.ts gives about
 * updateOffer: the id can only have come from somewhere that already showed it
 * to you, archiving is reversible, and a link in your own browser history for
 * your own file should not 404 because you binned the job this morning.
 */
export async function getAttachmentBytes(
  userId: string,
  id: string,
): Promise<{ filename: string; mimeType: string; size: number; data: Buffer } | null> {
  const row = await db.attachment.findFirst({
    where: { id, userId },
    select: { filename: true, mimeType: true, size: true, data: true },
  });
  return row ? { ...row, data: Buffer.from(row.data) } : null;
}

export async function deleteAttachment(userId: string, id: string): Promise<{ deleted: number }> {
  const { count } = await db.attachment.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No file with that id.");
  return { deleted: count };
}
