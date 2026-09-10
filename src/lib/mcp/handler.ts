import type { User } from "@prisma/client";
import {
  metaFor,
  promptsFor,
  promptsByName,
  splitLinks,
  splitNotice,
  toolsFor,
  toolsByName,
  type McpContext,
} from "@/lib/mcp/tools";
import { meIsEmpty, listGuardrails } from "@/lib/data/me";
import { recordSystemEvent } from "@/lib/data/system";
import { isAdmin, type McpCaller } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

/**
 * A small, dependency-light implementation of the MCP Streamable HTTP transport.
 *
 * Written by hand rather than wired through the SDK's Node transport because
 * Next.js route handlers speak the Web Request/Response API. Stateless: every
 * POST is self-contained, so there are no sessions to lose across restarts or
 * replicas — and every request re-resolves its user from the token, so
 * suspending someone takes effect immediately.
 */

/**
 * The two eras this server speaks, and why it speaks both.
 *
 * MCP changed shape in revision 2026-07-28: the `initialize` handshake is gone,
 * every request declares its own version, every result carries a `resultType`,
 * and `server/discover` replaces the handshake as the way in. The old shape did
 * not become invalid — every shipping client still speaks it — so this server
 * answers either, chosen per request rather than per connection.
 *
 * That choice is free here and would not be on a stateful server: the modern
 * revision made statelessness the spec-native shape, which is the architecture
 * this file already had. Era is a pure function of one message.
 *
 * MODERN_PROTOCOL_VERSION is deliberately not in LEGACY_PROTOCOL_VERSIONS. A
 * client that sends `initialize` is by definition speaking the old shape, so it
 * negotiates from the old list and gets 2025-06-18 back even if it asked for
 * something newer — which is what the old rules say to do and keeps the two
 * paths from crossing.
 *
 * 2025-11-25 exists and is not listed. Nobody has read its changelog, and
 * claiming a revision you have not read is how a server answers wrongly with
 * confidence.
 */
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = "2025-06-18";

/** Everything this server will answer to, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS];

type Era = "modern" | "legacy";

/** The `_meta` keys the modern revision reserves on a request. */
const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const SERVER_INFO = {
  name: "hired",
  title: "Hired",
  version: "2.0.0",
};

/**
 * The briefing every client is handed on connect — and the order it is in.
 *
 * ORDER IS LOAD-BEARING HERE, because at least one major client truncates it.
 * Claude Code "truncates tool descriptions and server instructions at 2KB
 * each. Keep them concise to avoid truncation, and put critical details near
 * the start." (code.claude.com/docs/en/mcp). Everything past roughly two
 * thousand characters is cut with no warning to anybody.
 *
 * That used to be catastrophic rather than merely lossy: this block opened
 * with a tour of the five areas and appended the person's own standing rules
 * LAST, so the one thing that must never be missing was the first thing
 * dropped. The rules are now the head and the tour is the tail.
 *
 * So the block is built in two parts:
 *   HEAD — who you are connected as, their standing rules, and the handful of
 *          rules that produce a wrong document or an unrecoverable act if they
 *          are missing. Budgeted, measured, and kept under HEAD_BUDGET.
 *   TAIL — the area tour and everything a client with room should also know.
 *          A client that truncates loses only detail it can rediscover from
 *          the tool list itself.
 */
const HEAD_BUDGET = 2000;

/**
 * What the WHOLE standing-rules section may take out of the head — its heading,
 * the rules themselves and the notice that says some were left out. Counting
 * only the rules was wrong: the heading and the notice together are another
 * three hundred characters, which pushed the head past the cap on an account
 * with a lot of rules on file, and the thing that fell off the end was the
 * fourth critical rule.
 */
const STANDING_RULES_BUDGET = 1000;

/**
 * The tail for an account with nothing in it.
 *
 * A new account has no roles, no highlights, no notes and no projects, so an
 * assistant handed a confident description of a populated workspace calls
 * search_me, gets an empty array back and improvises — which is the exact
 * moment this server's one real rule gets broken, because an invented career
 * is the only way left to satisfy the request in front of it.
 */
