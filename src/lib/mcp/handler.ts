import type { User } from "@prisma/client";
import { promptsFor, promptsByName, splitLinks, toolsFor, toolsByName, type McpContext } from "@/lib/mcp/tools";
import { meIsEmpty, listGuardrails } from "@/lib/data/me";
import { recordSystemEvent } from "@/lib/data/system";
import { isAdmin, type McpCaller } from "@/lib/auth";

/**
 * A small, dependency-light implementation of the MCP Streamable HTTP transport.
 *
 * Written by hand rather than wired through the SDK's Node transport because
 * Next.js route handlers speak the Web Request/Response API. Stateless: every
 * POST is self-contained, so there are no sessions to lose across restarts or
 * replicas — and every request re-resolves its user from the token, so
 * suspending someone takes effect immediately.
 */

const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = {
  name: "hired",
  title: "Hired",
  version: "2.0.0",
};

/**
 * What the briefing says when there is nothing to brief on.
 *
 * The tour below assumes four areas with something in them. A new account has
 * none, so an assistant connected to one was handed a confident description of a
 * populated workspace, called search_me, got an empty array back and improvised — which is
 * the exact moment this server's one real rule gets broken, because an invented
 * career is the only way left to satisfy the request in front of it.
 *
 * Naming the tools that get material IN is the whole point. import_resume is
 * the front door for anyone holding a document; the hand-filing tools remain
 * for the person who would rather talk it through.
 */
const EMPTY_WORKSPACE = `This workspace is EMPTY: no roles, no highlights, no notes, no projects.
Every read tool will come back with nothing, and that is the state of the account rather than a
failed call. Say so plainly instead of closing the gap with something plausible.

Ask one thing before anything else: "Do you have a resume or a LinkedIn export you can paste, or
would you rather talk me through your last job?" If they paste a document, parse it yourself and
file the whole thing with ONE import_resume call — roles with their bullets, education, skills,
profile facts — copying what it says and inventing nothing, then offer create_base_resume so they
see a rendered resume in their first minutes. If they would rather talk, file what comes back with
these:
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

async function instructionsFor(user: User) {
  // A failed lookup must not cost someone their briefing, so an unreachable
  // database falls back to the tour rather than telling an established user
  // their workspace is empty.
  const areas = (await meIsEmpty(user.id).catch(() => false))
    ? EMPTY_WORKSPACE
    : `The areas:
• ME — everything about them. Roles each hold an unlimited free-form "background" of raw
  material, plus polished reusable bullets called highlights. There are also notes, projects,
  education, skills and certifications. search_me is the fastest way in.
• RESUMES — documents assembled from that material. Call get_resume_format before writing one.
  New resumes use the Harvard OCS format by default. Any of them can be published to a public
  link with publish_resume, which is what to use when a form or a recruiter wants a URL.
• PIPELINE — applications, stages, activity timeline, tasks and follow-up dates.
  When the question is about a stretch of time rather than one application — this week, last
  month, what is coming — reach for list_schedule, which merges all three kinds of dated thing.
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
  location, how you know a person — every one of those is a tag rather than a free-text field,
  and they are multi-select. Call list_tags before writing any of them: passing a name that
  already exists matches it rather than creating a near-duplicate, and the six kinds are
  separate lists that never collide. "sources" on an application is the old spelling of its
  tags and still works.`;

  // Outside `areas` deliberately: this is about the connection, not about
  // content, so it is just as true of a workspace with nothing in it — and a
  // new account is exactly who is about to wire up a second client.
  const base = `Hired is ${user.name || user.email}'s career knowledge base, resume builder and
job-search CRM. You are connected as them; every tool reads and writes only their data.

${areas}

Deleting a company, a person or an application puts it in the archive rather than destroying
it. list_archive is what is in there and when each thing is due to go; restore_records brings
it back. delete_archived and empty_archive are the only two acts on this server that cannot be
undone, and neither can reach anything that is not already in the archive — so never call
either without reading the archive back to them first and getting a plain yes. Everything else
deletable — a role, a highlight, a note, a resume, a task, a tag, a saved view — really is gone
when you delete it.

The connection you are talking through is one of several this person may have — list_connections
shows them all, create_connection wires up another client and hands back its URL and setup steps,
and rotate_connection kills a URL that has leaked. Those URLs are credentials with full read and
write over this workspace; never repeat one anywhere it will be stored.
${
  isAdmin(user)
    ? `\nYou are an ${user.role === "SUPER_ADMIN" ? "instance owner" : "admin"}, so the admin_* tools are
also available: inviting people, managing accounts and configuring email. Those act on the
instance, never on another person's career history or resumes.\n`
    : ""
}
Rules of thumb:
- Never invent experience, employers, dates or metrics. Everything on a resume must trace back to
  something in Me. If evidence is missing, say so and ask.
