import { db } from "@/lib/db";
import { addWaitlistSignup, waitlistIsOpen } from "@/lib/data/waitlist";

/**
 * `POST /api/waitlist` — the one endpoint on this instance an anonymous
 * request may write to.
 *
 * hired.tools is a static site on a different origin, so the "request access"
 * form there posts here. Only an instance with such a site takes signups at
 * all: elsewhere this answers 404 (see waitlistIsOpen). It is open on purpose and it is safe to be: it grants
 * nothing, it reads nothing back, and the row it writes does nothing until an
 * admin turns it into an Invite.
 *
 * CORS is `*` rather than an allow-list, which is the deliberate choice. An
 * allow-list would be a new setting, and a new setting is a thing every
 * self-hoster has to configure before their own landing page works — the exact
 * cost invariant 5 exists to avoid. CORS is not the boundary here; the answer
 * being identical for every caller is.
 *
 * What stands in for a rate limiter, in order of how much work each does:
 *   - a honeypot field, which most drive-by bots fill in;
 *   - a unique index on email, so hammering one address writes one row;
 *   - a body cap, so nobody posts a novel;
 *   - a burst ceiling measured in the database rather than in memory, so it
 *     holds across replicas and restarts the way everything else here does.
 * A determined person can still put junk on the list. They cannot get in, and
 * deleting a row is one click.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** More signups than this inside the window and new ones stop being written. */
const BURST_LIMIT = 30;
const BURST_WINDOW_MS = 5 * 60_000;

const MAX_BODY = 4_000;

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors() });
}

export async function POST(request: Request) {
  // Closed on an instance with no site in front of it. See waitlistIsOpen.
  if (!(await waitlistIsOpen())) return new Response(null, { status: 404, headers: cors() });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "That's too long." }, 413);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Expected JSON." }, 400);
  }

  const str = (value: unknown) => (typeof value === "string" ? value : "");

  // The honeypot. A real form keeps this hidden and empty; a bot fills every
  // field it finds. Answer as if it worked so there's nothing to learn.
  if (str(body.website).trim()) return json({ ok: true });

  const email = str(body.email);
  if (!email.trim()) return json({ ok: false, error: "An email address, at least." }, 400);

  const recent = await db.waitlistSignup.count({
    where: { createdAt: { gt: new Date(Date.now() - BURST_WINDOW_MS) } },
  });
  if (recent >= BURST_LIMIT) return json({ ok: true });

  // The origin of the page that posted, not anything the body claimed. A
  // file:// page and some privacy modes send the literal string "null"; record
  // that as nothing rather than as a source called null.
  const origin = request.headers.get("origin") ?? "";
  const source = origin === "null" ? "" : origin.replace(/^https?:\/\//, "").slice(0, 200);

  const result = await addWaitlistSignup({
    email,
    name: str(body.name),
    context: str(body.context),
    source,
  });

  if (!result.ok) return json(result, 400);

  // Deliberately the same answer whether or not the address was already there:
  // otherwise this endpoint tells you who has signed up.
  return json({ ok: true });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function GET() {
  // Never lists anything. The waitlist is readable from Admin and from the
  // admin-only MCP tools, both of which authenticate.
  return new Response(null, { status: 405, headers: { Allow: "POST", ...cors() } });
}