const EMPTY_WORKSPACE = `This workspace is EMPTY: no roles, no highlights, no notes, no projects.
Every read tool will come back with nothing, and that is the state of the account rather than a
failed call. Say so plainly instead of closing the gap with something plausible.

Ask one thing before anything else: "Do you have a resume or a LinkedIn export you can paste, or
would you rather talk me through your last job?" If they paste a document, parse it yourself and
file the whole thing with ONE import_resume call — roles with their bullets, education, skills,
profile facts — copying what it says and inventing nothing. Pass its create_base_resume argument
in the same call so they see a rendered resume in their first minutes. If they would rather talk
it through, file what comes back with these:
• update_profile — name, contact details, links, and their personal background: what they want
  next, what they will not take.
• create_role — one per job, with dates. The raw material goes in its background, where length is a
  feature: keep the detail rather than summarising it away.
• append_role_background — what they remember about a role after it already exists. It adds;
  update_role replaces, which is why this one is here.
• create_highlights — polished, reusable bullets, once there is raw material to draw them from.
• create_note — whatever belongs to no single job.

Never hand them a form or a list of fields to fill in; that is the thing they came here to stop
doing. Resumes, the application pipeline and the CRM are worth explaining once a role exists, and
not before, because none of them do anything yet.`;

const AREAS = `The areas:
• ME — everything about them. Roles each hold an unlimited free-form "background" of raw
  material, plus polished reusable bullets called highlights. There are also notes, projects,
  education, skills and certifications. search_me is the fastest way in.
• RESUMES — documents assembled from that material. Call get_resume_format before writing one.
  New resumes use the Harvard OCS format by default. Any of them can be published to a public
  link with publish_resume, which is what to use when a form or a recruiter wants a URL.
• PIPELINE — applications, stages, activity timeline, tasks and follow-up dates. Six stages:
  wishlist, applied, interviewing, offer, accepted and lost. How deep an interview got is
  interviewRound, a number; why something was lost is a LOSS tag. When the question is about a
  stretch of time rather than one application — this week, last month, what is coming — reach for
  list_schedule, which merges all three kinds of dated thing.
• CRM — companies and the people at them, as records in their own right. get_company before
  writing anything about a company, so you add to their research rather than replacing it. A
  company's website field is their own domain and nothing else depends on it, but it is what puts
  their logo on the pipeline, so set it whenever you learn it. People have timelines: when they
  mention talking to someone — a call, a coffee, a reply — log_activity with contactId is how it
  gets remembered, and update_contact's nextFollowUpAt is how "ping them in two weeks" actually
  happens. list_follow_ups returns due people alongside due applications.
• MAIL AND CALENDAR — if they have connected an account (list_linked_accounts says: Google,
  Microsoft 365, or any IMAP and CalDAV provider), list_correspondence returns the real threads
  and meetings behind any contact, company, application or resume, read live across every
  account and never stored here. Call it before saying where an application stands: the
  pipeline's timeline only knows what was logged by hand. search_email and search_calendar
  cover questions that are not about one record. Every one of these is read-only — nothing can
  send, accept or delete. When nothing is connected, say how (Settings → Connections, or
  connect_imap_account with an app password) rather than guessing at their mail.
• TAGS cut across all of it. Where an application came from, a company's industry, size and
  location, how you know a person, why an application was lost — every one of those is a tag
  rather than a free-text field, and they are multi-select. Call list_tags before writing any of
  them: passing a name that already exists matches it rather than creating a near-duplicate, and
  the kinds are separate lists that never collide. "sources" on an application is the old
  spelling of its tags and still works.`;

/**
 * The person's own rules, and the reason they are the first thing in the block.
 *
 * "Never invent experience, employers, dates or metrics" does not catch the
 * failure that actually happens. Tailoring to a job req quietly *upgrades*
 * facts — a distribution credit becomes a hire, an unsettled follower count
 * becomes a cited one — and none of it feels like invention to whoever is
 * drafting, because every upgrade maps to a stated responsibility.
 *
 * Guardrails are Note rows, so they could in principle be found with search_me.
 * In practice nobody searches "follower count" before writing a scope bullet,
 * so a rule that has to be looked up is a rule that is absent at the moment it
 * matters. This block is the only place a constraint is guaranteed to be in
 * context — which is exactly why it has to survive a 2KB cut.
 */
