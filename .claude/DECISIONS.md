# Decisions

The memory a fresh session doesn't have. Append when you make a non-obvious call, hit a
constraint, or try something that doesn't work. Newest at the bottom. One entry, one
decision, with the *why* — the why is the part that stops it being relitigated.

Format:

```
## YYYY-MM-DD — short title
**Decision:** what we're doing.
**Why:** the reasoning, including what we gave up.
**Applies to:** files or areas this constrains.
```

---

## 2026-08-17 — CLAUDE.md and .claude/ added
**Decision:** the repo now carries its own working agreement: `CLAUDE.md` for
architecture invariants and the MCP-first rule, `.claude/skills/` for the feature and
tool-writing loops, `.claude/commands/` for `/ship`, `/parity` and `/preflight`, and a
`tenant-auditor` subagent. Personal context lives in `CLAUDE.local.md`, gitignored.
**Why:** every session was re-deriving the architecture from the source and sometimes
getting it wrong — building screens before tools, or adding data functions without a
leading `userId`. The rules were real but only existed in the author's head and in
file-header comments.
**Applies to:** everything. Read `CLAUDE.md` before writing code.

## 2026-08-17 — Focus: replace resume.lol before adding anything social
**Decision:** the next five features are public resume URLs, server-side PDF export,
resume/LinkedIn import, one-call job-posting capture, and traceable tailoring. Interview
question tracking and any sharing-between-users feature are parked.
**Why:** the pipeline board and CRM already exist and work; the reason the workflow still
leaves this app is that a resume has no URL and the PDF path runs through the browser
print dialog. Sharing needs a hosted instance, moderation and a privacy model that
single-tenant self-hosting doesn't have — starting it now would stall on infrastructure
rather than ship.
**Applies to:** roadmap decisions, and any PR that proposes a social feature.

## 2026-08-17 — Custom utilities must not outrank Tailwind's
**Decision:** `.ring-highlight`'s `position: relative` lives behind `:where()` in
`globals.css`, and any future custom utility that sets a property Tailwind also owns has to
do the same. Don't "tidy" the `:where()` away.
**Why:** `globals.css` is emitted *after* Tailwind's own utilities inside
`@layer utilities`, so a bare `.ring-highlight { position: relative }` beat `.fixed` at
equal specificity. Every dialog and the command palette silently lost `position: fixed` and
fell to the bottom of the page — the overlay still dimmed correctly, which is why it looked
like a layout bug rather than a cascade bug. `:where()` drops the rule to zero specificity
so it only supplies a default. The browser suite now asserts that no element carrying a
position utility computes anything else, which is the check that would have caught it.
**Applies to:** `src/app/globals.css`, and any new utility in `@layer utilities`.

## 2026-08-17 — One MCP connection per client, and the migration that made it safe
**Decision:** `User.mcpToken` is gone; connections are rows in `McpConnection`, one per AI
client, each with its own token, `lastUsedAt` and `lastUsedFrom`. The migration copies every
existing token into a connection row *before* dropping the column.
**Why:** a single token meant rotating after pasting a URL somewhere careless disconnected
every client at once, and there was no way to answer "is this actually connected?". The
backfill is the part worth remembering: it makes the change invisible to anyone who had
already pasted a URL into Claude, which is the only reason this could ship to a live
instance without a reconnect. Tested against a database seeded with old-schema rows, then
`prisma migrate diff` to confirm zero drift.
**Applies to:** `prisma/migrations/20250104000000_mcp_connections/`, `src/lib/auth.ts`
(`userByMcpToken`, `ensureDefaultConnection`), `src/lib/data/connections.ts`.

## 2026-08-17 — No counter on connections
**Decision:** connections record `lastUsedAt` and `lastUsedFrom`, not a call count. A
`callCount` field was built and removed before shipping.
**Why:** writing on every tool call is wasteful on a chatty session, so the increment was
throttled to once a minute — which made the number quietly wrong and the name a lie. If a
future session wants real usage numbers, that's a separate append-only table, not a counter
on this row.
**Applies to:** `prisma/schema.prisma` (`McpConnection`), `src/lib/auth.ts`.

## 2026-08-17 — A resume gets a URL, and the slug is the entire privacy model
**Decision:** `Resume.slug` + `visibility` (PRIVATE | UNLISTED), a public `/r/[slug]` route
with no auth, and `publish_resume` / `unpublish_resume`. No per-viewer permissions, no
passwords, no expiry. Withdrawing a link *clears the slug* rather than hiding it, so the
address is destroyed and republishing mints a different one.
**Why:** this is the one thing people actually leave for resume.lol — a link you paste into
an application form. Everyone you'd send it to is someone you already decided to send it to,
so permissions would be ceremony protecting nothing. The slug carries ~60 bits of entropy,
which is what makes "unguessable" true rather than a slogan, and the page sets noindex
because an indexed unlisted link is a listed one. Destroying rather than pausing the address
matters: the reason you withdraw a link is usually that it went somewhere you regret, and a
pause that can be undone doesn't fix that.
**Applies to:** `src/app/r/[slug]/`, `publishResume`/`unpublishResume` in
`src/lib/data/resumes.ts`, `Resume.slug` in the schema.

## 2026-08-17 — One deliberately anonymous read, and how it's kept narrow
**Decision:** `getResumeBySlug(slug)` is the only function in `src/lib/data/` without a
leading `userId`. It filters on `visibility: UNLISTED` and uses an explicit `select` listing
the nine fields the public page renders.
**Why:** a public page has no user, so the compile-time isolation rule cannot apply — which
makes this the one place where a mistake is a data leak instead of a type error. The
`select` is an allow-list rather than an omit-list precisely so that adding a column to
`Resume` later can never silently publish it. `notes` are private tailoring notes and must
never appear. Do not widen it without asking whether a stranger should see the new field.
**Applies to:** `getResumeBySlug` in `src/lib/data/resumes.ts`.

## 2026-08-17 — Never spread a patch object into Prisma
**Decision:** every update in `src/lib/data/` narrows its patch through `pick()` from
`src/lib/data/patch.ts` with an explicit column list. `updateHighlight` additionally verifies
that a new `roleId` belongs to the caller, as `createHighlight` already did.
**Why:** found while shipping public URLs, confirmed against a live database, and worse than
it looked. The userId-first rule scopes the *query*; it says nothing about what the patch
*contains*, and server actions accept whatever JSON a client sends because the TypeScript
parameter type is erased at runtime. So `{ ...patch }` handed the caller every column:
`updateResumeAction(myId, { userId: someoneElse })` moved a row into another person's
workspace, `updateHighlightAction(mine, { roleId: theirRoleId })` read back their employer and
job title through the joined role, and once slug/visibility existed, a member could have
claimed an address another user had just withdrawn. All three were reachable; all three are
closed. Whitelisting also means a patch of nothing-we-recognise leaves no columns to write,
so each function now checks ownership directly rather than reporting "no such record" for a
record that plainly exists.
**Applies to:** every `update*` in `src/lib/data/brain.ts` and `resumes.ts`. Adding an
editable column means adding it to that function's list on purpose.

## 2026-08-17 — Pure resume helpers live outside the data layer
**Decision:** `resumeToText` and `estimateLines` moved to `src/lib/resume-text.ts`.
`resumes.ts` re-exports them so server callers are unchanged.
**Why:** the editor is a client component and imports `estimateLines` for its live page
count, which dragged the whole data module into the browser bundle. That only ever worked by
accident — adding one `node:crypto` import for slug generation broke the production build
outright. Nothing in `src/lib/data/` should be reachable from a client component.
**Applies to:** `src/lib/resume-text.ts`, `src/components/resume/resume-editor.tsx`.

## 2026-08-17 — Server-side PDF drives the print page, it doesn't replace it
**Decision:** `/api/resumes/[id]/pdf` launches headless Chromium against this app's own
`/print/[id]` and returns the bytes. `export_resume_pdf` does the same and reports the real
page count. The print page is untouched and stays reachable from the editor's ⋯ menu.
**Why:** the alternative was generating a PDF from the ResumeDoc with a PDF library, which
would have been a *second* renderer to keep in sync with `ResumePaper` — it would drift, and
the five templates would drift fastest. Driving the real page means there is exactly one
renderer and the PDF cannot disagree with what the editor shows. Verified the output is
genuinely selectable text: Chromium writes Type0/CIDFontType2 fonts, so the words are glyph
ids, and it is the ToUnicode CMap that makes them recoverable by a human copy-pasting or an
applicant tracking system. The test decodes through that map rather than asserting "it's a
PDF", because a rasterised page would pass the lazy check and fail every real ATS.
**Applies to:** `src/lib/pdf.ts`, `src/app/api/resumes/[id]/pdf/`, `/print/[id]` (leave it
alone).

## 2026-08-17 — The PDF renderer degrades instead of becoming a deploy dependency
**Decision:** `playwright-core`, not `playwright` or `puppeteer`, plus whatever Chromium the
host already has. No browser is downloaded at install. When there is none, the route answers
501 with an explanation and the tool returns `available: false` and points at the print page.
**Why:** self-hosting is supposed to be one variable and five minutes, and Railway's default
image has no Chromium — Railway's own guidance for Playwright is a Dockerfile. Making the
browser mandatory would have meant changing the builder for everyone to buy one-click PDF for
one person. This way an instance without a browser behaves exactly as it did before the
feature existed, and adding a browser later is a pure upgrade. `PDF_CHROMIUM_PATH` is
optional and exists for unusual hosts; `DATABASE_URL` is still the only required variable.
**Applies to:** `src/lib/pdf.ts`, `package.json`, deploy config.

## 2026-08-17 — The renderer authenticates with an ordinary short-lived Session
**Decision:** the PDF route mints a Session row expiring in 120 seconds, hands that cookie to
the headless browser, and deletes it in a `finally`.
**Why:** the print page must keep its `requireUser()` guard, so the renderer needs to be
somebody. The alternatives were a signed render token or an auth exemption on `/print`, and
both add a new way in that has to be reasoned about separately. Reusing the existing session
mechanism means the renderer inherits every check that already applies — a suspended user's
ephemeral session is rejected exactly like any other — and there is no new credential type in
the system.
**Applies to:** `createEphemeralSession`/`destroySession` in `src/lib/auth.ts`.

## 2026-08-17 — Docker build for server-side PDF: parked, not abandoned
**Decision:** the repo stays on Nixpacks. The `Dockerfile` and `.dockerignore` that installed
Chromium are reverted. `src/lib/pdf.ts` and everything around it stay exactly as they are, so
the PDF button falls back to the print page on a stock Railway deploy.
**Why:** two attempts, and no local Docker daemon to test against. The first failed because
`npm ci` runs `prisma generate` in postinstall and the schema hadn't been copied yet —
fixed. The second built fine and then failed its healthcheck: the container started, ran
migrations, and `next start` produced no output and never listened, where the Nixpacks
container printed its banner and was ready in under a second. That is a third unknown, and
debugging it by pushing to a live deployment is the wrong way to spend someone's site.
**What is already proven**, so nobody repeats it: `node:20-bookworm-slim` installs
`chromium` (lands at `/usr/bin/chromium`), `fonts-croscore` and `fonts-liberation` cleanly in
about 26 seconds; `COPY prisma ./prisma` must precede `npm ci`; the fonts are not optional,
because the Harvard template asks for Tinos and would otherwise silently render in something
else.
**How to finish it:** build the image locally with a real Docker daemon, run it with
DATABASE_URL and PORT set, and find out why `next start` stays silent — likely a port or
entrypoint difference between Railway's Docker runtime and Nixpacks. It is a ten-minute job
with a daemon and an unbounded one without.
**Applies to:** deploy config; revisit before promising one-click PDF in the README.

## 2026-08-17 — Every prompt is also a tool
**Decision:** the five workflows are published in `tools/list` as well as `prompts/list`, via
one `promptAsTool` wrapper over the existing `prompts` array. `prompts/list` and `prompts/get`
are unchanged.
**Why:** MCP prompts are a client-optional surface and tools are not. A full working session
against the live instance ran start to finish without a single prompt being reachable —
`tailor_resume`, which encodes the whole seven-step loop including "do not invent anything",
simply did not exist as far as that client was concerned. That fails this project's own rule:
a feature isn't done until it's callable from a conversation. It is a wrapper rather than a
copy on purpose — the instruction text has exactly one home, and a test asserts the tool and
the prompt return byte-identical strings so the two surfaces cannot drift. `adminOnly` rides
along, so `onboard_teammate` stays hidden from members in both places.
**Applies to:** `promptAsTool` and `allTools` in `src/lib/mcp/tools.ts`.

## 2026-08-17 — Standing rules go in the briefing, not in search
**Decision:** `Note.kind` (`NOTE | GUARDRAIL`), and `instructionsFor` is now async and appends
every guardrail under a "THIS PERSON'S STANDING RULES" heading, capped at 4KB with a warning
logged if anything is dropped.
**Why:** "never invent experience, employers, dates or metrics" does not catch the failure that
actually happens. Tailoring to a posting quietly *upgrades* facts — a distribution credit
becomes a hire, an unsettled follower count becomes a cited one — and none of it reads as
invention to whoever is drafting, because every upgrade maps to a stated responsibility. Those
rules were already in the system as notes, and notes are only found if a search happens to hit
their words; nobody searches "follower count" before writing a scope bullet. `initialize` runs
once per session in every client before any tool call, which makes it the only place a
constraint is guaranteed to be in context. Truncation is logged rather than silent because
quietly dropping someone's guardrails is the worst thing this code could do.
**Applies to:** `standingRulesFor` in `src/lib/mcp/handler.ts`, `listGuardrails` in
`src/lib/data/brain.ts`, the shield toggle in `src/components/brain/notes-panel.tsx`.

## 2026-08-17 — Seeding: append impact only when it adds something
**Decision:** `buildDocFromBrain` runs each highlight through `bulletFor(text, impact)`, which
appends the impact only when the text doesn't already contain it (compared with punctuation
and case stripped).
**Why:** it appended unconditionally, and a polished highlight almost always states its own
number — people write "Cut infrastructure spend 38%" in `text` and then fill `impact` with the
same thing, so the bullet printed the figure twice. Six of eight bullets came out unusable on a
real first run, and seeding is the first thing a new user touches. Dropping `impact` from the
render entirely would have been simpler but loses the case where the text is terse and the
impact genuinely adds the number, so the check is a containment test rather than a deletion.
**Applies to:** `bulletFor` in `src/lib/data/resumes.ts`.

## 2026-08-17 — A narrowed-to-nothing patch must still report missing records properly
**Decision:** the empty-patch guards added with `pick()` go through `existingOrThrow`, which
throws `No <thing> with id <id>` instead of falling into `findFirstOrThrow`.
**Why:** found while testing `update_extra` — calling it with an unknown id and no fields
returned a raw Prisma stack trace to the caller instead of the legible error every other path
produces. Same information, wrong audience.
**Applies to:** `existingOrThrow` in `src/lib/data/brain.ts`, and the matching branch in
`updateResume`.

## 2026-08-17 — Colour has to earn its place
**Decision:** the interface is near-monochrome. One accent (blue) appears in exactly three
roles — the primary button, links, and the selected thing — and the only other hues are
status: green for current, amber for attention, red for overdue or destructive. The ambient
Aurora background, gradient headings, the gradient button variant, the shimmer, the grid
wash, the `ring-highlight` hairline and the accent hover-blooms are all deleted.
**Why:** with a purple accent used decoratively on eyebrows, icons, bullets, company names and
badges, plus a nine-hue rainbow for pipeline stages, nothing on screen could be read as
meaningful — an overdue application in red sat next to a purple sparkle that meant nothing.
This is a tool people work in for an hour at a time; the ground should be quiet so the one
thing that matters can be loud. Type does the hierarchy now: tighter tracking on large sizes,
a hairline border instead of a shadow on every panel, and shadow reserved for things that
genuinely float.
**Applies to:** `src/app/globals.css` is the whole system — change a token there rather than
restyling a component. Before adding a colour anywhere, say what information it carries.

## 2026-08-17 — Pipeline stages are a ramp, not a palette
**Decision:** `STAGE_TONE` is a monochrome scale that darkens (lightens, in dark mode) as an
application advances, with hue only at the ends: accent for OFFER, green for ACCEPTED, red
for REJECTED. The values are CSS variables rather than literals.
**Why:** stage is a position on one path, so weight reads as progress in a way that nine
arbitrary hues never did — nobody remembers that teal meant "interviewing". Variables rather
than fixed colours because the old literals were tuned for dark mode and went muddy in light.
**Applies to:** `STAGE_TONE` in `src/lib/data/pipeline.ts`, `--stage-*` in `globals.css`.

## 2026-08-18 — Elevation is a hairline ring plus a soft shadow, and the ring flips in the dark
**Decision:** every raised surface gets `0 0 0 1px <rim>` plus a many-stop shadow, exposed as
six tokens: `shadow-hairline`, `shadow-btn`, `shadow-field`, `shadow-card`, `shadow-raised`,
`shadow-overlay`. In the light theme the rim is a grey hairline. In the dark theme it becomes
`oklch(100% 0 0 / 0.09–0.13)` — a faint *highlight* rather than a darker line. Components ask
for the name of the thing (`shadow-card`) rather than a height number, and a component that
carries a ring no longer also carries a `border`.
**Why:** the previous pass made everything flat with a hairline border, which is correct in
light and invisible in dark — a dark border on a dark surface has nowhere to go, so the dark
theme read as one flat wall with text on it. Real objects are lit from above: their top edge
catches light. Flipping the ring to a highlight is one line and it is most of the reason the
dark theme now reads as cards. The many small shadow stops (six at 2–4% rather than two at
10%) matter too: a few big stops read as a slide-deck drop shadow, many small ones read as
light falling off an edge.
**Applies to:** `--rim` and the `--shadow-*` tokens in `globals.css`. Never hand-roll a
`box-shadow` at a call site, and never put `border` on something that already has a ring —
the doubled hairline is what makes an edge look muddy.
**Where it came from:** beautifului.dev, which the whole material layer here is modelled on.
Its catalogue is mostly chat-agent primitives that this product deliberately doesn't need —
the conversation lives in Claude, not in a panel in the app — but its material system is
better than what we had and cost nothing to adopt.

## 2026-08-18 — Four surfaces and three inks
**Decision:** the surface stack is `--background` (page) → `--canvas` (a recessed working area,
e.g. a pipeline column) → `--card` → `--popover`, plus `--inset` for wells and fields. Ink is
`--foreground` → `--muted-foreground` → `--faint`. Status hues each carry a `*-tint` token for
the wash behind a chip.
**Why:** two surfaces and two inks isn't enough vocabulary for a dense screen, so every
component was inventing its own — `bg-muted/25` here, `bg-[var(--success)]/12` there, and each
one wrong in one of the two themes. Fields in particular were raised (`shadow-xs`) when a
field is a hole you put something into; they're inset now. And the tints have to be tokens
because the correct wash differs by theme: a pale colour on white, low-alpha hue on dark.
**Applies to:** `globals.css`. `bg-canvas`, `bg-inset`, `text-faint`, `bg-success-tint` and
friends are real utilities — use them instead of an opacity modifier at the call site.

## 2026-08-18 — The pipeline gets three views; the board stays the default
**Decision:** `/applications` takes a `?view=` of `board` (default), `list` or `calendar`. The
view lives in the URL, not in component state, so all three stay server-rendered and a link to
the calendar is a link to the calendar. List sorts in JS on the server; calendar takes a
`?month=YYYY-MM` and renders a Monday-first grid of the whole visible window.
**Why:** a board answers "where is everything", badly answers "what do I chase first", and
cannot answer "what does next week look like" at all. Those are the two questions the daily
loop actually asks. The board stays default because drag-to-move is the reason it exists.
Sorting in JS rather than SQL because the useful default — soonest follow-up first, then
everything with no date — is not an ordering Postgres gives for free, and this is one person's
pipeline: tens of rows.
**Applies to:** `src/components/pipeline/{view-switcher,list,calendar}.tsx`. The calendar is
deliberately read-only — no dragging, no click-to-create. Dates here are set by the work
(moving a stage schedules the follow-up), so a second place to edit them would be a second
source of truth.

## 2026-08-18 — listSchedule merges the three tables that carry dates
**Decision:** `listSchedule(userId, from, to)` returns follow-ups, task due dates and logged
activity in one list sorted by date, each tagged with its kind. Exposed as `list_schedule`.
**Why:** the calendar needed it, but the rule is that a screen may not be able to answer a
question the conversation can't. "What does my week look like" was previously unanswerable —
`list_follow_ups` only knows about overdue, `list_tasks` ignores dates. Merging in the data
layer rather than in the calendar component is what makes both surfaces agree.
**Applies to:** `src/lib/data/pipeline.ts`. The tool's `to` is pushed to the end of that day
in `tools.ts` — a bare `YYYY-MM-DD` parses as midnight, so an inclusive end date would
otherwise silently drop everything that happened on it.

## 2026-08-18 — A thumbnail measures its container
**Decision:** `PaperThumb` renders the page at its true 816px and scales it with a factor
measured by a ResizeObserver, rather than a hardcoded `scale(0.29)`.
**Why:** the resume grid is responsive, so one fixed scale fits exactly one breakpoint. At
every other the document sat stranded to one side of a white card. CSS cannot do this — `calc`
cannot divide a length by a length — so the measuring is the one bit of client work; the
document itself still renders on the server and comes in as a slot.
**Applies to:** `src/components/resume/paper-thumb.tsx`.

## 2026-08-18 — Stages are a rotation, not a ramp (supersedes the monochrome decision)
**Decision:** each stage gets a hue, and the hue turns one direction along the path —
grey wishlist, steel applied, blue screening, violet interviewing, pink final, gold offer.
The three endings step outside the rotation because they mean something other than
progress: green accepted, red rejected, grey withdrawn. Every surface that shows a stage
uses the same token through one `.stage-chip` utility, and list rows carry the same colour
at 5% as a band.
**Why:** William asked for it, and the monochrome ramp I logged on 2026-08-17 was one step
too austere — a board where every column header is the same grey makes you read labels
instead of seeing shape. The rotation keeps what the ramp was protecting: because the hue
only ever turns one way, two chips still tell you which is further along without anyone
memorising that violet means interviewing. That is the property a nine-hue palette lost.
**Applies to:** `--stage-*` in `globals.css`, `STAGE_TONE` in `pipeline.ts`, and the
`.stage-chip` / `.stage-band` utilities. The rule from before still holds — before adding a
colour, say what information it carries. Here it carries position on the path.

## 2026-08-18 — Company logos, and the beacon that comes with them
**Decision:** the pipeline shows each company's favicon from twenty-icons.com, with a
tinted monogram of the initials underneath it that is always drawn and never replaced. An
admin switch turns the whole thing off; when it is off no domain is even sent to the
browser, so there is nothing for it to fetch. `admin_set_company_logos` makes that
switchable from a conversation, and `admin_instance_stats` reports the current state.
**Why:** logos make a list of companies scannable in a way text never is. The cost is that
a third party learns which companies are in someone's pipeline, which for a job search is
close to the most sensitive thing in the app — so it is stated plainly in the admin panel
rather than buried, `no-referrer` keeps our URLs out of it, and it is one click to stop.
**Applies to:** `src/lib/company.ts`, `src/components/pipeline/company-avatar.tsx`.

## 2026-08-18 — Domains are guessed, and the guess is allowed to be wrong
**Decision:** `companyDomain()` tries the company's `website`, then the posting URL —
unwrapping Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Workday slugs, and
ignoring LinkedIn and the other aggregators — and finally the company name as `name.com`.
`create_application` and `update_application` now take `companyWebsite` so an assistant can
just say it.
**Why:** nobody types a company's domain into a job tracker, so without inference the
feature would show initials forever. Guessing is safe here because the failure is
invisible: a wrong domain 404s and the monogram was already on screen.
**Applies to:** `src/lib/company.ts`.

## 2026-08-18 — An image that is already loaded fires no events
**Decision:** `CompanyAvatar` settles its state from the element (`img.complete` plus
`naturalWidth`) via a ref, not only from `onLoad`/`onError`.
**Why:** a cached image finishes before React attaches its handlers, so neither event ever
fires and the logo stays invisible — on every visit after the first, which is every visit
that matters. Found because the stubbed test served bytes instantly and reproduced exactly
that. The same three-state handling is why a request that hangs shows initials rather than
a white square.
**Applies to:** `src/components/pipeline/company-avatar.tsx`. Any image with a fallback
needs this; the two-state version passes a first-load test and fails in production.

## 2026-08-18 — The rail carries navigation, the top bar carries identity
**Decision:** search moved to the top of the sidebar (above the nav, below the brand), the
name/email block moved out of the sidebar footer into a profile menu at the top right
(Settings, Admin when you have it, Sign out), and the light/dark switch moved out of the
header into an Appearance card in Settings. The rail collapses to icons with a toggle in
the brand row, remembered in `localStorage` under `resume-os:sidebar-collapsed`.
**Why:** the header held two unlabelled icons that each did something permanent-feeling
(theme, sign out) and the sidebar footer held identity with nothing to click. Grouping
every account action behind one avatar makes the sign-out deliberate rather than a
mis-click, and frees the rail to be only navigation. Theme is a preference, and
preferences live in Settings.
**Applies to:** `src/components/shell.tsx`,
`src/components/settings/appearance-panel.tsx`. Collapse state is read in an effect, not
during render — reading `localStorage` while rendering would hydrate-mismatch. Follow-on:
Settings and Admin left the rail entirely, since a link that is also in the profile menu
is a second door to the same room. The rail is four destinations and nothing else. When
collapsed, the expand control replaces the `R` mark on hover rather than taking a row of
its own — a rail that is 4.5rem wide cannot spend vertical space on chrome.
during render — reading `localStorage` while rendering would hydrate-mismatch.
## 2026-08-18 — The pipeline gets its own rail
**Decision:** `/applications` has a second rail between the app nav and the content, holding
Views (Board / List / Calendar) and Filter (Everything, Needs a nudge, each stage with its
count, Closed). One filter at a time, carried in `?f=`, and it survives a view change. The
old top-right segmented switcher is gone.
**Why:** the app nav answers "which part of the product"; the rail answers "which cut of this
part". Those are different questions and they should never share a control — which is the
split every CRM makes between its object list and its saved views. The counts are the real
payload: "Needs a nudge 2" answers the daily question before you have clicked anything.
**Applies to:** `src/components/pipeline/rail.tsx`. Filtering to one stage draws one column
rather than five empty ones beside it, and filtering to Closed draws no columns at all,
because closed applications live under the board rather than in it — see the `columns` prop
on `PipelineBoard`. Nothing here needed a new tool: `list_applications` already filters by
stage and `list_follow_ups` already answers the overdue question.

## 2026-08-18 — Test fixtures have to be the suite's own
**Decision:** `avatar-test.mjs` seeds the companies it reasons about and restores the
instance setting it flips; `rail-test.mjs` asserts relationships — the rail says Screening is
3, so the Screening list must have 3 rows — instead of fixed numbers.
**Why:** this is the fourth time in this repo that a green suite went red with no regression
behind it, because it was reading state another suite left behind. A suite that flips an
instance-wide setting and does not put it back passes exactly once. Relational assertions
also test something stronger than a magic number: that the count in the rail is not a lie.
**Applies to:** anything new under `scratchpad/*.mjs`. Seed what you assert on, restore what
you mutate, and prefer "these two numbers agree" over "this number is 8".

## 2026-08-18 — Companies and contacts are records, not rows on an application
**Decision:** a CRM area with its own nav entry and two halves — `/crm/companies` and
`/crm/contacts` — each a searchable records table over a detail page. Eight new tools
(`list_companies`, `get_company`, `create_company`, `update_company`, `delete_company`,
`get_contact`, `update_contact`, `delete_contact`) so every one of those screens was
reachable from a conversation before it had a screen.
**Why:** a company used to be a name hanging off an application, which is fine right up to
the moment you want to keep what you learned about them — the loop, who you know there, why
you want it — and there is nowhere to put it. That research is worth more than the
application it started from, because it survives the rejection.
**Applies to:** `src/lib/data/pipeline.ts` and `src/app/(app)/crm/`. Deleting a company
refuses while applications point at it rather than cascading: tidying a company record must
never take an application with it. Contacts survive and lose their employer, which is the
correct shape for someone who changed jobs.

## 2026-08-18 — The logo comes from the company's own website, and nothing else
**Decision:** `companyDomain()` reads `Company.website`, then falls back to the name as a
domain. The Greenhouse / Lever / Ashby / Workday URL-unwrapping is deleted.
**Why:** William caught this — job listings live on boards, so a posting URL tells you where
someone advertises, not who they are. The clever ATS unwrapping was right often enough to
look like it worked and wrong in a way that showed the board's logo on half the pipeline.
One field, set on the company page or by `update_company`, and it is obvious where to fix it
when it is wrong.
**Applies to:** `src/lib/company.ts`.

## 2026-08-18 — Controls on top, records in a panel
**Decision:** the pipeline's views, filters and search sit in a horizontal toolbar above the
board, not in a rail beside it. Opening an application slides it in from the right over the
board; `/applications/[id]` stays a real page for permalinks, and cmd-click still opens one.
**Why:** two corrections in one. A rail took 216px out of the widest screen in the product to
hold nine links, and the board is the thing that needs the width. And replacing the whole page
to glance at a card meant losing your place on the board every single time — the board is what
you are working *from*, so the detail belongs over it rather than instead of it.
**Applies to:** `src/components/pipeline/toolbar.tsx` and `application-panel.tsx`. The panel
fetches on open rather than shipping every job description to the browser with the board.

## 2026-08-18 — A "use client" file's exports cannot be called from the server
**Decision:** `parseSort` and `sortRows` live in `src/lib/pipeline-list.ts`, not in the
component that uses them.
**Why:** adding `"use client"` to `list.tsx` so a row could open the panel silently turned two
pure functions into client exports, and the server page calls both. TypeScript is happy, the
build is happy, and the list view 500s at runtime. Same shape as the `resume-text.ts` split:
when a component becomes a client component, its pure helpers have to move out first.
**Applies to:** anywhere a server page imports from a component file. If the page calls it,
it does not live behind `"use client"`.

## 2026-08-18 — The tool reference is generated, never written
**Decision:** `/docs` builds its tool and workflow reference from `toolsFor(user)` and
`promptsFor(user)` at request time, grouped into the four areas by name. Anything that
matches no area is listed under "Everything else" rather than dropped.
**Why:** a hand-maintained list of 76 tools is wrong within a week, and wrong here is worse
than absent — this is the page someone reads to decide what to ask for. It is also
role-aware for free: a member's docs page does not mention the admin tools, which matches
what their client actually sees in `tools/list`. The test asserts the page and the live
server agree in both directions, so an undocumented tool fails the build's verification
rather than shipping quietly.
**Applies to:** `src/app/(app)/docs/page.tsx`. When you add a tool, add its name to the
right area's matcher — or don't, and it still appears, just in the wrong place.

## 2026-08-18 — Skills are files, read from disk
**Decision:** the three Claude Skills live at `skills/<name>/SKILL.md` in the repository.
The docs page reads them at request time, shows them raw, and serves them from an
auth-gated route that returns the file byte for byte.
**Why:** the thing being handed over *is* the markdown, front matter included — a
prettified preview would look better and be the wrong bytes. Reading from disk rather than
pasting into a constant means the copy someone downloads is the copy in the repository; a
skill duplicated into source is a skill that drifts from the one people have installed.
The test compares the download against the file on disk for exactly that reason.
**Applies to:** `skills/`, `src/lib/skills.ts`. Ordering is explicit — orientation first,
because the task skills read as if you have seen it.

## 2026-08-18 — Three skills, and the first one is about honesty
**Decision:** `resume-os` (orientation, the four areas, replace-vs-append, the rules),
`tailor-a-resume` (the craft), `run-the-search` (the daily and weekly loop).
**Why:** the orientation skill exists to carry one paragraph: the failure mode is not
fabrication from nothing, it is quiet upgrading while tailoring — a distribution credit
becomes a hire, "helped with" becomes "led" — and every upgrade maps neatly onto a stated
requirement, so it does not feel like invention to whoever is drafting. That is the same
argument as the guardrails feature, and it needs to be in front of an assistant before the
first tool call rather than looked up after the mistake.
**Applies to:** `skills/`. If a rule matters, it goes in the orientation skill *and* the
tool description *and* `instructionsFor` — a rule stated once is a rule that is absent when
the client only reads one of the three.

## 2026-08-18 — Diagnose the funnel, don't display it
**Decision:** `diagnoseSearch` computes per-step conversion, median days in stage, weekly
volume, stalled applications and per-resume response rate — and then says one sentence about
which step is losing people. The dashboard card leads with that sentence and puts the rates
underneath.
**Why:** six numbers with no reading is what every job tracker already shows, and the reading
*is* the work. "You're getting responses but not past the screen" is a different week from
"nothing is coming back at all", and a person staring at a funnel chart will not reliably tell
those apart. This is also the honest answer to "should I send more applications" — sometimes
the answer is no, stop, the resume is the problem.
**Applies to:** `diagnoseSearch` and `verdict()` in `src/lib/data/pipeline.ts`. Two rules held
firmly: under ten applications it refuses to diagnose and says so, because a verdict from four
data points is a guess wearing a lab coat; and the thresholds are stated as this tool's own
rules of thumb rather than dressed up as industry benchmarks we cannot source.

## 2026-08-18 — Progress is the furthest stage ever reached
**Decision:** conversion is computed from how far each application *ever* got, reconstructed
from the transition log, not from where it sits now.
**Why:** otherwise every rejection looks like it failed at the first hurdle. A rejection after
a final round and a rejection after applying are opposite signals, and collapsing them makes
the whole funnel lie in the most flattering direction — you would always conclude the top of
the funnel was broken.
**Applies to:** the `furthest` map in `diagnoseSearch`. `ACCEPTED` counts as having reached
`OFFER` whatever the row says now.

## 2026-08-18 — A note used to destroy the stage transition
**Decision:** `Activity.fromStage` / `toStage`, set on every move, backfilled from the
generated body where it survives.
**Why:** I told William this feature needed no schema change and I was wrong. The transition
was only ever recorded as the string `"Applied → Screening"` in the activity body — and
`moveApplicationStage(…, note)` replaces that body wholesale, while `stageActivityType`
collapses Screening, Interviewing, Final and Withdrawn into one `STAGE_CHANGE`. So every
stage move made with a note was invisible to the funnel. Two nullable columns, and the
diagnosis is trustworthy instead of inferred.
**Applies to:** anything reading stage history. Read `toStage`, never parse the body — the
backfill leaves nulls where a note had already destroyed the evidence, which is correct: we
genuinely do not know, and guessing would be worse than a gap.

## 2026-08-19 — The favicon service only serves six sizes

**Decision:** `logoUrl` snaps the requested pixel size up to the nearest size
twenty-icons.com actually serves (16, 32, 64, 128, 180, 192) instead of passing
through whatever the caller asked for.
**Why:** it does not serve arbitrary sizes — anything else is a 400 with the body
"Invalid size". Every avatar in the app asked for double its rendered size (48,
52, 88), so every single request was a 400 and no favicon had ever loaded
anywhere, in the pipeline or the CRM. The failure was invisible because a missing
logo is indistinguishable from a company that has none: the monogram is drawn
underneath and looks deliberate either way, which is the right fallback and also
the reason this survived two rounds of looking at it.
**What I gave up:** exact-size images. Rounding up means a 26px avatar downloads a
64px icon, which is a few hundred wasted bytes and a sharper result. Rounding down
would have been the cheaper wrong answer.
**Where it belongs:** in `logoUrl`, not at the call sites. The service's size list
is a fact about the service, and the UI should keep picking sizes from the layout.

## 2026-08-19 — The failed Railway deploy was not the code

