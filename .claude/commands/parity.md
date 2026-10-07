---
description: Audit whether everything the UI can do is also reachable by conversation
---

Audit MCP coverage. The rule is that anything a person can do in the app, they can do by
talking — except direct manipulation (drag, type, render).

Do this:

1. Enumerate every user-facing capability in `src/server/actions.ts` and the screens under
   `src/app/(app)/`.
2. Enumerate every tool in the `tools` array in `src/lib/mcp/tools.ts`.
3. Diff them.

Report a table with three columns: **capability**, **tool that covers it** (or `MISSING`),
**verdict** — one of:

- `covered` — a tool does this
- `gap` — no tool, and there should be one
- `ui-only` — legitimately direct-manipulation, rendering or a display preference (a width, a visible field); say which

Then, separately, list the reverse: tools with no UI equivalent. Those aren't bugs, but
call out any where a person would reasonably expect a screen.

Finally, sanity-check the asserted tool counts. Count the entries in `tools` and in
`prompts`, split by `adminOnly`, and compare against the numbers in the README's "Connect
your AI" paragraph. The Settings panel derives its count live and the manual's are
generated, so the README is the only thing that can go stale.

Don't fix anything. Just report, ranked by how much the gap hurts.
