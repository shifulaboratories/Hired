import { guardedFetch } from "@/lib/safe-fetch";

/**
 * Turning whatever someone hands us into a photo we are willing to store.
 *
 * There are two ways a picture arrives: the browser downscales a chosen file to
 * a square and posts a data URI, or an assistant passes a link ("use my GitHub
 * avatar") and the server fetches it. Both land here, so the rules about size
 * and type are written once — the settings page and the MCP tool cannot
 * disagree about what a valid photo is.
 *
 * Storage is a data URI in the Profile row. No object store, no signed URLs, no
 * second service to run: self-hosting stays one environment variable, and a
 * published resume renders the headshot inside the same HTML as the text, which
 * is what makes it work on the unauthenticated /r/<slug> page and inside the
 * headless-browser PDF without either of them fetching anything.
 *
 * The cap is deliberately small. A resume photo is printed at about 90 points
 * square, so anything past a few hundred kilobytes is bytes nobody can see, and
 * every one of them would be copied into every render of every document.
 */

/** Decoded bytes we will store. ~400KB is far more than a 512px square needs. */
export const PHOTO_MAX_BYTES = 400_000;

/** What a browser can actually paint. GIF is allowed in, but never produced. */
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const FETCH_TIMEOUT_MS = 15_000;

export type PhotoResult = { dataUri: string; bytes: number; type: string };

/** Bytes a base64 payload decodes to, without decoding it. */
function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function humanBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)}MB`
    : `${Math.round(bytes / 1000)}KB`;
}

/**
 * Validate a data URI a browser or an assistant produced.
 *
 * Throws with a sentence a person can act on rather than returning null —
 * every caller here surfaces the message straight to whoever tried.
 */
export function normalizePhotoDataUri(value: string): PhotoResult {
  const trimmed = value.trim();
  const match = /^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error(
      "A photo has to be a base64 data URI, e.g. data:image/jpeg;base64,… — or pass a https link instead and it will be fetched.",
    );
  }

  const type = match[1].toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`${type} is not an image this app can render. Use JPEG, PNG or WebP.`);
  }

  // Whitespace is legal inside base64 and browsers sometimes wrap it; strip it
  // before measuring, or a wrapped payload measures larger than it is.
  const base64 = match[2].replace(/\s+/g, "");
  const bytes = decodedLength(base64);
  if (bytes <= 0) throw new Error("That photo is empty.");
  if (bytes > PHOTO_MAX_BYTES) {
    throw new Error(
      `That photo is ${humanBytes(bytes)}. The limit is ${humanBytes(PHOTO_MAX_BYTES)} — crop or shrink it first.`,
    );
  }

  return { dataUri: `data:${type};base64,${base64}`, bytes, type };
}

/**
 * Fetch a photo from a public https URL and return it as a data URI.
 *
 * The host checks are the same ones `posting.ts` applies before fetching a job
 * ad: this runs on the server, so a link naming an address inside the host's
 * own network would make the app fetch something the caller cannot reach. A
 * profile photo is never a good enough reason to become somebody's proxy.
 */
export async function photoFromUrl(url: string): Promise<PhotoResult> {
  // The shared guard, redirects and all — see safe-fetch.ts. This used to
  // follow redirects automatically after checking only the name.
  const { response } = await guardedFetch(url, {
    httpsOnly: true,
    headers: { Accept: "image/*" },
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (!response.ok) throw new Error(`That link answered ${response.status}.`);

  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`That link served ${type || "no image type"}. Point at a JPEG, PNG or WebP.`);
  }

  // Content-Length is a hint, not a promise, so the body is measured too.
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > PHOTO_MAX_BYTES) {
    throw new Error(
      `That image is ${humanBytes(declared)}. The limit is ${humanBytes(PHOTO_MAX_BYTES)}.`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error("That link served an empty file.");
  if (buffer.byteLength > PHOTO_MAX_BYTES) {
    throw new Error(
      `That image is ${humanBytes(buffer.byteLength)}. The limit is ${humanBytes(PHOTO_MAX_BYTES)} — crop or shrink it first.`,
    );
  }

  return {
    dataUri: `data:${type};base64,${buffer.toString("base64")}`,
    bytes: buffer.byteLength,
    type,
  };
}

/** Either shape, resolved to one. Empty string means "remove the photo". */
export async function resolvePhoto(input: string): Promise<PhotoResult | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return normalizePhotoDataUri(trimmed);
  return photoFromUrl(trimmed);
}