async function standingRulesFor(userId: string) {
  const guardrails = await listGuardrails(userId).catch(() => []);
  if (guardrails.length === 0) return "";

  const heading = `\n\nTHEIR STANDING RULES — these override any inference you would otherwise make. They are not
preferences. Breaking one produces a document that reads as true and is not.`;
  // Reserved whether or not anything is dropped, and sized against the largest
  // number that could be, so the section fits its budget in every case rather
  // than only in the ones where nothing overflows.
  const notice = (n: number) =>
    `\n• (${n} more rules are on file and are NOT in this briefing — call list_notes with kind ` +
    `GUARDRAIL and read them before writing anything.)`;
  const budget = STANDING_RULES_BUDGET - heading.length - notice(guardrails.length).length;

  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const rule of guardrails) {
    const line = `\n• ${rule.title}${rule.body.trim() ? ` — ${rule.body.trim()}` : ""}`;
    if (used + line.length > budget) {
      dropped += 1;
      continue;
    }
    lines.push(line);
    used += line.length;
  }

  if (dropped > 0) {
    // Silently truncating someone's guardrails is the worst failure available
    // here, so it is at least visible in the server log and admitted in the
    // briefing itself.
    console.warn(
      `[mcp] standing rules truncated for user ${userId}: ${dropped} of ${guardrails.length} omitted past ${budget} chars`,
    );
    lines.push(notice(dropped));
  }

  return `${heading}${lines.join("")}`;
}

/**
 * The four rules whose absence produces a wrong document or an act nobody can
 * undo. Everything else is in the tail.
 */
const CRITICAL_RULES = `
Rules that are never optional:
- Never invent experience, employers, dates or metrics. Everything on a resume must trace back to
  something in Me. If evidence is missing, say so and ask.
- update_resume and update_role REPLACE what you send. Read first, modify, then write back whole.
  When they tell you something new about a job already on file, append_role_background adds
  instead of overwriting.
- delete_archived and empty_archive are the only acts here that cannot be undone. Read the archive
  back to them and get a plain yes first. Deleting a role, highlight, note, resume, task, tag or
  saved view is also permanent.
- Connection URLs are credentials with full read and write over this workspace. Never repeat one
  anywhere it will be stored.`;

async function instructionsFor(user: User) {
  // A failed lookup must not cost someone their briefing, so an unreachable
  // database falls back to the tour rather than telling an established user
  // their workspace is empty.
  const empty = await meIsEmpty(user.id).catch(() => false);

  const head = `Hired is ${user.name || user.email}'s career knowledge base, resume builder and job-search CRM.
You are connected as them; every tool reads and writes only their data. search_me is the first
tool to reach for when the question is about their experience.${await standingRulesFor(user.id)}
${CRITICAL_RULES}`;

  if (head.length > HEAD_BUDGET) {
    // Not fatal — a longer head only means a client that truncates loses the
    // tail sooner — but it means the budget above needs revisiting, and that
    // is not something to discover from a user report.
    console.warn(
      `[mcp] instructions head is ${head.length} chars, past the ${HEAD_BUDGET} budget: a 2KB client will cut inside it`,
    );
  }

  const tail = empty ? EMPTY_WORKSPACE : AREAS;

  const admin = isAdmin(user)
    ? `\n\nYou are an ${user.role === "SUPER_ADMIN" ? "instance owner" : "admin"}, so the admin_* tools are
also available: inviting people, managing accounts and configuring email. Those act on the
instance, never on another person's career history or resumes.`
    : "";

  return `${head}

${tail}${admin}

Deleting a company, a person or an application puts it in the archive rather than destroying it.
list_archive is what is in there and when each thing is due to go; restore_records brings it back.

The connection you are talking through is one of several this person may have — list_connections
shows them all, create_connection wires up another client and hands back its URL and setup steps,
and rotate_connection kills a URL that has leaked.

Also worth knowing:
- When the ask covers several records at once, reach for the bulk tool rather than a loop:
  move_applications_stage, tag_companies, tag_contacts, schedule_contact_pings, archive_records.
  The tagging ones ADD and REMOVE where update_company and update_contact REPLACE — so "tag these
  nine as fintech" written as nine update_company calls would strip the size and location off all
  nine. Every bulk tool skips ids that are not theirs rather than failing the whole call.
- export_csv turns any of the three lists into a spreadsheet, taking the same filters, search and
  sort as list_companies, list_contacts and list_applications. It is the answer to "send me this
  as a file" — do not assemble one by hand from a list call.
- Prefer creating a tailored copy (duplicate_resume) over editing a resume already attached to an
  application.
- A published resume is readable by anyone holding its link, and unpublish_resume destroys that
  link rather than pausing it. Say which resume you are about to publish, and warn before
  withdrawing a link that may already be out in the world. If it has showPhoto on, that page
  carries their face — mention it before you publish.
- The profile photo is one picture the whole app shares. set_profile_photo replaces it
  everywhere at once, including on every resume already showing it. Only ever use a file or link
  the user gave you; never find them a picture.`;
}

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/**
 * The protocol's own error codes, added in 2026-07-28. All three are answered
 * with HTTP 400 rather than 200, which is the part that matters: a client
 * probing for the modern shape reads the status, not the body.
 */
