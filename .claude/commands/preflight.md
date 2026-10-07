---
description: Review uncommitted work against the Hired invariants before committing
---

Review the current diff (`git diff` plus `git diff --staged` plus any untracked files)
against the invariants in `CLAUDE.md`. Be adversarial — you are looking for reasons this
shouldn't ship.

Check each, and say `pass` or `FAIL` with the file and line:

1. **Tenant isolation** — every new or changed function in `src/lib/data/` takes `userId`
   as its first positional argument and every query filters on it. No `userId` arriving
   from a client anywhere. No new admin path that can read another user's content.
   Run the `tenant-auditor` agent for this one if the diff touches the data layer.
2. **One data layer** — no logic in a server action or a tool that should live in
   `src/lib/data/`. No rule implemented twice.
3. **Stateless transport** — nothing added to `src/lib/mcp/handler.ts` that persists
   between requests or assumes process affinity.
4. **MCP parity** — every new capability has tools. Name them. If it's a legitimate
   direct-manipulation exception, say which.
5. **Tool descriptions** — each new description says when to reach for the tool, what
   comes back, and flags replace-vs-append semantics.
6. **One env var** — nothing new required at deploy time. Config belongs in `Setting`
   with an admin panel and an `admin_*` tool.
7. **Migrations** — a real migration exists for every schema change, no already-shipped
   migration was edited.
8. **Resume schema** — no field in `src/lib/resume-schema.ts` changed meaning; new fields
   are optional-with-default so old saved documents still render.
9. **Voice** — the manual, the README and UI copy match the existing register: plain, second person, no
   marketing, no emoji, no exclamation marks.
10. **Build** — `npm run typecheck` and `npm run build` both clean. Actually run them.

End with a verdict — ship / fix first — and a suggested commit message in the repo's
style: imperative, one coherent change, described by what it does for the user.
