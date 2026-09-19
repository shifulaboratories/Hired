import { assertPublicUrl, MAX_REDIRECT_HOPS } from "@/lib/posting";

/**
 * Every outbound fetch in this app that is not the posting parser itself.
 *
 * Two shapes, and the difference between them is the whole point. A board feed
 * lives at a URL this file builds out of its own constants plus a slug, so it
 * may not redirect anywhere at all — a board API that suddenly wants to send us
 * somewhere else is not something to follow. An arbitrary posting URL is a
 * column a person typed, so it may redirect, and `assertPublicUrl` runs again
 * on every hop.
 *
 * Neither ever throws on a non-2xx: for the liveness probe the status IS the
 * answer, and turning a 404 into an exception would lose it.
 */

const FETCH_TIMEOUT_MS = 20_000;

/**
 * 8 MB. Measured live: Greenhouse's index for a 667-role board is 417 KB,
 * Lever's whole feed with descriptions is 1.1 MB for 72 postings, Ashby's is
 * 2.1 MB for 73. Greenhouse's index WITH `?content=true` is 5.2 MB for the same
 * board, which is why nothing here ever asks for it.
 *
 * A body past the cap is abandoned rather than truncated: a truncated JSON body
 * does not parse, so truncating would turn a size problem into a confusing
 * parse error.
 */
const MAX_BOARD_BYTES = 8_000_000;

/** What a probe brings back. Never the whole body unless it was asked for. */
const MAX_PROBE_BYTES = 2_000_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Read a response body, refusing rather than truncating past `cap`. */
async function readCapped(response: Response, cap: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > cap) {
        await reader.cancel();
        throw new Error(`That answer was larger than ${Math.round(cap / 1_000_000)} MB, so it was not read.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(
    chunks.reduce<Uint8Array>((all, chunk) => {
      const next = new Uint8Array(all.length + chunk.length);
      next.set(all);
      next.set(chunk, all.length);
      return next;
    }, new Uint8Array(0)),
  );
}

/**
 * A JSON board feed, off a URL built from a constant host plus a slug.
 *
 * Refuses redirects outright — see the file header. Throws a sentence a person
 * can read on anything that is not a parseable 2xx.
 */
export async function fetchBoardJson<T>(url: string, options?: { maxBytes?: number }): Promise<T> {
  const target = assertPublicUrl(url);
  const response = await fetch(target, {
    headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error("That board redirected somewhere else, which a published feed should never do.");
  }
  if (response.status === 404) {
    throw new Error("That board answered 404 — check the company's slug.");
  }
  if (!response.ok) {
    throw new Error(`That board answered ${response.status}.`);
  }

  const text = await readCapped(response, options?.maxBytes ?? MAX_BOARD_BYTES);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("That board answered with something that is not JSON.");
  }
}

/** What a GET of an arbitrary posting URL came back as. */
export type Probe = {
  /** The final status after redirects, or 0 when nothing answered. */
  status: number;
  /** Where it ended up, after following at most MAX_REDIRECT_HOPS. */
  finalUrl: string;
  hops: number;
  /** The body, only when the caller asked for it and it was under the cap. */
  html: string;
  /** A sentence, when the fetch itself failed. Empty when something answered. */
  error: string;
};

/**
 * Fetch a URL a person typed and report what happened, without throwing.
 *
 * Redirects are followed by hand so `assertPublicUrl` runs on every Location:
 * a public hostname that 302s inside the network is exactly the shape this
 * guards against, and `redirect: "follow"` would walk straight past it.
 */
export async function probeUrl(rawUrl: string, options?: { wantBody?: boolean }): Promise<Probe> {
  let url: URL;
  try {
    url = assertPublicUrl(rawUrl);
  } catch (error) {
    return { status: 0, finalUrl: rawUrl, hops: 0, html: "", error: message(error) };
  }

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      return { status: 0, finalUrl: url.toString(), hops: hop, html: "", error: message(error) };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          status: response.status,
          finalUrl: url.toString(),
          hops: hop,
          html: "",
          error: "",
        };
      }
      try {
        url = assertPublicUrl(new URL(location, url).toString());
      } catch (error) {
        return { status: 0, finalUrl: url.toString(), hops: hop, html: "", error: message(error) };
      }
      continue;
    }

    let html = "";
    if (options?.wantBody) {
      try {
        html = await readCapped(response, MAX_PROBE_BYTES);
      } catch {
        // A body too large to read says nothing about whether the role is up.
        html = "";
      }
    } else {
      // Nothing wants the bytes, so do not pay for them.
      await response.body?.cancel().catch(() => {});
    }

    return { status: response.status, finalUrl: url.toString(), hops: hop, html, error: "" };
  }

  return {
    status: 0,
    finalUrl: url.toString(),
    hops: MAX_REDIRECT_HOPS,
    html: "",
    error: `That link redirected more than ${MAX_REDIRECT_HOPS} times without landing anywhere.`,
  };
}

function message(error: unknown): string {
  if (error instanceof Error) {
    // AbortSignal.timeout throws a TimeoutError whose message says nothing.
    if (error.name === "TimeoutError") return "The host did not answer in time.";
    return error.message;
  }
  return "That fetch failed.";
}