const HEADER_MISMATCH = -32020;
const UNSUPPORTED_PROTOCOL_VERSION = -32022;

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

/**
 * A result, shaped for the era that asked for it.
 *
 * The modern revision requires `resultType` on every result and asks servers to
 * name themselves in `_meta`. Both are additive, and a legacy result is not
 * allowed to carry them, so this is the one place that knows the difference —
 * every call site passes the same object it always did.
 */
function ok(id: JsonRpcId, result: object, era: Era): JsonRpcResponse {
  if (era === "legacy") return { jsonrpc: "2.0", id, result };
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resultType: "complete",
      ...result,
      _meta: { [META_SERVER_INFO]: SERVER_INFO },
    },
  };
}

/**
 * A result a client is allowed to cache, which in 2026-07-28 means it MUST say
 * for how long and in what scope.
 *
 * `cacheScope` is always "private": every list on this server is one person's
 * — their tools depend on whether they are an admin, their prompts likewise —
 * so a shared cache keyed on anything but the token would hand one member
 * another's answer. `ttlMs` is zero because the tool list changes on deploy and
 * a member's admin flag changes without one; there is nothing here worth a
 * stale read, and the field is required whether or not it is useful.
 */
function cacheable(id: JsonRpcId, result: object, era: Era): JsonRpcResponse {
  if (era === "legacy") return ok(id, result, era);
  return ok(id, { ...result, ttlMs: 0, cacheScope: "private" }, era);
}

/** Dates need to survive the trip; everything else is plain JSON already. */
function serialize(value: unknown) {
  return JSON.stringify(value, (_key, val) => (val instanceof Date ? val.toISOString() : val), 2);
}