**Decision:** treated deployment 31191df4 (commit d2b7451) as an infrastructure
failure and redeployed rather than reverting or bisecting.
**Why:** the build stage succeeded end to end — types checked, all five static
pages generated, the full route table printed, image pushed at 566MB. What failed
was the deploy stage, and both its log streams came back completely empty, as did
the HTTP stream, so nothing ever served a request. The build was also scheduled 40
minutes after the deployment was created, which is queue time, not build time. The
same commit boots locally against a real Postgres in under a second and answers
the healthcheck path with a 200, and all eight migrations apply clean to an empty
database in order.
**Worth remembering:** "build failed" in the Railway UI can mean the deploy failed.
The distinction matters because it changes what you go looking for, and because
production keeps serving the previous commit either way — which is why the app
looked alive while the new work was missing from it.

## 2026-08-19 — Resume OS becomes Hired

**Decision:** renamed the product to Hired (hired.tools) in one pass — mark, wordmark,
metadata, MCP server identity, client setup recipes, the three Skills, README, boot banner,
package name. MCP *tool* names were deliberately left alone.
**Why the tool names stayed:** they are an API. An assistant's saved config, and any habit a
client has formed, keys off `search_brain` and `create_resume`. None of them carried the old
brand anyway, so renaming would have been churn with a breakage risk and no upside. The
server identity and the setup alias did carry it, and those are safe to change: a client
stores the URL and token, not the server's name.
**What I gave up:** the skill at `skills/resume-os/` moved to `skills/hired/`, so its
download URL changed. Anyone who already installed it keeps their copy; only a fresh
download uses the new path.

## 2026-08-19 — The session cookie renamed without signing anyone out

**Decision:** `resume_os_session` became `hired_session`, and the read path checks the old
name as a fallback. There is a dated note saying the fallback can be deleted after 30 days.
**Why:** sessions are rows in the database keyed by token, not by cookie name, so reading
either name resolves the same session. Without the fallback, the deploy that renamed the
cookie would have silently signed out every person on the instance — an alarming thing to
happen on a day when the logo also changed, and impossible to tell apart from a bug.
**The alternative I rejected:** leaving the cookie named `resume_os_session` forever. It is
invisible to users, but it is a stale brand string sitting in the auth path, and the next
person to read that file would have to work out whether it was load-bearing.

## 2026-08-19 — The mark is three bars, not a letter

**Decision:** the mark is three stacked bars of increasing length, monochrome, cut out of
`--foreground` so it inverts with the theme. No letter, no gradient, no brand hue.
**Why no letter:** a lettered square is what everything in this category looks like, and it
ties the mark to the name — this one survives another rename. **Why no colour:** twelve hues
are already load-bearing (nine stages, three statuses). A thirteenth would either read as a
stage or shout over one. The brand colour is the existing `--primary` blue and nothing else.
**The one exception:** the stage rotation is allowed as a marketing motif, scoped to a
`.marketing` class so it cannot reach app chrome. Inside the product a stage hue means a
stage, everywhere.

## 2026-08-19 — Inter was declared for months and never loaded

**Decision:** load Inter and JetBrains Mono through `next/font`, and point `--font-sans` and
`--font-mono` at them.
**Why it matters:** `--font-sans` named `"Inter var", Inter` and nothing ever fetched it, so
every screen was rendering in whatever the system happened to have. The type scale in this
repo — 10.5px eyebrows, 12.5px rows, 26px stat numbers — was tuned against Inter's metrics,
so loading it is a correction, not a restyle.
**The resume renderer is deliberately excluded.** It keeps its own `.font-serif-resume` and
`.font-mono-resume` stacks, which name real system faces and reference none of the new
variables. The README promises that no webfont is fetched for a resume and that the output
is metrically identical across platforms; that promise survives.

## 2026-08-24 — AGPLv3, because the business is hosting

**Decision:** relicensed from MIT to AGPLv3 (LICENSE, package.json). The full text comes
from SPDX verbatim.
**Why:** the plan is Twenty's plan — free to self-host, paid to be hosted — and every
project running that model at any scale chose AGPL for the same documented reason:
Plausible started MIT, watched a company close-source their code and sell it against them,
and switched. AGPL changes nothing for a self-hoster and requires a commercial host who
modifies the code to publish their modifications. MIT was the friendlier portfolio signal;
the portfolio argument lost to the business argument because the license is also part of
the story now.
**Reversibility:** as sole author William can relicense future versions any direction;
released versions stay as released.

## 2026-08-24 — Paid hosting is one shared instance, not instance-per-customer

