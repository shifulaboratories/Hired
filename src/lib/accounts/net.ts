import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProviderError } from "@/lib/accounts/types";

/**
 * Where an IMAP or CalDAV connection may be pointed.
 *
 * An account form that takes a hostname is a request the server makes on
 * the person's behalf, to wherever they say. That must not be the host's
 * own loopback, its link-local range — where cloud metadata services live —
 * or an unspecified or multicast address. Private ranges are allowed on
 * purpose: a mail server on somebody's home LAN is a real reason to run this
 * app yourself, and the loopback and metadata cases are where the damage is.
 *
 * Checked when an account is connected, against every address the name
 * resolves to, so a name that quietly points at 127.0.0.1 is refused with
 * the same sentence as the literal.
 */

function blocked(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 127 || // loopback
      a === 0 || // unspecified
      (a === 169 && b === 254) || // link-local, including 169.254.169.254
      a >= 224 // multicast and reserved
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("ff") // multicast
  );
}

/** Throws a legible error when a host must not be connected to. */
export async function assertReachableHost(hostname: string): Promise<void> {
  const host = hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new ProviderError("Give a server to connect to.");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    throw new ProviderError(`${hostname} is this server itself, which is not a mail or calendar host.`);
  }
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((found) => found.map((entry) => entry.address))
        .catch(() => {
          throw new ProviderError(`${hostname} does not resolve. Check the spelling.`);
        });
  if (addresses.length === 0) throw new ProviderError(`${hostname} does not resolve. Check the spelling.`);
  if (addresses.some(blocked)) {
    throw new ProviderError(`${hostname} points at this server's own network, which is not a mail or calendar host.`);
  }
}

/** The host of a CalDAV URL, refusing anything that is not http(s). */
export function caldavHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError("The CalDAV address has to be a full URL, starting with https://.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderError("The CalDAV address has to start with https:// or http://.");
  }
  return parsed.hostname;
}