async function handleMessage(
  message: JsonRpcRequest,
  ctx: McpContext,
  era: Era,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const params = message.params ?? {};
  const isNotification = message.id === undefined || message.id === null;

  switch (message.method) {
    case "initialize": {
      // The legacy list, not the full one: a client sending `initialize` is
      // speaking the old shape whatever version string it names, so answering
      // "2026-07-28" here would promise a result shape this branch never emits.
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = LEGACY_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions: await instructionsFor(ctx.user),
      }, era);
    }

    /**
     * The modern era's way in, and the reason it needs no handshake: one call
     * that says what versions this server speaks, what it can do, and how to
     * use it. Servers MUST implement it, so it is answered whichever era asked
     * — a legacy client that stumbles onto it gets a usable answer rather than
     * a method-not-found it has no branch for.
     *
     * `supportedVersions` lists 2026-07-28 first. That is a promise: everything
     * above and below this line — resultType, the cache hints, the header
     * checks, the -3202x errors — is what makes the promise true, and the
     * version came off this list until all of it was here.
     */
    case "server/discover":
      return cacheable(
        id,
        {
          supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
          capabilities: {
            tools: { listChanged: false },
            prompts: { listChanged: false },
          },
          instructions: await instructionsFor(ctx.user),
        },
        era,
      );

    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
    case "notifications/roots/list_changed":
      return null;

    case "ping":
      return ok(id, {}, era);

    case "tools/list":
      return cacheable(id, {
        tools: toolsFor(ctx.user).map((tool) => {
          const meta = metaFor(tool.name);
          return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            // Sent on every tool, including where a hint matches the spec's own
            // default: two of the four default to the dangerous answer, and a
            // client cannot tell "we decided this" from "they forgot". The title
            // is repeated inside the block because it lived there before it was
            // promoted to a field of its own, and older clients still read it.
            annotations: { title: tool.title, ...tool.annotations },
            // Vendor hints — which tools stay loaded behind tool search, how
            // much of a result may be read, what must not run unattended. The
            // spec reserves _meta for exactly this, and a client that does not
            // know these keys ignores them.
            ...(meta ? { _meta: meta } : {}),
          };
        }),
      }, era);

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolsByName.get(name);
      if (!tool) return err(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      if (tool.adminOnly && !isAdmin(ctx.user)) {
        return ok(id, {
          content: [{ type: "text", text: "Error: that tool is only available to admins." }],
          isError: true,
        }, era);
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await tool.handler(args, ctx);
        // Links ride alongside the JSON rather than replacing it: a client that
        // renders resource links gets something clickable, one that doesn't sees
        // exactly what it always saw.
        const { data: noticed, notice } = splitNotice(result);
        const { data, links } = splitLinks(noticed);
        return ok(id, {
          content: [
            // Before the payload, not after: a notice saying a list was cut off
            // is worth nothing if it sits behind the very JSON that gets cut off.
            ...(notice ? [{ type: "text", text: notice }] : []),
            { type: "text", text: serialize(data ?? { ok: true }) },
            ...links,
          ],
        }, era);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The tool name and the failure, never `args` — those are the caller's
        // content and every admin can read the event stream.
        await recordSystemEvent({
          source: "mcp.tool",
          message,
          detail: name,
          userEmail: ctx.user.email,
        });
        // Tool failures are reported in-band so the model can recover.
        return ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true }, era);
      }
    }

    case "prompts/list":
      return cacheable(id, {
        prompts: promptsFor(ctx.user).map((prompt) => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: prompt.arguments,
        })),
      }, era);

    case "prompts/get": {
      const name = typeof params.name === "string" ? params.name : "";
      const prompt = promptsByName.get(name);
      if (!prompt || (prompt.adminOnly && !isAdmin(ctx.user))) {
        return err(id, INVALID_PARAMS, `Unknown prompt: ${name}`);
      }
      const args = (params.arguments ?? {}) as Record<string, string>;
      return ok(id, {
        description: prompt.description,
        messages: [{ role: "user", content: { type: "text", text: prompt.build(args) } }],
      }, era);
    }

    // Declared as unsupported in `capabilities`, but answer politely rather than
    // erroring so probing clients do not surface a scary message.
    case "resources/list":
      return cacheable(id, { resources: [] }, era);
    case "resources/templates/list":
      return cacheable(id, { resourceTemplates: [] }, era);

    default:
      if (isNotification) return null;
      return err(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
  }
}

/**
 * Which browser origins may POST here.
 *
 * The spec makes this a MUST — it is the defence against DNS rebinding, where a
 * page the person is merely visiting reaches an MCP server their browser can
 * see. Almost nothing this touches: every client in the app library connects
 * from a server or a desktop process and sends no Origin at all, and a header
 * that is absent is not "invalid". Only a browser that names a foreign origin
 * is turned away.
 *
 * Loopback is always allowed, on any port, because the MCP Inspector runs there
 * and refusing the standard debugging tool would be its own kind of bug.
 * Anything else an admin needs goes in one comma-separated setting rather than
 * an environment variable, so a self-hoster can fix it without a redeploy.
 */
function originAllowed(origin: string, baseUrl: string, extra: string): boolean {
  let host: URL;
  try {
    host = new URL(origin);
  } catch {
    return false;
  }
  if (host.hostname === "localhost" || host.hostname === "127.0.0.1" || host.hostname === "[::1]") {
    return true;
  }
  if (origin === baseUrl) return true;
  return extra
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .includes(origin);
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    // Mcp-Method and Mcp-Name are required of a 2026-07-28 client, so a browser
    // one cannot connect at all unless the preflight allows them. Mcp-Session-Id
    // and Last-Event-ID belong to a revision that removed both; they stay
    // listed because allowing a header nobody sends costs nothing and removing
    // one an older client still sends would break it.
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  };
}

