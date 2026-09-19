import { claimCaptureSlot, countCapture, userByCaptureToken } from "@/lib/data/capture-link";
import { createApplicationIfNew } from "@/lib/data/pipeline";
import { loadPosting } from "@/lib/posting";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Capturing a posting from a phone, with no app open and nobody signed in.
 *
 * Unlike /api/digest/<token> and /api/sweep/<token>, the secret here is not one
 * instance-wide string but a per-person credential, so this RESOLVES a token
 * through a unique index rather than comparing one — the same thing
 * /api/mcp/[token] does, and the reason neither needs a constant-time compare:
 * there is no fixed secret on this side to leak a character at a time.
 *
 *   GET  /api/capture/<token>?url=<encoded posting URL>
 *   POST /api/capture/<token>   { "url": "…" }
 *
 * WHY A GET WRITES. It is the only shape that works from a bookmark on iOS
 * Safari and from a Shortcut's "Open URL". It is not CSRF-exposed, because no
 * cookie or header authorises it: the token in the path is the whole
 * credential, and anyone who has it could call the tool anyway. The cost is
 * that a link-preview bot or a speculative prefetch will fire it — which the
 * rate limit bounds and createApplicationIfNew makes harmless.
 *
 * THE RESPONSE NEVER CARRIES THE PAGE. Not the description, not the body, not
 * one line of it. The holder of a capture link is not signed in and cannot read
 * anything in this app; a response that echoed the parsed page would turn this
 * into a way to read the text of any page the server can reach, sitting behind
 * a credential designed to live in a bookmark bar. Employer and role title
 * only, and that is the whole reason.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(request, await params, null);
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const body = await request.json().catch(() => null);
  const url = body && typeof body === "object" ? (body as Record<string, unknown>).url : null;
  return handle(request, await params, typeof url === "string" ? url : null);
}

async function handle(request: Request, params: { token: string }, bodyUrl: string | null) {
  const wantsJson = (request.headers.get("accept") ?? "").includes("application/json");
  const caller = await userByCaptureToken(params.token, request.headers.get("user-agent") ?? "");
  // No row, or a dead or suspended account: 404, and NOTHING is recorded. The
  // digest route's argument applies here too — an unauthenticated address with
  // no rate limit in front of it must not be a way to write to the event log.
  if (!caller) return reply({ ok: false, message: "Not found" }, 404, wantsJson);

  if (!(await claimCaptureSlot(caller.linkId))) {
    return reply(
      { ok: false, message: "That link has captured a lot in the last hour. Try again shortly." },
      429,
      wantsJson,
    );
  }

  const raw = bodyUrl ?? new URL(request.url).searchParams.get("url");
  if (!raw || !raw.trim()) {
    return reply({ ok: false, message: "No posting URL came through." }, 400, wantsJson);
  }

  let parsed;
  try {
    // loadPosting runs withScheme, the whole outbound guard on every redirect
    // hop, and takes the Greenhouse API path for free.
    parsed = await loadPosting(raw);
  } catch (error) {
    return reply(
      { ok: false, message: error instanceof Error ? error.message : "That page could not be read." },
      400,
      wantsJson,
    );
  }
  if (!parsed.roleTitle || !parsed.company) {
    return reply(
      { ok: false, message: "That page didn't name the employer or the role in a readable way. Nothing was saved." },
      422,
      wantsJson,
    );
  }

  const result = await createApplicationIfNew(caller.user.id, {
    company: parsed.company,
    companyWebsite: parsed.companyWebsite || undefined,
    roleTitle: parsed.roleTitle,
    stage: "WISHLIST",
    jobUrl: raw.trim(),
    jobDescription: parsed.jobDescription,
    location: parsed.location,
    workMode: parsed.workMode,
    salaryRange: parsed.salaryRange,
    sources: parsed.source ? [parsed.source] : [],
  });

  const id = result.created ? result.application.id : result.existingId;
  const company = result.created ? result.application.company.name : result.company;
  const roleTitle = result.created ? result.application.roleTitle : result.roleTitle;
  if (result.created) await countCapture(caller.linkId);

  const settings = await getSettings();
  const base = settings.publicUrl.trim().replace(/\/+$/, "") || new URL(request.url).origin;

  return reply(
    {
      ok: true,
      created: result.created,
      company,
      roleTitle,
      message: result.created ? "Added" : "Already on your board",
      href: `${base}/applications/${id}`,
    },
    200,
    wantsJson,
  );
}

type Result = {
  ok: boolean;
  created?: boolean;
  company?: string;
  roleTitle?: string;
  message: string;
  href?: string;
};

/**
 * JSON for a Shortcut, a page for a bookmarklet — which navigates, so what
 * comes back is something a person reads on their phone.
 *
 * No CORS headers at all, on purpose: a bookmarklet navigates rather than
 * fetching, so no page on another origin should ever be able to read this.
 */
function reply(result: Result, status: number, wantsJson: boolean) {
  const headers = { "Cache-Control": "no-store" };
  if (wantsJson) {
    return new Response(JSON.stringify(result), {
      status,
      headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(page(result), {
    status,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  );

function page(result: Result) {
  const title = escape(result.message);
  const detail =
    result.ok && result.roleTitle
      ? `<p class="detail">${escape(result.roleTitle)} at ${escape(result.company ?? "")}</p>`
      : "";
  const link = result.href ? `<p><a href="${escape(result.href)}">Open it</a></p>` : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; --fg: #111; --muted: #666; --bg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f3f3f3; --muted: #9a9a9a; --bg: #141414; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 24px; }
  main { max-width: 26rem; text-align: center; }
  h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 .5rem; }
  .detail { color: var(--muted); margin: 0 0 1.5rem; }
  a { display: inline-block; padding: .65rem 1.2rem; border-radius: .5rem; background: var(--fg); color: var(--bg);
      text-decoration: none; font-weight: 500; }
</style>
</head><body><main><h1>${title}</h1>${detail}${link}</main></body></html>`;
}
