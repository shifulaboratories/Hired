---
description: Build a feature the Hired way — schema, migration, data layer, MCP tools, then UI
argument-hint: [what to build]
---

Build this: $ARGUMENTS

Follow the `ship-a-feature` skill exactly, and read the `mcp-tool` skill before writing any
tool description.

Before writing code, tell me three things in three lines:

1. **The data** — models or fields you're adding, and the migration filename.
2. **The tools** — every tool name a person will be able to call, with one line each on
   when an assistant should reach for it.
3. **The screen** — what the UI shows, or "none" plus why nobody needs to see it.

If step 2 is empty, stop and explain why this feature can't be reached by conversation.
That is almost always a sign the design is wrong, not that the rule doesn't apply.

Then build it in order: schema → migration → `src/lib/data/` → `src/lib/mcp/tools.ts` →
`src/server/actions.ts` → UI → the manual under `docs/`.

Finish with `npm run typecheck` and `npm run build`, both clean, and append anything
non-obvious you decided to `.claude/DECISIONS.md`.