function sseResponse(payload: unknown) {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...corsHeaders(),
    },
  });
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/**
 * Which era a single message is speaking.
 *
 * A pure function of one request, which is the whole reason both eras can share
 * a stateless handler: nothing has to remember what was negotiated, because
 * every message says. The header and the body are both consulted because the
 * modern revision requires them to agree — and `checkModernHeaders` below is
 * what rejects the case where they do not.
 */
function eraFor(request: Request, message: JsonRpcRequest): Era {
  if (request.headers.get("mcp-protocol-version") === MODERN_PROTOCOL_VERSION) return "modern";
  const meta = (message.params?._meta ?? {}) as Record<string, unknown>;
  return meta[META_PROTOCOL_VERSION] === MODERN_PROTOCOL_VERSION ? "modern" : "legacy";
}

/**
 * The modern revision mirrors three body fields into headers so a proxy can
 * route without parsing, and requires the server to reject any disagreement —
 * the point being that a gateway routing on the header and a server acting on
 * the body must never see two different requests.
 *
 * Notifications are exempt: the revision says their header requirements are
 * undefined, and inventing a rule there would refuse messages nothing is
 * required to shape.
 */
function checkModernHeaders(request: Request, message: JsonRpcRequest): string | null {
  const header = (name: string) => request.headers.get(name);
  const params = message.params ?? {};
  const meta = (params._meta ?? {}) as Record<string, unknown>;

  if (typeof meta[META_PROTOCOL_VERSION] !== "string") {
    return `${MODERN_PROTOCOL_VERSION} requires params._meta["${META_PROTOCOL_VERSION}"] on every request.`;
  }
  const declared = header("mcp-protocol-version");
  if (declared !== null && declared !== meta[META_PROTOCOL_VERSION]) {
    return (
      `Header mismatch: MCP-Protocol-Version header value '${declared}' ` +
      `does not match body value '${String(meta[META_PROTOCOL_VERSION])}'.`
    );
  }
  if (meta[META_CLIENT_CAPABILITIES] === undefined) {
    return (
      `${MODERN_PROTOCOL_VERSION} requires params._meta["${META_CLIENT_CAPABILITIES}"]; ` +
      `send an empty object if the client has no optional capabilities.`
    );
  }

  const method = header("mcp-method");
  if (method === null) return "Header mismatch: Mcp-Method is required and was not sent.";
  if (method !== message.method) {
    return `Header mismatch: Mcp-Method header value '${method}' does not match body value '${message.method}'.`;
  }

  // Mcp-Name mirrors params.name or params.uri, and only for the three methods
  // that carry one. This server serves no resources, so two of the three.
  if (message.method === "tools/call" || message.method === "prompts/get") {
    const expected = typeof params.name === "string" ? params.name : "";
    const sent = header("mcp-name");
    if (sent === null) return "Header mismatch: Mcp-Name is required for this method and was not sent.";
    if (decodeMcpName(sent) !== expected) {
      return `Header mismatch: Mcp-Name header value '${sent}' does not match body value '${expected}'.`;
    }
  }
  return null;
}

/**
 * Undo the sentinel encoding a client uses when a name will not survive as a
 * plain ASCII header value. Every tool and prompt name on this server is
 * lowercase ASCII, so this only ever fires for a client that encodes anyway.
 */
function decodeMcpName(value: string): string {
  const match = /^=\?base64\?(.*)\?=$/.exec(value);
  if (!match) return value;
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return value;
  }
}

