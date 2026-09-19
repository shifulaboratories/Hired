import { timingSafeEqual } from "node:crypto";
import { sweepCompanyWatches, sweepPostings } from "@/lib/data/watch";
import { sweepMailForEveryone } from "@/lib/data/mail-sweep";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Boards, postings and mailboxes take a while. Well past a default 10s. */
export const maxDuration = 300;

/**
 * The scheduler's entry point for everything that looks outward.
 *
 * Same shape and same argument as /api/digest/<token>: this app runs no timers
 * and no background workers, because the transport is stateless on purpose and
 * a replica that quietly became the one doing everybody's background work would
 * be the end of that. A self-hoster points their platform's cron here and the
 * three sweeps decide who is actually due.
 *
 * NOT the digest token, deliberately. A secret that only ever caused mail to be
 * sent must not silently become one that fetches URLs and reads mailboxes.
 *
 *   GET /api/sweep/<token>              runs all three
 *   GET /api/sweep/<token>?only=boards  watched company boards
 *   GET /api/sweep/<token>?only=postings whether postings are still up
 *   GET /api/sweep/<token>?only=mail    the mail sweep, for whoever asked for it
 *
 * `?only=` exists because the three have different natural cadences — boards
 * every few hours, postings daily, mail hourly — and a self-hoster who wants
 * three crons should not need three tokens. An unknown value is a 400 naming
 * the three; it never falls through to "run everything".
 */
const KINDS = ["boards", "postings", "mail"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const settings = await getSettings();

  if (!settings.sweepToken) {
    return json({ error: "Background sweeps are not scheduled on this instance." }, 404);
  }
  // A wrong token records NOTHING — the digest route's comment is the argument
  // verbatim: logging it hands anyone who can reach this address a way to write
  // a row per request into the event log, in front of a route with no rate
  // limit.
  if (!matches(token, settings.sweepToken)) {
    return json({ error: "Not found" }, 404);
  }

  const only = new URL(request.url).searchParams.get("only");
  if (only && !KINDS.includes(only as Kind)) {
    return json({ error: `only must be one of ${KINDS.join(", ")}.` }, 400);
  }
  const wanted = only ? [only as Kind] : [...KINDS];

  const report: Record<string, unknown> = { ran: wanted };
  // Serially, not in parallel: all three make outbound requests, and three at
  // once from one instance is the burst that gets its IP rate-limited.
  for (const kind of wanted) {
    try {
      if (kind === "boards") report.boards = await sweepCompanyWatches();
      if (kind === "postings") report.postings = await sweepPostings();
      if (kind === "mail") report.mail = await sweepMailForEveryone();
    } catch (error) {
      // One sweep failing is not a reason to skip the other two.
      report[kind] = { error: error instanceof Error ? error.message : "That sweep failed." };
    }
  }

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
