---
name: ship-a-feature
description: The end-to-end loop for adding any capability to Hired — schema, migration, data layer, MCP tool, server action, UI, docs. Use whenever adding or substantially changing a feature, a data model, or anything a user can do. Triggers on "add", "build", "implement", "support", "let me be able to", "new tool", "new field", "new screen".
---

# Shipping a feature in Hired

Follow this in order. The order is the point: it forces the conversational interface to
exist before the visual one, which is the product thesis.

## 0. Decide whether it belongs

Three questions, answered out loud before any code:

- **Can a person do this by talking?** If the answer is no even in principle, it is
  probably direct-manipulation UI (drag, type, render) and belongs in the narrow exception
  list. Say so explicitly.
- **Does it add a required environment variable?** If yes, redesign. Configuration lives
  in the `Setting` table with an admin panel and an `admin_*` tool. `DATABASE_URL` is the
  only var, and that is a promise the README makes.
- **Does it fork logic that already exists?** Search `src/lib/data/` first. Two
  implementations of one rule is the failure mode this architecture exists to prevent.

## 1. Schema and migration

Add the model or field to `prisma/schema.prisma`. Every user-owned model carries
`userId` + a `user` relation with `onDelete: Cascade`, and an index that leads with
`userId` (`@@index([userId])`, or `@@index([userId, stage])` for the shapes you actually
query).

Write a real migration under `prisma/migrations/<timestamp>_<name>/migration.sql`. The
deploy runs `prisma migrate deploy` on start, so a missing migration is a broken deploy,
not a local inconvenience. Never edit a migration that has already shipped.

Defaults over nullables for scalars — the codebase uses `@default("")` heavily so that
partially-populated records render rather than crash.

## 2. Data layer

Add functions to the right file in `src/lib/data/` — `me.ts`, `resumes.ts`,
`pipeline.ts`, `users.ts`, `connections.ts`. New area, new file, same rules.

```ts
export async function listThings(userId: string, opts?: { limit?: number }) {
  return db.thing.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}
```

`userId` is the **first positional argument**, always, and every query filters on it.
This is the entire tenant-isolation story: the compiler rejects call sites that forget.
An optional `userId`, a `userId` inside an options object, or a query that doesn't filter
on it is a security bug, not a style preference.

Export the input/patch types (`RoleInput`, `ProfilePatch` style) so tools and actions
share them.

## 3. MCP tools — mandatory

Add to the `tools` array in `src/lib/mcp/tools.ts`. Read the `mcp-tool` skill before
writing the description; the description is where this product succeeds or fails.

Cover the whole capability, not just the write: if a person can create it, they can list
it, read one, update it and remove it by tool. Set `adminOnly: true` on anything
instance-scoped — those are filtered out of `tools/list` for members entirely.

If the capability is really a sequence, add a `prompts` entry that composes the tools
rather than a mega-tool.

## 4. Server action — only if a human needs to do it by hand

Add to `src/server/actions.ts`. Resolve the caller with `requireUser()` or
`requireAdmin()`. **Never accept a `userId` from the client** — no exceptions, no
"internal" ones. Call the same data function the tool calls. `revalidatePath` the screens
that show the change.

## 5. UI — only if a person needs to see or adjust it

Screens live in `src/app/(app)/`, components in `src/components/<area>/`. `src/components/ui/`
is shadcn — extend it, don't rewrite it. Everything autosaves (`src/hooks/use-autosave.ts`);
there is no save button anywhere in this app and adding one would be a regression.

## 6. Docs

Document the feature in the manual under `docs/`, in the existing voice — plain, second
person, no marketing, no emoji. If you added tools, run `node tools/gen-tool-docs.mjs` for
the generated tool pages, and bump the counts in the README's "Connect your AI" paragraph.
The README is a front door; it does not grow a section per feature.

## 7. Verify

```bash
npm run typecheck
npm run build
```

Then say, in the summary, for each thing you added: the data function, the tool name, and
the screen — or explicitly why one of the three doesn't exist. If you can't name the tool,
the feature isn't shipped.

Append anything non-obvious you learned to `.claude/DECISIONS.md`.