- When the user tells you something new about a job they already have on file, use
  append_role_background rather than update_role, so nothing is overwritten.
- update_resume and update_role replace what you send. Read first, modify, then write back whole.
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

  return `${base}${await standingRulesFor(user.id)}`;
}

/**
 * The user's own rules, appended to the briefing every client receives.
 *
 * This exists because "never invent experience, employers, dates or metrics"
 * does not catch the failure that actually happens. Tailoring to a job req
 * quietly *upgrades* facts — a distribution credit becomes a hire, an unsettled
 * follower count becomes a cited one — and none of it feels like invention to
 * whoever is drafting, because every upgrade maps to a stated responsibility.
 *
 * Guardrails are Note rows, so they could in principle be found with
 * search_me. In practice nobody searches "follower count" before writing a
 * scope bullet, so a rule that has to be looked up is a rule that is absent at
 * the moment it matters. `initialize` runs once per session in every client,
 * before any tool call — it is the only place a constraint is guaranteed to be
 * in context.
 */
const STANDING_RULES_BUDGET = 4096;

async function standingRulesFor(userId: string) {
  const guardrails = await listGuardrails(userId).catch(() => []);
  if (guardrails.length === 0) return "";

  const header = `

THIS PERSON'S STANDING RULES — these override any inference you would otherwise make.
They are not preferences. Breaking one produces a document that reads as true and is not.
`;

  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const rule of guardrails) {
    const line = `\n• ${rule.title}${rule.body.trim() ? ` — ${rule.body.trim()}` : ""}`;
    if (used + line.length > STANDING_RULES_BUDGET) {
      dropped += 1;
      continue;
    }
    lines.push(line);
    used += line.length;
  }

  if (dropped > 0) {
    // Silently truncating someone's guardrails is the worst possible failure
    // here, so it is at least visible in the server log.
    console.warn(
      `[mcp] standing rules truncated for user ${userId}: ${dropped} of ${guardrails.length} omitted past ${STANDING_RULES_BUDGET} chars`,
    );
    lines.push(`\n• (${dropped} further rules omitted — trim them in the app, they are not being sent.)`);
  }

  return header + lines.join("");
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

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

/** Dates need to survive the trip; everything else is plain JSON already. */
function serialize(value: unknown) {
  return JSON.stringify(value, (_key, val) => (val instanceof Date ? val.toISOString() : val), 2);
}

async function handleMessage(
  message: JsonRpcRequest,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const params = message.params ?? {};
  const isNotification = message.id === undefined || message.id === null;

  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
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
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
    case "notifications/roots/list_changed":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: toolsFor(ctx.user).map((tool) => ({
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
        })),
      });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolsByName.get(name);
      if (!tool) return err(id, INVALID_PARAMS, `Unknown tool: ${name}`);
      if (tool.adminOnly && !isAdmin(ctx.user)) {
        return ok(id, {
          content: [{ type: "text", text: "Error: that tool is only available to admins." }],
          isError: true,
        });
      }
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await tool.handler(args, ctx);
        // Links ride alongside the JSON rather than replacing it: a client that
        // renders resource links gets something clickable, one that doesn't sees
        // exactly what it always saw.
        const { data, links } = splitLinks(result);
        return ok(id, {
          content: [{ type: "text", text: serialize(data ?? { ok: true }) }, ...links],
        });
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
        return ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
      }
    }

    case "prompts/list":
      return ok(id, {
        prompts: promptsFor(ctx.user).map((prompt) => ({
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: prompt.arguments,
        })),
      });

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
      });
    }

    // Declared as unsupported in `capabilities`, but answer politely rather than
    // erroring so probing clients do not surface a scary message.
    case "resources/list":
      return ok(id, { resources: [] });
    case "resources/templates/list":
      return ok(id, { resourceTemplates: [] });

    default:
      if (isNotification) return null;
      return err(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
  }
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
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

/** Entry point shared by both MCP routes. */
export async function handleMcpPost(request: Request, caller: McpCaller): Promise<Response> {
  const { user, connectionId } = caller;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(err(null, PARSE_ERROR, "Invalid JSON"), 400);
  }

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const ctx: McpContext = {
    userId: user.id,
    user,
    connectionId,
    baseUrl: `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost ?? url.host}`,
  };

  const wantsSse = (request.headers.get("accept") ?? "").includes("text/event-stream");
  const messages = Array.isArray(body) ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];

  if (messages.length === 0) {
    return jsonResponse(err(null, INVALID_REQUEST, "Empty batch"), 400);
  }

  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || typeof message.method !== "string") {
      responses.push(err(null, INVALID_REQUEST, "Invalid JSON-RPC message"));
      continue;
    }
    try {
      const response = await handleMessage(message, ctx);
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
  return wantsSse ? sseResponse(payload) : jsonResponse(payload);
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
