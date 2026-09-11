import { timingSafeEqual } from "node:crypto";
import { runDigestSweep } from "@/lib/data/digest";
import { getSettings } from "@/lib/settings";
import { recordSystemEvent } from "@/lib/data/system";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The scheduler's entry point.
 *
 * This app runs no timers and no background workers — the transport is
 * stateless on purpose, and a replica that quietly became the one sending
 * everybody's mail would be the end of that. So the schedule lives outside:
 * a self-hoster points their platform's cron at this address, hourly, and the
 * sweep decides who is actually due.
 *
 * The token is a Setting rather than an environment variable, because
 * DATABASE_URL being the only variable is a promise the README makes. An
 * unset token means the address is off entirely — not "open", off — which is
 * the right default for a URL that makes an instance send mail.
 *
 * Compared in constant time. It is a short secret in a path that lands in
 * every access log, and the one attack it has to survive is somebody timing
 * responses to guess it a character at a time.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();

  if (!settings.digestToken) {
    return json({ error: "Digests are not scheduled on this instance." }, 404);
  }
  if (!matches(token, settings.digestToken)) {
    await recordSystemEvent({
      source: "email.send",
      level: "WARN",
      message: "A digest sweep was requested with the wrong token.",
    });
    return json({ error: "Not found" }, 404);
  }

  const report = await runDigestSweep();
  return json(report, 200);
}

/** POST as well: some schedulers only speak POST, and this is idempotent. */
export const POST = GET;

function matches(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would leak the length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