**Decision:** the hosted product is William's single instance with paying members, driven
by four Stripe objects he creates by hand in the Dashboard (product, price, payment link,
webhook) and three values pasted into Admin → Billing. No provisioning code.
**Why:** the codebase was already multi-user with compile-level tenant isolation, invites,
roles, and a suspension that kills sessions and MCP access — the entire per-customer
lifecycle existed; only payment was missing. Instance-per-customer means being an ops team.
Every comparable project (Cal.com, Plausible, Documenso, Rallly) runs shared multi-tenant
below enterprise price points.
**How sync works, and why it looks like the MCP transport:** the webhook never trusts an
event beyond the customer id — it re-fetches the customer's subscriptions from Stripe and
converges local state to that answer (Documenso's pattern). Late, duplicate and out-of-order
deliveries all land on the same state. `past_due` still counts as entitled: Stripe's retry
window is the grace period. Suspension keeps all data; paying again reactivates the same
workspace. The owner is structurally untouchable by billing, and `admin_sync_billing` is
the missed-webhook recovery. No Stripe SDK — it is three GETs and an HMAC, in the same
raw-fetch style as the Resend client.
**The checkout→invite gap:** a payer who isn't a user yet gets an invite that CARRIES the
Stripe customer id, and acceptInvite copies it onto the new User. Without that, a person
who paid and accepted between webhooks would be invisible to billing forever.

## 2026-08-24 — Docker is the self-host front door; Railway keeps Nixpacks

**Decision:** the Dockerfile is back (recovered from da8780d, which was proven to build),
plus docker-compose.yml with zero required configuration, plus a GitHub Action publishing
ghcr.io/byw1/hired on every push. railway.json still pins NIXPACKS, so William's own
production deploy is untouched by all of it.
**Why compose over Twenty's four containers:** Twenty needs server+worker+postgres+redis
and three required env vars. Hired needs app+postgres and zero — the compose file
hardcodes an internal DATABASE_URL on a private network, which beats the reference product
at its own quickstart. The old blocker ("a ten-minute job with a daemon") was real: with a
daemon available, the image built first try and the full stack came up healthy.
**What the image fixes that Railway can't:** PDF export. Chromium and the Times-metric
fonts ride in the image, so a compose self-hoster gets one-click PDF on first boot.
**Verification honesty:** the local build injects proxy-CA trust lines generated FROM the
shipped Dockerfile (never a parallel copy); the shipped file itself is verified by the
GitHub Action on clean egress.

## 2026-08-24 — hired.tools is a static page in site/, deployed by Pages

**Decision:** the landing page is one static HTML file in site/, published to GitHub Pages
by a workflow, with hired.tools as the CNAME. The app stays at the root of every instance;
William's instance will live at app.hired.tools. No route moves, no links break.
**Why:** Twenty splits marketing (twenty.com) from app (app.twenty.com) and keeps the
website in the product repo. The alternative — moving the app to /app to make room for
marketing at the instance root — would put a personal marketing page inside every
self-hoster's deployment, which is exactly backwards. The landing page belongs to the
project, not to each instance.
**What it borrows from the teardown:** open source as positioning not CTA, a live star
count as the one dynamic number, a DOM-built product mock instead of screenshots (the
transcript IS the product thesis), one primary CTA repeated, and no pricing table — the
hosted door states its terms in a sentence. The transcript only shows tools that exist.

## 2026-08-24 — Billing may create accounts, never claim them

**Decision:** the webhook never attaches a Stripe customer to an existing member. A
checkout from an unknown email still becomes an invite (safe: only the holder of that
inbox can accept it, and the invite carries the customer id). A checkout whose email
matches an existing member does nothing, and connecting that member to their subscription
is a deliberate admin act — `admin_link_billing`, which finds the customer in Stripe's own
records for that email and refuses ambiguity. Unlink is the recovery hatch and ends
billing's authority over the account. A pending invite the owner already sent is never
stamped with a customer id either — a free invitation must not silently become a billed one.
**Why:** the tenant audit caught the hole before it shipped. The first version matched
existing members by the checkout email — which is typed by the payer, not verified —
so anyone holding the public payment link could bind a member's account to their own
subscription and then suspend that member by cancelling it, with no admin surface to undo
the link. The rule that fixes it is worth stating as a rule because it generalises: an
unattended webhook may only ever touch state it created or state explicitly delegated to
it, and identity claims inside webhook payloads are attacker-controlled input.

## 2026-08-24 — The Dockerfile lives in docker/, and the placement is the fix

**Decision:** moved Dockerfile to docker/Dockerfile; compose and the GHCR workflow point
at it explicitly.
**Why:** the moment a Dockerfile existed at the repo root, Railway used it — despite
railway.json saying NIXPACKS and the service settings saying RAILPACK — and the deploy
died on the same healthcheck-never-sees-it-listen failure as on Aug 17. That's now been
observed twice and diagnosed zero times, and it doesn't need to be: Railway was never the
audience for this image. Auto-detection can't find a file that isn't at the root, so the
builder question is closed structurally rather than by configuration that has already
lost an argument with auto-detection once.
**Cost:** anyone hand-building must say `-f docker/Dockerfile` (compose and CI already
do). Production kept serving the previous commit throughout — a failed deploy never
replaces a running one.

## 2026-08-25 — The repo moved to the shifulaboratories org

**Decision (William's):** byw1/resume became shifulaboratories/resume. Every hardcoded
reference followed in one commit: the GHCR image is now ghcr.io/shifulaboratories/hired,
the landing page's links and live star count, the README's self-host curl, and the compose
file's image. The Pages address for the www record is shifulaboratories.github.io.
**Why the sweep couldn't wait:** GitHub forwards old repo URLs after a transfer, but the
forwarding dies the moment anyone creates a new repo named byw1/resume — a squat on the
old name would silently take over the self-host quickstart and the star count. Links that
matter don't get to depend on a redirect.
**Watch for:** Railway's GitHub connection was made to the repo under byw1; if pushes stop
auto-deploying, the GitHub app needs installing on the org and the service re-linking.

## 2026-08-26 — The landing page shows the app instead of describing it

**Decision:** hired.tools is rebuilt as `site/index.html` + `site/styles.css` + `site/motion.js`
+ `site/media/`, still static, still deployed to Pages by the same workflow. The page is a
guided tour of real screens: the dashboard, a role in the brain, the resume editor, the
pipeline board and the companies table are all rebuilt in HTML using the product's own
tokens, inside a browser frame, and the whole drawing is laid out at a 1440px logical width
and then `transform: scale()`d to fit its column.
**Why the scaler matters more than it looks:** a mock that reflows into a 900px column stops
being a picture of the app — the type goes large relative to the chrome, columns disappear,
and the reader is looking at a diagram. Scaling one object keeps every proportion the app
actually has. `motion.js` sets the factor from one ResizeObserver and gives the host the
scaled height; below a 0.72 floor it stops shrinking and lets the frame pan sideways, because
past that the app's 12.5px rows are a smudge and a phone cannot honestly do better.
**Why three files instead of one:** the previous page was one file and that was right at 345
lines. At ~1,900 it is not. The deploy is unchanged — the workflow uploads the whole folder.
**Applies to:** `site/`, `.github/workflows/site.yml` (unchanged, still uploads `site/`).

## 2026-08-26 — The signature moment is the assistant refusing

**Decision:** the "Nothing invented" section leads with a transcript where the assistant is
asked to add a team it cannot evidence, `search_brain` returns nothing, and it says no —
with the literal instructions block from `handler.ts` and the user's own guardrails printed
underneath it. It is the only tool chip on the page whose dot goes amber instead of green.
**Why:** every AI product on the internet is demoed saying yes. The property being sold here
is that this one says no, and the mechanism — a briefing sent on connect, plus notes the user
wrote once — is visible in the same frame. A judged panel of three landing-page directions
independently nominated this as the strongest thing available, over anything about features.
**What it cost:** the hero transcript went back to two exchanges. Two scripted refusals on one
page is repetition dressed as evidence.
**Applies to:** `site/index.html` `#honest`.

## 2026-08-26 — Every product picture is a rebuild first and a screenshot slot second

**Decision:** six named slots (`hero-resume`, `brain-role`, `resume-editor`, `pipeline-board`,
`crm-companies`, `dashboard-diagnosis`) plus a video slot (`demo`). Each renders a real HTML
rebuild by default; `motion.js` probes `media/<slot>.png` (or `.mp4`) on load and swaps it in
only if it loads. `?slots` on the URL outlines every slot and prints its filename.
**Why:** an empty `media/` folder is a finished page rather than a page of grey boxes, adding
art is dropping a file in with no markup to edit, and a rebuild never goes stale against a
screenshot taken three releases ago. `site/media/README.md` carries the shot list, the sizes
and the capture rules.
**Applies to:** `site/motion.js`, `site/media/`.

## 2026-08-26 — Counts on the page are generated from tools.ts, not remembered

**Decision:** the catalogue's 64 cards are the real member-visible surface — 58 tools plus 6
prompts — each carrying the first sentence of its actual description, extracted from
`src/lib/mcp/tools.ts`. The page states 64 for a member and 81 for an admin.
**Why:** the numbers were already drifting (README and the old page both said 64, which is
right; "sixteen admin tools" is not — it is sixteen tools *and* one admin-only prompt, so an
admin sees seventeen more). Anything counted on a marketing page should be counted from the
source at the time it is written, and re-counted whenever a tool is added.
**Watch for:** adding or removing a tool means regenerating the catalogue and the three places
the totals appear — the hero fact line, the figures row and the `#tools` heading.

## 2026-08-27 — The repo became shifulaboratories/Hired, and the links followed again

**Decision:** every hardcoded `shifulaboratories/resume` URL is now
`shifulaboratories/Hired` — the landing page's ten links, the star-count fetch in
`site/motion.js`, and the README's self-host `curl`. The git remote moved with them. The
GHCR image did not: `docker.yml` writes `ghcr.io/shifulaboratories/hired` literally rather
than deriving it from the repo name, so the published image and `docker-compose.yml` are
untouched.
**Why immediately, again:** this is the second rename, and the reasoning from the first one
holds without modification — GitHub forwards the old paths, and the forward dies the day
anyone creates a repo at the old name. A squat on `shifulaboratories/resume` would silently
take over the self-host quickstart and the star count. Links that matter don't get to
depend on a redirect.
**Verified:** `raw.githubusercontent.com/shifulaboratories/Hired/main/docker-compose.yml`
returns 200; the old path still 301s, which is exactly the redirect being removed from the
critical path rather than relied on.
**Note:** the entry above this one is left as written. It records what was true in August,
and rewriting a decision log to match the present makes it useless as a record.

## 2026-08-27 — Every inline icon carries its own size

**Decision:** all 81 `<svg>` elements in `site/index.html` now have explicit `width` and
`height` attributes, and an inline `<style>` in the head sets `svg:not([width])` to `1em`
as a floor for anything added later.
**Why:** an `<svg>` with only a `viewBox` has no intrinsic size, so the moment the
stylesheet is late, blocked or missing it falls back to the SVG default of 300×150. On this
page that was 57 icons at once: the document went from 14,000px tall to 83,000px and the
first thing on screen was a full-viewport blue arrow. Reported from the live site, and
reproduced exactly by aborting the request for `styles.css`.
**What it does not fix:** the page still needs `styles.css` to look like anything. The point
is only that its absence now degrades to a plain readable document instead of a screenful
of giant arrows — a stylesheet that is slow is a worse failure than one that never arrives,
because the giant state is what the visitor sees first either way.
**How the sizes were set:** measured from the rendered page with the stylesheet applied and
written back as attributes, so an attribute can never disagree with the CSS rule that
styles it.
**Applies to:** `site/index.html`. Any new inline SVG needs `width` and `height` on the tag,
not only a CSS rule.

## 2026-08-27 — The page is light; the product inside it stays dark

**Decision (William's):** hired.tools is now the app's **light** palette, lifted verbatim from
the `:root` block of `globals.css`. The product mocks are not: `.frame` and the diagnosis
card carry `.app-dark`, which redeclares the same tokens with the dark values, so every
rail, card, chip, bar and table inside them flips without any component knowing which theme
it is in.
**Why the split:** the app's own `ThemeProvider` has `defaultTheme="dark"`, so dark is what
a person actually sees when they open it — a light mock would be a picture of a state most
users never choose. It also keeps `site/media/README.md` honest: a real screenshot is still
captured in dark mode and still lands on top of a mock that agrees with it.
**What the flip actually cost:** the token swap was the easy half. The hard half was 17
places that had `oklch(1 0 0 / …)` written inline — hover washes, hover rims, window-chrome
dots, the rail surface, the hero grid — every one of which is invisible on a light ground.
Those are now `--wash`, `--rim-strong`, `--dot`, `--grid-line` and `--rail-bg`, declared
once per theme. **If you add a hover state, use the token; a literal white overlay only
works on one of the two grounds this page now has.**
**The mark:** `--brand-tile: var(--foreground)` and `--brand-cut: var(--background)`, so the
tile is the ink of whatever surface it sits on and the three bars are cut out of it. That is
why the same markup reads correctly in the light nav and inside a dark frame. Both carry a
literal fallback in the `fill` attribute, because `var()` with no fallback resolves to black
and the no-stylesheet state would otherwise be a solid black square.
**Also flipped:** `og.png` and its source, and the `theme-color` meta.
**Applies to:** `site/styles.css`, `site/index.html`, `site/media/og-source.html`.

## 2026-08-27 — Everything light, mocks included

**Decision (William's):** the split from earlier today is reverted. The product frames and
the diagnosis card no longer carry `.app-dark`; the whole page, screenshots and app UI
included, is the light theme. The `.app-dark` scope is deleted rather than left unused —
git has it if the split is ever wanted back.
**Why the split didn't survive:** it was my call, not a requirement, and the argument for it
(dark is the app's default, so a picture of it should be dark) lost to the simpler one — a
page asked to be light should be light all the way down, and a reader should not have to
work out why two surfaces on one page disagree.
**The one token the app doesn't have:** `--page`, a step deeper than `--background`. The
app's own background is near-white, so a frame containing it had nothing to sit on and the
window edge disappeared into the page. `--page` is the page ground only — `body`, the stuck
nav and the tour's chapter bar. Everything inside a frame still uses `--background`, so the
mock is the app's real colour and the separation comes from the page, not from faking the
app.
**Consequence for captures:** `site/media/README.md` now says shoot in **light** mode, and
says the part people forget — Hired defaults to dark, so its theme has to be switched
before the screenshot is taken or it will not match the frame it lands in.
**Supersedes:** the entry above it. Left in place as the record of what was tried.

## 2026-08-27 — The footer says who made this

**Decision (William's):** hired.tools carries a Shifu Labs footer, modelled on the one at
viral.bywilliaml.com — brand block, "A Shifu Labs tool" with the studio's mark, the
studio's social set, and the studio's domain, all in the page's own type and light theme.

**What came from where.** The mark is the `viewBox="0 0 96 96"` path from shifulab.com,
inlined into the sprite as `#i-shifu`. The signal orange is `#ff4d00`, the studio's own
accent, added as `--signal` and worn only by that mark — Hired's accent is still the one
blue, and nothing else on the page gained a second colour. The socials are Shifu's
(`linkedin.com/company/shifulabs`, `instagram.com/shifu`, `x.com/shifulab`), not William's
personal ones; the viral footer links the personal set, and copying that would have
credited the wrong account.

**The domain, deliberately not the one asked for.** The brief said `shifulabs.com`. That
host is a GoDaddy parking page — its only outbound link is to GoDaddy's site builder. The
real studio site is `shifulab.com` (singular lab), which is also what viral.bywilliaml.com
links, and whose canonical is `shifulaboratories.com` — currently unreachable, connection
reset, so linking that would be worse. The footer links `shifulab.com` and shows that
string verbatim. If the plural is registered and pointed at the real site later, it is a
one-line change in three places.

**The studio's mark does not spin here.** shifulab.com rotates it continuously
(`spin-slow`). This page's rule is that nothing loops — everything plays once on entry and
holds — and an ambient rotation in the footer would have been the only exception on the
page. The mark turns a quarter on hover instead, which keeps the gesture and costs nothing
when nobody is pointing at it. The large corner mark is static, at 5% opacity, and sits
behind the content on `z-index: -1` — which needs `isolation: isolate` on the footer, the
same trap the hero glow hit: `position: relative` alone does not make a stacking context,
so the mark would have painted behind `body` and vanished.

## 2026-08-26 — An activity belongs to exactly one thing

**Decision:** Activity.applicationId went nullable and contactId arrived, with the data
layer enforcing exactly-one-parent. Not both: an entry lives on one timeline, and a caller
passing both hasn't decided which. Contact deletion cascades its timeline; the funnel
diagnosis filters to application-attached transitions and is unaffected.
**Why this shape and not a Touch table:** contacts needed history and the Activity table
already was one — same fields, same rendering, same schedule integration. A parallel table
would have meant a second timeline component, a second merge in list_schedule, and a
"which table does a call go in" question forever.
**What fell out for free:** last-touched on the contact list, due pings beside due
follow-ups everywhere follow-ups appear (dashboard, calendar, list_follow_ups), and
"ping Sarah in two weeks" as a date on the person. No new tools — log_activity,
update_contact and list_follow_ups grew instead, so the tool count is unchanged and the
descriptions carry the routing.

## 2026-08-26 — The gap report is a prompt, not a server computation

**Decision:** gap_report ships as a workflow prompt (exposed as a tool like the others),
not as a data-layer function. The server cannot judge whether "ran a rollout across three
regions" evidences "experience leading distributed teams" — that reading is the
assistant's job — so the server's contribution is the recipe: extract what the posting
rewards, search the brain for the work rather than the buzzword, sort into
BACKED / THIN / MISSING, and never upgrade an item to be encouraging.
**The loop that matters:** every MISSING item ends in a question, because people forget
their own work constantly — and an answered question goes into the brain via
append_role_brain_dump, where it is evidence for every future posting. The gap report is
secretly the brain's best intake funnel.
**tailor_resume** now ends with the same three-list report, so the trust property the
landing page advertises is something a user actually sees after every tailoring.

## 2026-08-28 — The CRM caught up to the app's own manners

**Decision:** a quality-of-life pass on the existing CRM pages, nothing new underneath:
deletes confirm (stating the cascade — a company takes its applications and their history
with it), the company page can add the people and roles it lists, the contacts list shows
next ping and a relative last touch, ping dates have 1w/2w/1m presets, and the log box can
say what kind of touch it was. Every capability already existed in the actions and tools;
the UI had just never exposed it.
**Two calls worth remembering:** the Email column on the contacts list was *removed*, not
lost — it was xl-only and mostly dashes, and its job is now done by mailto/LinkedIn icons
on the row. Those icons sit in a cluster *outside* the row's link because an anchor inside
an anchor is invalid HTML; don't move them back in. And `TOUCH_TYPES` in contact-detail
lists only the kinds a person logs by hand — STAGE_CHANGE, APPLIED and the rest are
written by the system and would be lies if hand-picked.
**Applies to:** `src/components/crm/`, `src/app/(app)/crm/contacts/page.tsx`,
`agoDay` in `src/lib/utils.ts`.
## 2026-08-28 — A waitlist, and where it sits in the data layer

**Why:** hired.tools is becoming a "request access" page rather than a "read the README and
deploy it" page, and "email me directly" needed somewhere to land. The alternative was a
third-party form service, which would have been the first non-font external request the
marketing site makes and would have put a list of strangers' addresses on someone else's
server. This keeps it in the instance.

**Where it broke the pattern, and why that's fine.** Invariant 1 says every function in
`src/lib/data/` takes `userId` first. `waitlist.ts` doesn't, and neither does `users.ts` —
because neither touches a person's content. A signup is instance-level, like `Setting` and
`Invite`. The distinction that matters is not "does it take a userId" but "is this someone's
brain, resumes or applications", and for those the rule is unchanged. `waitlist.ts` says so
at the top so the next reader doesn't think the invariant slipped.

**`addWaitlistSignup` is the only data function an anonymous request can reach.** That is
safe because it grants nothing, reads nothing back, and writes a row that does nothing until
an admin acts on it.

**CORS is `*`, deliberately.** An allow-list would have been a new setting, and a new setting
is one more thing every self-hoster has to configure before their own landing page works —
the exact cost invariant 5 exists to avoid. CORS isn't the boundary here; the answer being
identical for every caller is. Signing up twice returns the same `{ok:true}` as signing up
once, so the endpoint can't be used to enumerate who is on the list.

**Rate limiting is in the database, not in memory.** An in-memory counter would be per-replica
and would reset on every restart, which is the same reason the MCP transport is stateless.
Instead: a honeypot, the unique index on email, a body cap, and a burst ceiling counted with
a query. A determined person can still put junk on the list; they cannot get in.

**Notification failures are recorded, not swallowed.** `notified`/`notifyError` mirror
`Invite.emailSent`/`emailError`, so a signup that arrived while Resend was misconfigured
shows up in Admin as one rather than looking like nothing happened.

**The landing page's tool count is unchanged at 64.** All three new tools are `adminOnly`,
and the figure on hired.tools is what a *member* sees.

## 2026-08-28 — The landing page is for someone looking for a job

**Decision (William's):** the page was written for someone who already knew what
self-hosting was. The audience is a job seeker, mostly non-technical, and the page should
sell getting hired. Modelled on 21st.dev's shape: scannable capability grid, pricing on the
page, one obvious action.

**What changed.**
- The headline is an outcome — "Get hired on what you actually did" — rather than an
  instruction ("Write your career down once").
- A new `#features` grid, four cards, sixteen concrete capabilities. This is the section a
  first-time reader scans before deciding whether to keep going, and the old page had no
  equivalent: it went straight from the problem into a product tour.
- The tour stopped being the inventory and became the demo. Its heading was "Four parts,
  one record", which now collides with the features grid, so it is "What each part actually
  looks like".
- `#get` — two co-equal doors, self-host and hosted — is gone. It has become `#pricing`
  (three tiers) plus one compact `#selfhost` band. Self-hosting is still there, still true,
  and no longer half the page.
- The FAQ is rewritten for someone who has never deployed anything: "do I need to be
  technical", "can I use it now", "how long until it's useful", "who can see my stuff".
- MCP is never named. It was already demoted to "you just say it" last week; the nav item
  is "How it works" and the jargon is gone from the tour lede too.

**The prices are placeholders and say so in the markup.** $0 / $12 a month / $99 a year.
They appear in exactly two places — the tier cards and the FAQ answer — with a comment
naming both, so changing them is not a search-and-hope.

**Hosting is presented as closed, because it is.** Both hosted CTAs go to the form, not to
a checkout. The Stripe Payment Link already exists as a setting; it replaces the hrefs when
hosting opens.

**Two bugs the restructure surfaced.**
`.stage { grid-template-columns: 1fr }` in the 900px query is `minmax(auto, 1fr)`, so the
track could not shrink below the min-content of the compose block's unbroken URL and the
whole page scrolled sideways at 390px. `minmax(0, 1fr)` lets `.code`'s own `overflow-x`
do its job. This never showed before because the old self-host column used `.doors`, whose
`auto-fit minmax` already had the zero floor.
The audit script's "inputs without a label" check only looked for `aria-label` and a
wrapping `<label>`, so it reported the new form's correctly-labelled inputs as failures. It
now follows `label[for]` and skips `aria-hidden` honeypots.

## 2026-08-28 — The hero is centred

**Decision (William's):** the hero copy is centred on both desktop and mobile.

The copy block is now a `.hero-lead` flex column with `text-align: center`, and the form
reuses the `.mid` variant already written for the close section rather than a second set of
rules. The product shots below it stay in two left-aligned columns on purpose: the text is
one column of statement and the shots are two columns of evidence, and centring the
statement is what stops a wide screen reading as a left margin with nothing to the right of
it. The hero's light was aimed at a headline that used to sit on the left, so both radial
stops moved toward the middle.

**Two things the centring forced.** The form's note used to carry a "run it yourself today"
link, which wrapped mid-phrase inside the 480px form; the link moved down into the fact row,
where it is a link at last instead of the plain words "Free to self-host, forever". And
below 560px the field and the button now stack full width — a half-width button wrapping
under a full-width field reads as an accident rather than a layout.

**Also fixed:** `POST /api/waitlist` recorded a `file://` or privacy-mode submission as a
source literally called "null". Empty now.

## 2026-08-28 — One plan

**Decision (William's):** pricing is a single monthly tier, not three.

The ladder was mine and it was doing two jobs badly. The Founding tier existed to make the
waitlist feel urgent, which is a reason to build a thing rather than a reason anyone wants
it, and the $0 self-host column duplicated the `#selfhost` band sitting directly underneath
it. What is left is the one plan there actually is: $12 a month, marked coming soon, with
the CTA still pointing at the form rather than a checkout.

Self-hosting has not been demoted further — it is in the section's own lede as a link, it
keeps its band, it keeps its nav item, and it is still the answer to "what does it cost"
in the FAQ. It just stopped being a column in a comparison it was never competing in.

**Two layout consequences.** `.tiers` is `auto-fit`, so one card stretched the full measure
and read as a banner rather than a price; `.tiers.one` pins it to 380px and centres it. And
a left-aligned section heading over a centred card lines up with nothing, so `#pricing`'s
heading centres too — which now matches the hero.

The price appears in exactly two places, the card and the FAQ answer, and the comment above
the section names both.
## 2026-08-28 — The phone gets the same app, not a smaller one

**Decision:** a mobile pass across every screen, mobile-first with the desktop restored at
`md`. Desktop renders identically to before — that was the constraint the whole pass was
built around, and it is verified rather than asserted.

**The four real defects**, in the order they mattered:

1. **The board could not be scrolled at all.** Every card carried `touch-none`
(`touch-action: none`), and the cards cover the board, so the browser was forbidden from
scrolling anywhere a finger would naturally land — vertically as well as sideways. It was
there because the `PointerSensor` had a 6px activation distance, and on a touch screen a
6px movement is the beginning of a scroll far more often than the beginning of a drag; the
only way to make dragging work at all was to switch scrolling off. Now `MouseSensor` and
`TouchSensor` are separate: mouse keeps 6px, touch needs a **220ms hold**, and the cards
are `touch-manipulation` so the browser scrolls again. Tapping a card still opens the panel,
whose stage Select is the no-drag way to move something — which is what most people will
use on a phone regardless.

2. **Navigation was five unlabelled 28px icons.** No labels, no current-page indicator, and
Settings/Docs/Admin reachable only through a 28px avatar. Replaced with a hamburger, a
drawer holding every destination with its name, and a header that says which page you are
on. The desktop rail is untouched.

3. **Every input zoomed the viewport.** iOS Safari zooms when a focused field is under 16px
and does not zoom back out. All fields are `text-base` below `md`, `text-sm`/`13px` above.
Watch for this on any new field, including the five that override the shared sizing.

4. **Three pages scrolled sideways at 360px** — the diagnosis row's three fixed columns, an
unbounded `TabsList`, and `PageHeader`'s `shrink-0` actions. `html { overflow-x: hidden }`
is the backstop, but each cause was fixed at its source rather than hidden.

**Touch targets — the part worth remembering.** The desktop design is deliberately dense and
inflating every control to 44px on mobile would have cost exactly that density. So on
`pointer: coarse` a control keeps its size and gains an invisible centred 44px hit area via
`::after`, plus a `.touch-target` utility for things that are not Buttons. **The catch, found
by measurement: an `overflow` ancestor clips the pseudo-element.** Anything inside a scroll
strip, a `truncate`, or an animating `overflow-hidden` panel needs real height instead —
which is why the filter chips, tabs, calendar links and connection buttons are `h-11 md:h-7`
rather than relying on the trick. Both `position: relative` rules are wrapped in `:where()`
so a Tailwind position utility still wins; see the `.ring-highlight` entry above for why
that is not optional in this codebase.

**How it was checked:** a Playwright pass over eleven pages at 360/390/430px asserting no
horizontal overflow, no sub-44px hit area (probed with `elementFromPoint`, not
`getBoundingClientRect` — the box is not the target) and no field under 16px, plus a
behavioural suite for the drawer and both board gestures. 14 failing page-viewport
combinations before, 0 after; 20/20 behavioural checks; desktop screenshots unchanged.

**Applies to:** `globals.css` (the coarse-pointer block, `.touch-target`), `ui/` primitives,
`shell.tsx`, `board.tsx`, and any new control — if it sits inside an overflow container, give
it real height.

## 2026-08-28 — Free is self-hosting, and the card says why

**Decision (William's, after asking for the analysis):** a free column comes back, and free
means self-hosting. A limited free *hosted* tier is the eventual destination, but not now.

**What the product research found, because it settles the question.** Hired makes no LLM
calls at all — the only provider strings in the tree are documentation links and
user-agent sniffing in `clients.ts`. The thinking is done by the reader's own Claude or
ChatGPT subscription, so the marginal cost of a hosted user is Postgres rows of text plus
the occasional PDF render, and `src/lib/pdf.ts` launches a fresh Chromium per render with no
pool and no concurrency cap, which makes export the only operation that spikes anything.
Nothing about the economics forbids a free hosted tier.

**What does forbid it today is that there is no plan.** Billing is binary: entitled means
`isActive: true`, lapsed means suspended with the data kept. No plan, tier or quota exists
anywhere in the schema or settings, and by invariants 1 and 2 any limit would have to be
enforced inside `src/lib/data/` rather than the UI, or MCP walks straight past it. With no
checkout yet and the waitlist already throttling signups, building that to convert people
to a payment link that does not exist would have been premature.

**The card names its own catch.** The page is now addressed to someone who has never
deployed anything, so a "Free" card that quietly means "if you can run a server" would be a
lie by layout. The last row is a caveat rather than a tick — "you need somewhere to run it,
and about ten minutes" — greyed, with the refusal icon instead of a check.

**"There is no smaller version of it" survives**, which was the point of choosing this
split. The free column is not a trial and not a cut-down build; the difference between the
two cards is who runs the server, and the fine print says exactly that.

## 2026-08-28 — The page is an ATS, and the acronym does the work

**Decision (William's):** the positioning is "Applicant Tracking System (ATS, for
applicants)". Not "the inverse ATS" — the words stay exactly what they always were, and
only the owner flips. Every job seeker already knows the term and already resents it, so
the headline borrows recognition that took the recruiting industry twenty years to build.

**Why it survives contact with the product.** The parallel is not a metaphor, it is a
feature map, which is what makes it safe to run through the whole page: their candidate
database is the brain, their resume screening is the resume builder, their hiring pipeline
is the pipeline, and the notes a recruiter keeps on you are the notes you keep on them.
Their funnel report is the diagnosis section, almost line for line. Nothing had to be
invented or overstated to draw it.

**Where the angle went.** Hero headline and gloss; the "why it exists" band, which now
states the asymmetry outright ("They have a system. You have a folder called final_v3");
the features heading, which draws the four-way parallel explicitly; the read, which is now
"Recruiters get a funnel report. Now you get one."; the close; the title, meta description,
og:title and og:description; the share card, re-rendered; and the README's opening.

**What deliberately did not change.** `#honest` — "Nothing on a resume is invented" — was
left alone. It is the one place the analogy would turn against the product: their ATS
rewards keyword-stuffing, and the answer to that is not a better stuffer. And the footer
keeps "Your career, on the record" as the brand line; a tagline and a positioning line are
different jobs.

**Typography.** "Applicant’s Tracking System" is 27 characters and the hero's 18ch measure
broke it into an orphan, so the measure is 22ch and it sets on one line at desktop, two on
a phone. A curly apostrophe, not a straight one: at 62px the typewriter quote is the first
thing that looks cheap.

**Three revisions later** the flip is carried by the possessive alone. It went
"Applicant Tracking System" with a mono gloss reading "(ATS, for applicants)", then
"Applicant tracking system" with the first word in the accent, and landed on
**Applicant’s Tracking System** — the apostrophe does what the gloss was doing, so the gloss
is gone. The description states it outright in its first sentence; saying it a third time
in the typography was one telling too many.

**Also gone from the hero:** the invite-only chip above the headline, and the "Free to
self-host, forever" fact. The fact row is now two items, and the client names in it wear
their own favicons — the same self-hosted files the strip below the fold uses, so the page
still makes no third-party request. On a phone the mobile rule that turns every
`.hero-note span` into a block had to be undone for that group, or the chips stack instead
of wrapping.

## 2026-08-28 — Stripping the hero back, and a width that was an accident

**Decision (William's):** out of the hero go the "Nothing on a resume is invented" fact, the
form's small print ("No card, no account yet…"), and the whole "Connects to" client strip
under the product shots. What is left above the fold is the headline, the description, the
form, and one row saying which assistants it works inside.

**One bug fell out of it, and it is worth knowing about.** `.hero-lead` is a centred flex
column, so its children are sized shrink-to-fit rather than filled. `.joinform` had only a
`max-width`, which meant its actual measure came from whichever line of text inside it
happened to be longest — and that was the small print. Deleting the small print narrowed the
form from 480px to 373px, which was under the flex basis of the field plus the button, so
the button wrapped onto its own line at full desktop width. Nothing in the diff looked like
a layout change. `.joinform` now carries `width: 100%` alongside its `max-width`, so its
measure is stated rather than inherited from prose.

The lesson generalises: in a centred flex column, `max-width` alone is not a width, and a
copy edit can silently become a layout edit.

**What was kept.** `.mark` survives the strip's removal — the hero's chips and the connect
section's client tabs both wear it, and only the `.strip`-scoped rules were dead. Its
comment said "so six different icon shapes read as one row", which described the strip that
no longer exists; it now describes what it actually styles. `media/clients/vscode.png` and
`windsurf.png` are unreferenced by the page for the moment and stay on disk, because the
connect section still names those clients and the media README asks for them to be kept.
## 2026-08-28 — Silence is a fourth ending, and the table is where you edit

**Decision:** `GHOSTED` joins accepted / rejected / withdrawn, and the list view stopped
being a list. Stage, follow-up, salary and location are now the cells themselves; a Waiting
column counts days since the last stage change; rows can be selected and closed out in a
batch; stage filters combine.

**Why ghosted and not "closed":** merging the endings was the tempting simplification and it
is the wrong one. The funnel's whole job is to tell you what is going wrong, and "they said
no" and "nobody replied" point at different fixes — a resume problem versus a follow-up
problem. `pipelineStats` already counted a ghosting as a non-response, so the number was
right and only the label was lying. Rejected and withdrawn stay distinct for the same
reason: who decided is the information.

**Waiting is measured, not inferred.** `updatedAt` moves when you edit a note, so it cannot
answer "how long has this sat there". `applicationInclude` now pulls the most recent
transition row (`toStage: { not: null }`, take 1) and `listApplications` turns it into
`stageSince` + `daysInStage`, stripping the raw array — a one-element relation is plumbing,
and it would have shown up as noise in every `list_applications` tool result. Applications
older than stage history fall back to `createdAt`, which reports their age rather than
inventing a precision the data does not have.

**Bulk moves loop rather than `updateMany`.** One query would have been faster and would
have destroyed the timeline entry, the follow-up date and the transition row that the funnel
is built from. `moveApplicationsStage` calls `moveApplicationStage` per id and skips ones it
cannot find, so closing out twelve dead applications does not fail on the one deleted in
another tab.

**Filters are a set in one param.** `f=SCREEN,INTERVIEW`. An old single-stage link still
parses, an unknown value means everything, and `overdue`/`closed` replace the set rather
than joining it because they are cuts across stages rather than stages. The URL stays the
state, so a filtered view is still a link you can send yourself.

**Two things the UI had to concede.** An empty `input[type=date]` prints "mm/dd/yyyy", and a
column of those on every row without a follow-up shouts louder than the dates that are set —
so an empty date cell is an em dash until clicked. And collapsed board columns live in
localStorage, not the URL: it is how you like to look at the board, not what you are looking
at, and it should not travel in a shared link. A collapsed column is still a drop target.

**Watch for:** `move_applications_stage` brings the member surface to 67 tools and the admin
surface to 87. The README states both in three places.
**Applies to:** `prisma/migrations/20250112000000_ghosted_stage/`, `src/lib/data/pipeline.ts`,
`src/components/pipeline/{list,board,toolbar}.tsx`, `src/lib/pipeline-list.ts`.

## 2026-08-28 — A saved view is a name for a URL

**Decision:** `SavedView { name, query }` — the query string, stored whole, rather than
parsed columns for view / filters / sort / search. The pipeline toolbar already encodes all
of that into the URL, so saving a view is saving that string, and anything the toolbar
learns to encode later is saved without a migration.

**What that costs:** nothing validates the query. A view saved against a stage that is later
removed returns everything instead of erroring — the harmless failure, and the reason this
is the right trade. `normaliseQuery` keeps only the six parameters the pipeline actually
reads and writes them in a fixed order, so the same view saved twice is the same string and
"am I looking at this view" is a string comparison rather than a parse on every render.

**Saving under an existing name replaces it.** Re-saving under a name you already use means
"update it" every single time; the alternative is making someone delete a view to change it.
The unique index is `[userId, name]`, so the upsert is the constraint rather than a check.

**Two mobile bugs the seeded data exposed**, both pre-existing and neither caused by this
work — an empty database had been hiding them. The docs page scrolled sideways because tool
descriptions are prose written elsewhere and two of the new ones quote a query string: one
unbreakable 45-character token is wider than the column on a phone. Fixed at the render site
with `overflow-wrap: anywhere` rather than by shortening the description, so no future
description can do it either. And the calendar's month grid is seven columns, which at 360px
is 48px a cell — not a calendar, a grid of three-character stubs. It now keeps a 44rem width
and scrolls sideways, the same gesture the board uses, which also makes room for chips tall
enough to tap.

**Applies to:** `prisma/migrations/20250113000000_saved_views/`, `src/lib/data/views.ts`,
`src/components/pipeline/saved-views.tsx`, `src/app/(app)/docs/page.tsx`,
`src/components/pipeline/calendar.tsx`.

## 2026-08-29 — Real company marks in the mocks, fetched once

**Decision (William's):** the pipeline and CRM mocks show each company's actual favicon
instead of a two-letter initials tile.

**Fetched at author time, not at render time.** The app does this live, through
twenty-icons.com, which is why `admin_set_company_logos` exists and warns that the service
can see which companies are in someone's pipeline. The marketing page must not inherit that:
it makes no third-party request beyond Google Fonts and one call for the GitHub star count,
and a mock is a picture, not a live pipeline. So the seven marks were pulled once from the
same source, committed under `site/media/companies/`, and are served from this origin. The
check that matters is in the scratchpad — the page still contacts only `fonts.googleapis.com`
and `api.github.com` after scrolling the whole page and clicking through all four scenes.

**Three companies deliberately keep their initials.** Meridian Logistics and Northbeam
Freight are invented, so there is nothing to fetch. Convoy shut down in 2023 and the logo
now served for `convoy.com` is not the mark it used — labelling somebody else's logo
"Convoy" would be a small lie in a product whose whole pitch is that it doesn't invent
things. The mixed result is not a compromise: the scene's own lede already says "the website
you save is what puts their logo on the board", and the table's caption already says
companies without one fall back to initials. The mock now demonstrates the sentence it was
already making.

**Two things found while wiring it.** The marks first read as broken because every one of
them reported `naturalWidth: 0` — they sit inside the tour's scene panes, and `loading="lazy"`
means an image in a pane nobody has opened never loads. They decode correctly once a scene
is shown, but lazy loading would have made the mark arrive a frame after the reader switches
scene, which reads as a flicker; they are 4–12KB each and same-origin, so the attribute is
gone. And the tinted `--hue` ground is dropped on a logo tile: the marks bring their own
background, and two grounds fight.

## 2026-08-29 — The page caught up to a tenth stage and four new tools

Merging main brought the pipeline table rework, saved views, and a `GHOSTED` stage. Three
numbers on the landing page were quietly wrong afterwards, and none of them would have
thrown an error:

- the features card said **"Nine stages from wishlist to offer"**; the enum has ten now,
  and `GHOSTED` is not a stage anyone advances *to*, so the line reads "Ten stages, wishlist
  through offer" rather than pretending the arc got longer;
- the member-visible surface went **66 → 70** — `save_view`, `list_saved_views`,
  `delete_saved_view` and `move_applications_stage` are all member tools — which moves the
  figure block, the disclosure summary, the sentence inside it, and the All chip;
- the catalogue's Pipeline group went **16 → 20**, and four cards had to be written, because
  that list is hand-maintained rather than generated.

Counted from the running instance rather than from the diff: 90 entries an admin sees, 20 of
them `adminOnly`, so a member sees 70 across 21 brain, 11 resumes, 20 pipeline, 10 crm, 7
workflows and 1 account. Verified twice over — the group chips sum to 70 and the page renders
70 real cards against the claim.

**This keeps happening, and it is worth naming.** Every feature that adds a member-visible
tool silently falsifies five numbers on a static page in another directory. Nothing checks
it. A generator for the catalogue block, or a test that diffs `tools/list` against the page,
would end the whole class of error.

## 2026-08-29 — Every mocked company is real, and the footer loses the studio column

**Decision (William's):** no initials tiles left in the mocks, and the footer's Shifu Labs
column goes entirely.

**The three companies without marks were not equivalent.** Convoy was an application target
and swapped straight out for Ryder. Meridian Logistics and Northbeam Freight are the mocked
candidate's own *employers* — they run through the resume paper, four brain highlights, a
guardrail note and the hero transcript, so replacing them everywhere would have meant a
fictional person claiming employment at real companies. Instead they were removed only from
the pipeline board and the CRM table and replaced with C.H. Robinson and Motive. That was
the incoherent part anyway: the board had this person interviewing at the company they
already work for. The invented names stay exactly where no logo is ever drawn.

Locations and industries moved with the names — Eden Prairie MN, Miami FL, San Francisco CA,
and Motive is fleet telematics rather than freight — because a real company sitting under a
wrong city is the kind of detail that makes a mock look fake.

**Two domains lied.** `convoy.com` no longer serves Convoy's mark, and `coyote.com` is not
Coyote Logistics; both return a clean, plausible logo belonging to somebody else. They were
caught by rendering every candidate to a contact sheet and looking at it. That check is now
written into `site/media/README.md`, because the failure mode is silent.

**The table's caption changed with the data.** It said companies without a website fall back
to their initials, which the table no longer demonstrated. It now says where the marks come
from, which it does.

**Footer.** The Shifu Labs column is gone; `studio@shifulaboratories.com` went with it and
appears nowhere on the site now (the correct address, for the record, is
`studio@shifulab.com`). The LinkedIn is the company page,
`linkedin.com/company/shifulab` — the earlier `/in/shifulab` was a personal-profile path.
Two link columns left a hole in the middle of a three-track grid, so the links are sized to
their content and sit at the right edge, where the base bar's own line already ends.

## 2026-08-29 — Admin moved under Settings, and the login form learned to say no

**Decision (William's, after asking how Twenty does it):** the admin surface is
`/settings/admin`, not `/admin` and not `admin.hired.tools`. Twenty puts theirs at
`SettingsPath.Admin` inside the same app, gated by a flag on the account, and that shape is
right for the same reason it is right for them: the admin of a self-hosted instance is its
owner, and a separate deploy would mean DNS and a second service before anyone could
administer their own copy. `/admin` still redirects — it was in the profile menu for months.

**Why not a subdomain, said plainly:** a subdomain is a public DNS record. Putting the admin
pages behind one is obscurity, not security. What protects them is `requireAdmin`, which was
already enforced. The one honest argument for a separate origin is XSS blast radius, and
that is worth less than the things below.

**The actual hole was rate limiting, and there was none.** Anyone could POST the sign-in
form as fast as their connection allowed. `LoginThrottle` counts failures per email and per
address: eight against one account in fifteen minutes locks it for fifteen. Counters are in
the database, not in a process, for the same reason the MCP transport is stateless — a
counter in memory is a counter an attacker clears by waiting for a deploy. The IP counter is
deliberately loose and deliberately secondary: offices share addresses, and
`x-forwarded-for` can be forged by whoever talks to the proxy. **The email counter is the
protection; the IP counter is a speed bump.** Verified by actually brute-forcing it: locked
after nine attempts, and it then refuses the *correct* password, which is the assertion that
distinguishes a lock from a delay.

**Password reset is the support tool a hosted instance cannot run without** — a locked-out
customer had no way back and neither did you. It goes through `canManage`, so an ADMIN
cannot reset the SUPER_ADMIN. Without that line this feature is a one-click instance
takeover wearing a support-ticket costume. Proved over HTTP with a real admin token: the
same call is refused against the owner and succeeds against a member. Sessions are destroyed
on reset, because a reset whose old sessions keep working has locked nobody out.

**The audit log stores emails as text rather than joining.** An audit row has to survive the
deletion of the account it describes; deleting a user is exactly when you most want the log
to remember. It records account administration only — never content — and never the
password or invite token, because every admin can read it.

**Testing note worth keeping.** Three of this session's tests passed while proving nothing:
one scraped a password out of page text and captured the `.com` of the email above it, one
matched the sidebar's "Collapse sidebar" instead of a board column, and one asserted against
a reimplementation of `canManage` rather than the real function. A security test that does
not fail when the guard is removed is decoration. The escalation check now runs through the
real MCP endpoint against the real data layer.

**Applies to:** `src/lib/login-throttle.ts`, `src/lib/data/audit.ts`, `src/lib/passphrase.ts`
(extracted from `bootstrap.ts` so a password helper does not drag in instance provisioning),
`src/app/(app)/settings/admin/`, `prisma/migrations/20250114000000_login_throttle_and_audit/`.

## 2026-08-29 — Sharing a pipeline is a slug, not a workspace

**Decision (William's, after weighing the cost):** the "let someone help me review my
applications" job ships as a read-only link — `PipelineShare`, a public `/p/<slug>` route,
`share_pipeline` / `unshare_pipeline` / `get_pipeline_share`. Shared workspaces with viewer
and editor roles are still parked.

**Why not workspaces, with the actual number:** `userId` as the first positional argument
*is* the tenant isolation, and it is load-bearing across 65 data functions, 17 tables, 75
MCP call sites and 69 server actions. A `Workspace` + `Membership` model repoints every one
of those, adds an acting-user parameter for permission checks, teaches the MCP token to
resolve a user-and-workspace pair, and introduces a read-only role the data layer has never
had. That is a week with a real chance of a tenant-isolation bug, and it should be its own
piece of work rather than a side quest — which is what `CLAUDE.md` has said all along.
The link gets most of the value in a day and tells us whether anyone opens it.

**The select is the entire privacy model.** `getSharedPipeline` is the second function in
`src/lib/data/` without a leading `userId`, which makes it the second place where a mistake
is a leak rather than a type error. It is an allow-list, and what is absent is deliberate:
salary, notes, job descriptions, the activity timeline, and — most importantly — contacts.
**A share link is consent to show your own search, never consent to publish a third party's
name and email address.** That distinction is why contacts are excluded even though a
reviewer might find them useful.

**Verified by seeding secrets and looking for them.** A salary, a private note, a job
description, a contact and a timeline entry were written into the database with recognisable
markers, then the public page was fetched by a browser with no session: none of the five
appear, no link walks back into the app, and the page is noindex. A revoked link 404s. That
is a stronger test than reading the select and agreeing with it.

**Revoking deletes the row rather than flipping a flag**, the same call as an unpublished
resume and for the same reason: you revoke because a link reached someone it should not
have, and a pause you can undo does not fix that.

**Also decided, and deliberately not built:** `admin.hired.tools`. A subdomain adds no
security — it is a public DNS record, and `requireAdmin` is what protects the pages. It can
be had for about fifteen lines of hostname routing in the same deploy if it is ever wanted,
with no second service and nothing extra for self-hosters. But what "admin" administers
changes if workspaces ever land, so the hostname would be decided twice. **If it is built
later, give it its own login rather than widening the session cookie to `.hired.tools` —
the apex is served by GitHub Pages, so a widened cookie would be sent to GitHub's servers
on every landing-page request.**

**Applies to:** `src/lib/data/pipeline-share.ts`, `src/app/p/[slug]/`,
`src/components/pipeline/share-pipeline.tsx`,
`prisma/migrations/20250115000000_pipeline_share/`.

## 2026-08-29 — The hero's shots lean back

**Decision (William's):** the hero's two product shots get the 3D tilt from a Tailark hero
block — perspective, `rotateX`, a skew, and a mask that fades the bottom away.

**The request arrived wrapped in shadcn install instructions that did not apply.** The
component was a React/Tailwind hero wanting `lucide-react`, `@radix-ui/react-slot`,
`class-variance-authority` and a `components/ui/button`. The app already has every one of
those and 21 shadcn components in `src/components/ui/`, so there was nothing to install —
and the hero being pointed at is not in the app at all. It is hand-written HTML and CSS in
`site/`, with no React, no Tailwind and no build step. Only the CSS technique transferred.

**Perspective on the wrap, transform on the stage.** Putting perspective on `.stage` and
transforms on its children would tilt each panel around its own origin and make them
diverge; the two shots have to share one vanishing point to read as a single receding
surface. `.hero .wrap` holds the perspective and `.hero .stage` takes the transform.

**The angles are deliberately softer than the reference.** That block tilts one static
screenshot: `rotateX(20deg)` with `skewX(.36rad)`, about 20.6°. The left panel here is a
transcript that types itself out and is meant to be read, so it runs 13° and 0.1rad. Both
are `--tilt-x` and `--tilt-skew` custom properties, there to be argued with.

**Desktop only, at 900px and up.** On a phone the shots already fill the screen and a tilt
buys nothing but lost legibility. Verified: tilted at 1440 and 1024, flat at 899 and 390.

`skewX` widens an element's painted box, which is exactly the kind of thing that starts a
sideways scroll — `.hero` already clips, and the overflow check is clean at all five widths.

## 2026-08-29 — Seventy-three, and the counting problem is now the story

Pipeline sharing landed on main and added three member-visible tools — `share_pipeline`,
`get_pipeline_share`, `unshare_pipeline` — so the page went 70 → 73 and the Pipeline group
20 → 23. Same five places as last time: the figure block, the disclosure summary, the
sentence inside it, the All chip, the group chip, plus three cards written by hand.

**That is twice in two days and three times this week.** The catalogue is a hand-maintained
copy of `tools/list` living in a different directory from the thing it describes, and
nothing fails when it drifts — the page renders, the tests pass, and the number is simply
wrong. Every count on this page has been correct only because someone re-derived it from a
running instance each time. The fix is a generator: emit the catalogue block and the six
totals from `allTools` at build time, or fail CI when the page disagrees with `tools/list`.
Until that exists, treat "merge main" as implying "recount".

The admin refactor in the same merge moved the admin page to
`src/app/(app)/settings/admin/page.tsx`. The waitlist panel came with it — checked rather
than assumed, since a panel silently dropped in a file move is exactly the kind of thing
that stays broken for weeks.

## 2026-08-29 — Scroll-driven motion, and the thing that was not built

**Decision (William's):** more advanced scrolling. Three things went in; the obvious fourth
did not.

**Not built: scroll hijacking.** Lenis, Locomotive and friends replace the browser's scroll
with a JS-interpolated one. They demo beautifully and feel worse in the hand: trackpad
momentum stops matching the OS, keyboard paging and find-in-page get strange, and the whole
page depends on a runtime library that this one currently does without — it ships zero
third-party JS and contacts nothing but Google Fonts and one call for the star count.
Nothing about "smoother" is worth that. Everything below is native.

**1. The progress bar came off the main thread.** It was a scroll listener writing a custom
property every frame. Where `animation-timeline: scroll()` exists it is now a CSS
scroll-driven animation, and `motion.js` checks the same support and nulls its own handle so
only one of the two ever runs. Verified both paths: with timelines, the bar tracks scroll
exactly and the JS custom property is never set; with `CSS.supports` stubbed to refuse, the
JS fills it as before.

**2. The nav says where you are.** Links pointing at a section on this page get
`aria-current="true"` as their section passes a line a third of the way down the viewport —
steadier than "most visible", because these sections differ wildly in height. It is
`aria-current` rather than a class so the state is announced and not merely drawn.

**3. The hero's tilt scrubs.** The shots lean back when you land and stand up over the first
65vh of scrolling. This is the page's *third* kind of motion and the header comment in
`styles.css` only described two — "plays once on entry and holds", and "does not move".
A scrubbed animation has no duration and no direction of its own; it reflects the scrollbar
and reverses exactly as faithfully going back up. It sits behind
`prefers-reduced-motion: no-preference`, so the calm path keeps the static tilt — checked,
not assumed.

**Two bugs, one of which was mine and imaginary.** The `animation` shorthand resets
`animation-duration` to `0s`, which on a scroll timeline collapses the animation to a point;
the longhands with `animation-duration: auto` fix it. And `markSection` used
`element.offsetTop`, which is measured from the nearest positioned ancestor — every
`section` on this page is `position: relative`, so it was not the document offset it looked
like; it reads `getBoundingClientRect().top` now.

The imaginary one: the progress bar appeared frozen near zero in the first test run. It was
fine. `html { scroll-behavior: smooth }` meant the harness was reading the value while the
page was still travelling. Worth remembering — **any scroll assertion on this page has to
scroll with `behavior: 'instant'` or it measures the journey rather than the destination.**

## 2026-08-29 — A resources section, and the site's first build step

**Decision (William's):** a resources section for search, with the content calls left to me.

**The site had no SEO plumbing at all.** No sitemap, no robots.txt, no structured data, one
canonical tag across five files. That was worth more than any single post: hired.tools was a
one-page site giving a crawler almost nothing. Now there is a sitemap, a robots.txt pointing
at it, an RSS feed, `SoftwareApplication` and `FAQPage` schema on the home page, and
`Article` + `BreadcrumbList` + `Person` on every post.

The `FAQPage` block is generated by reading the FAQ out of `index.html` at build time rather
than being written by hand beside it. Nine question-and-answer pairs that could have drifted
apart cannot.

**The first build step, and why it is not a betrayal of "no build step".** The property that
mattered was never the absence of a build — it was that the output is static HTML with no
runtime dependency and no third-party request. That survives exactly. What has gone is
hand-maintenance, and this repo has already shown three times this week where that leads: the
tool catalogue drifted on every merge and nothing ever failed. Twelve hand-written posts
would rot the same way. `tools/build-resources.mjs` imports nothing, so the whole build is one
`node` call with no install step, and the generated files are gitignored so the Markdown is
the only copy.

**Content calls, since they were delegated.** No listicles. "Resume tips" is among the most
AI-saturated query spaces on the internet and a new domain will not touch the head terms, so
all three posts are pitched at winnable angles with something true behind them:

- **What an ATS actually does** — corrects the "75% are auto-rejected" claim, which is
  repeated everywhere and sourced nowhere. The one topic where this site has real standing,
  because the product is the mirror image of one.
- **STAR does not fit a resume bullet** — not "what is STAR", which has half a million
  competitors, but the argument that it is an *interview* framework misapplied to a
  fourteen-word line, with three before-and-after rewrites.
- **The Harvard format** — a checkable claim about a format the product already implements,
  against weak competition.

Each answers its title question in the first paragraph, which is what gets picked up as a
snippet and what an LLM quotes. They cross-link, and every one carries the no-fabrication
argument, because that is the product's actual differentiator and it happens to be true.

**Two bugs worth remembering.** `esc()` ran before `smart()`, so the curly-quote rule was
matching a character that had already become `&quot;` and never fired. And the template
pointed at `/icon.svg`, which does not exist — the home page inlines its favicon as a data
URI, so the generator now reads that same tag out of `index.html` rather than keeping a
second copy.

**Left for William:** verify hired.tools in Google Search Console and submit the sitemap.
Nothing gets indexed quickly without it, and it is the only step here that cannot be
automated from this side.

## 2026-08-30 — Resources holds more than articles, and can be searched

**Decision (William's):** search on the hub, room for things that are not posts, and a
shout-out to Ethan Evans' YouTube channel.

**Kinds, rather than a second section.** `kind` in the frontmatter picks a badge, a filter
chip and whether the page leads with an outbound button — `article`, `watch`, `template`,
`tool`, with the first two in use. An unknown kind fails the build rather than rendering a
blank badge. Adding a fifth is one line in `KINDS`. The chip row only offers kinds that
actually have something in them, so a filter can never return nothing.

**The search bar is hidden in the markup and revealed by the page's own script.** A search
box that does nothing without JavaScript is worse than no search box; with scripting off the
hub is the complete list, which is a finished page. Same reasoning as everything else here.

**On recommending someone else's work.** The temptation was to describe videos I have not
watched. Everything factual about Evans is attributed — "by his own count" for the 10,000
resumes and 2,500 interviews — and the specifics I could verify (Amazon VP until 2020, Prime
Video, Appstore, Merch, Prime Gaming, Twitch Commerce) are stated plainly while the rest is
left to the link. On a site whose entire pitch is that it does not invent things, a
recommendation padded with invented detail would be the worst possible place to slip. The
byline flips to "Recommended by" when an entry points outward, because the author line would
otherwise claim someone else's work.

It is also noted in the post that the ethanevans.com link is not an affiliate link, since
recommending a person who sells classes without saying so reads badly whether or not money
changed hands.

**Why it belongs here at all:** the site argues that the software on the other side keeps a
record you cannot see. Evans covers the human half — the judgment made in rooms you are not
in. Both land on the same point, that you cannot influence a decision you have no record for.

## 2026-08-30 — Two buttons in the header, and the second copy of the header goes away

The header had three text links and a GitHub chip, and below 720px the links simply stopped
being rendered — the nav collapsed to a brand and a chip with nowhere to go. It also had no
way in for somebody who already has an account. It now carries two groups: where you can go
(Features, Pricing, Resources) and what you can do (GitHub, **Log in**, **Get started**),
separated by a hairline so six items do not read as one undifferentiated row.

**The small-screen menu is a `<details>`.** It opens, closes, and takes keyboard focus with
no JavaScript, which means it works on the generated pages, which load no JavaScript at all.
A hand-rolled dropdown would have needed a script on every page to hold a menu that opens.

**`Get started` goes to `/coming-soon/` rather than a signup.** Hosting is not open; a button
that leads to a form pretending otherwise is the kind of thing this site is supposed to be
the opposite of. The page says what the state actually is, takes the email, and spends most
of its length on the thing that *is* available today, which is the whole product on your own
machine for nothing.

**The generator now reads the header out of `site/index.html`.** It used to contain a second,
simpler copy — and within a day of it existing the two had drifted: the landing page had a
CTA the resources pages did not. So `tools/build-site.mjs` (renamed from `build-resources`,
since it builds more than resources now) lifts `<header class="nav">` out of the landing page,
repoints `#anchor` at `/#anchor`, and inlines the sprite symbols the header uses, because the
sprite sheet only exists on the landing page. If the header moves, the build fails loudly
rather than shipping two different navs.

The `<use>` inlining has to run *before* the anchor rewrite. It did not, the first time, and
`href="#i-gh"` became `href="/#i-gh"` — which resolves to nothing, so the GitHub mark silently
vanished on every generated page. Caught by asserting the icon's rendered width, not by
looking at a screenshot.

**The request-access form moved to `site/join.js`.** It lived inside `motion.js`, which the
generated pages do not load. Two pages need the form now, so it is its own file that both
load, rather than twenty lines of `fetch` copied into a template. Its success tick is inlined
rather than `<use href="#i-check">` for the same sprite reason.

## 2026-08-30 — The FAQ schema had eaten the tool catalogue

The `FAQPage` block in the landing page's head was generated by matching `<summary>` elements
and the prose after them. It matched the tool catalogue's `<summary>` too — that section is
also a `<details>` — so question one of the structured data was the entire catalogue, pricing
table and self-host section as a single 44 KB string, and the real first question was missing
altogether. It had been live for a day. Nothing rendered wrong, nothing failed to build, and
the page looked correct in every browser.

Regenerated from `details.q` only. More usefully, `tools/build-site.mjs` now compares the
questions in the schema against the questions in the markup and throws if they differ, so
editing an answer and forgetting the head fails the build. This is the third time a
hand-maintained copy of generated-looking data on this page has gone stale without
complaining; the tool catalogue is still the one that has no such check.

## 2026-08-30 — The header is a pill

The full-width bar was measured before it was redesigned, which is the only
reason the fix was obvious: at 1440 the brand ended at x=184 and the links began
at x=792. Six hundred and eight pixels of nothing, 42% of the row, and the whole
navigation crushed into the right quarter. That is what "the nav bar sucks"
meant — not the items in it, the shape of it.

It is now a contained capsule, max-width 1080px, floating 12px below the top.
A pill has no full-width row to leave empty, so the imbalance cannot recur.

**Three grid tracks, not a flex row.** `1fr auto 1fr` puts the links on the pill's
true centre no matter how wide the brand or the actions grow; `margin-left: auto`
on a flex row only ever shoves them up against the right-hand group, which is
exactly how the 608px void got there. The brand needs `justify-self: start` or it
stretches across its whole 1fr track and half the header becomes a link to the
home page — a bug you cannot see, only measure.

**The transparent strip above a floating pill is the part nobody plans for.**
Scrolled content appeared in it, clipped by the top of the viewport, which reads
as a rendering fault rather than a design. `.nav::before` is the ground the page
dissolves into first: opaque `--page` down to roughly the pill's bottom edge, then
a 40px fade, and only while stuck. The first attempt started thinning immediately
and left a legible ghost of the heading sliding past above the pill.

**A 999px radius needs asymmetric padding.** At the height of the button's
corners the curve turns in about five pixels, so the filled CTA on the right wants
more clearance than the text on the left. 20px and 14px, measured rather than
guessed — 10px on the right looked like the button was escaping the capsule.

**The GitHub chip lost its label and its star count.** Word plus mono number made
it a third button competing with the two that matter. Icon only in the pill; the
count moved to the footer beside the existing GitHub link, where a live number is
a detail rather than a distraction. It ships `hidden` and motion.js reveals it only
if the number arrives, so a rate limit shows a plain link rather than an empty chip.
The page still makes exactly one third-party request, and it is still the only live
number on it.

---

## 2026-08-30 — The instance can say whether it is working

Before this there was no error tracking of any kind: no `error.tsx`, no `global-error.tsx`,
two `console.error` calls in the whole codebase, and nothing persisted anywhere. On a
hosted instance that means a customer hits a 500 and you find out when they email you, or
never. The only failures that survived were `Invite.emailError` and
`WaitlistSignup.notifyError` — the right instinct, stored next to the thing that failed,
just not general.

**`SystemEvent` is instance-level, like `AdminAudit`, and for the same reason.** It has no
`userId` and does not follow the first-positional-argument rule, because it is not anyone's
content — it is the instance talking about itself. `users.ts` and `waitlist.ts` already draw
that line; this is the third file on the same side of it, not a new exception.

**The rule that keeps it safe to read: never write an operation's inputs.** An error message
produced by a failure is fine — "Resend returned 422", `Missing required string argument
"id"`. The arguments that produced it are someone's content and every admin can read this
table. That is why the MCP handler records the tool *name* and the thrown message, never
`args`. It is written into the schema comment because it is the one place "admins manage
accounts, never content" could be broken by accident rather than by design.

**INFO rows are the point, not noise.** A successful Stripe delivery is recorded, because
"the last webhook arrived four minutes ago" is the only available evidence that Stripe has
not silently stopped calling. You cannot ask Stripe whether it is still delivering; you can
only notice that something arrived. Thirty-day retention, swept on login next to
`sweepThrottles`, keeps that from becoming a table that only grows.

**A bug worth recording, because the check reported green on its own worst case.** The first
version of the billing check treated any recent webhook as healthy. But the failure it
exists to catch — a wrong signing secret in Admin → Billing — rejects every delivery, so
deliveries keep arriving and billing is completely broken while the panel says "Last webhook
just now, ok". Fixed by separating "a delivery arrived" from "a delivery *worked*": the last
INFO is what counts, and a rejection with no recent success behind it is `down`, not `warn`.
Found by pointing a bad signature at the real endpoint and reading the panel, not by
re-reading the code.

**Health is not the first tab, and does not need to be.** It carries a dot coloured by the
worst check, the way the Email tab already does. A healthy instance stays quiet; a broken one
announces itself from wherever you are. The day-to-day job in Admin is still people and
invites, so those keep the default.

**Applies to:** `src/lib/data/system.ts`, `src/components/admin/health-panel.tsx`,
`src/app/(app)/error.tsx`, `src/app/global-error.tsx`,
`prisma/migrations/20250116000000_system_events/`, and the recording sites in
`src/lib/email.ts`, `src/lib/mcp/handler.ts` and `src/app/api/stripe/webhook/route.ts`.

---

## 2026-08-30 — One page per account, and no way in from it

The People tab answers "who is on this instance". It could not answer "what is going on with
this person", which is the question you actually have when someone emails asking why they
can't get in. That answer was spread across four places and one of them (whether the invite
email actually left) was only visible while the invite was still pending — after they
accepted, the bounce was gone.

`/settings/admin/people/[id]` is Twenty's user lookup, minus the impersonation. Everything
needed to answer a support email without asking them anything: when they joined, who invited
them, whether that invitation bounced and why, when they last signed in, which assistants
they connected and when each last called, whether they are billed, what has been done to
the account, and what the instance recorded against their address.

**What it deliberately lacks is a way in.** Counts of roles, resumes and applications say
whether a workspace is being used; there is no link, no preview, no impersonation. This is
the page where "admins manage accounts, never content" would be most natural to break, so
the copy on the page states the rule rather than leaving it implied. Connection tokens are
excluded from the select for the same reason they are shown once to their owner: they are
credentials, and an admin has no use for one.

**`canManage` is resolved in the data layer and returned as `manageable`**, so the page and
`admin_user_detail` cannot disagree about who may act on an account. When it is false the
controls are absent rather than disabled-with-a-tooltip, because all three reasons — it's
you, it's the owner, it's another admin and you are not the owner — are permanent.

**Verified rather than assumed:** a MEMBER hitting the URL directly is redirected to their
dashboard, the owner's own page renders no action buttons and says why, and the tool's reply
contains no connection tokens.

**Applies to:** `src/app/(app)/settings/admin/people/[id]/`,
`src/components/admin/person-actions.tsx`, `getUserDetail` in `src/lib/data/users.ts`.

---

## 2026-08-30 — Configuration changes are administrative changes

The audit log recorded what admins did to *accounts* and nothing about what they did to the
*instance*. That left the quietest destructive click in the app unrecorded: clearing the
Resend key breaks every future invitation, produces no error anywhere, and is invisible
until somebody mentions they were never emailed. Nine audited actions, and the one that
takes the whole instance down was not among them.

**`updateSettings` now takes the actor first and is the thing that writes the row.** Not the
server action, not the tool — the shared function both of them already call, which is why
one change covers five call sites and no future one can forget. Making the argument
required rather than optional was the whole point: the compiler listed all five call sites
the moment the signature changed, which is the same argument as `userId` first in
`src/lib/data/`. It also matches `setUserRole(actor, …)` and `adminResetPassword(actor, …)`,
so instance-level writes now read the same way everywhere.

**One row per save, listing what moved, and secrets by name only.** `Resend API key set` or
`Resend API key cleared`, never the key. Non-secrets carry their new value, because
`Public URL → https://app.hired.tools` is the entire reason anyone reads the row. A save
that changes nothing writes nothing — the panel sends every field on every submit, so
without the before-comparison the log would fill with rows recording that somebody opened
a form.

**The log filters on the server, not in the browser.** Tempting to load rows and slice them
client-side; wrong, because the log outlives everything else on an instance, and cutting a
page before filtering it shows you the wrong hundred rows. Group chips and the email search
each re-query, `Show more` pages by offset, and "is there more" is `rows.length === limit`
rather than a count query on every keystroke.

**`src/lib/audit-groups.ts` exists so the Log tab can be a client component.**
`src/lib/data/audit.ts` imports `db`; importing the group constants from there into a
client component would have pulled Prisma into the browser bundle. The constants live in a
pure module that both sides import, so a filter means the same thing in the chips and in
the query.

**Applies to:** `src/lib/settings.ts`, `src/lib/audit-groups.ts`, `src/lib/data/audit.ts`,
`src/components/admin/audit-panel.tsx`, `loadAuditAction` in `src/server/actions.ts`.

---

## 2026-08-30 — One briefing for every agent, and it had to be true first

**Decision (William's ask):** any AI tool pointed at this repo should get the full context,
not just Claude. `AGENTS.md` — the name Cursor, Codex, Gemini CLI and the rest all read —
now exists as a **symlink to `CLAUDE.md`**. One file, two names, zero drift; a real copy
would have violated this repo's own rule about one implementation of every rule. The
tradeoff: on a Windows checkout without symlink support, git materialises the link as a
one-line file containing "CLAUDE.md". Acceptable — self-hosters deploy on Docker/Railway,
and the one line still points a confused reader at the right file.

**The symlink alone would have been a mistake.** A survey against the code found CLAUDE.md
itself badly stale: the "Current focus" list claimed public resume URLs, server-side PDF
and capture_job_posting were unbuilt (all three shipped weeks ago — an agent trusting the
list would rebuild them), the map was missing six data-layer modules, the CRM and docs
screens, and both public routes. Serving stale content to more tools is worse than serving
it to one. So the file was corrected before it was shared.

**Gaps closed while in there,** each previously written nowhere an agent would look:
`npx prisma generate` after any schema edit (only postinstall/build regenerate the client —
a fresh agent's first schema change fails typecheck with a misleading error); there is NO
CI gate — no typecheck, no build, no tests run on branches or PRs, the Docker image build
on main is the first compile after push, so local typecheck+build are the whole gate, not a
convenience; the DECISIONS.md protocol (append-only, ~1900 lines, later entries supersede
earlier ones — search from the end, never read whole); and the two same-named skills trees
(`.claude/skills/` teaches whoever writes the code, root `skills/` is served to users of a
running instance from /docs — nothing distinguished them before).

**Hardcoded counts keep lying.** `.claude/skills/mcp-tool/SKILL.md` said "55 tools, 11
adminOnly" while the array holds 90 tools + 8 prompts; its own paragraph warns counts
drift. Rewrote it to name the rule (authoritative count is generated on /docs; grep for
the split) instead of a number that will be wrong again in a week. Same fix to CLAUDE.md's
map and the "five workflows" comment in tools.ts (there are eight).

**Applies to:** `AGENTS.md`, `CLAUDE.md`, `.claude/skills/mcp-tool/SKILL.md`,
`src/lib/mcp/tools.ts` (comment only).

---

## 2026-08-30 — One configuration screen, and a table of every knob under it

Admin had an **Email** tab and a **Billing** tab, each holding one form. Nobody arrives at
an admin panel wanting exactly one half of "how is this instance set up", and the split was
costing more than it explained: the instance name, the public URL and the company-logo
switch all lived inside the *email* panel, because that is where the first form happened to
be built. A public URL that every invitation link, published resume and Stripe webhook URL
is built from is not a Resend setting.

**One `Configuration` tab, three cards: Instance, Resend, Billing.** The panels themselves
were not rewritten — they were already good, and the Resend card still carries its
four-step setup and its test-send button, which is the part that earns a guided form. What
moved is the three instance-wide fields, out of Email and into their own card at the top.

**And a `Variables` tab: every setting the instance stores, in one editable table.** This is
the piece the guided forms can't be. `DATABASE_URL` is the only thing this app asks of its
host (invariant 5), which means everything else is a row in `Setting` — so an admin should
be able to see and change all of it, including the things that have no form yet. You can
add a key of your own, which is the escape hatch: a feature can read a setting today and
grow a screen for it later, instead of the setting waiting on the screen. Keys are
`^[a-z][a-z0-9_]{1,63}$` so an invented one reads like a declared one.

**The duplication between the two tabs is deliberate and one-directional.** Both render from
`VARIABLES` in `src/lib/settings.ts` — a single declaration of key, field, label, help,
kind and default. That list now generates the typed `InstanceSettings` defaults, the audit
wording and both screens, so adding a knob is one entry plus one field and nothing has to
be taught about it twice. It also deleted `FIELD_LABEL`, which was a second copy of the
same labels, and fixed what it was quietly getting wrong: a logo toggle used to log
`Company logos → 1`, and now logs `Company logos → off`.

**`keepExistingSecrets` is why there is one save action instead of two.** "An empty secret
field means keep it, not clear it" was retyped in `saveEmailSettingsAction` and again in
`saveBillingSettingsAction`, each naming its own fields — the kind of rule that is correct
until someone adds a third secret and forgets. It is now derived from `kind: "secret"` in
the registry, so `saveConfigAction` replaces both actions and covers every secret that will
ever exist. Clearing one on purpose is `deleteVariable`, which is also what "reset to
default" is: delete the row, let the fallback take over. One operation, because for a
declared key those are the same thing.

**A settings change now revalidates the whole tree** (`revalidatePath("/", "layout")`)
rather than the two paths someone remembered. The instance name is on the sign-in page, the
logo switch is on every pipeline and CRM screen, and a custom variable could be read
anywhere — guessing which routes a settings change touches is a bug waiting for its second
reader.

**Tried and rejected:** a route of its own at `/settings/admin/variables`. The admin area is
one page of tabs and a tab is what "page" means there; a second route would have needed its
own header, its own stats row and its own way back. The tab count is unchanged at seven —
two became one, and one is new.

Verified against a real Postgres end to end, not just typecheck and build: defaults with
nothing stored, a masked secret that never reaches the audit log, a blank secret that
leaves the stored one alone, a no-op save that writes no row, a rejected bad key, reset to
default, and the flat table and the guided form agreeing — setting the Resend key from
Variables flips the Resend card to "Ready".

**Applies to:** `src/lib/settings.ts`, `src/lib/mcp/tools.ts` (`admin_list_variables`,
`admin_set_variable`, `admin_delete_variable`), `src/server/actions.ts`,
`src/app/(app)/settings/admin/page.tsx`, `src/components/admin/{instance,variables,email,billing}-panel.tsx`.

---

## 2026-08-30 — Settings is three subjects, and the reference material moved out

The page was one column: an AI-connections card of roughly 1,210px with nothing expanded,
then Appearance, then the account you actually came to edit. Measured, 872px of that card —
72% of its body — was three blocks that are not settings: a grid of eight workflow
descriptions, a strip of hardcoded "try saying" sentences, and six buttons for adding a
client.

**Three tabs — Connections, Account, Appearance — defaulting to Connections.** One subject
each. Connections is the default because CLAUDE.md's current focus is a new user's first ten
minutes, and those are spent pasting a URL into an assistant, not changing a password. A
validated `?tab=` on `searchParams` keeps the page a server component and lets the resume
editor link straight at the photo (`/settings?tab=account`); an unknown value falls back to
the default rather than rendering nothing.

**The workflow grid and the example sentences were deleted, not folded.** `/docs` already
generates both from the same `promptsFor(user)` call, with more in them — names, admin badges,
arguments — and its own header comment exists to say why a hand-maintained second copy goes
wrong. A collapsed duplicate is still a duplicate. What is left is one dashed link row that
counts the tools live and points at `/docs`. The six add-client buttons became a `Connect ▾`
dropdown in the card header: picking the client *is* the first step of adding a connection,
never a separate row. That also closed a real bug — the old bare button wrote `client: "other"`,
an id absent from `MCP_CLIENTS`, so the card read "Other", no picker chip was selected, and
`SetupGuide` silently served Claude's instructions for whatever client you had actually meant.

**Vendor brand colours are allowed on a connection's tile, and nowhere else.** This is a
deliberate, narrow exception to "the brand colour is the existing `--primary` blue and nothing
else" (2026-08-19). The reasoning there was that twelve hues are already load-bearing and a
thirteenth would read as a stage. A vendor mark is *identification*, not status: it is scoped
to its own 34px tile, it never encodes a state, and the alternative — nine identical grey plugs
— is a list you have to read rather than recognise. Do not extend it. A brand colour outside a
`ClientTile` is a bug.

**The marks are vendored path data, not a dependency and not a fetch.** `src/lib/mcp/marks.ts`
holds six 24×24 paths keyed to `MCP_CLIENTS` ids. Checked before choosing: `simple-icons` is
26.7MB unpacked for 3,457 icons to use six, and current versions no longer ship `openai` or
`visualstudiocode` at all — they were pulled in 16.0.0 and during 12.x — so the dependency
would arrive *and* leave two to hand-write. Those two are vendored from 13.x and 11.x
respectively; that provenance is written here because the predictable "fix" a year from now is
to add the package and discover the icons missing. A favicon service was disqualified outright:
`/settings` is the one page that renders the MCP token, and it should not tell a third party
which assistants you use. Each mark carries a light and a dark colour, because a near-black
logo is invisible on this app's dark card and a tinted box around it does not fix that.

**Applies to:** `src/app/(app)/settings/page.tsx`, `src/components/settings/connections-panel.tsx`,
`src/lib/mcp/marks.ts`, `src/components/client-mark.tsx`. `src/components/settings/security-panel.tsx`
was deleted — it had no importer and told people to set an env var that stopped being the
access story when settings moved into the `Setting` table.

---

## 2026-08-30 — One photo, and the resume says whether to show it

**Decision:** `Profile.photo` holds a square headshot as a data URI; `Resume.showPhoto` is a
boolean beside `template` and `accent`. The document says whether to show a face, the profile
says whose.

**Why not a field in the resume document.** `src/lib/resume-schema.ts` is a contract shared by
the database, the renderer and the tools (invariant 4), and putting the image in it would mean
every saved `Resume.data` carrying its own copy — replace the picture and you would be editing
n documents. As a column it is a design property like the accent colour, no saved document
changes meaning, and one replacement updates every resume at once, which is what the ask
actually was.

**Why a data URI and not an object store.** `DATABASE_URL` is the only required env var and
that is not negotiable for a five-minute self-host. It also happens to be the only shape that
works everywhere the document renders: `/r/[slug]` is unauthenticated, so a same-origin image
URL would need its own public route; the PDF path drives headless Chromium at `networkidle`,
so anything fetched is something that can hang. Inlined, the picture arrives in the same HTML
as the text and there is nothing to authenticate, fetch or time out. The browser crops and
re-encodes to a 512px JPEG before upload and the server refuses over `PHOTO_MAX_BYTES`
(400KB), so rows stay in tens of kilobytes.

**The crop is chosen, not computed.** The first version took a centred square, which is wrong
for the photo people actually have: a phone portrait is roughly 3:4 with the face in the top
third, so the middle square lands on their chest. It fails invisibly — a square test image
passes — so the fix is not a better heuristic but showing the crop and letting it be dragged.
The dialog opens biased toward the top so the common case needs no dragging, holds the original
`ImageBitmap` for as long as it is open so re-framing never re-encodes an already-compressed
JPEG, and closes by releasing it.

**Harvard renders no photo whatever `showPhoto` says.** It is a US academic convention and a
face on it is the single thing that marks a document as not-that-format. `PHOTO_TEMPLATES` in
`resume-paper.tsx` is the list; the editor's toggle disables itself and says why rather than
appearing to work.

**Photo bytes never enter a conversation.** `get_profile`, `update_profile` and
`get_brain_snapshot` return `hasPhoto: true` instead of the base64, and `get_resume` strips the
resolved image; a few hundred kilobytes of a picture nobody can look at would drown a tool
reply. `photo` is deliberately absent from `PROFILE_COLUMNS` so `update_profile` cannot write
it — every write goes through `setProfilePhoto` and therefore through `resolvePhoto`'s size and
type gate. Do not "fix" that by adding it to the column list.

**Publishing a resume with a photo on puts a face on an unauthenticated page.** That is a new
category of thing an unlisted link exposes, so it is said in `publish_resume`'s description, in
the server instructions every client receives, and in the README.

**Applies to:** `prisma/migrations/20250117000000_profile_photo/`, `src/lib/photo.ts`,
`setProfilePhoto` in `src/lib/data/brain.ts`, `src/components/settings/photo-field.tsx`,
`src/components/user-avatar.tsx`, `resume-paper.tsx`, `set_profile_photo`.

---

## 2026-08-30 — The settings page was the one screen you couldn't talk to

Rule zero says a feature is not done until an assistant can do it end to end with no browser
open. `src/lib/data/connections.ts` had `listConnections`, `createConnection`,
`renameConnection`, `rotateConnection` and `deleteConnection`, all `userId`-first, and
`tools.ts` exposed none of them. Every other screen in the app was reachable by conversation;
the one about connecting assistants was not.

Five tools, no data-layer work: `list_connections`, `create_connection`, `rename_connection`,
`rotate_connection`, `delete_connection`. "Add this to my work laptop" now returns a URL *and*
that client's setup steps, which is the answer a person wanted anyway.

**Listing never returns tokens; creating and rotating do.** A token in a `tools/list` reply
would sit in a transcript forever for no gain — the only place it is useful is the client you
are pasting it into, and `list_connections` is for "which of these am I still using?".
Create and rotate return one because handing over a working URL is the entire point of them,
and both say in their reply that it is a credential.

**`userByMcpToken` now returns `{ user, connectionId }`.** A tool that manages connections has
to know which one it is speaking through, so `delete_connection` can refuse to cut the wire it
is standing on and `list_connections` can mark it. That is why the return type changed rather
than the tools guessing.

**Applies to:** `src/lib/mcp/tools.ts`, `src/lib/auth.ts` (`McpCaller`), `src/lib/mcp/handler.ts`,
both routes under `src/app/api/mcp/`.

---

## 2026-08-30 — Say what a tool does before it does it

Four changes to the MCP surface, all pointed at the same thing: a client — Claude in
particular — could not tell this server's tools apart. Everything looked equally dangerous,
links came back as fields inside a blob, and a brand new account got a confident tour of four
empty areas.

**Annotations are a required field on `McpTool`, not an optional one.** That is the entire
enforcement mechanism. Two of MCP's four hints — `destructiveHint` and `openWorldHint` —
default to the *dangerous* value when omitted, so a tool that forgets them is not neutral,
it is wrong in the direction that matters. Making the field required meant the compiler
listed all ninety tools the moment the type changed, which is the same argument as `userId`
first in `src/lib/data/` and `actor` first in `updateSettings`. All four hints are sent on
every tool even where the value matches the spec default, because a client cannot tell
"we decided this" from "they forgot".

**The rule that decided thirty-six of them: replacing is destructive, appending is not.**
`update_role` overwrites and is destructive; `append_role_brain_dump` — which exists
*because* `update_role` was eating people's notes — is not. That line already existed in
CLAUDE.md as advice to whoever was writing a tool description; it is now a machine-readable
property of every tool.

**`search_brain`, `get_brain_snapshot` and `get_profile` are NOT read-only, and that was the
find.** `getProfile` lazily creates the Profile row when there isn't one, so the three tools
that call it write to the database on first use. Every instinct says a search is a read.
Marking it `readOnlyHint: true` would have told a user it was safe to allow unreviewed, on
the strength of a name. Found by following the call chain rather than by reading the tool
description — which is the only way this class of mistake gets found, and the reason the
classification was checked against the handler rather than accepted from the tool's own
prose. `brainIsEmpty` deliberately uses `db.profile.findFirst` rather than `getProfile` for
exactly this reason: a briefing must not create a row as a side effect of describing nothing.

**Links ride alongside the JSON rather than replacing it.** `withLinks` / `splitLinks` in
`tools.ts`, unwrapped in exactly one place in `handler.ts`. `export_resume_pdf`,
`publish_resume`, `share_pipeline` and `get_pipeline_share` now return a `resource_link`
block as well as the object they always returned, so a client that renders links shows
something clickable and one that doesn't loses nothing. The marker is a Symbol so that a
result which somehow escapes unwrapping degrades to nested JSON rather than to garbage.
`share_pipeline` was also handing back a bare slug and telling the caller to assemble the URL
themselves, while `publish_resume` two hundred lines away returned `publicUrl` — the same job
answered two different ways. It returns `publicUrl` now.

**An empty workspace gets a different briefing, because the old one was an invitation to
invent.** The four-area tour describes a brain, resumes, a pipeline and a CRM. To a new
account all four are empty, so the assistant called `search_brain`, got nothing, and had one
remaining way to satisfy the request in front of it. `EMPTY_WORKSPACE` names the tools that
get material *in* and says to take the history in whatever shape the person already has it.
It does not promise an import tool, because there isn't one — that is still the adoption
blocker, and this is the seam it will land in.

**Skills ship as a zip as well as a file, and it did not cost a dependency.** Claude's apps
install a skill by taking a zip of its folder, so handing over a bare `SKILL.md` left people
to make a directory and compress it themselves. `src/lib/zip.ts` is two headers and a
trailer, deflate via the built-in `zlib`, with a fixed 1980 timestamp so the same skill
always produces byte-identical bytes — a download that changes every time you fetch it is a
download nobody can check. One route serves both shapes: `/docs/skills/hired` is the markdown,
`/docs/skills/hired.zip` is the folder.

**A bug worth recording, because it only appears at runtime.** The external-attributes field
is `0o100644 << 16`, which in JavaScript overflows into a negative signed 32-bit integer and
`Buffer.writeUInt32LE` rejects outright. `>>> 0` fixes it. Found by compiling the one file
standalone and checking the output with `unzip -t` and Python's `zipfile` — round-trips
byte-for-byte, valid archive, deterministic across runs — not by reading the code, where it
looks entirely correct.

**Three of the ninety were wrong, and all three were wrong the same way.**
`create_application` and `capture_job_posting` were called purely additive because they create
an Application row. They also call `upsertCompanyByName`, whose `update: extra ?? {}` replaces
an existing company's website — so adding an application can quietly overwrite research
already on the company. `complete_task` was called idempotent because setting done twice looks
like setting it once; it re-stamps `doneAt` with a fresh timestamp on every call. Each mistake
came from reading what the tool is *for* rather than what its call chain *does*, which is the
argument for checking the second thing.

**Applies to:** `src/lib/mcp/tools.ts`, `src/lib/mcp/handler.ts`, `src/lib/data/brain.ts`
(`brainIsEmpty`), `src/lib/zip.ts`, `src/app/(app)/docs/skills/[slug]/route.ts`,
`src/components/docs/copy-block.tsx`, `src/app/(app)/docs/page.tsx`, `README.md`.

---

## 2026-08-30 — The card is the button, and a source is a list

Four asks from William landed together: opening a board card needed more than a
13px company name as its click target, an application's source needed to be
several things at once, outreach-first applications (a DM, no listing) needed a
home, and the CRM needed to be reachable and filterable without archaeology.

**The whole board card opens the panel; drag still works.** The card became the
anchor (cmd-click still opens the page) and the sensors' activation thresholds —
6px of movement for mouse, a 220ms hold for touch — are what keep click and drag
apart. Two traps found by review and worth remembering:

1. *The click after a drop.* A drop is followed by a click on the same element,
   which would reopen the panel you just filed the card away from. A `wasDragged`
   ref armed during the drag and spent in `onClickCapture` swallows it — and it
   must ALSO be cleared on `keydown`, because Enter on the card's link
   synthesizes a click with no pointerdown, and a drag that ended off the card
   leaves the flag armed to eat the next keyboard activation.
2. *iOS link callout.* A still ~500ms press on an anchor pops Safari's link
   preview sheet, which fires `touchcancel` and kills the drag the 220ms hold
   just started — and iOS never dispatches `contextmenu` for touch, so dnd-kit's
   guard doesn't cover it. `[-webkit-touch-callout:none]` on the draggable
   wrapper is the one switch that does.

**`Application.source` (string) became `sources String[]`.** Real applications
arrive from several directions at once — a posting AND a referral AND a DM —
and one free-text column forced a choice. Free strings, not an enum: the picker
offers the person's own past spellings first (`list_application_sources`, also a
tool, so assistants reuse spellings instead of minting near-duplicates), then a
starter set. The old `source` stays accepted on both application tools as a
legacy alias — `sources` wins when both arrive — and its update description
now warns loudly that it replaces the whole list. Migration backfills old
values as one-element arrays; verified against a live Postgres on the actual
upgrade path (old schema + data, then the migration).

**Removing a person from an application detaches, never deletes.** The old
trash button on the application's People card called `deleteContactAction` — a
person you removed from one thread vanished from the CRM with their whole
history. The card now attaches people already on file (picker first, blank form
second) and the remove button only clears `applicationId`. The optimistic merge
must let the server row win over the local stub after `router.refresh()`, or
the just-attached contact renders without their email until remount.

**OUTREACH is an activity type**, because "I messaged the hiring manager first"
was being filed as NOTE and hidden from the record. It is on both timelines'
pickers — application and contact — since a first touch is usually logged
against the person.

**Two rules from the tool review worth keeping:** the hand-rolled transport
never validates `inputSchema`, so an enum argument the data layer would
silently ignore (an unknown `filter` returning the UNFILTERED list as if it
were the answer) must be validated in the handler and fail loudly. And a cmdk
"Add ‘X’" row whose value IS the query outranks every real suggestion — Enter
on "linked" minted a duplicate instead of picking LinkedIn — so the creatable
row is `forceMount` with a non-matching value and sorts last.

**README tool counts were already lying** (73/98 against an actual 66/91
before this change). Corrected to 67/91 by evaluating the array, not by
counting by hand. The count rule from the 2026-08-30 briefing entry stands:
/docs is authoritative, the README hand-carries it in three places.

**Applies to:** `prisma/schema.prisma`,
`prisma/migrations/20250118000000_sources_and_outreach/`,
`src/lib/data/pipeline.ts`, `src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/pipeline/{board,application-detail,application-panel,new-application-dialog,sources-input}.tsx`,
`src/components/crm/contact-detail.tsx`, `src/components/shell.tsx`,
`src/app/(app)/crm/{companies,contacts}/page.tsx`, `README.md`.


---

## 2026-08-30 — The manual moves to Mintlify at docs.hired.tools

**The docs are now two things, deliberately.** `/docs` inside the app stays exactly
what it was: generated from `toolsFor(user)`, so it shows *your* tool count, *your*
skills, *your* connection URL, and it cannot drift. The written manual — first ten
minutes, concepts, guides, workflows, the deploy paths, security — is 40 MDX pages
served by Mintlify at docs.hired.tools. Neither copies the other; each links to it.
A second rendering of the generated tool list would have been a second one to keep
right, which is the same argument that stripped the catalogue out of Settings.

**They live in `docs/` in this repo, not in a docs repo.** The Mintlify deployment
pulls `shifulaboratories/hired` on `main`, and its `contentDirectory` was moved from
`""` to `docs` so page paths are URLs (`docs/quickstart.mdx` → `/quickstart`) and the
repo root stays clean. Before this the deployment was still serving the Mintlify
starter kit, because there was no `docs.json` anywhere in the repo for it to build.

**The tool reference is generated, not transcribed.** `docs/tools/*.mdx` carries every
argument of all 100 data tools. Writing that by hand guarantees it is wrong within a
week, so the tables were produced by evaluating each `inputSchema:` expression out of
`tools.ts` against stubs of `object`/`str`/`num`/`bool`/`strArray` — real JSON Schema,
no transcription. Regenerating is the same trick; do not hand-edit an argument table.

**README tool counts were lying again, in all three places.** They read 73/100, which
is the `tools` array alone — but `allTools` appends the eight workflows, so
`tools/list` returns **80 for a member and 108 for an admin**, and that is what the
Test button prints, because `testConnectionAction` counts the actual response. The
claim that the workflows were "among" the 73 was the tell. Corrected to 80/108/28.
The rule stands and has now failed twice: evaluate the array, never count by hand.

**Verified with Mintlify's own tooling rather than by eye.** `docs.json` passes
`validateDocsConfig` from `@mintlify/validation`, and all 40 pages compile under
`@mdx-js/mdx`. The `mint` CLI's TUI cannot run headless here, so link and anchor
checking is a script over the nav tree — worth rerunning after any page is added.

**Applies to:** `docs/` (new), `README.md`, `site/index.html`, `src/lib/links.ts` (new),
`src/app/(app)/settings/page.tsx`, `src/app/(app)/docs/page.tsx`.

## 2026-08-30 — What an adversarial pass over the manual found in the code

Writing docs/ meant asserting, in public, what this app does. Six auditors read the
pages against the source and 17 findings survived independent verification. Most
were the docs' fault. These were not, and are fixed:

**`create_resume` advertised `seed_from_brain`.** The key is `seedFromBrain`, so
anyone following the description got a silently empty resume. **Its `lineHeight`
default said 1.35**, which was true until `20250102000000_harvard_default` lowered
the column to 1.2; `get_resume_format` has been reporting 1.2 the whole time, from
the same file. **`admin_health` pointed at "Admin → Billing"**, which has not been a
tab since email and billing were merged into Configuration. **`save_view` omitted
`month`** from the parameters it says are kept, then said anything else is dropped —
so an assistant saving a calendar view would have dropped the month believing that
was correct.

**`admin_set_user_role` lets any admin promote a member to admin.** `createInvite`
refuses a non-owner inviting an ADMIN, and the promote control in Admin → People is
rendered only for the owner — but `setUserRole` checks `canManage` and then only
refuses `SUPER_ADMIN`, so the MCP path has neither guard. Left as it is rather than
tightened, because changing an authorisation rule is not a documentation change; the
manual states the actual behaviour, including that it differs from the browser.
Worth closing deliberately.

**Two things the docs got wrong that are worth remembering.** `showPhoto` does not
put a face on a published resume by itself — `PHOTO_TEMPLATES` excludes harvard,
which is the default, so the warning was unconditionally false for a new resume. And
`diagnose_search` will not name a weakest step under ten applications; an example
built on six was describing output the tool refuses to produce.

**Not changed:** `Admin → Billing` in the billing error strings and the Stripe
webhook comment. There is a card headed Billing inside Configuration, so those are
imprecise navigation rather than a pointer at nothing.

**Applies to:** `src/lib/mcp/tools.ts`, `skills/hired/SKILL.md`, `docs/`.

---

---

## 2026-08-30 — A person is more than a LinkedIn URL, and a company is a place you can go

Four complaints about the CRM, all of them the same complaint: the screens knew things they
would not let you act on.

**The employer became a chip.** A contact's company was a monogram and grey text — on the
list, and twice on the detail page. Nothing said there was a page behind it, so the
research, the people and the other roles at that employer went unvisited. `CompanyChip`
(bordered, hovering, carrying the company's own favicon) is now the one way a company is
drawn anywhere it is mentioned. The favicon needs `website`, which is why the chip takes a
company record rather than a name: the contact page was not fetching it at all, which is
the actual reason a letter was showing where a logo should have been.

**The contacts table is one link with a stretched overlay, not three anchors.** Making the
company clickable inside a row that was itself one big `<Link>` is not allowed — an anchor
inside an anchor is invalid HTML and browsers drop the inner one. Two anchors to the same
contact would have fixed the nesting and made every row two tab stops reading the same
name; the first attempt hid the second from screen readers with `aria-hidden`, which also
hid the ping and last-touch dates from anyone using one. So: the name is the only link, a
`before:absolute before:inset-0` overlay stretches it across the row, and the chip and the
icon buttons are positioned so they paint above it and stay independently clickable.

**Five named link columns plus a list, not one `links` array.** `linkedin` alone is the
right guess for a recruiter and wrong for everyone else. Named columns (`twitter`,
`instagram`, `github`, `website`) because a tool argument called `twitter` is one an
assistant gets right first time, and because `Profile` already settled this shape;
`otherLinks String[]` for the tail — Bluesky, Mastodon, a Substack — which has no end and
does not need one. The column is `twitter`, the label is X: renaming a column to follow a
rebrand is a migration that buys nothing.

**Six inputs would have been the obvious fix and a worse one.** Most are empty for most
people, and an empty box still costs a row of the sidebar. `ContactLinks` lists what is set
and adds with one row: paste a URL and the platform comes from its host; type `@handle` and
the picker is how you say which platform it belongs to, because nothing in `@will` says X
rather than Instagram. A handle under Website or Other is refused rather than stored — it
expands to nothing, and a row you can never open is worse than a rejected one. A second
LinkedIn URL lands in `otherLinks` instead of overwriting the first: losing an address you
just pasted is worse than an untidy list.

**The Company text field is gone once there is a company to link to.** It sat directly
above a "Linked to" card naming the same employer, and editing it renamed the company for
every other contact and application attached to it. It now appears only when nothing is
linked, which is the one case where typing a name is the way to attach one.

**`src/lib/social.ts` is pure for the same reason `audit-groups.ts` is** — the contact form
is a client component, and anything importing `db` would drag Prisma into the browser
bundle. Its parsing was exercised by hand against the awkward cases (bare handles, missing
scheme, `www.`, trailing slashes, `bsky.app`, "not a url at all") before shipping, because
there is no test suite to catch it later.

**It is `social.ts`, not `links.ts`, because main got there first.** This branch and the
manual work both added a `src/lib/links.ts` — one for a person's social addresses, one for
the project's own (docs.hired.tools). The name fits both, which is exactly why neither
could keep it by default: the file already merged and already imported by two screens kept
it, and the newcomer took the name that says what it actually holds.

**Applies to:** `prisma/schema.prisma`,
`prisma/migrations/20250119000000_contact_socials/`, `src/lib/social.ts`,
`src/components/crm/{company-chip,contact-links,contact-detail,company-detail}.tsx`,
`src/app/(app)/crm/contacts/page.tsx`, `src/app/(app)/crm/contacts/[id]/page.tsx`,
`src/app/(app)/crm/companies/[id]/page.tsx`, `src/lib/data/pipeline.ts`,
`src/lib/mcp/tools.ts`, `src/server/actions.ts`, `README.md`.

---

## 2026-08-30 — Four questions, not seven tables

Admin had seven tabs. Two rounds of consolidation later it has four, and the rule that got
it there is worth keeping: **a tab should be a question, not a table.** Who is here, how is
this set up, is it working, what changed.

**People, Invites and Waitlist were one funnel split across three clicks.** Somebody asks,
you invite them, they become a member — and the answer to "has this person got in yet?"
always lived in whichever tab you were not on. They are three `Section`s on one screen now,
read downwards in that order, with the counts still in the tab label and a warning dot when
anyone is waiting. `Section` and `SectionEmpty` are new in `page-header.tsx`: a heading with
a count, and a one-line empty state, because `EmptyState`'s dashed box is a whole screen's
worth of nothing and a section only needs a sentence.

**Configuration and Variables became one screen, which is a correction.** The previous entry
shipped them as two tabs and called the duplication "deliberate and one-directional" — the
guided forms for email and billing, and a flat table of the same nine rows underneath. That
was wrong, and it was wrong in a way worth naming: two screens editing the same values pose
a question ("which one is authoritative?") that has no good answer, and the answer a user
invents is usually the wrong one. What actually earned its place was not the *forms* but the
*guidance* — Resend's four setup steps, the webhook URL to paste into Stripe, the test send,
the resync. So the guidance moved into the section it belongs to and the forms went away.
Every field on the page is now the same editable row, and one sticky save covers all of
them, so you can fix a from address and a payment link in the same pass.

**Deleting `saveConfigAction` and `keepExistingSecrets` was the tell that this was right.**
They existed to serve typed forms. With the forms gone they had no callers, and the rule
they carried — a blank secret field means keep what is stored — already lives in
`setVariables`, on the path that survived. A helper that only one dead caller needs is not
a helper.

**What did not change:** the data layer, the three `admin_*_variable` tools, and the tool
counts. This was entirely a question of where things sit on a screen, which is the cheapest
kind of change to get right and the most expensive to leave wrong.

**Applies to:** `src/app/(app)/settings/admin/page.tsx`,
`src/components/admin/configuration-panel.tsx` (was `variables-panel.tsx`, and absorbs
`instance-panel.tsx`, `email-panel.tsx` and `billing-panel.tsx`, all deleted),
`src/components/page-header.tsx`, `src/components/admin/{invites,waitlist}-panel.tsx`,
`src/server/actions.ts`, `src/lib/settings.ts`.

---

## 2026-08-30 — The screen is called Me; the concept is still the brain

**Decision (William's ask):** the rail item reads **Me** and wears an avatar
(`CircleUserRoundIcon`) rather than a brain. The route stays `/brain`, the MCP tools keep
their names — `search_brain`, `get_brain_snapshot`, `append_role_brain_dump`,
`mine_brain_dump` — and "brain dump" survives as the name for the raw free-form text on a
role.

**Why the line is drawn there.** Two different things were both called Brain: a place in the
navigation, and a body of knowledge. Only the first was doing badly. "Brain" as a nav item
asks somebody to learn a metaphor before they know what the app is; "Me" is what the screen
actually holds and needs no explaining. The concept is fine as it stands, and renaming it
would have cost far more than it bought: every connected client's saved prompts name the
tools, every skill in `skills/` names them, and the URL is in people's history. A rename
that breaks a working assistant to improve a label is a bad trade.

**So the rule for the future is:** where the word names a destination, it is Me — the rail,
the command palette's "Go to", the role page's back link, the dashboard's stat card, the
`/brain` page's eyebrow, the four rail mockups and the chapter tab on hired.tools. Where it
names the material, it is still the brain — the page's own title ("Your brain"), the feature
card on the landing page, "Brain dump" as an action, and the docs tool group, which is
labelled after tools that are literally called `*_brain`.

**Applies to:** `src/components/shell.tsx`, `src/components/command-palette.tsx`,
`src/app/(app)/page.tsx`, `src/app/(app)/brain/page.tsx`, `src/app/(app)/brain/[roleId]/page.tsx`,
`site/index.html`, `README.md`.

---

## 2026-08-30 — A nav branch you can open, and still click

**Decision:** CRM's children are folded away by default. The parent stays a real link to
`/crm`; a chevron beside it opens the branch, and the choice is remembered in
`hired:nav-open-branches`.

**Why:** a permanently open branch made a five-item rail read as seven and pushed Pipeline —
the screen used most days — to the bottom. The previous note in this file argued the rail
should name both children because reaching Contacts otherwise meant landing on Companies and
finding the tabs. That is still true; it just does not require them to be visible always.
Open once and it stays open.

**The chevron is a sibling of the link, positioned over it, not inside it.** A `<button>`
nested in an `<a>` is invalid HTML and the browser's behaviour for it is not something to
rely on. Clicking the row navigates to CRM; clicking the chevron unfolds. Both are real
controls with real names — `aria-expanded`, `aria-controls`, and a label that says which it
is.

**Being inside the branch opens it regardless of what was stored.** Arriving at
`/crm/contacts` from a link and finding the rail insisting Contacts is hidden would be the
rail arguing with the page. The stored value is a preference, not a lock.

**The drawer shares the rail's state** rather than keeping its own, so a phone and a desktop
window of the same account never disagree about whether the branch is open.

**Applies to:** `src/components/shell.tsx` (`NAV`, `branchOpen`, `toggleBranch`, `MobileNav`).

---

## 2026-08-31 — Sign in with Google, without becoming a way around invitations

**The hard part was not OAuth.** It was that `passwordHash != ""` was the test for "is this
account real", written out in **sixteen places** — the session guard, the MCP token guard,
`instanceNeedsSetup`, three counts in `instanceStats`, `listUsers`, both invite guards. A
person who has only ever signed in with Google has no password and is entirely real, so
every one of those was a lockout waiting to happen: sessions rejected, MCP token refused,
missing from the admin list, uncounted in the stats. Finding all sixteen before writing any
OAuth code was most of the work.

The rule now has a name and one implementation in `auth.ts`: `CLAIMED` (a
`Prisma.UserWhereInput` for queries) and `isClaimed()` (a predicate for a row in hand).
The unclaimed placeholder from the single-user migration is now "no password **and** no
Google id", which is what it always meant. `authenticate()` deliberately still tests
`passwordHash` on its own — a Google-only account has no password, so there is nothing
there to match, and saying so is the point.

**`googleId` is nullable and unique, against the grain of this schema.** Everything else
optional here is `String @default("")`. An identity is different: Postgres permits many
NULLs under a unique index but only one empty string, so `@default("")` would have made the
column unusable as a constraint. The database is the only place that can actually stop two
accounts claiming one Google identity, and that is worth an inconsistency.

**The policy is an ordered list, and the order is the whole security model.** Known Google
id → matching email (link, and they keep their password) → unexpired invitation (accept it,
no password ever chosen) → sign-up, if an admin turned it on → refused. The first three need
no new setting: **an invitation you already sent starts working with the Google button the
moment it is configured**, which is why "let people sign in with Google" did not have to
mean "let strangers in".

**Sign-up is off by default and that is not a hedge.** Every other door on this instance is
invite-only, and a switch that silently opened it on upgrade would be a security change
nobody asked for. Turning it on is one toggle, with a domain allowlist beside it. A Google
sign-up is always a MEMBER — no sign-in method should be able to hand out a role.

**`email_verified` is the single check everything rests on**, and it is worth being blunt
about why: accounts here are matched by address, so an unverified Google email would let
anyone who can create a Google account walk into the matching account. Refused outright.

**The ID token's signature is not verified, on purpose.** It arrives in the body of a direct
TLS POST this server makes to Google's token endpoint, authenticated with the client secret
— not through the browser. Google's own guidance is that a token collected that way needs no
signature check, because TLS already proved who sent it. Issuer, audience, expiry and nonce
*are* checked, because those catch misconfiguration rather than forgery. Writing a JWKS
fetch, an RS256 verify and a key-rotation cache would have been more code, a cache to get
wrong, and no more secure. Revisit only if the token ever stops arriving over that channel.

**The half-finished sign-in is a signed cookie, not a row.** State and nonce go into one
HMAC-signed httpOnly cookie keyed on the client secret — the one instance-wide secret both
ends already share. Nothing about an abandoned sign-in is worth persisting, and it means a
login survives a restart, a replica or a redeploy, for the same reason the MCP transport
holds no session state. Every exit from the callback clears it, failures included, so one
authorization code can never be replayed against a second attempt.

**`safeNext` exists because a login callback is exactly where an open redirect lives.**
Anything not starting with a single `/` becomes `/`.

**Not built, deliberately:** no "sign in with Google" on the first-run setup screen. Setup
is a deliberate act with the owner's own password and happens before any of this is
configured; the callback refuses outright on an unclaimed instance.

---

### What the tenant audit found, and what it changed

The first cut of this shipped an **account takeover**, and the shape of it is worth keeping
because the same trap is waiting for the next person who joins accounts on an email
address.

**Matching by email meant trusting a field the account holder types.** `updateOwnAccount`
accepts any address nobody else holds, with no verification of any kind — it always has,
and before Google that bought an attacker nothing but a squat an admin would notice. With
Google sign-in, rule 2 turned it into capture: a member sets their email to a colleague's
address, the colleague presses Continue with Google, and lands in the member's workspace —
brain, resumes, pipeline — while the member keeps their password and can read everything
filed there afterwards. Worse, rule 2 runs before the invitation branch, so an outstanding
invitation for that address was silently ignored in favour of the squatted row.

The fix is `User.emailProvenAt`: **when this instance last had a reason to believe the
address belongs to the account.** An admin addressed an invitation to it, the owner claimed
the instance with it, or Google handed it over verified. Typing it into Settings clears it.
Rule 2 requires it. Existing rows are backfilled to `createdAt` in the migration, and the
reasoning is written there: every address on an upgrading instance was set in a world with
no Google sign-in, so none of them could have been squatted *for this*.

That left people whose address is unproven with no way in, so **Settings → Account gained
Connect Google** — the same flow with `link=1` carried in the *signed state cookie* rather
than a query parameter, so the callback cannot be talked into linking by a crafted URL.
This is the safe direction of the same join: you proved you hold the account by being in
it, Google proved you hold the address. Disconnect refuses when Google is your only way
back in.

**Second finding, same root: `touch()` rebound `googleId` unconditionally.** A *different*
Google subject presenting the same address took the row and overwrote the previous link,
silently, because the unique index never fired — `byGoogle` was null for the new subject.
Google Workspace admins reassign addresses when somebody leaves, so this was one routine
HR action away from handing a new hire the departed employee's entire history. Rule 2 now
refuses when the account is already bound to a different identity.

**Third: `safeNext` missed backslashes.** `/\evil.com` starts with one slash, is not `//`,
and resolves to `https://evil.com/` — WHATWG treats `\` as `/` for http(s). A credential
phishing primitive handed to a visitor in the second after they watched a real sign-in
succeed. Control characters are excluded for the same reason.

**Fourth: the callback echoed free text onto its own sign-in page.** `?error=<sentence>`
rendered in a styled warning box above the real password form, on the real domain. Refusals
now travel as a fixed set of codes and the sentence is looked up locally; the one
interpolated value, the domain list, is read from settings rather than the URL. Google's
own words still reach the admin, in **Health**, where they are useful and not weaponisable.

**Not treated as a finding:** an admin can generate a password for a Google-only account
and sign in as them. That is the pre-existing `adminResetPassword`, audited like every
other use of it, and it is equally true of password accounts — Google did not widen it.

The lesson worth carrying: **an email address is a routing label, not an identity**, and
the moment two authentication systems are joined on one, the question is not "do the
strings match" but "who last asserted this string, and what did they prove".

**`src/lib/request-url.ts` is new and half-applied.** The two-line "work out the base URL
from forwarded headers" idiom is inlined in about ten older call sites; route handlers get a
plain `Headers` rather than `next/headers`, so the helper had to exist. Folding the other
ten in belongs in a commit that is not also adding an authentication method.

**Verified against a real Postgres, every branch:** unverified email refused, existing
member linked with their password intact, Google id winning over a changed email, stranger
refused with sign-up off, invited person let in with sign-up still off and the invitation
consumed, domain allowlist enforced both ways, suspension holding with the billing-aware
message, and a Google-only account passing the session guard, the MCP token guard,
`listUsers` and `instanceStats`. Plus the claim checks against a stubbed token endpoint, and
the callback refusing a forged and a mismatched state.

**Applies to:** `src/lib/google.ts`, `src/lib/auth.ts`, `src/lib/request-url.ts`,
`src/components/settings/account-panel.tsx`,
`src/app/api/auth/google/`, `src/lib/settings.ts`, `src/lib/mcp/tools.ts`,
`src/lib/data/users.ts`, `src/lib/bootstrap.ts`, `src/components/login-form.tsx`,
`src/components/accept-invite-form.tsx`, `src/components/admin/configuration-panel.tsx`,
`prisma/schema.prisma`, `docs/self-hosting/google.mdx`.

---

## 2026-08-31 — A flag on the domain above both, and a box that says how long

Two things, and they turn out to be the same thing: what happens before you sign in, and
what happens after.

**hired.tools could not ask app.hired.tools anything, and should not have been able to.**
The obvious implementation of "send a signed-in visitor to the app" is a `fetch` from the
landing page to the app with credentials, and it does not work: the session cookie is
`SameSite=Lax` and is simply not sent on a cross-site request. The fix people reach for is
`SameSite=None`, and that is the wrong trade — it is a real defence against cross-site
requests, spent on a convenience. The other option, a top-level bounce through the app on
every visit, makes an anonymous visitor watch a redirect on the way to a marketing page.

So: a cookie on the domain above both hosts. Signing in writes `hired_signed_in=1` to
`hired.tools`, an inline script at the top of the landing page reads it, and that is the
whole mechanism. It is script-readable on purpose and carries nothing — no identity, no
token, no session — because the worst thing a forged one can do has to be "sends somebody
to a sign-in page". This is what GitHub's `logged_in` cookie is, and for the same reason.

**The cookie domain is a setting, not a guess.** `landing_url` in Admin → Configuration,
and the domain written to is the longest run of labels the app host and that URL share.
Deriving it from the request host alone would have needed no configuration and would have
written a cookie on `mycompany.com` for anyone self-hosting at `hired.mycompany.com` —
a flag visible to every unrelated site on that domain, that nobody asked for. Taking the
common suffix of the two also means a forged `Host` header cannot widen it past what an
admin wrote down: the answer is bounded by the landing page at both ends. `.co.uk` is the
case this deliberately does not get clever about — the browser refuses a cookie on a public
suffix and the landing page stays the landing page, which is the right failure.

**The redirect replaces rather than pushes, and that is not a choice.** A navigation started
from a head script replaces the history entry whatever you call it, so `location.replace`
is the honest spelling. The escape hatch is a `sessionStorage` marker: ask for hired.tools a
second time in the same tab and you get it. Without the marker, the page would be
unreachable for as long as you stayed signed in. A deep link (`#pricing`, or any query, so
ad clicks land where they were pointed) and arriving from the app also stay put.

**A stale hint is cleared by the sign-in page.** The flag can outlive the session it
describes — an expired session, a password change, an admin ending every device. Reaching
`/login` means there is definitively no session here, since the page redirects into the app
when there is one, so the form deletes the hint on mount. That is also the only place that
can: nothing can write a cookie during a server render.

**Keep me signed in, ticked, is what the app already did.** Thirty days, persistent cookie.
Unticked is twelve hours and a cookie with no expiry, so it goes when the window does. The
box is a native `<input type="checkbox">` rather than the shadcn one, which is the only
interesting decision in it: this form posts to a server action and still works with
scripting off, and Radix only grows the hidden input carrying its value once it has
hydrated — so the Radix version would have quietly given every no-JS sign-in a twelve-hour
session. The show/hide eye and `required` came along with it; `autocomplete` was already
right.

**Verified against a real browser rather than by reading it.** Postgres, a production
build, and a TLS proxy serving `site/` at hired.tools and the app at app.hired.tools, so
the cross-domain half was exercised as it actually ships: sign in, get bounced from the
landing page, ask again and stay, sign out and watch the deletion in the response headers,
and an instance with no `landing_url` writing no cookie at all.

**Applies to:** `src/lib/auth.ts`, `src/lib/settings.ts`, `src/server/actions.ts`,
`src/app/login/page.tsx`, `src/components/login-form.tsx`, `site/index.html`, `README.md`,
`docs/reference/security.mdx`, `docs/self-hosting/configuration.mdx`.
## 2026-08-31 — /docs folds into docs.hired.tools, and the skills stay behind

**There is one Docs now and it is the manual.** The in-app `/docs` page listed every
tool from the same array `tools/gen-tool-docs.mjs` generates `docs/tools/*.mdx` from,
so it was a second rendering of one generated list — the exact thing the settings
page comment warned about when it stripped the catalogue out of Settings. Worse, the
profile menu had grown two entries that answer the same question. The page is gone;
`next.config.ts` redirects `/docs` permanently to the manual, because people have it
bookmarked and the README and marketing site both linked it.

**Two things could not move, and both stayed in the app.** The **skill files** are
served from the running instance's own `skills/` directory — byte for byte the copies
in the repository it is running — and no static site can build somebody a zip out of a
folder on someone else's server. They live on **Settings → Connections** now, which is
where you wire up an assistant, and installing a skill is part of that rather than part
of reading about one. The **live tool count** was already in that panel's header
("108 tools · 8 workflows · 28 admin"), with **Test** to prove it by calling the
endpoint, so the per-account number survives where it is actually useful.

**The redirect is exact-match on purpose.** `source: "/docs"` does not catch
`/docs/skills/<name>` or `.zip`, which is what keeps the downloads working. That was
worth checking rather than assuming: signed in, the route still returns
`text/markdown` with a `SKILL.md` disposition and a real `PK`-signature zip.
Unauthenticated it 307s to `/login`, which is `requireUser` and correct — an early
test that looked like a broken download was just a client with no session.

**`next.config.ts` imports `src/lib/links.ts` by relative path**, not `@/lib/links` —
the config is compiled outside the path aliases, so the alias silently would not
resolve.

**Applies to:** `next.config.ts`, `src/app/(app)/docs/page.tsx` (deleted),
`src/app/(app)/docs/skills/[slug]/route.ts`, `src/app/(app)/settings/page.tsx`,
`src/components/settings/{skills-panel,copy-block}.tsx`, `src/components/shell.tsx`,
`README.md`, `docs/{app,skills}.mdx`, `docs/tools/overview.mdx`,
`docs/reference/faq.mdx`.

## 2026-08-31 — The generator owns the tool counts now

Two admin tools landed with Google sign-in and every hand-written figure in the
manual went stale: 100 became 102, 27 became 29, and `tools/list` for an admin
became 110. That is the **fourth** time a count in this repository has been wrong
— twice in the README, and now twice in `docs/`.

So they are generated. `docs/tools/overview.mdx` carries two blocks between
`{/* generated:counts */}` and `{/* generated:areas */}` markers, filled by
`tools/gen-tool-docs.mjs` from the array itself, and `--check` fails when either
is stale. The generator also reads the prompts array now, because the workflows
are published as tools and the totals are wrong without them.

**Every other page stopped repeating a number.** connect.mdx, troubleshooting.mdx
and index.mdx used to state "80 for a member, 108 for an admin" and now link to
the table; configuration.mdx said "All 27 admin tools" and now says "Every admin
tool". One generated figure, cited from everywhere else — the same rule that
killed the in-app /docs page, applied to the numbers rather than to the list.

The per-area blurbs moved into `SECTIONS` in the generator, since it has to emit
the cards to keep their counts right.

**Applies to:** `tools/gen-tool-docs.mjs`, `docs/tools/overview.mdx`,
`docs/connect.mdx`, `docs/index.mdx`, `docs/reference/troubleshooting.mdx`,
`docs/self-hosting/configuration.mdx`, `docs/reference/security.mdx`, `CLAUDE.md`.

---

## 2026-08-31 — Searching settings by name, and only then by description

Configuration is one screen now, and Google sign-in added four more rows to it, so finding
a setting had started to mean scrolling past three sections of somebody else's setup. A
search box, group chips, and a **Changed** filter that narrows to whatever is no longer on
its default — which turns out to be the fastest answer to "what has actually been
configured on this instance".

**Filtering happens in the browser, unlike the Log tab, and the difference is the point.**
The log pages an unbounded table, so it filters on the server: slicing a hundred rows and
*then* filtering them shows you the wrong hundred. Configuration is every setting the
instance has — a few dozen at the very most, already on the page — so the fastest filter is
the one that makes no request. Same feature, opposite implementation, for a reason worth
being able to state.

**Searching names and descriptions together was too noisy to use, and the fix is two
passes.** The help text is prose: "From the webhook you registered", "the Stripe webhook URL
is built from it". Search all of it at once and `from` returns six unrelated rows, `stripe`
returns Public URL. So: match keys, labels and group names first, and fall back to the
descriptions only when nothing was named. `from` gives the two From fields; `webhook` gives
the signing secret rather than also the Public URL; `twenty-icons` — a word in no name
anywhere — still finds company logos by what it does. Ranking both passes into one list
would have been the fancier answer and a worse one: a precise hit and a prose hit are
different kinds of answer, and mixing them puts the noise back.

**The setup guidance hides while a filter is on.** Resend's four numbered steps, the Stripe
webhook URL, the Google redirect URI, the test-send and resync buttons — all of it is for
setting an area up, and somebody searching for one row does not want four numbered steps
between them and it. Section blurbs and the Add a variable card go the same way. With no
filter, the screen is exactly what it was.

**An edited row that the filter then hides gets called out.** The sticky bar already listed
the dirty keys, but "1 hidden by the filter — show" says the thing plainly and clears the
filter when pressed. Losing an unsaved change because it scrolled out of existence is the
one way a filter can actively cost you something.

**`FilterChip` moved to `src/components/filter-chip.tsx`.** It was private to the audit
panel; a second user made it a shared control rather than a copy.

**Applies to:** `src/components/admin/configuration-panel.tsx`,
`src/components/filter-chip.tsx`, `src/components/admin/audit-panel.tsx`,
`docs/self-hosting/configuration.mdx`.

---

## 2026-08-31 — Merging duplicate employers, and the bug that was manufacturing them

**The duplicates had a cause, and it was ours.** `updateApplication` resolves `company`
through `upsertCompanyByName`, which creates the company when the name does not exist. The
application header put that name on the 700ms autosave, so typing "Stripe" and pausing after
"Str" created a company called `Str` and moved the application onto it. Every hesitation
mid-name was a new employer. The name commits on blur now, and `upsertCompanyByName` refuses
a blank outright — a `Company` named `""` is unreachable, unnameable and permanent. Fixing
the cause first was the point: a merge tool that tidies up after a machine still producing
mess is a bailer, not a repair.

**`mergeCompanies` runs in one transaction because `Application.company` is
`onDelete: Cascade`.** Delete the duplicate before re-pointing its applications and they go
with it, silently, with no recovery. The ordering inside the transaction is the safety
property; a failure between the two `updateMany`s would leave the pipeline split across two
companies, which is the state being repaired but half-done. It does not reuse
`deleteCompany` for the last step: that function throws while applications point at the
company, and it closes over the module-level `db` rather than the transaction client.

**Four rules, in order of how much they matter.** Nothing is deleted but the duplicate's own
row; notes are never lost (the survivor's keep their position, the duplicate's are appended
under a provenance line, skipped entirely when already present so merging a recreated name
twice cannot double the text); blanks are filled but values are never overwritten, because
the duplicate usually holds the website while the record you kept holds the research; and
the survivor's NAME is never taken from the duplicate, because which name lives IS the
direction of the merge.

**Nothing is de-duplicated.** Two identical role titles on the survivor is correct — the
alternative is guessing which of two records to destroy. Both the tool description and the
dialog say so, because "merge" reads like "de-duplicate" to everyone who has not thought
about it.

**Detection suggests, never acts.** `companyKey` (the existing `slugify`, now exported)
strips `inc`, `llc`, `labs`, `group` and friends, so it pairs "Stripe" with "Stripe, Inc."
and also "Meta" with "Meta Labs". That false-positive rate is fine for pre-selecting a
dialog and unacceptable for anything automatic, so it only ever populates a suggestion a
person reads a plan before accepting.

**There is no unmerge, and the preview exists because of it.** `preview_company_merge` is a
separate read-only tool, the confirm button stays disabled until a plan comes back, and the
dialog lists the role titles that will move. Do not let a later simplification collapse the
preview away.

**Two corrections found while in here.** The company page's delete confirmation promised it
would "delete all N applications with them, history included" — but `deleteCompany` refuses
while any application exists, so the warning was a threat followed by an error toast. And
the comment above `deleteCompany` claimed the schema nulls the link rather than cascading:
true of contacts, false of applications, and exactly backwards about the risk.

**Applies to:** `src/lib/data/pipeline.ts` (`previewCompanyMerge`, `mergeCompanies`,
`planCompanyMerge`, `upsertCompanyByName`, `deleteCompany`'s comment), `src/lib/company.ts`
(`companyKey`), `src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/crm/merge-companies-dialog.tsx`, `src/components/crm/company-detail.tsx`,
`src/components/pipeline/application-detail.tsx`, `src/app/(app)/crm/companies/[id]/page.tsx`,
`README.md`, `docs/concepts/crm.mdx`, `docs/tools/crm.mdx` (generated).

---

## 2026-08-31 — The application page stops being a form

**People first, then the resume, then the timeline; the posting folded away.** The old order
was an accident of construction — the timeline led because it was built first, and the
people you are actually talking to were last in the right rail, which in the slide-over is
two scrolls below the fold. The new order is look-at things before adjust-things: People,
Resume, Timeline, Job description, Notes, with Details and Tasks in the rail.

**The job description is collapsed when there is one and open when there is not.** Empty vs
filled is the only signal worth branching on: a filled description is a wall of text you
pasted once and Claude reads from then on, and an empty one needs its paste target visible
or the card is a dead end. The state is per-mount and deliberately not persisted — it is a
glance, not a preference.

**The resume is rendered, not named.** `ResumePaper` is a pure component (no `"use client"`,
no server-only imports) and takes a plain JSON document, so the same live thumbnail the
resumes grid draws can render inside this client component from data the page or the panel
action already fetched. A name in a Select told you which document was attached and nothing
about what was on it. The document is fetched **only when one is attached**, because it
carries the owner's photo as a data URI and the panel is opened far more often than a
resume is read.

**The company is a chip, and changing it is a picker.** The header's editable company field
was the bug in the previous entry; replacing it with free text that commits on blur would
have kept the same trap open, just narrower. The picker offers the companies already on
file and only creates when you pick the row that says it is creating — which is the same
argument as `merge_companies`, at the other end of the problem.

**`lg:` was measuring the wrong box.** One component renders in two: the page, whose content
is about 720px at a 1024px viewport once the 15rem rail is subtracted, and the slide-over,
which is about 688px at any viewport. A viewport breakpoint therefore gave the *panel* two
columns on every desktop and crammed a 21rem rail into 688px. It is a container query now —
`@container` on the root and `@min-[44rem]` on the grid — chosen above the panel and below
the page. Do not "simplify" it back to `lg:`, and if the rail width or the sheet width
changes, re-measure: the usable window is narrow.

**Applies to:** `src/components/pipeline/application-detail.tsx`,
`src/components/pipeline/application-panel.tsx`,
`src/app/(app)/applications/[id]/page.tsx`, `getApplicationForPanelAction` in
`src/server/actions.ts`, `docs/app.mdx`.

---

## 2026-08-31 — Sources become rows the person owns

**The complaint was that the list only ever grew.** `Application.sources` was a `String[]`,
and the picker offered every spelling anyone had ever typed *plus* six starters appended in
code — so the starters were un-deletable by construction and a typo was permanent. They are
`Source` rows now: named, coloured, renameable and, the point, deletable.

**Deleting a source detaches and succeeds. It never refuses.** Deliberately unlike
`deleteCompany`, which throws while applications point at it. A company is a record with
its own history and losing it loses work; a source is a label, and the applications are
untouched apart from no longer wearing it. A label that refuses to die IS the bug.
`deleteSource` returns `detachedFrom` so both the dialog and an assistant can say how many
applications it came off.

**Colour is a token name, never a hex.** `Source.color = "violet"` resolves through
`SOURCE_TONE` to `var(--tag-violet)`, the same way `STAGE_TONE` resolves stages — and for
the same reason recorded there: a hex is right in exactly one theme. `--tag-*` is defined
twice in globals.css, at L≈0.56 for light and L≈0.72 for dark.

**A source chip is a coloured dot on a neutral chip, not coloured ink on a wash.** Ten
stages already own colour-as-progress in this product, and globals.css says outright that a
new hue beside them "would either be mistaken for a stage or shout over one". Since the
colour here is chosen by a person and cannot be constrained, the *form* is what keeps them
apart. Do not "unify" `.tag-chip` with `.stage-chip`.

**An explicit `ApplicationSource` join, not Prisma's implicit m2m.** The migration writes
the links in raw SQL, and an implicit table's name and its `A`/`B` columns are a convention
of Prisma's rather than a contract. The explicit table also gets an index for the usage
count the picker and `delete_source` both show.

**`key` is a column holding `lower(trim(name))`.** Case-insensitive uniqueness is the whole
point — "LinkedIn" and "linkedin" are one channel — and Prisma cannot express a functional
index, so a raw one would read as permanent drift. It is derived, so `updateSource` assigns
it explicitly rather than picking it off the patch: a rename that left the old key would
quietly stop the uniqueness meaning anything, which is the exact bug the column exists to
prevent.

**Names still work on the write path, and resolve before they create.** `capture_job_posting`
and every assistant that has ever used this server pass strings. `resolveSourceIds` matches
on the folded key first and creates only when nothing matches, so `linkedin` lands on the
existing `LinkedIn`. `sourceIds` was added alongside for precision and wins when both come.

**The join table carries no `userId`, which is a real dent in invariant 1.** Nothing in
`src/lib/data/` can filter `ApplicationSource` by owner. `resolveSourceIds` re-reads every
supplied id against the caller before it links, and that check is the only thing standing
between a client-supplied id and a cross-workspace link. Verified against a live database
along with the rest; do not remove it.

**The starters survive as an offer, not a fixture.** `seedSources` creates them as real
rows when someone presses "Add the usual six" in the empty picker, so a new workspace is
not a blank box and nothing is imposed.

**Two things worth knowing for next time.** The write paths return `include:
applicationInclude`, and every one of them needed `flattenSources` — a test against a real
database caught `create_application` handing back raw join rows where an assistant expected
`{ id, name, color }`. And `tools/gen-tool-docs.mjs` evaluates each `inputSchema` in a
hand-built scope: a new enum constant must be added to BOTH the duplicated constants and
the verification loop, or `--check` dies with a ReferenceError rather than a useful message.

**Applies to:** `prisma/schema.prisma`,
`prisma/migrations/20250122000000_source_categories/`, `src/app/globals.css`,
`src/lib/data/pipeline.ts`, `src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/pipeline/{source-chip,sources-input,new-application-dialog,application-detail}.tsx`,
`src/components/crm/company-detail.tsx`, `tools/gen-tool-docs.mjs`, `README.md`,
`docs/concepts/pipeline.mdx`.

---

## 2026-08-31 — The pipeline could only be asked three questions

**What was actually wrong.** The board could be asked which stage, whether a follow-up date
had passed, and whether text appeared in the company name, role title or notes. Everything
else the schema records — sources, the resume sent, excitement, work mode, days in stage,
the whole posting — was write-only. And `overdue` and `closed` could not be combined with a
stage at all, because the toggle made them REPLACE the set: "screening interviews that are
overdue" and "closed, but only the ghostings" were unaskable for no reason but that.

**`overdue` is a flag that ANDs; `closed` expands to the four terminal stages.** Both
spellings still parse out of `f`, so saved views and pasted links keep meaning what they
meant, and `closed` being an alias deletes the special case from every downstream branch
rather than adding a seventh.

**The chip counts were lying.** They came from `pipelineStats(userId)`, which ignores `q`,
so searching "stripe" left "Screening 12" above a board showing one card. Counts are
computed from the rows the page already holds, faceted the standard way — each dimension
counted against rows passing every OTHER dimension — so ticking one source does not collapse
the source counts to that source. The page reads applications once and both filters and
counts from that array.

**Stages stay chips; the unbounded dimensions go behind one button.** Six stages are short,
colour-coded and used constantly, and burying them would make the common case worse. A
person has forty companies and a dozen sources: a chip each is a wall.

**Search moved out of the Prisma `where` and widened.** "Which of these mentioned Rust" was
unanswerable with the whole posting sitting in `jobDescription`, and a substring across a
relation's names is not something Prisma's array operators can express at all. It now covers
the company, role, notes, location, work mode, the posting and the source names.

**`src/lib/pipeline-filters.ts` is pure and shared.** The page filters with it and the
toolbar builds links with it, so there is one definition of what a filter means rather than
a server copy and a client copy that drift. Its predicate was exercised against eighteen
cases — every dimension, the two combining fixes, and a URL round-trip — because there is
no test suite and this is the code that decides what somebody sees.

**New parameters are APPENDED to `normaliseQuery`'s whitelist, never inserted.** A saved
view is compared to the current URL as a raw string, so reordering that array rewrites every
stored view's identity at once. A parameter this module understands and that file drops is a
filter that vanishes the moment somebody saves the view.

**`co` and `cv` hold ids, not names.** Ids survive a rename, which names do not; they do not
survive `merge_companies`, and a saved view naming a merged-away company simply stops
matching it. That is the acceptable failure — nothing breaks and clearing the filter fixes
it — but it is the reason the manual says so out loud.

**The calendar is narrowed only by what a calendar entry carries.** An entry is a date, not
an application: it has a stage and a kind, and no source, resume or excitement. The other
dimensions apply on the board and the table and are documented as doing so, rather than
being silently ignored on one view.

**Applies to:** `src/lib/pipeline-filters.ts`, `src/components/pipeline/filter-menu.tsx`,
`src/components/pipeline/toolbar.tsx`, `src/app/(app)/applications/page.tsx`,
`src/lib/data/views.ts`, `README.md`, `docs/concepts/pipeline.mdx`, `docs/app.mdx`.

---

## 2026-08-31 — What an adversarial pass over the CRM batch found

Seventy-eight agents over the five commits above: fifteen findings survived two independent
refutation attempts each, twenty-one did not. The ones that stood, and why they matter more
than they look:

**The Closed chip became a dead end the moment it was combined with a stage.** `closedOn`
required the four terminal stages to be the ONLY stages on, but the chip's own href unioned
them into whatever was already there. Click Screening, then Closed: the URL holds five
stages, the chip reads "off" while closed rows are visibly on screen, and its href is now
byte-identical to the current URL — so clicking it again does nothing, forever. The fix is
two lines (drop the length clause; make the off-branch subtract rather than clear), and the
lesson is that a control's "am I on" test and its "what happens when clicked" link are two
statements about the same thing and have to be written to agree. Combining filters was the
entire point of that commit and this was the one combination it broke.

**Server-derived props in the slide-over cannot be refreshed with `router.refresh()`.** The
panel's contents come from a server ACTION held in component state, not from the route, so
refreshing the page underneath left the company chip, the resume thumbnail and the source
list on the snapshot taken when the panel opened — three separate findings, one cause.
`ApplicationPanelProvider` now exposes a nonce-driven `reload`, passed down as
`onServerChange`. Anything added later that renders a server-derived prop in that component
must call it; `router.refresh()` alone is a no-op there.

**A count is a promise about what clicking will show you.** `counts.all` relaxed every
dimension while the Everything chip only cleared stages and overdue — so it advertised a
number you could not reach, which is precisely the class of lie the same commit fixed for
the search box. Counted against the chip's own link now.

**The calendar honours two of seven dimensions, and now says so.** An entry is a date, not
an application: it has a stage and a kind, and no source, resume or excitement. Silently
dropping five filters while the Filter button showed them as active was the dishonest half;
the menu carries a line explaining it on that view.

**cmdk keys selection on an item's `value` string.** Two rows sharing one both highlight and
Enter fires whichever is first in the DOM — and a source named "LinkedIn" beside a company
named "LinkedIn" is the likely case, not a contrived one. Facet rows are namespaced
(`src-`, `co-`, `cv-`) now. Related: a `forceMount` item is never registered in cmdk's
store, so it does not count towards `filtered.count`, and `CommandEmpty` was rendering
"Type a name to create it" directly above the Create row that contradicted it.

**Five hand-written tool counts in `docs/` were missed** when the README's three were
bumped — `docs/tools/overview.mdx` (the table and two area cards), `docs/connect.mdx`,
`docs/reference/troubleshooting.mdx`, `docs/index.mdx`. `gen-tool-docs.mjs --check` does not
see them because they are prose. That is now four rounds where these numbers drifted; the
generator covers the argument tables and nothing covers the prose.

**`save_view`'s description was the parity gap for the whole filtering commit.** Five new
URL dimensions were accepted by `normaliseQuery` and documented in the manual, while the one
tool that can write a view still enumerated the old six and closed with "anything outside
those parameters is dropped" — so an assistant asked for "everything from a referral that
has sat a fortnight" would read that sentence and refuse, or save a view missing both
conditions. A tool description that under-claims is as wrong as one that over-claims.

**Applies to:** `src/components/pipeline/{toolbar,filter-menu,application-panel,application-detail,sources-input}.tsx`,
`src/app/(app)/applications/page.tsx`, `src/lib/mcp/tools.ts`, `docs/tools/overview.mdx`,
`docs/connect.mdx`, `docs/reference/troubleshooting.mdx`, `docs/index.mdx`.

---

## 2026-08-31 — A contact represents companies, plural

**`Contact.companyId` became a `ContactCompany` join.** A person is a founder at one place,
an advisor at two more and a friend who has since moved, and a single nullable FK forced a
choice about which of those to keep. Explicit join rather than Prisma's implicit m2m, for
the same reason `ApplicationSource` is: the migration backfills the rows in raw SQL, and an
implicit table's name and its `A`/`B` columns are a convention of Prisma's rather than a
contract.

**The backfill is lossless and the column goes in the same migration.** Everyone who had an
employer gets exactly one join row carrying the contact's own `createdAt`, and the insert
joins `Company` so a row orphaned by an older bug cannot fail a deploy. Verified on a
throwaway Postgres seeded at the previous migration with two tenants: five contacts in,
four join rows out, nobody's rows crossing a workspace.

**Cascade replaces `SET NULL`, and means the same thing.** Deleting a company used to null
the contact's employer; now it deletes the link row. The person survives either way — which
is what `deleteCompany`'s comment claimed and now claims accurately.

**`companies` REPLACES the set, like `sources` on an application.** One rule for every array
in the API is easier to hold than a per-field mix of add and replace. `companyIds` wins over
`companies`, which wins over the legacy `company` — and `company: ""` still detaches, so a
client written against the old single field keeps working rather than half-working.

**Merging companies had to learn the collision.** `(contactId, companyId)` is the primary
key, so re-pointing every link at the survivor throws when someone is already at both. The
duplicate's link is deleted first and the rest moved — and `previewCompanyMerge`'s contact
count excludes those people, because they are not someone the survivor gains.

**The picker keeps already-linked companies in the list, marked.** Filtering them out looked
tidier and left typing a linked company's name showing nothing at all: no match, and no
"Create" row either, since the name exists. A row that says `linked` answers the question the
empty list did not.

**The Company text field is gone rather than conditional.** It was already only rendered
when nothing was linked; a field that can hold one value has no honest form now that the
answer is a set, and the chips under the name are the control — each with an × and a button
beside them to add another.

**Applies to:** `prisma/schema.prisma`,
`prisma/migrations/20250123000000_contact_companies/`, `src/lib/data/pipeline.ts`,
`src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/crm/{contact-companies,contact-detail}.tsx`,
`src/app/(app)/crm/contacts/`, `src/app/(app)/page.tsx`, `docs/concepts/crm.mdx`,
`skills/run-the-search/SKILL.md`.

## 2026-09-01 — The brain is called Me

The nav had said **Me** for a while; everything behind it still said brain — the route,
the column, five tool names, forty pages of manual and the landing page. One name in the
product and another in every sentence about it is a tax on every future reader, so the
rename went all the way through in one pass.

**The database was left alone deliberately.** `Profile.background`, `Role.background` and
`Project.background` are `@map("brainDump")`: the Prisma field is renamed, the column is
not. There is no migration, no drift, and no self-hoster has to take a schema change to
follow a vocabulary change. If a later migration ever renames the columns for real, it
can — nothing above the data layer knows the old name any more.

**"Me dump" is not a phrase, so the raw text became the background.** "Notes" was the
natural English and was rejected: `Note` is already a model with its own tools, and
`append_role_notes` sitting next to `create_note` is exactly the ambiguity that makes an
assistant pick the wrong one. Everything the field touches follows it — the card titles,
`append_role_background`, `include_background`, `mine_role_background`.

**Tools renamed, arguments included:** `search_brain` → `search_me`, `get_brain_snapshot`
→ `get_me_snapshot`, `append_role_brain_dump` → `append_role_background`,
`include_brain_dumps` → `include_background`, `mine_brain_dump` → `mine_role_background`,
`brainDump` → `background`, `seedFromBrain` → `seedFromMe`. Tool names are resolved live
from `tools/list`, so a connected client picks the new ones up on its next session — but
a prompt somebody saved that names `search_brain` will not, which is the one real cost and
was taken knowingly.

**"Me" works as a proper noun and not as a possessive.** "Search Me", "nothing goes on a
resume that the evidence in Me cannot back", "filling in Me" all read. "Does not expose
anyone's Me" does not, so the privacy and admin sentences — which were listing the three
things an admin cannot see — say **career history** instead. It is descriptive rather
than a section name, which is what those sentences needed anyway.

**`/brain` redirects permanently to `/me`, and `/brain/:path*` with it.** Claude has been
handing out `/brain/<roleId>` links since the first release and they are in people's
history; a 404 on somebody's own record is the worst possible outcome of a rename.

**Applies to:** `prisma/schema.prisma`, `next.config.ts`, `src/lib/data/me.ts` (was
`brain.ts`), `src/lib/data/resumes.ts`, `src/lib/mcp/{tools,handler,clients}.ts`,
`src/server/actions.ts`, `src/app/(app)/me/` (was `brain/`), `src/components/me/` (was
`brain/`), `tools/gen-tool-docs.mjs`, all of `docs/` (`concepts/me`, `tools/me`,
`guides/fill-in-me` renamed), `skills/`, `site/index.html`, `README.md`, `CLAUDE.md`.
---

## 2026-09-01 — The resume grid learns to answer, and a paste fills in Me

**The cards got the answers; the thumbnail stopped being the message.** Page count (the
editor's own gauge), a Live badge, the actions that used to need the editor open, an
application count that links to `/applications?cv=<id>` (the filter already existed), and
the outcome line. The card also stopped being one big `<Link>` — the star, the menu and
the badges are controls, and nesting controls in an anchor is how clicking "delete" also
navigates. Thumbnail and title navigate; everything else acts.

**LINES_PER_PAGE lived in two places and now lives in one.** The editor hardcoded 46 and
`preview_resume_text` hardcoded 46 separately. It is exported from `resume-text.ts` now,
with `estimatePages` beside it, because the grid became a third consumer and three copies
of a magic number is how gauges start disagreeing.

**Outcomes count the timeline, not just the current stage.** An application's `stage` is
where it is now; most applications that interviewed are now REJECTED or GHOSTED, and a
current-stage-only count would have called every effective resume a failure. So a resume's
`interviewed` counts stage ∈ screen-or-later OR an INTERVIEW activity OR a STAGE_CHANGE
whose `toStage` reached one — computed in `listResumes` in the data layer, so the card and
the tool cannot diverge. Honest limit: a stage move logged before `fromStage`/`toStage`
existed, with no INTERVIEW activity, is invisible to it.

**Lineage flattens to the root.** `Resume.baseResumeId` is set by `duplicateResume` as
`source.baseResumeId ?? source.id`: a copy of a variant points at the base, not at the
variant, because the grid and the diff only ever show one level and a chain would rot the
moment a middle link was deleted. SET NULL on delete — losing the base makes variants
standalone, it does not delete tailored work. `create_resume` accepts `baseResumeId` but
validates it against the caller's own resumes first: the FK alone would happily cross
tenants.

**The diff is exact-string on purpose.** A reworded bullet shows as one removed plus one
added — old wording beside new — rather than a similarity metric deciding what counts as
"the same" bullet. `resume-diff.ts` sits next to `resume-text.ts` outside `src/lib/data/`
for the same reason that file does: the editor computes it client-side as you type.

**Import is additive or it is dangerous.** `importResume` fills only empty profile fields
and skips any role (company+title), education (school+degree), project or certification
(name) that already exists — so a second import of the same document is a no-op, not a
duplicated history. Skill groups union instead, because "Languages" existing is no reason
to drop three new languages. One transaction; the summary lists created vs skipped. The
parser is the assistant, not the server: the tool takes the structured payload, and the
description carries the no-fabrication rule. The EMPTY_WORKSPACE briefing in `handler.ts`
said "there is no import tool" — updated, and that sentence is the kind that goes stale
silently: it duplicates a fact the tools array owns.

**gen-tool-docs maps pages by contiguous ranges of the tools array.** `SECTIONS` pins each
docs page to a `first`/`last` tool name; adding `import_resume` at the end of the Me
area meant bumping that page's `last` or the generator throws. A new tool inserted at an
area boundary will hit this every time — the error message says exactly what it expected.

**The README's tool count was already five stale before this batch.** It said 80/110 while
the generator said 85/115. Set to the generated 87/117 now. The count appears twice in the
README (lines ~45 and ~214), not three times as `mcp-tool`'s skill doc remembers.

**Applies to:** `prisma/schema.prisma`, `prisma/migrations/20250124000000_resume_lineage/`,
`src/lib/data/{resumes,me}.ts`, `src/lib/{resume-text,resume-diff}.ts`,
`src/lib/mcp/{tools,handler}.ts`, `src/app/(app)/resumes/`, `src/components/resume/`,
`tools/gen-tool-docs.mjs`, `README.md`, `docs/tools/`.

---

## 2026-09-01 — What the adversarial pass found in the resume batch

Five review lenses (logic, tenant, UI, MCP surface, data/migration) with three verifying
skeptics per finding, plus a live run of the whole data path — every migration applied to a
throwaway Postgres 16, then import/lineage/outcomes/search exercised for real across two
tenants. Six distinct findings survived verification; all fixed, all covered by the live
checks now.

**Import's dedupe key was eating boomerang careers.** company|title as the whole identity
meant a resume listing two stints at one employer lost the second ON FIRST IMPORT — data
loss in the one tool whose promise is "nothing is lost". The date is part of a stint's
identity now: within a payload, company|title|startDate; against existing rows, skip only
when dates match or either side has none. Education keys gained field for the same reason
(two degree-less certificates at one school). The lesson generalises: a dedupe key is a
claim about what makes two things the same, and "same employer, same title" is not it.

**The diff answered a question nobody asked.** It compared the stored documents; the person
asks about the printed ones. section.visible is a first-class tailoring move (the eye
toggle, and update_resume's own description recommends it), so hiding a section now reports
as removed ("hidden, not deleted"), unhiding as added, and edits inside a section hidden on
both sides as nothing at all.

**A Map is the wrong container for a multiset.** Keying base experience entries by
company|title collapsed two same-key stints into whichever the Map kept last, so a
byte-identical copy reported phantom bullet diffs. Matching is a two-pass pool now: roleId
first, then company+title in order of appearance — which also pairs an entry that lost or
gained its roleId across a copy.

**idempotentHint is a promise about the whole call.** import_resume's Me half was
genuinely idempotent while create_base_resume minted a new "Base resume" per retry. It
reuses an existing resume of that name now. If one branch of a handler breaks an
annotation, the annotation is wrong, not nearly-right.

**?new=1 plus URL-writing controls is a reopen loop.** The dialog's effect fired on every
params identity change; harmless while nothing on /resumes wrote the URL, a reopen-on-
every-keystroke the moment search did. The flag is consumed on first open. Any future
"open X via query param" effect on a page with a toolbar needs the same consume.

**The 5s interactive-transaction default is sized for none of this.** A full-career import
is dozens of round trips; importResume now batches highlights per role (createMany) and
passes timeout: 60s. Also from the pass: fractional bullet strength is rounded rather than
rolling the whole import back; an OFFER activity counts as interview evidence (offers ⊆
interviewed, always); deleteResumeAction only redirects from the editor, so deleting from
the grid keeps the search and sort; pickers use listResumeNames instead of paying
listResumes' new outcomes join; and the README carried a THIRD hand-written count at line
~364 that both CLAUDE.md and the mcp-tool skill misremember as three-elsewhere — it is
lines ~45, ~214 and ~364.

**Applies to:** `src/lib/data/{me,resumes}.ts`, `src/lib/resume-diff.ts`,
`src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/resume/{resume-card,new-resume-dialog}.tsx`,
`src/app/(app)/applications/`, `README.md`.

---

## 2026-09-01 — Merging the resume batch across the Me rename

Two branches touched the same eight files: the resume-page batch and the brain→Me
vocabulary rename. Notes from resolving it, because the same shape will recur.

**A rename lands as conflicts in the diff and silence everywhere else.** Git resolved most
files cleanly and left code that compiled against a vocabulary that no longer exists —
`importBrain` writing `brainDump`, `create_resume` called with `seedFromBrain`, a tool
description telling assistants to call `search_brain`. The conflict markers were the small
half of the job; the grep for every retired term across the added code was the real one.
`npx prisma generate` first, per the working agreement — the stale client reported
`background` missing on Role, which reads like the merge broke the schema when it only
meant the client predated it.

**The import API took the new vocabulary, not a translation layer.** `importBrain` →
`importResume` in `me.ts`, `BrainImport*` → `ResumeImport*`, and the role payload's
`brainDump` argument → `background`, matching `append_role_background` and the `@map`ped
column. The tool is `import_resume`, so the data function it calls is `importResume`: one
name for one thing, which is the whole point of the rename it merged into.

**The generated pages were regenerated, not merged.** `docs/tools/{overview,resumes}.mdx`
conflicted; both sides were machine output. Taking main's copy and re-running
`gen-tool-docs.mjs` is the only resolution that cannot be subtly wrong. `SECTIONS` needed
both halves — main's renamed `me.mdx` page, this branch's `last: "import_resume"`.

**Applies to:** the merge commit, `src/lib/data/me.ts`, `src/lib/mcp/{tools,handler}.ts`,
`src/lib/data/resumes.ts`, `src/app/(app)/resumes/page.tsx`, `tools/gen-tool-docs.mjs`,
`docs/tools/`.
---

## 2026-09-01 — Eleven improvements, and what the review found in them

Both of CLAUDE.md's focus items shipped in this batch, along with nine smaller things.
The entries below are the calls worth knowing about, not a changelog.

**One rule for "gone quiet", and it is not `updatedAt`.** `diagnoseSearch` computed
staleness privately from stage transitions, falling back to `updatedAt` — so logging a call
left an application stalled, and dragging a card past another one (which writes a sort
order) made a dead thread look alive. `src/lib/quiet.ts` now holds the thresholds and the
rule, the dashboard and the board read the same numbers, and `quietDays` sits beside
`daysInStage` on every application because they answer different questions. A stage with
no threshold — the wishlist, the four endings — has no quiet value at all: the badge, the
cell, the filter and the sort all agree on that, which took three separate fixes to get
right after the review pointed out that closed rows have the largest numbers in a
workspace and were therefore winning every sort.

**Evidence is derived, never recorded.** `trace_resume_evidence` scores each resume bullet
against the brain by word overlap rather than reading a provenance field. A field written
when a document is seeded would be right for seeded documents and silently wrong for every
one an assistant wrote — and a wrong provenance record is worse than none, because it is
believed. The first version fell back to the whole brain when a bullet's own role had no
highlights; three reviewers independently confirmed that credited a Stripe line at 100% to
a note about another employer, with an unbacked count of zero. There is no fallback now: a
role with nothing recorded backs nothing, which is the honest answer the unbacked list
exists for.

**Dice, not shared-over-longest.** Bullet similarity pairs "Ran the Postgres migration"
with "Led the Postgres migration across six services" — tailoring usually makes a line
longer, and the longest-token measure scored that pair 0.43 and reported a rewrite as an
unrelated cut plus an unrelated addition. Dice scores it 0.55 against a 0.5 threshold.

**A document's ids are not a given.** `RESUME_DOC_SHAPE` never mentions `id`, so everything
an assistant writes has empty ids on every section and entry. Both the section pairing and
the entry pairing need the same three-pass ladder — id, then what the row looks like, then
position — or a base written by the app and a copy written by Claude report 100% churn.
Two stints at one employer under one title need the dates in the fallback key.

**The import adds, and the preview is the same code path.** A role already on file is left
exactly as it is; a profile field with anything in it is kept; skill groups union. `dryRun`
runs the reads and skips the writes, so a preview cannot disagree with what lands — except
that it did, until the review found the in-memory indexes were only updated on the write
path, so a document listing one employer twice previewed two creates and performed one.
The indexes are maintained on both paths now, with an empty-string placeholder id.

**`createRole` defaults `employmentType` to "Full-time", so the import writes `""`
explicitly.** Passing `undefined` for a document that never stated a type meant the import
asserting a fact nobody had. Worth remembering the shape of this mistake: a default that is
sensible for a form is a fabrication when the caller is a parser.

**No PDF parsing, and the paste dialog says why.** A PDF's text layer arrives in column
order, so a two-column resume interleaves. A wrong parse of a document you cannot see the
parse of is worse than asking for the text. The parser also learned two things from the
review: a heading must be the whole line (a per-role "Tools: Postgres, Kafka" line was
being read as a Skills heading and swallowing every job below it), and a stamped "Page 2 of
3" has to be dropped rather than blanked, because a blank line separates entries and
blanking one mid-role cut its bullets loose.

**dnd-kit listens for `mousedown` and `touchstart`, not `pointerdown`.** The board's card
actions menu stopped only the pointer event, so opening it from a card started a drag. Stop
all three, and stop them rather than preventing them: Radix composes its own trigger
handler after the child's and skips it entirely when the event is already
`defaultPrevented`, so `preventDefault` opens nothing and fails silently.

**Radix's menu is `role="menu"` and its select is `role="listbox"`.** The keyboard hook's
"a modal owns the keyboard" guard only knew about `[role=dialog]`, so `j`, `n` and `?`
fired into open dropdowns. Escape in the palette needs `onEscapeKeyDown` on the dialog
content, not a bubbled keydown — Radix handles Escape in a capture-phase listener that runs
first.

**The palette's index came off the page-load path.** It was assembled in
`src/app/(app)/layout.tsx`: three content queries on every navigation, for a dialog most
navigations never open, and the only three hand-written `where: { userId }` clauses outside
`src/lib/data/`. It fetches on open now, through the data layer, and indexes companies and
contacts as well — and passes `includeClosed`, because `listApplications` defaults to
hiding the endings and the layout's version had no stage filter.

**No `quick_log` tool, deliberately.** The dashboard's one-line box matches a typed sentence
against the open pipeline with a stopword table, because this app has no language model and
self-hosting it stays one environment variable. An assistant asked the same thing resolves
it with `list_applications` and `log_activity`, which read a pipeline better than any table
can — so the matcher lives in the data layer and is reachable only from the box that needs
it. Four tools for one concept would have been the worse trade.

**The review paid for itself.** Eight dimensions, every finding attacked by three
independent skeptics, then a critic pass: fifteen findings survived a majority vote and the
critic found six more, including the wishlist badge contradicting the rule module three
files away. Two were mine to have caught by reading (the pluralised toast, the frontmatter
count); the rest needed either a probe or a second pair of eyes.

**Applies to:** `src/lib/{quiet,quick-log,resume-parse}.ts`,
`src/lib/data/{me,resumes,pipeline,onboarding}.ts`, `src/lib/mcp/{tools,handler}.ts`,
`src/server/actions.ts`, `src/hooks/use-keyboard-nav.ts`, `src/components/` (board, list,
application-actions, command-palette, evidence-panel, import-dialog, quick-log,
setup-strip), and the manual.

**Postscript, written at the merge.** Main built import and lineage in parallel with this
branch, and main is what is deployed. So main's `import_resume`, its `resume-diff.ts`, its
`compare_resumes` and its already-applied `20250124000000_resume_lineage` migration are
what survived; this branch's equivalents were dropped rather than reconciled, because two
implementations of one feature is worse than either. What was kept from here is what main
had no answer for: `trace_resume_evidence` and the evidence panel (main compares two
documents; this says what backs a claim), `set_resume_base` for a document that was not
made by duplicating one, `tailor_resume_for_application`, and the paste-and-correct dialog
for somebody who has not connected an assistant yet — rewired to call main's `importResume`
so there is still one filing path. Two lessons worth the space: a migration directory name
is a shared namespace, and the file has to match the one already applied byte for byte;
and when two branches solve the same problem, the one that shipped wins even when the other
is more thorough, because the diff nobody can review is the one that breaks.


---

## 2026-09-02 — One catalogue for every label, and a page to work the list from

Six asks, one shape underneath: industry, size and location should be multi-select and
editable; applications' "sources" should be called tags; companies and people should have
tags of their own; the ping date should leave the CRM record; there should be a tasks page;
and a contact's links should look like the platforms they point at.

**`Source` became `Tag`, keyed by `kind`.** One table, one picker, one set of tools. The
enum is APPLICATION, COMPANY, CONTACT, INDUSTRY, SIZE, LOCATION, uniqueness is
`(userId, kind, key)` on a case-folded key, and three join tables hang off it. The
alternative — a table per list — would have been five more migrations, five more pickers
and five more sets of CRUD tools for one idea. The migration renames in place rather than
creating and copying, so tag ids survive; that matters because the pipeline's saved views
store them, and a view is a URL a person may have pasted somewhere.

**The URL still says `src`.** `PipelineFilters.sources` is now `.tags` and the filter menu
says Tags, but the query parameter stays `src` — every saved view already contains it, and
renaming a parameter for tidiness breaks views nobody can get back. The comment on the
field says so, because the next person to see `src` will want to fix it.

**Industry, size and location as three lists in one join.** A company's four tag sets share
`CompanyTag`, which means a naive replace-the-set write takes the other three with it.
`writeCompanyTags` deletes only the kind being written, and a set the patch is silent about
is left alone. The probe that proved it is the one worth keeping in mind: set all four,
clear one, check the other three are still there.

**Two bugs the probe caught that typecheck could not.** `writeCompanyTags` was written and
never called, so company tags were silently dropped; and `updateCompany` decided "no such
company" from `updateMany`'s count, which is zero for a patch that touches no columns — so
saving only tags threw. Both are the same lesson: a write path with no round trip through a
real database is a write path nobody has run.

**Contact pings moved to `/tasks`.** The date box on a contact record was in the wrong
place — you are reading about a person, not planning a week — but deleting it would have
left no way to schedule one at all. So the tasks page has the picker: who, and when. The
page keeps two columns rather than merging them, because ticking a task and logging a chase
are different acts with different consequences; a merged list would make "logged it" and
"done" look interchangeable.

**Tasks became editable.** They were write-once and tick-once: `updateTask`, `update_task`
and `delete_task` exist now because a page that lists a stale task with no way to move it
is worse than no page.

**Link icons are read off the URL, not the column.** `brandFor(value, filedAs)` prefers
what the host says and falls back to the field only when the host says nothing useful —
so a YouTube link in the website slot wears YouTube's mark, and an "@will" typed before
there was a picker still wears X's. The brand list is deliberately wider than `PLATFORMS`
(which drives the five named columns) and deliberately shorter than "every platform":
a Bluesky link staying a chain link is better than one wearing a bird that is not theirs.
The X mark is hand-drawn in `platform-icon.tsx` because lucide's `TwitterIcon` is still
the old bird and one glyph is not worth a dependency.

**The generator now owns the frontmatter counts.** They had drifted on two pages —
pipeline said twenty-nine when it had thirty-two — for exactly the reason CLAUDE.md
predicted: they sit above the first "### `" heading, so nothing owned them. Twenty lines
in `gen-tool-docs.mjs` spell the count and rewrite the first word of each `description:`.
`--check` catches it now.

**Applies to:** `prisma/schema.prisma` + `20250125000000_tags`, `src/lib/data/tags.ts`,
`src/lib/data/pipeline.ts`, `src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/lib/social.ts`, `src/lib/pipeline-filters.ts`, `src/components/tags/`,
`src/components/tasks/`, `src/components/crm/`, `src/app/(app)/tasks/`, and the manual.
## 2026-09-02 — Gmail and Calendar, read live

**One row, no sync.** `GoogleAccount` holds a refresh token per user and nothing else from
Google ever touches the database. Every screen and tool asks Gmail and Calendar at the
moment it is opened. The alternative — syncing threads into a table with a background job —
was rejected three times over: the transport is stateless and the app has no worker, a copy
of someone's inbox on a self-hosted server is a liability the product does not need, and a
one-person pipeline is a few dozen threads, not a few thousand. The cost is a round trip on
every open, which is why `CorrespondenceCard` fetches after the page paints and never
during it.

**The same OAuth client, a second flow.** Sign-in and inbox access are different grants
and people give them to different Google accounts, so `GoogleAccount` is independent of
`User.googleId`. The flow is the existing one with a `data` flag in the signed state cookie:
`?data=1` on the start route asks for `gmail.readonly` + `calendar.readonly`,
`access_type=offline` and `prompt=consent` (without `consent`, a second connect from the same
account comes back with no refresh token), and the callback stores the grant against the
session's user — never matched by address. Failures from that flow land on
`/settings?tab=google&google=<code>`, a fixed code from the same list the sign-in page uses,
for the same reason it uses one.

**Matching is by address and domain, done here.** Gmail is queried with
`{from:a to:a cc:a from:acme.com …} newer_than:365d`; Calendar is fetched for a window in one
request and filtered locally on attendee addresses, because the free-text `q` parameter's
tokenisation of an email is undocumented and one request beats one per term. Freemail
domains are never matched as a company. A contact is their address; a company is its
website's domain plus its people; an application is the company domain plus the people
attached to *that* application, not everyone at the company, because a second application
at the same employer has its own recruiter; a resume is its applications.

**`MEETING` joined `ScheduleKind`.** `listSchedule` merges matched Google events, so the
pipeline calendar and `list_schedule` show interviews the person accepted in their real
calendar. `listMatchedEvents` returns empty rather than throwing when nothing is connected
or granted, because "no Google" is not an error on a calendar.

**Tokens are plaintext, like McpConnection tokens.** There is no instance secret to wrap
them in that would not be a second required env var, and encrypting with the Google client
secret would kill every connection the day an admin rotated it. The trust boundary is the
database; the migration says so.

**No connect tool.** Consent happens in a browser. `get_google_connection` returns the URL
and says so, and the server briefing tells assistants to point at Settings rather than guess
at mail. `inbox_review` is a prompt, not a tool: it composes `list_correspondence`,
`get_email_thread` and the existing write tools, and its build text insists on a yes before
any of them.

**Applies to:** `prisma/schema.prisma`, `src/lib/{google,google-api}.ts`,
`src/lib/data/{google,pipeline,system}.ts`, `src/app/api/auth/google/`, `src/lib/mcp/{tools,handler}.ts`,
`src/server/actions.ts`, `src/components/google/`, `src/components/settings/google-panel.tsx`,
the four detail screens, the pipeline calendar, `tools/gen-tool-docs.mjs`, and the manual.

## 2026-09-02 — Google is a tile on Connections, not a tab

**One screen for both directions of wiring.** Assistants read and write the workspace;
Google is the workspace reading you. They were a tab apart for one release, and the
question a person brings to either is the same — what is connected, is it working, how do
I add or cut one — so they share a grid now: brand mark on a tile, a one-line status,
the whole tile is the button. The Google "G" lives in `CLIENT_MARKS` for that reason
even though it is not a client; a second map for one entry would be a second thing to
keep in step.

**A tile is a summary; the slide-over is the record.** The old row-with-accordion put
the URL, the nine client chips and the setup guide inline under each connection, which
made three connections a page of config snippets. Everything you can do to a
connection — reveal, copy, test, rename, re-pick the client, rotate, disconnect — is in a
Sheet opened from its tile, and picking a client to add is a Sheet too, with the marks
and taglines rather than a dropdown of names.

**Old addresses still work.** `?tab=google` is mapped to Connections with the Google
tile opened, and the OAuth callback lands on `?tab=connections&google=<code>` with the
tile opened the same way, so the outcome is in front of the person rather than a click
away. Every "Settings → Google" in tool descriptions, errors and the manual now reads
"Settings → Connections".

**Applies to:** `src/components/settings/{connections-panel,google-panel}.tsx`,
`src/lib/mcp/marks.ts`, `src/app/(app)/settings/page.tsx`, `src/app/api/auth/google/`,
and the copy in `src/lib/{data/google,mcp/tools,mcp/handler}.ts` and `docs/`.

---

## 2026-09-02 — Resumes is a tab on Me, and the tabs became addresses

**The rail is four items now: Dashboard, Me, CRM, Pipeline.** The resume grid moved to
`/me?tab=resumes`. A resume is a view of your own record rather than a separate filing
cabinet, and the grid was already the screen you land on expecting Me to be filled in.
Only the list moved: `/resumes/<id>` is a full-screen document editor and stays where it
is, so this is a list finding a better home, not a route family being rewritten.

**The four-area model did not change.** ME / RESUMES / PIPELINE / CRM is the tool and
concept model — `handler.ts`'s briefing, `docs/concepts/`, the README's areas — and it is
untouched. What moved is one nav entry. The manual's `app.mdx` is the page that describes
the rail, so that is the page that changed.

**Me's tabs had to stop being client state.** They were `defaultValue="roles"` with no URL
involvement, which is fine for four panels of facts and fatal the moment one of them owns
query parameters: the resume grid writes `?q=` and `?sort=` from its search box, and a URL
that names the query but not the tab sends the server back to Roles on the first
keystroke. Every trigger is now a `<Link>` under a `value={active}` Radix root — the URL is
the tab state, Back walks the tabs, and `/me?tab=notes` is linkable. Settings' `?tab=` is
the same pattern; this one additionally validates and falls back to Roles, because a tab
name arriving from a URL is input.

**Each panel loads only its own data, which the old page did not.** Me used to fetch
roles, notes, education, projects, skills, certifications and the profile on every visit
regardless of which tab you were looking at. Now the page fetches three counts for the tab
strip and the active panel fetches the rest. That is what makes the resume grid affordable
here at all: it is a join plus a rendered ResumePaper per card, and nobody editing a role
should pay for it. `ResumesPanel` is a server component for that reason and must stay one.

**A redirect, not a route.** `/resumes` → `/me?tab=resumes` sits in `next.config.ts`
beside the `/brain` → `/me` pair, matching the source exactly so `/resumes/<id>` is
untouched. Next merges the incoming query into the destination's, verified against a
running server: `/resumes?new=1` arrives as `/me?new=1&tab=resumes`, so the dashboard and
command-palette "New resume" links still open the dialog.

**`deleteResumeAction`'s redirect had to stay conditional and the revalidations moved.**
Every `revalidatePath("/resumes")` now names `/me`, which is the route that renders the
grid; a stale path revalidates nothing and the failure is invisible. Exercised in a real
browser rather than reasoned about: favourite persists across a reload, duplicate opens
the copy, and deleting from a card refreshes the grid in place while keeping `?tab` and
`?sort`.

**Both browser-test failures were the test.** Playwright's `getByRole` `name` matches
substrings, so "Favourite" also matched the "Unfavourite" of an already-starred card and
the assertion un-starred what it meant to star; and notes render as editable inputs, whose
values `innerText` does not see. Worth writing down because both look exactly like product
bugs in the output.

**Applies to:** `src/app/(app)/me/page.tsx`, `src/components/resume/resumes-panel.tsx`
(new), `src/app/(app)/resumes/page.tsx` (deleted), `next.config.ts`,
`src/components/shell.tsx`, `src/components/command-palette.tsx`, `src/app/(app)/page.tsx`,
`src/components/resume/resume-editor.tsx`, `src/server/actions.ts`, `docs/app.mdx`.

---

## 2026-09-03 — The three pages people see before they have an account

**The mark became an object, twice, without a 3D library.** `HiredMark3D`
(`src/components/hired-mark-3d.tsx`) for the app and the `.mark3d` block in
`site/styles.css` + `buildMark` in `site/motion.js` for the marketing site are the same
construction in two dialects: a stack of identical rounded squares, each a fraction of a
pixel further back on a `preserve-3d` stage, with the three bars floating above the face
as their own small slabs. Stacked slices rather than four rotated side walls because a
wall cannot follow the 23.4% corner radius; slices rather than three.js because this is
eight rectangles and a library is three hundred kilobytes. Geometry is the same 64-unit
grid the flat SVG uses, expressed as fractions, so one element scales from 24px in the
nav to 240px without a second rule.

**It has a resting tilt, and that is the whole trick.** Square-on, an extruded slab is a
rounded rectangle with a story about depth — the walls are hidden behind the face and no
amount of shading rescues it. `REST_Y = -24°`, `REST_X = 13°` and a depth of 0.24 × size
put about 7% of the tile's width of wall on screen before anything moves. Pointer tilt
adds to that rest rather than replacing it, so the mark never flattens out.

**`--mark-edge` is a third token because it cannot be derived.** The flat mark needs two
values and inverts on its own — tile is the ink, bars are cut out of it. A slab also has a
side, and the side of a near-black tile has to be *lighter* than its face while the side
of a near-white one has to be *darker*: the same lift, opposite directions. Two values,
one per theme (0.56 light, 0.52 dark), landed after four passes of screenshots; the first
three all failed the same way, with the wall washing out against the face it was meant to
separate from.

**The front door is allowed to be lit; nothing else is.** globals.css opens by saying
colour that isn't carrying information shouldn't be there, and that rule is about a tool
you work in for an hour. `/login`, `/setup` and `/invite/[token]` are looked at for four
seconds and are the first thing a self-hoster sees after `docker compose up`, so they get
`AuthShell`: a masked grid, three slow-drifting lights in the first three pipeline hues, a
plinth and a vignette. Four elements, all CSS, all flattened by the reduced-motion block
already at the top of the file. This is scoped to those three pages and should stay there.

**One `<main>` wrapper became `AuthShell` because there were three copies of it.** Same
reason the nav is lifted out of `index.html` by the site generator: two copies of a thing
drift the first time one is touched.

**The site's motion rules survived.** `site/motion.js` says nothing loops and nothing is
required to read the page, and both still hold. The 3D mark, the card spotlight and the
magnetic CTA are all pointer-reflections — no duration, no direction of their own, gone
when the cursor leaves — which is the same third category the hero's scroll-driven tilt
already occupied. The word-by-word headline plays once on entry and holds. And every one
of them hides nothing until the script has already built it: `.split` and `.on` are added
*after* the work, so a failed motion.js leaves a finished page rather than an invisible
headline. Keying those off the `js` class instead would have been one line shorter and
would have blanked the hero on any network that ate one file.

**`.req` was already taken.** The signup form's "required"/"optional" tags were `.req` and
`.opt` for about ten minutes, which quietly inherited the tour's requirement-chip styling
and drew a border around the word REQUIRED. They are `.flag` now. The one-line form's
`input[type=email]` carries `flex: 1 1 210px` for its row; the signup card's row is a
column, so it needed `flex: 0 0 auto` or the email field stretched to the height of the
card.

**/coming-soon/ is a signup, not an explanation.** It used to lead with "Hosting isn't
open yet" and then spend three paragraphs and a `docker compose` block talking the reader
into self-hosting instead — on the page the header's primary action leads to. It is now
name, address and one line about what you're chasing, posting to the same open
`/api/waitlist` the short form uses; the endpoint has taken `name` and `context` since it
was written and the site simply never sent them. `join.js` reads them with
`form.elements.namedItem`, not `form.name` — a `<form>` has its own `name` property, the
attribute, which shadows the field. Self-hosting is one ghost button to
docs.hired.tools/self-hosting/overview, which is a better place to make that argument than
the bottom of a signup page.

**The success sentence is the page's, not join.js's.** `data-said` on the form, with
`{email}` substituted, because the landing page's one-line form and the full signup are
answering different questions and one hard-coded sentence cannot do both.

**Generated pages animate now.** `shell()` in `tools/build-site.mjs` adds the `js` opt-in
and loads `motion.js`, so /coming-soon/ and the resources pages get the reveals and the
3D nav mark rather than being the one corner of the site that sits still.

**Verified in browsers, not reasoned about:** the app at 1280 and 390 wide in both themes
via Playwright against a real Postgres, the static site the same way, and the signup form
end to end with the POST intercepted — `{email, name, context, website}` goes out, the
answer renders, the fields are replaced. Then the same body against the live route on a
local instance, and the row read back out of `WaitlistSignup`.

**Applies to:** `src/components/{hired-mark-3d,auth-shell,login-form,setup-form,accept-invite-form}.tsx`,
`src/app/globals.css`, `src/app/{login,setup,invite/[token]}/page.tsx`,
`site/{index.html,styles.css,motion.js,join.js}`, `tools/build-site.mjs`.

---

## 2026-09-03 — A parity and vocabulary audit after the resume batch, the rename and Gmail

Ran the parity check over `src/server/actions.ts` against the tools array, and swept the
MCP surface and the manual for anything the last few features left inconsistent.

**`delete_note` did not exist, and notes are the one thing where that hurts.** Every other
collection has its delete tool; notes had list, create and update only, so the UI could
remove one and a conversation could not. The sharp version: a note with `kind: GUARDRAIL`
is a standing rule injected into the briefing *every* client receives on connect, so an
assistant could write a rule that shapes all future work and then had no way to withdraw
it. A note has no `archived` state either, unlike a highlight, so deletion is the only
removal — the description says so. Verified over a live connection: create a guardrail,
see it in `initialize`'s instructions, delete it, see it gone.

**The Me rename missed the `title` fields.** The merge that took the rename swept
descriptions and left "Import a resume into the brain" as `import_resume`'s title, plus
"the imported brain" in an argument and "career material in the brain" in
`get_setup_status`. Titles are user-visible — clients show them in approval UI, and
`gen-tool-docs` quotes them verbatim into the published manual, which is where they were
found. The lesson is mechanical: a vocabulary rename is `grep -in '<old word>'` over the
whole of `tools.ts`, not a pass over the fields you happen to be editing.

**The briefing had no line about tags.** They cut across every area — where an application
came from, a company's industry, size and location, how a person is filed — and an
assistant that never calls `list_tags` invents near-duplicate labels. `list_tags`' own
description is good; the briefing is what gets read *before* any tool, so the rule that
matters ("call list_tags first; a name that exists matches rather than twinning") belongs
there too. Its opening line also still said "Four areas:" above six bullets.

**A backtick inside the briefing template literal would have ended the string.** The tags
line was first written with `` `sources` `` in it, inside a JS template literal — caught
before commit, but it typechecks as a *different* program rather than failing, so nothing
downstream would have said so. Prose edited inside a template literal takes plain quotes.

**Own-account writes stay UI-only, deliberately.** `updateOwnAccountAction` (name, email),
`changeOwnPasswordAction` and unlinking a Google *sign-in* have no tools and should not:
a connection URL is a credential with full read and write over the workspace, and letting
it change the account's email or password turns a leaked URL into account takeover. Note
this is a different thing from `disconnect_google`, which drops the Gmail/Calendar grant
and does have a tool. `testConnectionAction` and the quick-log parser are also UI-only —
the parser exists precisely because the browser has no language model, and both halves of
what it commits are already covered by `log_activity` and `move_application_stage`.

**Everything else was already in step**, which is worth recording so the next audit can
skip it: the generated tool pages, the three hand-carried README counts (the Gmail commit
bumped them; `delete_note` moved them again to 104/134), `docs/app.mdx` after the resumes
move, and the product-facing `skills/` tree, which carries no retired vocabulary.

**Applies to:** `src/lib/mcp/tools.ts`, `src/lib/mcp/handler.ts`, `README.md`,
`docs/tools/{me,connections,overview}.mdx`.

---

## 2026-09-03 — The landing page, second pass

**The hero lost the mark it had just been given.** One page down it read as a logo asking
to be admired rather than a headline making an argument, and it pushed the transcript —
which is the actual evidence — below the fold on a laptop. The object stays in the nav,
where it is a label, and on /coming-soon/, where it is the only thing above the form.

**"What's in it" is one landscape card and three portrait ones, not four squares.** Two
plus two was tried first and the problem was structural, not aesthetic: in a row of two,
the taller card sets the height and the shorter one opens a hole under itself, and the
hole moved around as the text rewrapped. A full-width card has no neighbour to be
stretched by, and three cards with the same bullet count come out the same height on their
own. Me gets the big one because the other three are built out of it.

**Each card carries a diagram, animated off the card's own `.in`.** The reveal observer
already puts that class there, so four drawings cost no JavaScript and no second observer —
`.js .cell.in .viz i { scale: 1 1 }` is the whole mechanism. They are diagrams and not
screenshots on purpose: the tour below has the real screens at the width the app is used
at, and the same screenshot shrunk to 280px is illegible as a screenshot and useless as a
diagram. The pipeline card's moving card is drawn in the column it ends up in and animated
*from* where it was, which needs no measuring and no JS, and is the same trick the real
board plays on a drop.

**The conversation section shows a conversation, including the part where it is working.**
A screenshot of a chat can show a question and an answer; it cannot show the four seconds
in between, which is the only part that demonstrates anything is happening at all. So
`playTape` grew a `data-think` phase: the step shows a working state, the tool chips land
and go green one at a time, and only then is the reply typed.

**That working state is laid over the answer, not stacked above it.** Stacked, it added
its own height and the panel grew by eighty pixels the moment it appeared. `.answer` is
the shared box; the skeleton sits in the space the finished reply has already reserved.

**And the reply's height is now actually reserved.** `motion.js` has claimed since it was
written that emptying a line "does not hide the layout it occupies". It did: clearing
`textContent` collapses the box, so every tape grew a line at a time while somebody was
reading it and everything below walked down the page. It measures the finished line, holds
that height, then empties it — and measures again on `document.fonts.ready`, because Inter
is wider than the fallback and a height reserved against the wrong face is the wrong
height. Only for a tape that has not started; re-measuring one mid-type would throw away
what it had written.

**Two exceptions to "nothing loops", and both are the same exception.** The typing caret
already blinked forever and the file said why: it indicates something in progress and it
stops when that thing does. The thinking dots and the skeleton sweep are that, with an
iteration count so they run out even if the script that hides them never ran.

**Monthly and annual, with both figures in the markup.** The annual pair ships `hidden`
and the control ships `hidden`, so a page with no scripting is the monthly price and no
buttons that do nothing — the monthly figure being the one anybody comparing starts from.
`$120` a year is two months off, said on the button rather than in a footnote, and it
shrinks rather than disappears on a phone: a toggle with no stated benefit is a toggle
nobody presses. The figure is a placeholder in four places now — the card, the fine print,
the FAQ answer, and the FAQ answer again inside the FAQPage block — and they move together.

**`.tier .price span` was catching the price.** It styles the "/ month" beside the figure
at 13px and faint, and the figure had just become a span too. Ten minutes of a $12 that
looked like a footnote.

**The self-host band is gone and every link that pointed at it points at the manual.** It
was the answer to "what happens if you lose interest", which is a real question, but it
was a compose file three scrolls below a page whose primary action is a signup form. The
pricing card's free column still says the whole thing out loud; the argument for it belongs
at docs.hired.tools, which is written for someone who has already decided.

**Smoothed scrolling that keeps the real scroll position.** The usual implementation
translates a wrapper and leaves `scrollY` at zero. Three things on this page read
`scrollY` — the sticky tour chapters, the progress bar and two scroll timelines — and a
transformed wrapper breaks all of them, so this is `window.scrollTo` once a frame towards
a target the wheel moves. Frame-rate independent, or 120Hz arrives twice as fast. Left
alone: touch, because the platform's momentum is better than anything written here; a pane
with its own scrollbar; and precision devices, which already emit a smooth stream that
easing only adds lag to — a wheel delta under 40px in pixel mode is a trackpad and is not
touched. Anything that moves the page other than the wheel becomes the new target, or the
next notch yanks it back.

**Verified in a browser at 1360 and 390:** one notch eases 0 → 195 → 316 → … → 399 over
about four hundred milliseconds; a 12px delta is not intercepted and a 120px one is; the
nav's anchors still land (they take about 1.5s for thirteen thousand pixels, which is the
browser's own smooth scroll, not this); the billing switch swaps both the figure and the
terms; and every in-page anchor in the file still resolves to an id that exists.

**Applies to:** `site/{index.html,styles.css,motion.js}`, `tools/build-site.mjs`.

---

## 2026-09-03 — Why it exists, said without a filename

**`final_v3` was a joke for people who name files.** It was the headline of the section
that has to land first, and it asked the reader to already know what a version-suffixed
filename is. The section now says the asymmetry straight: *They keep a file on you. You
keep it all in your head.* The paragraph lost "req" for the same reason — that is recruiter
vocabulary, and the person reading this has never been on that side of it.

**The gap is now an object, because two objects at different depths is what reads as 3D.**
Their file sits back, thick and full and shut; yours sits in front, thin and half empty,
half of its lines never written. One `preserve-3d` stage, one card at `translateZ(-42px)`
and one at `+28px`, and the whole thing leans towards the pointer — so moving the cursor
slides them past each other. That parallax is the entire effect. An extrusion on a single
flat card reads as a drop shadow no matter how many layers it has; two things moving at
different rates read as a space with things in it, which is the thing the extruded mark
had to work much harder for.

**A card pushed towards the viewer is drawn larger.** The front file grew out of its own
column until the stage got padding. Obvious in hindsight, invisible until a screenshot at
1360 showed the corner clipped.

**Scrolling now behaves the same whatever you are holding.** The first pass exempted
precision devices on the theory that a trackpad is already smooth, and the result was a
page that felt different depending on the hardware — which is worse than either behaviour
on its own. One easing for everything, longer than before (0.115 a frame, about six hundred
milliseconds to settle), plus the keys that scroll, so a page turned with PageDown arrives
the way one turned with the wheel does. A field, a button or a `<summary>` keeps its own
idea of what a key means.

**The real cause of "not smooth" was probably not the easing.** A dozen elements answered
the pointer and each one attached its own `pointermove` and read a bounding box inside it.
A read after somebody else's write is a forced layout, so moving the mouse cost twelve of
them per event. They share one listener and one frame now — every rect read together, then
every style written together — which is one layout per frame however many things are
watching. That is the fix; the easing tune is the part you notice.

**The bento cards lean on `rotate`, not `transform`.** `transform` on those elements
already belongs to the reveal, and two owners of one property is a bug waiting for whoever
edits the other. The independent `rotate` property composes with it. The axis is
perpendicular to the direction of the cursor, which is what makes the card lean *towards*
it rather than pivot about an edge — and dead centre there is no direction at all, so a
zero-length axis has to be caught or the browser normalises it to something arbitrary.

**Two degrees, and an edge lit from where the cursor is.** More lean than that and a
paragraph starts to keystone. The edge is the standard masked-ring trick — a padded
pseudo-element, `mask-composite: exclude` — and at 1px and 62% it was invisible in a
screenshot; 1.5px and 92% is the difference between an effect and a rumour of one.

**The tool count on this page had gone stale, exactly as CLAUDE.md warns.** It said 73;
`tools/list` returns 104 for a member. Corrected by hand, which is the same thing that will
go wrong again — the generator owns every count in the manual but not the ones on the
landing page.

**Applies to:** `site/{index.html,styles.css,motion.js}`.

---

## 2026-09-03 — Half the landing page, deliberately

Measured before touching anything: **twelve sections, 16,300px, eighteen screens, 3,100
words.** A page that converts is six to eight screens and under a thousand. It now runs
**nine sections, 8,650px, 9.6 screens, 1,490 words** — half the height, half the words.

**The waste was not spread evenly; four sections said "here is what it does" four times.**
The bento named the four areas, `#app` showed one screenshot of them, the tour showed the
same four areas again at 4,379px and 904 words, and `#diagnosis` blew one feature up to a
full section. Together they were 47% of the page. The tour went entirely — it was the
single biggest thing on the page and it repeated what the section above it had just said —
and `#app` stayed, because a product page needs one real screenshot and its frame is
already a video slot waiting for a demo.

**`#connect` was setup documentation on a sales page.** Five client tabs and a config
blob, for a step nobody takes before signing up. The hero already says "works inside Claude
· ChatGPT · Cursor", which is the claim; the how belongs in the manual.

**The tool catalogue went, and that is the one cut worth arguing about.** Eighty tool names
with descriptions, kept by hand, already stale against the 104 `tools/list` actually
returns, written for whoever reads function names — which is not who this page is for. It
was behind a `<details>` so it cost no screens, but it was 350 lines of markup that had to
be right and never would be. One sentence and a link to the manual replaces it, and the
manual is generated, so it stays correct on its own. This also permanently kills the
stale-count problem the last entry predicted would come back.

**"Nothing on a resume is invented" kept its argument and lost two of its four exhibits.**
The refusal and the requirement check *show* it. The server-instructions code block and the
guardrails card *asserted* it a third and fourth time, and one of them put `handler.ts` on
the page.

**Open source is now in pricing and one FAQ answer.** It was in 24 places across six
sections. Gone: the "1 environment variable — DATABASE_URL" stat tile, the spec sheet at
the foot (`AGPL-3.0 · Next.js 15 · PostgreSQL · MCP Streamable HTTP…`, which was the last
thing a job seeker read), the "or skip the queue and run it yourself" note under the
closing form, and the Docker/terminal copy that left with `#connect`. What is left says it
where somebody is deciding what to pay: the free column, and the cost answer, which
absorbed the old "what if you stop caring" question because that is the only reason the
licence matters to somebody who will never clone it.

**Nine FAQ questions became five**, in the markup and in the FAQPage block together —
`build-site.mjs` fails the build when those disagree, which is exactly what that check is
for and the reason this was safe to do quickly.

**Dead code went with the sections.** Nine handlers in `motion.js` (`data-scene`,
`data-chapter`, `data-move`, `data-tabs`, `data-tab`, `data-pane`, `data-copy`,
`data-count`, `data-grow`) and about 9,000 characters of CSS for the tour, the catalogue,
the pipeline-board mock and the funnel charts. Every remaining `$$("[data-…]")` in
`motion.js` now matches an attribute that is still in the markup — that is the check worth
running after a cut this size, and it caught the last two dangling footer anchors too.

**The stat tiles went as a row, not one at a time.** Product-spec numbers — how many tools,
how many env vars — in the middle of the one emotional section on the page. "104 things it
can do on your say-so" is a sentence for somebody who has already decided.

**Applies to:** `site/{index.html,styles.css,motion.js}`.

---

## 2026-09-03 — The four bento drawings run

The drawings in "What's in it" played once on entry and then held. That made each one an
illustration of a thing rather than the thing happening, which is the only reason they are
on the page. They loop now: a line arrives in the record and a highlight is pulled out of
it, a resume's body re-tailors itself and the page count holds at one, a card walks the
four pipeline stages, and "due" moves down the three people in turn.

**This reverses `motion.js`'s own "nothing loops" rule, on purpose, and the reversal is
bounded three ways.** Written into the CSS header so the next person does not have to
reconstruct it:

1. **Every cycle starts and ends at rest** — the state the entry reveal leaves the drawing
   in. A paused cycle, a cycle that never starts and no cycle at all are the same picture,
   which is what makes the other two bounds cheap rather than load-bearing.
2. **Nothing runs off screen.** One `IntersectionObserver` toggles `.live` on
   `[data-live]`, so a phone reading the FAQ is compositing nothing. At 390px only one
   drawing is ever live, because they stack.
3. **`calm` never adds `.live`**, and a `prefers-reduced-motion` block is the belt to that
   pair of braces — it also puts back the one element the loop owns outright.

Everything animates `transform`, `scale` and `opacity` only, so all of it is on the
compositor. The four periods (9s, 10s, 11s, 12s) are deliberately not multiples of each
other, or the section falls into step with itself and starts reading as a metronome.

**Three bugs worth writing down, because each cost more than the feature did:**

**A property that first appears at 90% is interpolated from 0%.** `walk-the-board` set
`opacity: 0` at 90% to fade the traveller out, and the browser correctly read that as "fade
from 1 to 0 across the whole cycle" — a DOM probe measured 0.77, 0.32, 0.12, 0.04, 0.01. A
keyframed property has to be pinned at the frames where it should not be moving, not only
at the frames where it should.

**`.vz-trip` was an `<i>` and `.viz i` is a rule.** It inherited `height: 5px`,
`background: var(--rim)` and `scale: 0 1` and rendered as a thin grey line rather than a
card. Changed to a `<span>` with `display: block`. The `.viz` drawings use bare `i` and `b`
as their primitives, so anything added to one that is *not* a line or a label needs a
different element, not an override.

**The entry reveal and the loop fought over the same element.**
`.js .cell.in .viz i { scale: 1 1 }` beat the loop's own resting `scale: 0 1`, so the line
that is supposed to arrive was already there. It is now `i:not(.vz-fresh)`: an element a
loop owns outright has to be excluded from the entry stagger rather than fixed up
afterwards.

**Applies to:** `site/{index.html,styles.css,motion.js}`.

---

## 2026-09-03 — Delete becomes reversible, and the CRM lists grow up

Five asks in one batch: real filters and sorting on both CRM lists, multi-select with bulk
changes, an export per list, an archive that deleting goes through with a 30-day sweep, and a
per-view choice of which fields the pipeline shows.

**The archive covers three models, and that number is the design.** Company, Contact,
Application. Not resumes, not roles, not notes, not tasks, not tags, not saved views. The
reason is the one thing a soft delete cannot buy you: every read of an archivable model has
to exclude archived rows, and nothing in this toolchain catches one that forgets. I checked
whether a Prisma client extension could make it the default and it cannot — measured, not
assumed: an extension on `findMany`/`findFirst`/`count` works and the caller's own `where`
survives, but a nested `include` and a nested `_count` both come back unfiltered. That is
worse than no net at all, because it teaches you to stop checking exactly where it stops
working. So every read is explicit, seven deliberate exceptions carry a comment saying why,
and the scope stays small enough to audit by hand.

**`archiveKey`, not a partial unique index.** `Company @@unique([userId, name])` would have
let an archived "Stripe" block tracking a new job at Stripe. Postgres says that as
`CREATE UNIQUE INDEX … WHERE archived_at IS NULL`; Prisma cannot model one, so every future
`migrate dev` would offer to drop it as drift, and drift a tool offers to fix is worse than a
column. So: `""` while live, the row's own id once archived, and the constraint becomes
`(userId, name, archiveKey)`. Among live rows that is exactly the old constraint. Proven in
SQL before any code was written — archived Stripe, new live Stripe, second archived Stripe,
and a second LIVE Stripe still refused.

**`upsertCompanyByName` matches only live rows.** It could have resurrected the archived one,
and that reading is defensible, but it would mean tracking a new job at Stripe silently
un-deleting every application that went into the bin with the old record. Restoring the old
one afterwards is refused by name and points at `merge_companies`, which is the tool for
deciding what one record says.

**Two bugs a real database found that the compiler could not.** `writeCompanyTags` was
written and never called, so company tags were silently dropped on every write; and
`updateCompany` decided "no such company" from `updateMany`'s count, which is zero for a
patch that touches no columns — so saving only tags threw. Both are the same lesson the tags
entry already recorded: a write path with no round trip through a real database is a write
path nobody has run.

**Filtering moved out of the Prisma `where`.** A faceted count is "how many would survive if
I relaxed this one dimension", which only has an answer while you hold the unfiltered set.
Keeping the cut in SQL for the list and a predicate for the counts would have been two
definitions of one rule. It costs one full read of a personal-sized table. Two bugs fell out
of the rewrite: passing a company id alongside the `no-company` cut had the second `where`
assignment silently overwrite the first, and `ping-due` took a fresh `new Date()` inside the
query so a long list could answer differently for its first row and its last.

**Bulk tagging adds and removes; it does not replace.** Replace would mean "tag these nine as
fintech" stripping the size and location off all nine. And ids go through a kind allowlist
first: all four of a company's lists share one join table, so nothing at the database level
stops an APPLICATION tag landing on a company, where no screen renders it and no picker can
take it back off — one click across forty rows would write forty invisible, unremovable rows.

**`scheduleContactPings` validates its date rather than handing it to `toDate`.** `toDate`
returns null for anything it cannot read, so "next Tuesday" — a plausible thing for an
assistant to send — would have cleared the ping date on every person in the batch instead of
failing.

**The selection bar lives inside the list component.** The obvious split — server page renders
the table, client component renders the bar — breaks on the one path that matters: filter
down to no matches and the table subtree unmounts, taking the selection with it. The bar and
the empty state are now siblings inside one client component, and when what you ticked is off
screen it says so.

**The export always includes closed applications.** `listApplications` hides them by default,
and somebody exporting before a clear-out wants the rejections most of all — a file that
silently dropped them would look complete and be wrong at the only moment it mattered. CSV
cells beginning `=`, `+`, `-` or `@` are prefixed, because a note beginning "=2+2" is a
formula to Excel.

**The purge has no cron, and the entry should say so honestly.** There is no worker in this
app. `sweepArchive` runs at boot, at sign-in, from the MCP token resolver's existing
once-a-minute throttle, and `purgeExpiredFor` runs whenever somebody archives something — the
act that fills the bin trims it. It throttles through a Setting row rather than a process
timer, because the transport is stateless and may be more than one replica. The honest gap:
an instance nobody restarts, nobody signs into and nobody archives anything on purges
nothing. The direction is over-retention, never over-deletion, and the screen states each
row's own purge date rather than the header promising a guarantee the app cannot keep.

**Archived records read as gone by id, not just in lists.** `getCompany`, `getContact` and
`getApplication` return null for an archived row, so a bookmarked URL 404s. The alternative —
render the page with a banner and every control disabled — is a lot of surface for a state
whose one useful action (restore) is on a screen built for it. A clean not-found is what "I
deleted this" should look like.

**Field visibility is stored, and empty means the defaults.** Three `String[]` columns on
Profile. An empty list is "I have never chosen", which is what keeps every existing account
looking as it did and what makes a field added to a catalogue later appear for everybody;
meaning genuinely nothing needed its own sentinel. The view is a positional, enum-validated
argument rather than a key in a patch bag — through `pick` a mistyped view would have been
dropped and reported back as a success over a board that never moved.

**Applies to:** `prisma/schema.prisma` + `20250126000000_archive` + `20250127000000_pipeline_fields`,
`src/lib/data/{archive,export,pipeline,tags,me,resumes,pipeline-share,onboarding,users}.ts`,
`src/lib/{crm-filters,pipeline-fields,pipeline-list,settings,auth,bootstrap}.ts`,
`src/lib/mcp/{tools,handler}.ts`, `src/server/actions.ts`, `src/components/{archive,crm,filters,pipeline}/`,
`src/app/(app)/{archive,crm,applications}/`, `src/app/api/export/`, `tools/gen-tool-docs.mjs`,
and the manual.

## 2026-09-03 — What the adversarial pass found in the archive batch

A hundred and one agents read the batch above; nineteen findings survived three independent
skeptics each. The ones that changed the code, and why they were not obvious:

**A scoped empty of the bin destroyed rows it reported as untouched.** `Application.company`
is `ON DELETE CASCADE` at the database level. "Empty just the companies" deleted the company
rows and let the foreign key take their archived applications, then reported
`application: 0` — the one number somebody reads before agreeing to it. Now
`destroyArchivedCompanies` deletes those applications explicitly and counts them first, and
`purgeExpiredFor` and `sweepArchive` go through the same helper. The `none: { archivedAt:
null }` guard already stopped a LIVE application riding along; what was missing was honesty
about the archived ones.

There is one edge the foreign key does not let us out of: a company past its window whose
archived application is not yet past its own goes when the company goes. Every real path
archives the two together, so the application's window is never the later of the pair — the
only way to construct it is to edit `archivedAt` by hand. Measured, not assumed.

**Restoring one application woke every sibling.** An application under an archived company
cannot be drawn anywhere, so restoring one has to bring its company back too. It called the
same `restoreCompany` the company row uses, which also un-archives everything swept in with
it — so asking for one application back silently returned nine. `restoreCompany` now takes
`withApplications`, false on that path.

**"with 3 applications" promised more than the restore delivered.** The archive row counted
every archived application under a company; the restore only brings back the ones it swept in
(`archivedWith` set), leaving anything binned separately where the person put it. The count
is now filtered to match.

**A `$extends` query extension does not reach nested reads.** Measured against a real
Postgres, not inferred: the client extension covers top-level `findMany`/`findFirst`/`count`,
and silently does nothing for a nested `include` or a nested `_count`. That is the whole
reason this feature filters by hand in every read rather than globally, and the reason the
archivable set is three models — small enough to audit by hand, because nothing in the
toolchain catches a read that forgets. Three nested reads were still wrong and are fixed:
`listResumes` and `getResume` counted archived applications against a resume, and
`diagnoseSearch` counted archived transitions.

**Two descriptions promised behaviour the schema did not have.** `export_csv` said companies
and contacts take the same filters as the list tools while exposing only `kind`, `ids`,
`search` and `query` — a filtered request returned everything, which is worse than refusing.
And `ids` intersects with the other arguments rather than replacing them; the description now
says so, because the code's behaviour is the more predictable of the two. `get_pipeline_fields`
said stage is always drawn, one field away from an `available` list that returns stage as
optional on the calendar. A tool description that contradicts its own output is a bug.

**The archive screen printed the whole bin's count next to a filtered list.** Every other list
on the site prints what is on screen. With a search on, the archive printed the larger number.
It now says both.

**The row checkboxes on both CRM lists could not be clicked.** The stretched-link pattern
(`before:absolute before:inset-0` on the `<Link>`) paints its overlay over any sibling
earlier in DOM order — `relative` is not enough, it needs a stacking order. Found by driving a
real browser, then confirmed with `elementFromPoint` against the compiled CSS: before the fix
the element at the checkbox's centre is the `<a>`.

**Applies to:** `src/lib/data/{archive,resumes,pipeline}.ts`, `src/lib/{crm-filters,pipeline-fields}.ts`,
`src/lib/mcp/tools.ts`, `src/components/{archive,crm,pipeline}/`, `src/app/(app)/archive/page.tsx`,
and the manual.

## 2026-09-03 — Merging the archive batch across Gmail, Calendar and the Me rename

Main had moved a long way: Gmail and Calendar read live, the resume grid moved onto Me, and
the landing page was rebuilt twice. Five files conflicted, and all five were the same shape —
two branches both appending to a list.

**The conflicts were all bookkeeping.** The decision log takes both sides in date order.
`docs.json`, the generator's `SECTIONS` and the README's three hand-carried tool counts each
needed both entries rather than a winner; the counts came from running the generator after
the code merged, which is the only number worth trusting. `overview.mdx` took main's copy
wholesale because everything this branch changed in it sits between `generated:` markers.

**The merge's real work was the archive audit, and it found six.** Everything main added
compiled cleanly against this branch and was wrong at runtime: `list_correspondence` would
happily return the mail behind an archived company, person or application, and the calendar
matched attendees against archived companies and people. A stale id an assistant is still
holding is exactly how somebody reaches a deleted record, so these read like the bug the
archive exists to prevent. Six reads in `src/lib/data/google.ts` now filter — three subject
lookups, the resume's applications and their people, and both sides of the calendar match,
each reaching through its join where there is one.

This is the cost the archive was designed to have, and it landed on the first feature written
after it: nothing in the toolchain catches a read that forgets, so every merge with new reads
of Company, Contact or Application has to be audited by hand. A script that walks each
`db.<model>.<op>(...)` call expression and reports the ones with no archive predicate does
the mechanical half in a second; the seven it flags are the documented exceptions.

**The audit found one this branch had left too.** A tag's count — the number beside it in
every picker, and the "comes off N things" a person agrees to before deleting one — counted
archived rows. Measured on a real database: two, where one thing wore it. All three relations
are join tables, so each predicate reaches through the link. The two counts that stay
unfiltered now say why in a comment: `instanceStats` and the admin's per-account row counts
are an operator looking at what is on disk, and a row in somebody's archive is still on disk.

**Applies to:** `src/lib/data/{google,tags,users}.ts`, `.claude/DECISIONS.md`, `README.md`,
`docs/docs.json`, `docs/tools/overview.mdx`, `tools/gen-tool-docs.mjs`.

## 2026-09-03 — The parity and docs pass after the merge

A tool audit and a manual audit over the merged tree. Parity came back clean: 145 tools,
30 admin-only, every server action covered except four that are deliberately not.

**The four uncovered actions, and why three of them should stay that way.**
`loginAction`, `setupAction` and `acceptInviteAction` are how you get a connection in the
first place — a tool for them would be authenticating over a channel that is already
authenticated. `testConnectionAction` calls the server's own endpoint and counts what
answers, which over MCP is `tools/list`. `changeOwnPasswordAction` is the deliberate one: a
password typed into a chat is a password in a transcript. The one worth revisiting is
`updateOwnAccountAction` — `update_profile` writes the Profile row's email, which is the one
printed on a resume, and there is no tool for the User row's name and email, which is the one
you sign in with. Two fields called `email` that mean different things, and only one is
reachable by conversation. Left alone here because it is not this batch's, and noted so the
next person does not have to work it out again.

**The manual was stale in five places and the product skills in more.** The pipeline concepts
page still said `delete_company` refuses while applications point at it, and still said the
stage is never optional, one page after the calendar made it optional. Neither page said that
deleting an application archives it — the CRM page said it for companies and nothing said it
for the pipeline's own record. Me's "a highlight can be archived rather than deleted" now
collides with a screen called Archive, so it says which it means.

The product-facing skills in `skills/` mattered more than any of that, because they are what
a person's assistant actually loads. `hired` opened with "there is no draft copy and no undo",
which stopped being true the day the archive shipped, and its replace-versus-append table —
the whole reason the skill exists — had no row for the bulk tools, where the rule inverts.
`run-the-search` never mentioned that an ending is a stage rather than a deletion, which is
the confusion that costs somebody their funnel.

**The server briefing gained two rules of thumb, not a feature tour.** `handler.ts` is read
by every client before any tool call, so the bar for adding to it is a trap rather than a
capability. Two qualified: the bulk tools invert the replace rule that the briefing already
teaches, and `export_csv` is what "send me a spreadsheet" means. Field visibility did not —
it is a display preference, and a client that has to be told about it will find it in
`tools/list` anyway.

**Applies to:** `src/lib/mcp/handler.ts`, `skills/{hired,run-the-search}/SKILL.md`,
`docs/concepts/{pipeline,me}.mdx`, `docs/reference/{faq,security}.mdx`,
`docs/guides/what-to-say.mdx`, `docs/skills.mdx`.

## 2026-09-03 — Resizable columns, a filter you step into, and a library behind Connect

Five asks in one batch: an app library behind Connect with the settings screen reduced to a
status row, resizable columns on the pipeline table, the stage chips out of the toolbar,
a filter that does not make you scroll, and sorting and resizing on every list.

**Column widths are stored, not local.** The Fields menu set the precedent — a display
preference follows you between devices, a cut of the data lives in the URL — and a width you
set on a laptop that does not apply on a phone is the same broken promise. It costs a `Json`
column on Profile, a data function and two tools. `Json` rather than the `String[]` beside it
because this is a map with a number in it, and a parallel array of `"key:width"` strings is
the same thing with a parser bolted on. Prisma has no partial update for a Json column, so
the write is read-modify-write and the merge lives in `withWidths` — where the clamping is
too, so a tool and a drag handle cannot disagree about what 4000 means.

An absent list, or an absent column inside one, means that column's catalogue width. That is
what makes a column added later size itself, and what makes "reset" a delete rather than a
write of every default. Widths are clamped on the way in AND on the way out: the value in the
database was written by a client that may predate a narrower max.

**Only the fixed columns resize; the name column absorbs the rest.** Giving every column a
width means the table needs a horizontal scrollbar, which is a different design. So the
handle sits on the LEFT edge of each fixed column and widening one narrows the name, which is
the "divider between these two cells" a person expects.

**The snap-back was only findable in a browser.** `setColumnWidthsAction` deliberately does
not revalidate the route — the table already has the new width on screen. Clearing the local
override when the drag ended therefore reverted the column to the stale server value the
instant the pointer came up, and it corrected itself on the next navigation. Typecheck and
build were both clean through all of it. The local width now stands until a genuinely
different map arrives, compared by its serialised form because `stored` is a fresh literal
every render. Measured with Playwright: 188 → drag → 248 → reload → 248.

**The stage chips left the toolbar, which reverses an earlier entry.** They read well at five
stages and badly at ten: the widest row on the page, scrolling sideways on a phone, above a
board whose columns already are the stages. Stage is a dimension like tags or companies and
it lives in the Filter menu now, with the four endings as one "Closed" row because that is
how they are picked. Two chips stayed: Everything, and Needs a nudge — overdue is what the
dashboard leads with and what the tasks page is built around, and burying it three clicks
deep to tidy a row would have cost more than the row did. A line beside the chips names the
stages the menu is holding, because a narrowed board whose only explanation is a number on a
button is a board that looks broken.

**The filter menu is two levels, and search still spans both.** One flat scroller is fine at
three dimensions and unusable at seven — the dimensions, which are what you pick first, were
invisible headings between walls of rows. It opens on them now. The drill-down would have
made "I want the Fintech one and I don't care which list it is on" worse, so typing searches
every value in every dimension at once and keeps the headings, because a company called
Remote and a location called Remote are different rows that read identically.

`CommandEmpty` had to go with it: `shouldFilter={false}` makes cmdk count every rendered item,
and the "Clear these" row is one — so a search matching nothing showed a menu with one
unrelated row in it and no explanation.

**Sorting became a control as well as a heading.** Every one of these tables hides columns
below `md`, so on a phone half the sort keys had no heading to click and were unreachable.
The menu lists all of them at every width. The headings still sort; the two share one href
builder so they cannot disagree.

**The settings screen is a row, and Connect is a library.** Two labelled grids of the same
tile spent most of a screen restating that an assistant and an account are different kinds of
thing — a distinction that matters while you are adding one and nobody needs while reading.
So: one row per wired thing, saying whether it is on and whether it needs you, and a library
behind Connect with a tab each. The library lists everything, connected or not, and a row for
a client you already have opens it rather than making a second connection: "did I already add
Cursor?" is the question that screen exists to answer.

**Applies to:** `prisma/schema.prisma` + `20250128000000_column_widths`,
`src/lib/column-widths.ts`, `src/lib/data/me.ts`, `src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/lists/`, `src/components/filters/facet-menu.tsx`,
`src/components/{pipeline,crm,settings}/`, `src/app/(app)/{applications,crm}/`,
`tools/gen-tool-docs.mjs`, and the manual.

## 2026-09-04 — Two ratings out, a calendar in, and a task about anything

**Excitement and fit are dropped, not hidden.** Two 1-5 ratings on every application,
defaulted to 3, which made a pipeline of thirty into thirty threes — a number that looks like
data, sorts, filters and says nothing. They reached sixteen files each: a board field, a table
column, a filter ("Want it at least"), the `x` parameter in every saved view's query, the CSV
export, the shared pipeline's select, and four tool arguments. Hiding them would have left two
columns an assistant could still write that no screen shows, which is the kind of thing that
rots. The migration drops both; the rating widget went with them.

**Location and mode stay free text and gained a memory.** "Remote (US, PST overlap)" is a real
answer and no enum survives it, so the fields are still strings. What free text costs is
consistency — three spellings of Remote, none of which group — so the field now lists what is
already on your applications, most-used first with a count, and typing something new is still
just typing. Folding is case-insensitive with the first spelling winning, and archived
applications do not vote: a value only they carry is not a value you use. `list_field_values`
is the same list over MCP, and both write tools' argument descriptions now point at it.

**The calendar replaced every `input[type=date]`.** The native control was doing the job four
different ways — three segments in the browser's locale, a text box on Firefox for Linux, a
wheel on iOS — and printing "mm/dd/yyyy" in grey on every empty one, which in a column of
follow-up dates was louder than the dates actually set. react-day-picker 9, wrapped as given.

The subtle part is the string, not the widget: **these are civil dates, not instants.** A
follow-up on the 14th is the 14th wherever you open it, so `parseISODate`/`toISODate` split and
rebuild by local parts. `new Date("2026-03-14")` parses as UTC midnight and renders as the 13th
for anyone west of Greenwich, and a date picker that silently moves a date back a day is worse
than no date picker. Verified against a real database: clicking the 22nd stored
`2026-09-22 00:00:00`.

**An opened application has tabs.** Overview, Timeline, Posting, Notes — everything here is
about one application but not at the same moment, and stacked, the posting and the notes sat
three scrolls under the thing you came for. The details rail stays OUT of the tabs: stage,
follow-up and salary are the answer to "where is this", which is true on every tab.

**A task is about at most one thing, and the thing can be almost anything.** Five nullable
foreign keys beside the existing `applicationId` rather than a `subjectKind` + `subjectId`
pair. The pair has no referential integrity — delete a resume and the task points at an id
nothing resolves, forever, with nothing in the database to stop it. These cascade, which is
what `applicationId` already did and what a person expects.

Nothing in Postgres enforces "at most one": a CHECK across five columns is a constraint every
future subject has to remember to extend. `taskSubject` enforces it on the way in — refusing
two rather than guessing, checking ownership rather than trusting the foreign key, and
clearing the others when one is set — and `taskSubjectOf` takes the first it finds on the way
out, so a hand-written row can never render in two places.

`LIVE_TASK_PARENT` grew from one leg to three. Three of the six subjects are archivable, and
each needs BOTH legs of its own OR: a task about a company has `applicationId: null` and would
have sailed through a single-legged application filter. Measured: archiving a person hides its
two tasks and restoring brings them back, and deleting a note takes its task with it.

**Applies to:** `prisma/schema.prisma` + `20250129000000_drop_ratings` +
`20250130000000_task_subjects`, `src/lib/task-subject.ts`, `src/lib/data/pipeline.ts`,
`src/lib/mcp/tools.ts`, `src/server/actions.ts`, `src/components/ui/{calendar,date-field}.tsx`,
`src/components/{pipeline,tasks}/`, `src/app/(app)/{applications,tasks}/`, and the manual.

---

## 2026-09-04 — The front door is always light

`/login`, `/setup` and `/invite/[token]` no longer follow the app's theme. They are reached
from the marketing site, which is paper, and they are what a stranger sees before there is
a person here with a preference — a dark card at the end of a light page reads as a
different product. The theme inside the app is untouched: signing in lands you in whatever
you had set.

**Done as a class, not as `forcedTheme`.** `next-themes` decides the theme in an effect, so
a nested provider with `forcedTheme` paints the dark card for a frame and then flips. A
flash on the first screen a stranger sees is worse than the dark card would have been.
`.theme-light` on the shell is in the server-rendered HTML and applies on the first style
pass.

**The mechanism is that a custom property set on an element beats one inherited from an
ancestor, whatever that ancestor's selector.** So the light token block simply gained a
second and third selector — `:root, .theme-light, body:has(> .auth-field.theme-light)` —
and nothing is duplicated. This only works because the front door is written entirely in
tokens; the check that made it safe was that there is not one `dark:` utility anywhere in
`src/components/ui/` or on the three pages (the whole app has two, both in
`client-mark.tsx`).

**Three things a subtree of tokens does not cover, and they are the whole lesson:**

**`color`.** `body { color: var(--foreground) }` resolved before the subtree got a say, and
what inherits down is the answer, not the question — near-white ink on a paper card. Caught
by probing computed styles under `html.dark` and comparing against `html.light`; every
other value already matched. Any inherited property set from a token above the door has to
be re-stated on `.theme-light`. `color` is the only one in this file. `* { border-color }`
is not one, because a universal selector re-resolves at every element.

**`color-scheme`, and `accent-color` with it.** The browser paints its own furniture —
autofill, scrollbars, the "keep me signed in" checkbox — and would paint it for a dark page
behind light fields.

**The canvas.** A subtree cannot reach the element the browser paints the page background
from, so a rubber-band overscroll on a phone showed a near-black sliver above paper. Hence
the `body:has(> .auth-field.theme-light)` selector. The child combinator is deliberate: it
keeps this a cheap `:has()` for every other page, one the engine re-checks only when body's
own children change. If the tree above the door gains a wrapper this stops matching and the
overscroll gutter goes dark again — cosmetic, not broken.

**`@custom-variant dark` gained `:not(.theme-light *)`,** so a `dark:` utility added to the
door later cannot fire against light tokens. It changes nothing today and is the guard that
makes the class name honest.

**`themeColor` is per page now.** The root layout sets it from `prefers-color-scheme`, which
is right for every page that follows the theme and wrong for these three — a phone in dark
mode painted the bar above a paper page near-black, which is the exact seam the root
layout's own comment is about. `authViewport` is exported beside `AuthShell` and re-exported
by each of the three pages, because Next only reads that export from a page or a layout.

**Verified without a database.** There is no Postgres in the environment these sessions run
in, so the door was rendered from the compiled stylesheet and the real class strings, under
`html.dark` with the OS in dark mode, and probed: field, card ink, input, mark tokens and
aurora opacity all identical to the light-theme render. The same probe with the door removed
confirms body goes back to `oklch(0.165 …)` — the app is untouched.

**Applies to:** `src/app/globals.css`, `src/components/auth-shell.tsx`,
`src/app/{login,setup,invite/[token]}/page.tsx`.

---

## 2026-09-04 — The three emails got a design, and tables came back

An instance sends exactly three emails: the invitation (`inviteEmail`), the notice to the
owner when a stranger asks for access (`waitlistNoticeEmail`), and the test from
Admin → Configuration → Email (`testEmail`). All three shared one `shell()` of divs with
hex greys picked by hand and no relationship to the app. They now share a rebuilt one.

**Tables carry the layout now, which reverses the comment that used to sit above these
templates.** That comment said "plain, table-free HTML so it survives every mail client",
and it was aimed at the right goal by the wrong means: Outlook on Windows renders through
Word, Word has no `max-width`, so the centred `<div>` became full-bleed on the one client a
hiring manager is most likely to be reading an invitation in. The layout is now a centring
table plus an MSO ghost table, which is the boring standard answer. Everything inside is
still inline-styled — the tables are structure, not decoration.

**The palette is the app's tokens converted to hex, not new colours.** A mail client cannot
read `globals.css`, so `C` (light) and `D` (dark) in `email.ts` repeat `--canvas`, `--card`,
`--foreground`, `--muted-foreground`, `--faint`, `--border` and `--primary` as hex. The one
value that is not a straight conversion is the dark primary: `--primary` in `.dark` is
`oklch(0.65 0.17 252)`, which still disappears against a dark card at button size in mail,
so `D.primary` is lifted to `#4ea1f5`. If a token in `globals.css` moves, this block is the
thing that silently stops matching.

**The mark is drawn out of a table cell and three coloured strips.** Not an `<img>`: images
are off by default in a lot of inboxes and a broken-image icon where the logo goes is worse
than no logo. Not inline SVG: Gmail strips it. The geometry is the same 64-unit grid as
`hired-mark.tsx` scaled to 40px and rounded to whole pixels — bars 8/14/20 wide, 4 tall, 3
apart, 10 from the left, tile radius 9. Outlook drops the corner radii and gets square bars
in a square tile, which is still legibly the mark.

**No webfont.** Inter is named first in case it is installed locally, then the system stack.
Loading it from Google would tell a third party the moment an email was opened, and this
product already has a switch (`company_logos`) that exists because that trade is not ours to
make for someone.

**Dark mode is a `prefers-color-scheme` block over inline light values**, and the `html`
element is in it — without that, a short email leaves a light band under the content in
Apple Mail. Gmail forces its own inversion and ignores the query; the design survives it
because the surface is a near-neutral grey either way.

**This does not contradict the entry above about the front door being light.** A page can
decide it is paper; an email cannot. Apple Mail and Outlook invert a message whether or not
it asked to be inverted, so the choice is not light-or-dark, it is *a dark theme I designed*
or *a dark theme the client invents by flipping my greys*. Do not "fix" these templates to
match `/login` by deleting the media query — that only hands the decision to the client.

**`admin_send_test_email` now takes a `template`.** A design nobody can look at is a design
nobody checks, and the only way to see the invitation used to be to invite a real person —
which mints a token that *is* the credential for accepting. The tool (and the Send test row
in the admin UI, which reads the same `EMAIL_TEMPLATES` list) sends any of the three filled
with placeholder material, subject prefixed `[Sample]`, links pointing nowhere.
`EMAIL_TEMPLATES` lives in `email.ts`, which reaches the database, so the admin panel is a
client component that receives `{key, label}` as a prop rather than importing it.

**`tools/gen-tool-docs.mjs` evaluates each `inputSchema` expression with nothing else in
scope.** The `template` argument's description originally interpolated
`EMAIL_TEMPLATES.map(...)`; the generator died with `EMAIL_TEMPLATES is not defined`. Any
schema expression has to be self-contained — the helpers and literals only.

**Verified** by rendering all three to files and screenshotting them in Chromium at 700px
and 375px, light and dark. Typecheck and build clean, tool docs regenerated.

**Applies to:** `src/lib/email.ts`, `src/lib/mcp/tools.ts`, `src/server/actions.ts`,
`src/components/admin/configuration-panel.tsx`, `src/app/(app)/settings/admin/page.tsx`,
`docs/tools/admin.mdx`, `README.md`.

---

## 2026-09-04 — Tasks is the front door, Analytics is its own screen, and the funnel is a picture you can post

**The dashboard was the wrong front door.** You open this app to do the next thing, not to
read your own statistics — and a screen of numbers you click past every morning is a tax.
So `/` is the tasks page now and everything that was on the dashboard moved to
`/analytics`. `/tasks` stays as a redirect: it is in people's history, in the command
palette's muscle memory, and in two places the manual has been publishing.

**"Needs you now" became a bell in the top bar.** A card on one page only tells you what is
owed if you happen to be on that page. `dueNow(userId, withinDays = 0)` in
`src/lib/data/pipeline.ts` merges the three kinds of dated debt — an application's
follow-up, a person's ping, a task past its date — and the shell renders one count from it
on every screen. Deliberately *not* dismissable: an item leaves that list by being dealt
with, and a dismissable notification lets the bell go quiet while the work stays undone.
The rail's old follow-up badge on Pipeline is gone with it — two numbers in one chrome for
the same idea, with different scopes, is worse than one.

**`list_follow_ups` returns the tasks too**, so the bell and an assistant cannot disagree
about what is owed. It calls `dueNow` for that third list while keeping the rich
application and contact rows the two existing reads return. That is four queries where
three would do; the duplication buys one definition of "due" rather than two, and it is a
tool a person calls a few times a day, not a hot path.

**The Sankey is `reached` for arithmetic, `visited` for honesty.** An application that went
interview → offer has passed the final-round rung's depth, which is what makes the sums
close at every rung. Drawing a column for it would put "Final round 1" on a chart belonging
to somebody who never had one, and this chart's entire job is to be posted and read by
strangers. So `funnelFlows` returns both, and `sankeyLayout` skips a rung nobody entered.
The ribbon still joins: survivors leaving one kept rung equal the depth reached at the next
kept one, drawn or not.

**One emitter for the picture, and it is a string, not JSX.** Next refuses
`react-dom/server` anywhere in the app router — the build fails outright — so
`sankeyBody`/`sankeyDocument` in `src/lib/funnel-sankey.ts` build the markup as text and the
React component injects it with `dangerouslySetInnerHTML`. That is the *point*, not a
workaround: two emitters would be two pictures the day somebody edited one. Everything in
that string is a number counted from the database or a label from a fixed catalogue;
`esc` guards the day someone passes a `labelFor` that is neither. Do not reintroduce a JSX
copy of this markup.

**The one thing the page and the file differ on is ribbon opacity.** 34% of a colour reads
as a pastel on the white sheet and as mud on the app's near-black; the page passes
`flow: { spine: 0.5, exit: 0.32 }`. Geometry, words and numbers are identical.

**Tones are resolved hex, never `var(--…)`.** The headless Chromium that screenshots the
SVG loads no stylesheet of ours, so a CSS variable comes out black.

**`EXIT_LANE` exists because the last rung sat on top of its own exits.** Without 120px
reserved, the offer column landed at x=838 and the exit column at x=844 — the offer block
was hidden behind "Offer accepted", which is exactly the square somebody wants to see.
Found by rendering the PNG and looking at it; no assertion would have caught it.

**PNG degrades to SVG, and the route says 503 rather than 500.** Same posture as
`export_resume_pdf`: the request was fine, this host cannot serve it. `export_funnel_image`
reports `formats` so an assistant picks one that works instead of guessing.

**Verified** against a real Postgres — `dueNow` counts, the archive taking a task off the
bell with its parent application, the SVG's structure — plus a production `next start`
driven in Chromium (login, bell, analytics, the share menu, both themes), the three routes
fetched from inside the page (svg 200, png 200 image/png 41KB, gif 404 JSON), and all four
new/changed tools round-tripped over the real MCP transport. Seven unfiltered archivable
reads before and after, which is the documented set. Typecheck, build, `gen-tool-docs
--check` and `migrate diff --exit-code` all clean.

**Applies to:** `src/lib/data/pipeline.ts`, `src/lib/funnel-sankey.ts`,
`src/lib/funnel-image.ts`, `src/components/analytics/`, `src/components/notifications.tsx`,
`src/components/shell.tsx`, `src/components/command-palette.tsx`,
`src/app/(app)/page.tsx`, `src/app/(app)/analytics/page.tsx`, `src/app/(app)/tasks/page.tsx`,
`src/app/(app)/layout.tsx`, `src/app/api/funnel/[format]/route.ts`, `src/lib/mcp/tools.ts`,
`src/server/actions.ts`, `README.md`, `docs/app.mdx`, `docs/concepts/`.

---

## 2026-09-06 — Analytics is a tab on the front door, and the funnel is sized for a real search

**Two screens were one screen.** Today and Analytics are the same subject at two altitudes,
and a rail entry for the second made it a place you had to decide to visit. It is `?tab=`
on `/` now, matching Me and Settings: an address, so a tab can be linked to and Back walks
them. `/analytics` redirects. The rail lost its entry; the palette points at
`/?tab=analytics`.

**Each tab reads its own data, and the page reads almost none.** `AnalyticsPanel` takes a
`userId` rather than props, and the page only loads the profile and setup status when Today
is showing. That is the whole point of a tab strip built this way — the list is nine reads
and the funnel is five, and a page that loads both to show one costs as much as both.
**Share chart** moved onto the chart's own card for the same reason: in the page header it
needed an application count, which meant a second `pipelineStats` on every analytics load.

**The setup strip belongs to the Today tab, not to the page.** Three onboarding cards above
a tab strip pushed the chart under the fold on a screen that is meant to be a glance.

**The Sankey's labels had to be de-collided before it could shrink.** At `height=420` and a
handful of applications it looked fine; at `height=200` with a real search — 24
applications, nine departures — five labels landed on top of each other and the right-hand
side was unreadable. The cause was structural, not a matter of scale: each rung placed its
own exits knowing nothing about the others, which works only while every block is taller
than the 11.5px label beside it.

So `sankeyLayout` now collects every departure first and places the landing column in one
pass, top to bottom, with `MIN_EXIT_PITCH = 17` as the floor. Blocks keep their true
heights — a 1 must not look like a 3 — so what gives is the space beneath them, and the
drawing grows instead of overlapping. Ordering falls out of sorting by natural position: a
rung's exits occupy the band between its survivors and its total, so deeper rungs land
higher, which is what the eye expects. Do not go back to placing exits per rung.

**The page renders at `height=200`, the downloadable file at 460.** The file wants to be
big; the tab wants a band. Both went through the same de-collision and both were rendered
and looked at with 24 applications in.

**Verified** on a seeded real Postgres with a realistic search — 24 applications across
five rungs and nine departures — driven in a production `next start`: both tabs, the tab
links, the browser's Back button, the share menu in its new home, and `/api/funnel/png` at
200 (82KB). Typecheck, build and `gen-tool-docs --check` clean; seven unfiltered archivable
reads, the documented set.

**Applies to:** `src/app/(app)/page.tsx`, `src/app/(app)/analytics/page.tsx`,
`src/components/analytics/analytics-panel.tsx`, `src/components/analytics/funnel-sankey.tsx`,
`src/lib/funnel-sankey.ts`, `src/components/shell.tsx`,
`src/components/command-palette.tsx`, `src/server/actions.ts`, `README.md`,
`docs/app.mdx`, `docs/concepts/pipeline.mdx`.
## 2026-09-06 — A printed resume's margin belongs to the page box

**Every page after the first had no top margin, and page one ran to the sheet's edge.**
`resume-paper.tsx` carried the document's margin as `padding` on `.resume-paper` while
`globals.css` said `@page { margin: 0 }`. Padding on a box that fragments across pages is
sliced — that is what `box-decoration-break: slice`, the default, means — so page one keeps
the top of it, the last page keeps the bottom, and every page in between gets neither.

Measured out of this app's own PDF rather than argued, by inflating the content streams and
reading the text matrices: on a two-page resume at a 48px margin, page one's first text sat
61px from the sheet's top edge and page two's sat **12px** from it, while page one's last
line ran to within **23px** of the bottom. After the change both pages start 60–61px down.

**The margin moved to `@page`, which means it is emitted per document.** `@page` cannot read
a custom property and the margin is a per-resume setting, so `PageMarginStyle` renders one
rule and both printable routes — `/print/[id]` and the public `/r/[slug]` — use it. In print,
`.resume-paper` drops its padding and goes `width: auto`, filling a page box that is already
the sheet minus its margins; the content width is 720px at a 48px margin either way, which is
why **page one is unchanged**. Verified: first text at 61px before and after, and a
one-page resume still renders as exactly one page.

**`page.pdf()`'s explicit zero margin is gone.** With `preferCSSPageSize: true` Chromium
honours the CSS, and stating the margin in `pdf.ts` as well would be a second place for it to
be decided — which is how a PDF and a print page drift apart.

**`.rp-block { break-inside: avoid }` left `@media print`.** It is inert without a
fragmentation context, so nothing changes on screen. It moved because the editor is about to
measure the document inside a multi-column host, which *is* a fragmentation context, and the
rule that decides where pages break has to be the same one the printer reads.

**Applies to:** `src/app/globals.css`, `src/components/resume/page-margin-style.tsx` (new),
`src/app/print/[id]/page.tsx`, `src/app/r/[slug]/page.tsx`, `src/lib/pdf.ts`.

---

## 2026-09-06 — The editor measures its pages instead of estimating them

**The page badge could not have been right.** `estimateLines()` assumes ~110 characters to a
line and 46 lines to a page, and takes only the document — it never sees `fontSize`,
`lineHeight`, `pageMargin` or `template`, all four of which sit in the Design popover two
clicks from the badge. It was styled warning/success, so it looked authoritative while being
structurally blind to half its own inputs. The same document now reads 1, 2 or 3 pages
depending on those settings, and the editor agrees with the real PDF in all three cases.

**The browser does the fragmenting; this code only reads the result.** `PageMeasure` renders
a second, invisible copy of the document inside a multi-column box whose column is exactly
one page's content box. CSS fragmentation and paged fragmentation are the same machinery and
honour the same `break-inside: avoid`, so the column an element lands in is the page it
prints on. Checked against the real PDF, not assumed: 1/2/3 pages measured, 1/2/3 pages
printed. The naive `contentHeight / 1056` division does NOT work — it undercounts whenever an
entry is pushed whole, which is most documents past one page.

**It measures a copy, not the preview.** The preview lives inside `transform: scale()` and a
scaled element's rectangles are scaled with it, so measuring it would report a page height
that changed when you zoomed. The hidden host is never scaled. Its paper is rendered with
`pageMargin: 0` and the margin carried by the column size — the same arrangement the printed
page uses now that the margin lives on the page box.

**The break line is drawn where content actually breaks, not where the sheet ends.** Those
are different places, and the difference is the whole point: `break-inside: avoid` pushes an
entry that will not fit down whole, so the page before it ends early with slack. A rule ruled
across the geometric boundary cut through a paragraph that in fact prints intact. The line is
anchored to the element that opens the next page, found by its `data-rp` path and positioned
with `offsetTop` — a layout value, so it is unaffected by the zoom it sits inside.

**Section wrappers are never the element that "starts" a page.** A `<section>` holding five
jobs straddles every page it covers, so it is always the first rectangle on the page and
always a continuation. Naming it made every break read "splits here" and pointed at the
heading rather than at the entry you could actually move. The opener is now the first
fragment that *begins* on the page and is not a section wrapper.

**`data-rp` is positional, not id-based.** `resume-schema.ts` defaults every `id` to `""` and
`RESUME_DOC_SHAPE` never mentions ids, so a document written through `create_resume` — the
product's main path — carries empty ids throughout. Those were also being used as React keys
in the renderer; both now key on the index. Positional paths are total and collision-free.

**`estimateLines` stays, but only for the server.** `preview_resume_text` has no browser and
still needs an answer; its number remains an estimate and `export_resume_pdf` remains the
measured one. What went is the editor's duplicate `LINES_PER_PAGE`, which sat beside a comment
in `resume-text.ts` explaining that the constant lives there so the two cannot drift.

**Applies to:** `src/lib/resume-pagination.ts` (new), `src/lib/resume-measure-dom.ts` (new),
`src/components/resume/{page-measure,page-breaks}.tsx` (new),
`src/components/resume/{resume-paper,resume-editor}.tsx`, `src/app/globals.css`.

## 2026-09-06 — Telling someone their resume is two pages is not the useful part

The badge knew the page count and stopped there, which is the least useful moment to stop:
nobody is surprised their resume is two pages, they want it to be one. It is now a panel that
answers "what do I cut?" — what is on the last page in order, which sections could be hidden,
and the longest bullets, each with a button that removes it.

**Two sources, one for each half, and that is deliberate.** What is *on* the last page comes
from the measured layout, so it is exactly what will print. What is *worth cutting* comes from
`fitReport` in `src/lib/resume-fit.ts`, a pure function over the document with no DOM in it,
because `check_resume_fit` has to answer the same question on a server with no browser. The
tool's description says plainly that it ranks rather than measures and points at
`export_resume_pdf` for a real page count, so an assistant does not quote the estimate as
fact.

**Hiding a section is offered before deleting a bullet.** It is the biggest single lever and
the only reversible one — the content stays in the document. The delete button carries the
bullet's own words in its label, including for screen readers, because that button is
throwing away something the person actually did.

**Ranked by lines, not characters.** A 90-character bullet that wraps to two lines costs the
same as a 130-character one that also wraps to two; sorting by length puts the second first
and gains nothing when you cut it. `fitReport` sorts on estimated lines and shows the
character count only as a tiebreak.

**The measurement effect must not depend on the settings object.** Found by a click that
never landed: `PageMeasure` listed `settings` in its dependency array, the editor builds that
object fresh on every render, and `onLayout` sets state — so reporting a layout scheduled the
next measurement and the editor re-rendered at frame rate forever. Nothing looked broken (the
badge showed the right number, the breaks were in the right places) but Playwright could not
click the badge, which is how it surfaced. The effect now depends on the settings' *values*,
and reports once per pass rather than once per callback. Anything else that measures the DOM
and reports upward needs the same care.

**Applies to:** `src/lib/resume-fit.ts` (new), `src/components/resume/fit-panel.tsx` (new),
`src/lib/data/resumes.ts` (`resumeFitReport`), `src/lib/mcp/tools.ts` (`check_resume_fit`),
`src/components/resume/{page-measure,resume-editor}.tsx`.

## 2026-09-07 — Every section of an assistant-written resume shared one identity

`resume-schema.ts` defaults every `id` to `""` and `RESUME_DOC_SHAPE` never mentions ids, so
a document built by `create_resume` — the product's main path — arrived with `id: ""` on
every section and entry. The editor addressed sections by id. Reproduced rather than
reasoned about: create a two-section resume over MCP, open it, click the eye on the first
section, and **both** sections leave the page. `removeSection` filtered on the same
comparison, so "delete this section" deleted the document. React was also keying the list on
that value, so every section was key `""`.

**Healed in `parseResumeDoc`, not at the write.** The write path was the obvious place and it
is too late: a document is read, edited and only then saved, so the first edit happens while
the ids are still blank. `parseResumeDoc` is the one funnel both reads and writes pass
through — the fix applies before anything can act on a document, and the repaired ids persist
on its next save.

**Deterministic ids, not `rid()`.** `rid()` is random. Minted on read, a document would come
back from `get_resume` with different ids every call, and two parses of one stored document
would not be equal — which `compare_resumes` and every other read-parse-read path would have
to defend against. Blank ids take a positional name (`sec_0`, `exp_1_0`), so parsing twice
gives the same document. `claim()` also walks a name until it is free, so an id the document
already uses twice is separated rather than trusted.

**The editor now addresses sections by position anyway.** Ids are trustworthy after this, but
position is the one address that cannot be blank or repeated, and this is the exact code that
used to edit every section at once. Ids stay for React keys and for the drag reordering that
is coming.

**Applies to:** `src/lib/resume-schema.ts` (`ensureIds`), `src/components/resume/resume-editor.tsx`,
`src/lib/mcp/tools.ts` (`get_resume_format` guidance).

## 2026-09-07 — Reordering is a drag, and one call rather than a rewrite

Sections, the entries inside them and the bullets inside those all reorder by dragging now,
and `reorder_resume` does the same job over MCP. The two halves share `moveWithin` in
`src/lib/resume-reorder.ts`, so a drag, an arrow button and a tool call cannot disagree about
what moving something means.

**The tool exists because `update_resume` replaces.** "Put the Stripe job first" through
`update_resume` means reproducing the entire document from memory, and the failure mode is
losing a bullet nobody notices for a month. `reorder_resume` reads, moves one thing and
writes back. This closes a parity gap that predates it: the ⌃/⌄ buttons have always been
able to reorder and nothing over MCP could, short of a full rewrite.

**Named by whatever the caller has to hand.** `section`, `entry` and `bullet` each accept an
id, a name or a 1-based number, and an entry answers to *every* name it goes by — a job is
"Company 3" as readily as "Senior Engineer 3". Matching only the display label was the first
implementation, and it failed a request for the company with an error that did not even
contain the word. A miss now lists what is actually there, so an assistant can retry from the
error instead of falling back to `update_resume`.

**The deepest thing named is what moves.** One tool rather than three: give `section` and it
moves a section, add `entry` and the entry moves, add `bullet` and the bullet moves. A bullet
named without an entry is only unambiguous when the section holds one entry — otherwise it is
a question, and the tool asks it rather than guessing.

**Drag from a handle, not from the row.** Rows here are mostly text inputs, and a card you can
pick up anywhere is a card you cannot select text in. The handle is a real button, so the
keyboard gets the same power: tab, space, arrows. Three of these lists nest inside each other
and dnd-kit handled it without special-casing — verified in a browser that dragging an entry
does not also move its section.

**Applies to:** `src/lib/resume-reorder.ts` (new), `src/components/resume/sortable-list.tsx`
(new), `src/lib/data/resumes.ts` (`reorderResume`), `src/lib/mcp/tools.ts`
(`reorder_resume`), `src/components/resume/resume-editor.tsx` (its local `moveItem` is gone —
one implementation of a move, not two).

## 2026-09-08 — Undo, and the one place it must keep its hands off

The editor deletes a job in one click and reorders a document with one drag, and until now
neither had a way back. Undo and redo now sit beside the save indicator, answer to ⌘Z and
⇧⌘Z, and every destructive action also raises a toast that offers the exact previous
document back.

**Snapshots, not patches.** `src/hooks/use-history.ts` keeps whole values of
`{ doc, meta }` — the same object autosave already writes. There is no inverse operation to
write for each of the twenty ways a document can change, and no chance of the two drifting.
It costs a reference rather than a copy, because every mutation path in the editor already
builds a new object instead of mutating the old one.

**⌘Z inside a text field is the field's, not the document's.** A textarea has its own undo
stack and it is the right one while you are typing: taking back a sentence is what a person
means mid-sentence, not resurrecting the section they deleted a minute ago. The shortcut
checks the focused element and stands down for INPUT, TEXTAREA and anything
contenteditable. The toolbar buttons work from anywhere, so the capability is never
unreachable — which is also why they exist rather than leaving this keyboard-only and
invisible.

**Steps are coalesced by time, with an explicit override.** Changes closer together than
700ms fold into one step, so a typed sentence undoes as a sentence. That alone would merge a
delete that happened to land mid-sentence into the typing around it, so discrete acts —
delete, add, drag, toggle, the fit panel's cuts — pass `{ step: true }` and force a boundary.
The 700ms matches the autosave debounce deliberately: one undo step is about one saved
revision, which is the model a person already has from watching the indicator. The
alternative considered and rejected was inferring "structural vs text" from a shape
signature of the document; it gets reordering wrong (the shape is unchanged) and clever undo
is worse than predictable undo.

**A toast restores its own snapshot, not the top of the stack.** The toast names one thing
("Senior Engineer 3" removed) and its Undo puts back the document as it stood at that moment.
Popping the stack instead would undo whatever happened last, which after a few seconds is
often something else entirely.

**No MCP tool, and this is the exception's shape.** Undo is editor state, not data: there is
no stored history to reach for, and every document it restores is reachable through
`update_resume` and `reorder_resume` already. A conversational "undo that" would need
version history on `Resume` — a real feature, worth doing on its own terms, not smuggled in
as a side effect of a keyboard shortcut.

**Applies to:** `src/hooks/use-history.ts` (new), `src/components/resume/resume-editor.tsx`,
`src/components/resume/fit-panel.tsx` (its `onChange` now names what it cut).

## 2026-09-03 — Any mailbox: Microsoft 365, IMAP and CalDAV, behind one reader

**`GoogleAccount` became `LinkedAccount`, several per person.** A `provider` column
(GOOGLE, MICROSOFT, IMAP), provider-neutral `features` ("mail", "calendar") in place of
Google's scope URLs, and the IMAP and CalDAV fields on the same row. The migration renames
rather than recreates, so a Google connection made on the previous release survives with
its scopes rewritten. Unique on (userId, provider, email) rather than userId, because a work
Outlook and a personal Gmail are both where recruiters write, and every read merges across
them with the account named on each thread and event.

**One interface, three wire protocols.** `src/lib/accounts/types.ts` defines `MailReader`
and `CalendarReader`; `google.ts`, `microsoft.ts`, `imap.ts` and `caldav.ts` implement them
and nothing else in the app knows which answered. Read-only is enforced by the interface
having no write, not by convention. The data layer resolves credentials — refreshing OAuth
tokens, keeping Microsoft's rotated refresh token — and collects per-account failures into
`warnings` so one dead token never hides the other inbox.

**Two libraries, on purpose, for the protocols nobody should hand-roll.** Google and
Microsoft are six HTTP requests each and stay hand-written. IMAP is a stateful protocol with
thirty years of server quirks and MIME is worse, so `imapflow` and `mailparser` do that;
CalDAV discovery differs per server and ICS recurrence is its own specification, so `tsdav`
and `ical.js` do those. They are the largest dependencies in the app and load only when an
IMAP account is read. Threads on IMAP are joined by Message-ID and In-Reply-To, which is
what every mail client does; a reply whose client dropped the header is its own thread.

**App passwords, verified before they are stored.** `connectImapAccount` logs in to both
servers first, so a wrong password is an error in the form rather than a broken tile.
Stored as issued, like every other credential here. `connect_imap_account` exists as a tool
because MCP-first means it must, and its description says never to repeat the password.

**A hostname in a form is a request the server makes.** `assertReachableHost` refuses
loopback, link-local (where cloud metadata lives), unspecified and multicast targets for
both IMAP and CalDAV, resolving names so an A record at 127.0.0.1 is refused like the
literal. Private ranges are allowed on purpose: a mail server on a home LAN is a real
reason to self-host, and loopback and metadata are where the damage is.

**No SMTP.** The app never sends on anyone's behalf; read-only is what makes handing over an
inbox safe. Sending is a product decision to make on purpose, not a side effect of "support
IMAP".

**Slack and Discord are on the picker as coming soon**, greyed, because the user asked for
them to be visible before they exist. Nothing behind them yet.

**Applies to:** `prisma/schema.prisma`, `src/lib/accounts/`, `src/lib/data/accounts.ts`
(replacing `data/google.ts`), `src/lib/settings.ts`, `src/app/api/auth/microsoft/`,
`src/lib/mcp/{tools,handler}.ts`, `src/server/actions.ts`, `src/components/settings/`,
`src/components/admin/configuration-panel.tsx`, and the manual.

## 2026-09-08 — The import review step showed a count where the content should have been

The paste-and-correct dialog let you fix a job's company, title and dates, and then said
"5 bullets" — a number, for the part of the document that is actually the document. The
bullets are also the parser's shakiest output, so the one thing it most needed checked was
the one thing it would not show. They are editable fields now, add and remove included, and
what you leave is exactly what gets saved.

**Doubts belong on the field, not in a list at the top.** The parser now emits
`notes: { path, message }[]` alongside its document-level `warnings`, keyed by where the
doubt is — `roles.2.company`, `roles.0.bullets`. "Check the employer on one of these" is a
warning you go hunting with; the same sentence under the input is one you act on. The
document-level list stays for things with no field to point at: no name, no jobs recognised,
lines that could not be placed.

**Two parser defects the review step existed to catch, and did not.**

*Employer and title were decided by position.* `splitTitleAndCompany` read "A — B" as title
then company, so every resume written "Stripe — Staff Engineer" filed the career under
employers named after job titles. Now `pickTitleAndCompany` asks which half reads like a job:
when exactly one does, that settles it and no doubt is raised; when neither or both do, order
decides and the field says it guessed. "X at Y" was already unambiguous and stays untouched.

*A resume with no bullet marks produced no bullets at all.* Every non-marked line became a
"header line", of which only the first two were ever used, so the rest survived only in the
role's background. Sentences left over after the header now become the bullets — filtered to
lines with no date range and at least six words, so a location line does not become a claim —
and the field says they were read that way. Only when nothing at all was marked: mixing
marked and unmarked lines is how one wrapped bullet becomes two.

**Applies to:** `src/lib/resume-parse.ts`, `src/components/me/import-dialog.tsx`. No tool
changed — `import_resume` already takes bullets, and the heuristic parser is the browser's
fallback for someone who has connected nothing, never a path an assistant takes.

---

## 2026-09-08 — A welcome tour, because most people arriving have never tracked a job search

**The audience does not know the words.** Board, pipeline, stage, CRM — every screen in
this app assumes a vocabulary that most people looking for a job have never used. The setup
strip told them what to *do* and nothing about what any of it *was*, and its first step was
"copy your private connection URL and add it as a custom connector", which is where a
non-technical person closes the tab.

So: a five-card tour that opens over whatever screen you land on. One picture and one
sentence a card, teaching four words — board, Today, Me, assistant. No forms, no accounts to
link, no decisions. If a card ever needs a paragraph, the app needs fixing, not the
paragraph.

**Skippable from the first frame, and closing counts.** Skip, the X, Escape and the overlay
all write `tourSeenAt` — one write for finishing and for leaving, because somebody who
closed it on card two has decided, and asking again tomorrow is the behaviour everyone
hates. That is only safe because it is recoverable: Settings → Account → Show it again, and
`restart_tour` over MCP for the person who says out loud that they are lost.

**Only half of it is a tool, deliberately.** `restart_tour` exists because "show me that
again" is a real request. Marking it seen has no tool and should not get one: it is a person
closing a dialog in their own browser, which is the direct-manipulation exception rather
than a parity gap. `get_setup_status` reports `tourSeenAt` instead, and a null there is a
strong hint to an assistant that it is talking to somebody who has not been shown around.

**The pictures are rectangles, not screenshots.** A screenshot is stale within a release,
and a person who has never seen the app cannot tell a stale one from a current one. Each
drawing is the *shape* of the screen it stands for — four columns and a card moving right,
a list with a due chip, a pile of text becoming one page — recognisable from across the
room and immune to the real screen moving.

**`w-auto` on the art pushed the dialog off the side of a phone.** A 220×110 viewBox in a
176px-tall box asks for 352px of width; plus padding that is wider than a 390px screen, and
the buttons were clipped. Fitting to the box in both directions letterboxes instead. Found
by driving a 390px viewport — nothing about the desktop render hinted at it.

**The setup strip changed order and voice.** Easiest first: a job on the board (needs
nothing), then the resume paste, then connecting an assistant — the most powerful step and
the one most likely to stop somebody, so it is no longer standing between them and their
first useful minute. Its copy lost "MCP", "custom connector" and "the pipeline".

**Skipping is per person, and every existing account gets the tour once.** `tourSeenAt` is
nullable on Profile with no backfill, which is the right default for a feature whose whole
job is to explain what the app is.

**Verified** against a real Postgres with the migration applied: the five cards walked end
to end, gone after finishing, still gone after a reload, back from Settings, back from
`restart_tour` over the real MCP transport, and Escape counted as seen. Separately on a
brand-new account with no Profile row at all (the upsert's create branch) at 390px wide, and
`get_setup_status` reporting `tourSeenAt` both ways. Typecheck, build, `gen-tool-docs
--check` and `migrate diff --exit-code` clean; seven unfiltered archivable reads, the
documented set.

**Applies to:** `prisma/schema.prisma`,
`prisma/migrations/20250131000000_welcome_tour/`, `src/lib/data/onboarding.ts`,
`src/components/onboarding/welcome-tour.tsx`, `src/components/dashboard/setup-strip.tsx`,
`src/components/settings/account-panel.tsx`, `src/app/(app)/layout.tsx`,
`src/lib/mcp/tools.ts`, `src/server/actions.ts`, `README.md`, `docs/app.mdx`.

---

## 2026-09-08 — What a screen says when there is nothing on it, and what Settings shows first

Walking the app as a genuinely empty account — a real user with a real login and no
data — turned up three screens that told a beginner nothing, and one that told them far
too much.

**The empty pipeline drew seven columns saying "Empty" under eight controls that all did
nothing**: a filter menu with nothing to filter, an export with nothing to export, a share
link to an empty board. It is the screen the welcome tour has just promised, and it read as
a broken one. A workspace with nothing tracked now gets one sentence and one button.

**"Nothing tracked" and "the filter matched nothing" look identical and are not.** The
second still needs the whole toolbar, because that is how you undo the filter — so the
first-run state is gated on `everyApplication.length === 0 && !hasAnyFilter(filters)`, never
on the visible rows. Archiving the last application lands in the same branch, so the archive
note stays under it and there is still a way back.

**Me's roles tab had the words and no button.** Getting in meant noticing a small Import in
the top corner. It offers both paths now and leads with pasting a resume, which takes a
minute rather than an afternoon. They are links to `?import=1` and `?new=role`, which the
page's own dialogs already open — the same thing the setup strip links to, rather than a
second copy of a dialog.

**Settings → Connections is where "let Claude do the typing" sends somebody, and the
skills panel dwarfed it.** Three files' worth of `~/.claude/skills/<name>/SKILL.md`, zip
uploads and folder paths, open by default, above the fold — while the actual task was one
quiet row that looked like a status line. The skills are folded into a `<details>` now (a
server component, so no state, and the content stays in the page for ⌘F), and a workspace
where nothing has ever called in gets one line saying what connecting buys and a button
that opens the panel. The instructions inside that panel were always good; the problem was
only ever reaching them.

**Verified** in a browser against a real Postgres on a genuinely empty account: the three
empty screens, both buttons opening their dialogs, the nudge opening the setup panel, the
skills opening on click — plus the two cases that must NOT change, a filter matching nothing
(toolbar kept, first-run state suppressed) and a workspace with data (board unchanged), and
the nudge correctly absent once something has connected.

**Applies to:** `src/app/(app)/applications/page.tsx`, `src/components/me/roles-panel.tsx`,
`src/components/settings/skills-panel.tsx`,
`src/components/settings/connections-panel.tsx`, `docs/app.mdx`.

## 2026-09-08 — The preview was a picture; now it is an index into the form

Clicking a line on the paper opens the card that holds it and focuses the field that produced
it. The editor's most tedious minute was scrolling a long form looking for the input behind
the line you were staring at.

**Nothing new had to be invented for this.** `data-rp` was put on every block so the
pagination code could say which entry starts a page, and `parsePath` already decodes it. The
preview was already an index into the document; it just was not wired to anything. Features
that fall out of an existing structure this cheaply are a sign the structure was right.

**The rail flattens the paper's addressing, deliberately.** The paper distinguishes an
education entry (`d`) from a job (`e`) from a project (`p`) because pagination cares what
kind of thing straddles a page. A form field does not: the rail marks everything
`s{section}/e{entry}`, and a click on `s1/d0` focuses `s1/e0`. Two schemes, one translation,
done once in the editor's effect rather than at each of the eight call sites.

**Opening is a signal, not a controlled prop.** `Collapsible` takes an `openSignal` number
that means "someone asked you to open", rather than becoming fully controlled. Full control
would have meant lifting every card's open state into the editor for a feature that only ever
pushes one way. A changing number rather than a boolean, so clicking the same line twice
works after you have closed the card by hand.

**Frames, not a delay.** The card animates open over 220ms, so the field does not exist when
the click handler runs. The effect polls up to 24 frames for `[data-field]` and then gives
up, rather than sleeping a guessed interval — and giving up matters, because some blocks on
the paper have no input behind them at all.

**The affordance is CSS with `:has()`.** Blocks nest — a bullet inside a job inside a section
— so a plain `:hover` outline lit up three boxes at once. `[data-rp]:hover:not(:has([data-rp]:hover))`
picks the innermost one under the pointer. Scoped to `.rp-pick`, which only the editor sets:
the print page and the public link are documents, not controls.

**Applies to:** `src/components/resume/resume-editor.tsx`, `src/app/globals.css`. No tool and
no data change — this is the direct-manipulation exception, and every field it focuses is one
`update_resume` already writes.
