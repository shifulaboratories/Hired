---
name: mcp-tool
description: How to write, name and describe an MCP tool or prompt in Resume OS so an assistant calls it correctly the first time. Use whenever adding, editing or reviewing anything in src/lib/mcp/tools.ts, handler.ts or clients.ts, or when a tool is being called wrongly, ignored, or is producing bad data.
---

# Writing MCP tools for Resume OS

The tool list is the product's real API and its real UX. A person's career history gets
written by whatever an assistant infers from these strings.

## Shape

```ts
{
  name: "append_role_background",
  title: "Append to a role's background",
  description: "...",
  inputSchema: object({ role_id: str("..."), text: str("...") }, ["role_id", "text"]),
  adminOnly: false,
  handler: async (args, ctx) => me.appendToRoleBackground(ctx.userId, required(args, "role_id"), ...),
}
```

Use the file's local helpers — `str`, `num`, `bool`, `strArray`, `object`, `s`, `n`, `b`,
`a`, `required`, `defined` — rather than hand-rolling. `required()` throws a legible error
naming the missing argument. `defined()` strips undefined keys so Prisma doesn't write
them.

`ctx.userId` is the only source of ownership. A tool must never accept a user id, an owner
id, or anything else that would let a caller act as someone else.

## Naming

`verb_noun`, snake_case, area-consistent: `list_*`, `get_*`, `create_*`, `update_*`,
`delete_*`, `search_*`, plus specifics like `move_application_stage`,
`preview_company_merge`, `pipeline_stats`. Admin tools are prefixed `admin_`. A name that
doesn't fit the pattern means the tool is doing too much.

## Descriptions — where the effort goes

A description has four jobs, in order:

1. **When to reach for this.** The most valuable sentence in the file is in
   `search_me`: *"This is the FIRST tool to call when tailoring a resume or answering a
   question about their experience."* That is routing information no schema can convey.
   Write the equivalent for every tool.
2. **What it does**, in the user's terms — "roles", "background", "highlights",
   "applications", "stages" — not the table names.
3. **What comes back** and what to do with it: ids, kinds, whether anything was saved.
4. **The trap.** Every destructive or surprising semantic, stated bluntly.

Traps that must be restated wherever they apply:

- **Replace vs append.** `update_resume` and `update_role` replace what you send. Say
  "read first, modify, then write back whole." `append_role_background` exists precisely
  because assistants kept overwriting people's notes with `update_role`.
- **Saved vs not.** `import_resume` with `dry_run` reports what it would add without saving.
  Any tool with a dry-run twin, or a dry-run flag, should point at it.
- **Prefer a copy.** Tailoring should say to `duplicate_resume` rather than edit a resume
  already attached to an application.
- **No fabrication.** Any tool that writes resume content restates the rule: never invent
  experience, employers, dates or metrics; if Me has no evidence, say so and ask.

Write descriptions for an assistant that has never seen this codebase and will not read
the source. Verbose beats ambiguous.

## Prompts, not mega-tools

A sequence — read a posting, mine Me, draft, save, report gaps — is a `prompts`
entry at the bottom of `tools.ts` composing existing tools. Those surface as slash
commands or prompt shortcuts depending on the client. Existing ones: `tailor_resume`,
`mine_role_background`, `pipeline_review`, `log_my_week`, `onboard_teammate` (admin). If a new
tool's description needs the word "then" twice, it is a prompt.

## Server instructions

`instructionsFor(user)` in `handler.ts` is the system-level briefing every client gets on
connect: the three areas, and the rules of thumb. When a new area or a new footgun
appears, it goes here as well as in the tool description — clients read this once and rely
on it.

## Transport

`handler.ts` is hand-written Streamable HTTP because Next route handlers speak the Web
Request/Response API. It is **stateless on purpose**: every POST re-resolves its user from
the token, which is what makes replicas, restarts and instant suspension work. Do not add
session state or per-connection caches. Supported protocol versions are pinned at the top
of the file.

## Adding a client

One entry in the `MCP_CLIENTS` array in `clients.ts` — id, name, category, tagline,
whether it's native HTTP or needs the `mcp-remote` bridge, a docs link, and a `steps`
function that takes the URL. No UI changes. Check the config format against the vendor's
own documentation and keep the `docs` link current, because these formats drift.

## Before you're done

Bump the tool count in `README.md`, which hardcodes it in three places ("73 tools any MCP
client can call, 98 if you're an admin" style). The Settings panel derives its number live
from the tools array, and the Test button reports what actually answered — so a stale
README is immediately visible to a user as a contradiction. Don't trust any count written
in prose, this file included — earlier versions of this paragraph hardcoded a number and
it drifted within a week. The authoritative count is generated on the /docs page; grep
`adminOnly: true` in `tools.ts` for the admin/member split, and remember every prompt is
also published as a tool, so the callable total is the tools array plus the prompts
array.
