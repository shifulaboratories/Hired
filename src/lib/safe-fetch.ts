import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Every server-side fetch of a URL somebody else chose goes through here.
 *
 * On an instance that hosts people the operator does not know, a tool that
 * fetches a link is a request this server makes on a stranger's behalf, to
 * wherever they say. Three things have to hold on EVERY hop, not just the
 * first:
 *
 *   - the name is not an address inside a network: no IP literals, no
 *     localhost, no single-label name like `db` that a container network
 *     resolves, no .local or .internal;
 *   - what the name RESOLVES to is not one either — a public name with an A
 *     record of 127.0.0.1 (nip.io and friends) passes any check of the name;
 *   - a redirect is followed by hand, so a public host that 302s to
 *     169.254.169.254 meets the same two checks as the link it started from.
 *
 * This used to be four copies that disagreed: two of them followed redirects
 * automatically and none of them resolved a name. DNS can still change
 * between this check and the connection; that window is accepted for a tool
 * whose callers are the instance's own members, and pinning addresses through
 * a custom agent is not worth what it costs.
 */

export const MAX_REDIRECT_HOPS = 5;
const FETCH_TIMEOUT_MS = 20_000;

/** True for any address a fetch on a stranger's behalf must not reach. */
export function blockedAddress(address: string): boolean {
  const v4 = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 || // unspecified
      a === 10 || // RFC 1918
      a === 127 || // loopback
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, including 169.254.169.254
      (a === 172 && b >= 16 && b <= 31) || // RFC 1918
      (a === 192 && b === 168) || // RFC 1918
      a >= 224 // multicast and reserved
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") || // unique local, fc00::/7
    lower.startsWith("fd") ||
    lower.startsWith("ff") // multicast
  );
}

/**
 * The checks that need no network: scheme, credentials, and a name that is
 * obviously inside one. `httpsOnly` is for files and photos, which have no
 * reason to travel in the clear; postings and boards still allow http.
 */
export function assertPublicUrl(rawUrl: string, options: { httpsOnly?: boolean } = {}): URL {
  let url: URL;
  try {
    const trimmed = rawUrl.trim();
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (options.httpsOnly ? url.protocol !== "https:" : url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(options.httpsOnly ? "Links have to be https." : "Only http and https links can be fetched.");
  }
  if (url.username || url.password) throw new Error("Links with credentials aren't fetched.");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const inside =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") || // a single label resolves inside a network, never outside it
    isIP(host.replace(/^\[|\]$/g, "")) !== 0 ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":");
  if (inside) throw new Error("That address points inside a network, not at the public web.");
  return url;
}

/** What the name resolves to has to be public too. Every address, not the first. */
export async function assertPublicAddress(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const addresses = await lookup(host, { all: true })
    .then((found) => found.map((entry) => entry.address))
    .catch(() => {
      throw new Error(`${url.hostname} does not resolve. Check the link.`);
    });
  if (addresses.length === 0) throw new Error(`${url.hostname} does not resolve. Check the link.`);
  if (addresses.some(blockedAddress)) {
    throw new Error("That address points inside a network, not at the public web.");
  }
}

/** Both checks, for a caller that makes its own single request. */
export async function assertPublicTarget(rawUrl: string, options: { httpsOnly?: boolean } = {}): Promise<URL> {
  const url = assertPublicUrl(rawUrl, options);
  await assertPublicAddress(url);
  return url;
}

/**
 * A GET that follows redirects by hand, checking every hop.
 *
 * Returns the first response that is not a redirect, whatever its status —
 * the caller decides what a 404 means. Throws on a guard refusal, a redirect
 * with nowhere to go, or too many hops.
 */
export async function guardedFetch(
  rawUrl: string,
  init: { headers?: Record<string, string>; timeoutMs?: number; httpsOnly?: boolean } = {},
): Promise<{ response: Response; url: URL; hops: number }> {
  let url = await assertPublicTarget(rawUrl, { httpsOnly: init.httpsOnly });
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetch(url, {
      headers: init.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw new Error(`That link answered ${response.status} with nowhere to go.`);
      // Relative Locations are the common case, so resolve against the URL we
      // asked for, then run the whole guard again on where it points.
      url = await assertPublicTarget(new URL(location, url).toString(), { httpsOnly: init.httpsOnly });
      continue;
    }
    return { response, url, hops: hop };
  }
  throw new Error(`That link redirected more than ${MAX_REDIRECT_HOPS} times without landing anywhere.`);
}