/** Entry point shared by both MCP routes. */
export async function handleMcpPost(request: Request, caller: McpCaller): Promise<Response> {
  const { user, connectionId } = caller;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const baseUrl = `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost ?? url.host}`;

  // Before anything is parsed or any work is done: a browser naming a foreign
  // origin does not get to act as this person. Recorded rather than silent,
  // because the fix — adding it to the setting — needs the address, and the
  // admin will otherwise only see a client that stopped working.
  const origin = request.headers.get("origin");
  if (origin) {
    const { mcpAllowedOrigins } = await getSettings().catch(() => ({ mcpAllowedOrigins: "" }));
    if (!originAllowed(origin, baseUrl, mcpAllowedOrigins)) {
      await recordSystemEvent({
        source: "mcp.origin",
        message: `Refused an MCP request from origin ${origin}`,
        detail: "Settings → Variables → Extra MCP origins allows it, if it is meant to be there.",
        userEmail: user.email,
      });
      return jsonResponse(err(null, INVALID_REQUEST, `Origin not allowed: ${origin}`), 403);
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(err(null, PARSE_ERROR, "Invalid JSON"), 400);
  }

  const ctx: McpContext = { userId: user.id, user, connectionId, baseUrl };

  const wantsSse = (request.headers.get("accept") ?? "").includes("text/event-stream");
  const messages = Array.isArray(body) ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];

  if (messages.length === 0) {
    return jsonResponse(err(null, INVALID_REQUEST, "Empty batch"), 400);
  }

  // A version this server does not speak is refused before the message is even
  // looked at, and the refusal names what it does speak so the client can pick
  // one and retry. HTTP 400 rather than 200 is the load-bearing part: it is the
  // status a modern client reads to decide whether to fall back.
  const declaredVersion = request.headers.get("mcp-protocol-version");
  if (declaredVersion !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(declaredVersion)) {
    return jsonResponse(
      err(
        messages[0]?.id ?? null,
        UNSUPPORTED_PROTOCOL_VERSION,
        `Unsupported protocol version: ${declaredVersion}`,
        { requested: declaredVersion, supported: SUPPORTED_PROTOCOL_VERSIONS },
      ),
      400,
    );
  }

  // Batching was legal in exactly one revision, 2025-03-26, which this server
  // still answers — so an array is still accepted rather than refused. The
  // modern revision requires a single message, and says so here rather than
  // quietly answering half of one.
  if (Array.isArray(body) && messages.some((message) => message && eraFor(request, message) === "modern")) {
    return jsonResponse(
      err(null, INVALID_REQUEST, `${MODERN_PROTOCOL_VERSION} requires one JSON-RPC message per POST, not an array.`),
      400,
    );
  }

  const responses: JsonRpcResponse[] = [];
  let modernRequested = false;
  for (const message of messages) {
    if (!message || typeof message !== "object" || typeof message.method !== "string") {
      responses.push(err(null, INVALID_REQUEST, "Invalid JSON-RPC message"));
      continue;
    }
    const era = eraFor(request, message);
    if (era === "modern") modernRequested = true;
    const isNotification = message.id === undefined || message.id === null;
    if (era === "modern" && !isNotification) {
      const problem = checkModernHeaders(request, message);
      if (problem) return jsonResponse(err(message.id ?? null, HEADER_MISMATCH, problem), 400);
    }
    try {
      const response = await handleMessage(message, ctx, era);
      if (response) responses.push(response);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      responses.push(err(message.id ?? null, INTERNAL_ERROR, detail));
    }
  }

  // Everything was a notification — the spec wants 202 with no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  if (wantsSse) return sseResponse(payload);

  // A method this server does not implement is a 404 in the modern era and a
  // 200 carrying a JSON-RPC error in the old one, and the difference is not
  // pedantry: the status is how a modern client tells "this endpoint does not
  // host that method" from "this is not an MCP endpoint at all". Only ever
  // applied to a single unbatched message, since a batch has no one status.
  const single = Array.isArray(body) ? null : responses[0];
  if (single?.error?.code === METHOD_NOT_FOUND && modernRequested) {
    return jsonResponse(payload, 404);
  }
  return jsonResponse(payload);
}

export function mcpUnauthorized() {
  // Deliberately no WWW-Authenticate header: this server uses a token embedded
  // in the URL, and advertising a challenge would send clients down an OAuth
  // discovery path that does not exist here.
  return jsonResponse(
    {
      error: "unauthorized",
      message:
        "Missing, invalid or suspended token. Copy your personal connection URL from the Settings page of your Hired.",
    },
    401,
  );
}
