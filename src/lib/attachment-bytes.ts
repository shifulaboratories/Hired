/**
 * Turning whatever somebody hands us into a file we are willing to store.
 *
 * The same two ways a photo arrives — a data URI from a browser or an
 * assistant, or an https link the server fetches — so the rules about size and
 * type are written once and the route and the data layer cannot disagree about
 * what a valid file is. src/lib/photo.ts is the model this follows, one size up.
 *
 * THE TYPE IS READ FROM THE FILE, not from what the caller called it. A caller
 * that says `application/pdf` and sends a Windows executable is the shape this
 * guards against, and the declared type is trusted only for the text formats,
 * which have no magic number to read.
 */

import { createHash } from "node:crypto";

export type AttachmentBytes = {
  data: Buffer;
  /** What the bytes actually are, after sniffing. */
  mimeType: string;
  size: number;
  /** sha256, hex. What makes attaching the same file twice idempotent. */
  digest: string;
};

/**
 * What this app will hold, and nothing else.
 *
 * Refused BY NAME, the way normalizePhotoDataUri refuses, so somebody who
 * tried knows what happened rather than being told "invalid file".
 */
export const ATTACHMENT_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "text/plain": ["txt"],
  "text/markdown": ["md", "markdown"],
  "text/csv": ["csv"],
  "application/json": ["json"],
  "application/zip": ["zip"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

/** The ones with no magic number, where the declared type is all there is. */
const TEXTUAL = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

const FETCH_TIMEOUT_MS = 20_000;

export function humanBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1000))}KB`;
}

/**
 * What the first bytes say this is, or null when they say nothing.
 *
 * DOCX and XLSX are zips, so they sniff as `application/zip` and the declared
 * type is preferred when it is one of the two — which is the one place a
 * caller's word is taken for a binary format, and it can only widen a zip into
 * a more specific zip.
 */
export function sniffType(data: Buffer, declared: string): string | null {
  const head = data.subarray(0, 12);
  const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06)) {
    const office = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    return office.includes(declared) ? declared : "application/zip";
  }
  // A legacy .doc is an OLE compound file.
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "application/msword";
  return null;
}

/** Bytes a base64 payload decodes to, without decoding it. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function finish(data: Buffer, declared: string, capBytes: number): AttachmentBytes {
  if (data.byteLength === 0) throw new Error("That file is empty.");
  if (data.byteLength > capBytes) {
    throw new Error(
      `That file is ${humanBytes(data.byteLength)}. The limit here is ${humanBytes(capBytes)}.`,
    );
  }
  const sniffed = sniffType(data, declared);

  // THE DECLARED TYPE IS TRUSTED ONLY FOR THE TEXT FORMATS, which have no magic
  // number to read. For everything else the sniff has to succeed, and falling
  // back to the label would be the whole hole this function exists to close: a
  // caller saying "application/pdf" and sending a Windows executable sniffs as
  // nothing, and a fallback would store it as a PDF.
  const mimeType = sniffed ?? (TEXTUAL.has(declared) ? declared : "");
  if (!mimeType || !ATTACHMENT_TYPES[mimeType]) {
    throw new Error(
      sniffed === null && declared && !TEXTUAL.has(declared)
        ? `Those bytes are not ${declared} — they carry no format this app recognises. It takes PDFs, images, plain text, markdown, CSV, JSON, zips and Word or Excel documents, and it reads the type off the file rather than off what you called it.`
        : `${mimeType || declared || "that"} is not something this app will hold. It takes PDFs, images, plain text, markdown, CSV, JSON, zips and Word or Excel documents.`,
    );
  }
  return {
    data,
    mimeType,
    size: data.byteLength,
    digest: createHash("sha256").update(data).digest("hex"),
  };
}

/** Validate a data URI, or raw base64 with the type taken from the filename. */
export function normalizeAttachmentDataUri(
  value: string,
  capBytes: number,
  fallbackType = "application/octet-stream",
): AttachmentBytes {
  const trimmed = value.trim();
  const match = /^data:([a-z0-9/.+-]+)?(;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  // Raw base64 is accepted too, but it has to actually BE base64: a padded
  // multiple of four and long enough to be a file. Without that check a
  // sentence of prose ("just some words") reads as base64, decodes to noise,
  // and is refused three steps later with a message about MIME types.
  const bare = trimmed.replace(/\s/g, "");
  const looksBase64 =
    /^[A-Za-z0-9+/]+={0,2}$/.test(bare) && bare.length >= 16 && bare.length % 4 === 0;
  const base64 = match ? match[3] : looksBase64 ? trimmed : null;
  if (!base64) {
    throw new Error(
      "A file has to arrive as a base64 data URI, e.g. data:application/pdf;base64,… — or pass an https link instead and the server will fetch it.",
    );
  }
  // Checked BEFORE decoding: a 400MB base64 string should not become a 300MB
  // Buffer on the way to being refused.
  const declaredSize = decodedLength(base64.replace(/\s/g, ""));
  if (declaredSize > capBytes) {
    throw new Error(
      `That file is about ${humanBytes(declaredSize)}. The limit here is ${humanBytes(capBytes)}.`,
    );
  }
  const declared = (match?.[1] ?? fallbackType).toLowerCase();
  return finish(Buffer.from(base64.replace(/\s/g, ""), "base64"), declared, capBytes);
}

/**
 * Fetch a file from an https link.
 *
 * The host checks are photoFromUrl's, word for word: this runs on the server,
 * and a link naming an address inside the host's network would make the app
 * somebody's proxy. An attachment is not a good enough reason.
 */
export async function attachmentFromUrl(url: string, capBytes: number): Promise<AttachmentBytes> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("That is not a URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("File links have to be https.");

  const host = parsed.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":");
  if (privateHost) throw new Error("That address points inside a network, not at a file.");

  const response = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`That link answered ${response.status}.`);

  // Content-Length is a hint, not a promise, so the body is measured too.
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > capBytes) {
    throw new Error(
      `That file is ${humanBytes(declaredSize)}. The limit here is ${humanBytes(capBytes)}.`,
    );
  }
  const declared = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return finish(Buffer.from(await response.arrayBuffer()), declared, capBytes);
}
