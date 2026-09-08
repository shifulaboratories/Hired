# Hired

An applicant tracking system, for applicants.

Every company you apply to runs one. Theirs keeps a record on you, scores what you sent and
decides what happens next. This one keeps the record on them — a record of your career, a resume
builder and a job-search CRM in one app you host yourself, wired into Claude so you can
just *talk* to it.

- **Me** — dump everything you know about every job you've had. No length limit, no
  structure required. Numbers, projects, stories, praise, screw-ups. This is the raw
  material every resume gets built from.
- **Resumes** — tailored documents assembled from that material. Defaults to the Harvard
  OCS format; four other templates, live preview, real PDF export, and a shareable link for
  the application forms that want a URL instead of a file.
- **Pipeline** — stages, activity timeline, tasks, and follow-up dates that schedule
  themselves. A toolbar across the top picks the view — a drag-and-drop board, a sortable
  table, or a month calendar of everything that has a date on it — plus the cut and a search.
  Filters combine — all of them, with each other: "screening and interviewing", "screening
  but only the overdue ones", "everything from a referral that has sat a fortnight". Stage
  chips are the fast lane and the rest live behind one button, counted against what the
  other filters left. A cut worth keeping gets saved under a name. The table edits in place: stage,
  follow-up, salary and location are the cells themselves, a Waiting column counts days in
  the current stage and a Quiet column counts days since anything was logged — the second
  is the one to chase on — and selecting rows closes a batch out in one action.
  Applications end as accepted, rejected, withdrawn or ghosted — silence is the most common
  ending, and filing it as a rejection makes the funnel lie about what went wrong. An
  application carries tags — several at once, because a job board posting, a referral and a
  LinkedIn message are often the same job — and a listing is optional: a role you're only
  chasing through a DM is still worth a card. Opening
  an application slides it in from the right, so you keep your place on the board. A
  read-only link shares the board with whoever is helping you — a friend, a coach, a former
  manager — showing companies, roles, stages and follow-up dates, and never your salaries,
  notes, contacts or job descriptions.
- **Nothing is deleted by accident** — pressing Delete on a company, a person or an
  application puts it in an archive rather than destroying it. It leaves every list, board,
  picker, filter and count immediately, and waits thirty days — an instance setting, or zero
  to keep everything — before it is deleted for good. Archiving a company takes its
  applications with it and brings exactly those back on restore, leaving one you binned
  separately where you put it; the people stay, because somebody is a founder at one company
  and an advisor at another. Every delete offers an Undo, each list says when that kind has
  something in the bin, and the two acts that really do destroy something can only reach what
  is already in there — so nothing in this app can be destroyed in one step.
- **Today** — everything you owe, and it is the first thing the app opens to. The things you
  wrote down, grouped by overdue, today, the next seven days, later and no date, each
  rewordable and re-datable in place and attachable to the role it's about; and beside them
  the chase list, the follow-ups and pings whose dates have come round, where the verbs are
  "logged it" and "push it out three days". Ticking a task and logging a chase mean different
  things, so they don't share a column. On every other screen a bell in the top bar carries
  one number — follow-ups due, pings due, tasks past their date — and opens them grouped.
  Nothing in it can be dismissed: a thing leaves that list by being dealt with.
- **Analytics** — the second tab on that same page, because it is the same subject at a
  different altitude: one click away, never in the way of the list. The funnel drawn as a
  flow chart: applications enter on the left, the survivors carry across to the phone screen, the interview, the
  final round and the offer, and everything that leaves peels off to where it went —
  rejected, no response, withdrew, offer accepted, still going. A rejection after two
  interviews leaks out of the interview rung, not the applied one, because progress is
  measured by how far it actually got. **Share chart** hands it to you as a PNG or an SVG
  with no company, role or person named anywhere on it — only the shape — which is what
  makes it the one thing here that is safe to post. Under it: response rate, what is in
  flight, the diagnosis of which step is losing people, and recent activity.
- **People** — companies and the people at them, as records you can visit. (The rail says
  People; the address is still `/crm`.) A company page holds
  their website, whatever you have learned about them, and their industries, sizes and
  locations as labels rather than text boxes — a company is plausibly both fintech and
  infrastructure, and hiring in two cities — alongside every application and every contact
  you have there. The website is what puts their logo on the pipeline. Their roles read as
  job listings, each one a click from the posting it came from. The company list says when
  you last applied and what's still live, and both lists filter — to the companies where you
  know someone, to the people whose ping is due — while the search box matches any label.
  Both lists filter properly now: industry, size, location and tags on companies, tags,
  company and how long since you logged anything on people, plus the gaps worth fixing in one
  sitting ("no website", "no email", "filed under nothing"). The Filter button opens on the
  dimensions rather than on every value at once — pick Industry, then pick from industries —
  and typing searches across all of them together. Dimensions AND with each other and OR
  inside themselves, every count is counted against what the other filters left, and every
  column that has an answer sorts, from its heading or from a Sort control that still works
  on a phone. Drag the divider between two columns to set their widths, which follow you
  between devices. Tick rows to tag a batch, put a batch on the chase list, delete a batch,
  or export just those; each list exports to CSV on its own, honouring whatever you have
  narrowed it to.
  Contacts attach to applications straight from the CRM rather than being retyped, and
  removing one from an application never deletes the person. A person keeps every way you
  can reach them — LinkedIn, X, Instagram, GitHub, their own site, and anything else you
  paste — each wearing its own platform's mark, because the address that matters is
  whichever one they actually answer on.
- **Tags** — one catalogue behind all of it. A tag is a name and a colour you own, and every
  list that used to be free text is one: where an application came from, a company's
  industry, size and location, how you know a person. Tick to attach, type to create,
  recolour from the swatch row, delete outright — deleting says how many things it comes off
  before it does it. Names fold case, so `linkedin` lands on the `LinkedIn` you already
  have rather than minting a twin.
- **AI connections** — every person gets their own URL that turns all of the above into
  126 tools any MCP client can call (158 if you're an admin). Claude, Claude Code, ChatGPT,
  Cursor, VS Code and Windsurf all have one-paste setup built into the app.
- **It explains itself** — a short tour opens the first time you sign in: what the board is,
  what Today is for, what Me holds, one picture and one sentence each. Skip it in a click if
  you have run a search before; it never asks twice. Settings → Account brings it back, and
  so does asking a connected assistant. Under it, three cards track the only three things a
  new workspace needs — a job on the board, your history on file, an assistant connected —
  and tick themselves off from what is actually there.
- **Multi-user** — invite whoever you like. Each person gets a completely private workspace;
  admins manage accounts but never see anyone's career history, resumes or applications. Admin lives
  under Settings → Admin: invitations, accounts, per-workspace usage, a password reset for
  whoever is locked out, and a log of every administrative change — including changes to how
  the instance itself is configured, so clearing the Resend key is traceable rather than a
  mystery three weeks later. Secrets are recorded as having been set, never as their value.
  Click any name for that
  account on one page — when they joined, who invited them, whether that invitation email
  actually left, which assistants they have connected, and everything the instance recorded
  against their address. It is the page you open when somebody emails asking why they can't
  get in, and there is no way from it into their career history, resumes or applications.
- **You can tell when it breaks** — Settings → Admin → Health checks the database, whether
  every migration finished, whether the last invite email actually left, and whether Stripe
  is still calling the webhook, then lists what has failed in the last thirty days. Ask an
  assistant for `admin_health` and you get the same answer without opening a browser.
- **Your inbox and calendar, on the record** — connect your own mail and calendar under
  Settings → Connections — Google, Microsoft 365, or anything that speaks IMAP and CalDAV,
  and more than one if recruiters write to more than one — and every contact, company and
  application shows the real threads and meetings behind it, under the timeline of what you
  logged. Interviews you accepted in your real calendar land on the pipeline's calendar view.
  Read-only and live: nothing from any account is copied to the server, and an assistant
  asked where an application stands reads the recruiter's reply instead of guessing from a
  stage.
- **Sign in how you like** — email and password always work, and an instance that adds a
  Google OAuth client gets a Continue with Google button as well. Google never bypasses an
  invitation: it signs in people who already have an account or an unexpired invite, and
  turns everyone else away unless an admin has deliberately opened sign-up.
- **Hard to guess at** — sign-in attempts are counted per account and per address, and an
  account stops answering after eight wrong passwords in fifteen minutes. Passwords are
  scrypt hashes, sessions are httpOnly cookies you can decline to keep past the browser
  window, and admins cannot reset each other or the owner — the code being public is not
  the same as the door being open.

> "Here's everything I did at Vertex last quarter — file it."
> "Tailor my resume to this posting."
> "What do I need to follow up on this week?"

---

## Get it

Two ways in. Both are the full product.

**Hosted** — [hired.tools](https://hired.tools). I run an instance at
app.hired.tools and host people on it for a monthly fee: pay, get an invite, connect
your assistant, start. Your workspace is private — instance admins manage accounts,
never content — and if you stop paying it's suspended, not deleted.

**Self-host** — free, AGPL, yours forever. One command if you have Docker, or five
clicks on Railway if you'd rather never open a terminal. Both below.

The manual is at **[docs.hired.tools](https://docs.hired.tools)** — getting connected,
filling in Me, tailoring a resume, running the search, every tool written out, and
the deploy guides in longer form than they are here.

## Self-host with Docker

On any machine with Docker installed:

```bash
curl -fsSLO https://raw.githubusercontent.com/shifulaboratories/Hired/main/docker-compose.yml
docker compose up -d
docker compose logs app   # your sign-in details are printed here, once
```

That's the whole procedure. It pulls the published image, starts the app and a
Postgres it talks to over a private network, applies migrations, creates your owner
account and prints the password. Sign in at http://localhost:3000, and read the top
of [docker-compose.yml](docker-compose.yml) for the optional variables (owner email,
port, a public URL once you have one).

PDF export works out of the box here — the image carries the browser and fonts the
renderer needs, which is the one thing the Railway path below can't give you.

To upgrade:

```bash
docker compose pull && docker compose up -d
```

Your data lives in a named volume and survives upgrades and restarts. Back it up with
`docker compose exec db pg_dump -U hired hired > backup.sql`.

The image is built from this repository on every push and published at
`ghcr.io/shifulaboratories/hired`. Building it yourself is `docker compose build`.

## Self-host on Railway (no terminal)

**One variable, five minutes, no terminal.** You don't invent a password, run a migration,
or configure anything — the app provisions itself on first boot.

### 1. Create the project

Go to [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** →
pick this repository. Railway starts building immediately.

The build will succeed, but the app won't start yet — it has nowhere to store anything.
You'll see it crash and retry. That's expected; the next two steps fix it, and Railway
redeploys on its own.

### 2. Add a database

In the same project, click **+ Create** → **Database** → **Add PostgreSQL**.

Railway names the service **Postgres**. Leave it alone; you never have to configure it.

### 3. Point the app at it

Click your **app service** (not the Postgres one) → **Variables** → **New Variable**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

Type it exactly as shown, `${{ }}` included — Railway autocompletes it. It's a *reference*,
so if the database credentials ever rotate, your app follows automatically.

That's the only variable. Everything else is configured inside the app.

### 4. Give it a web address

**Settings** → **Networking** → **Generate Domain**. You'll get something like
`hired-production.up.railway.app`.

### 5. Get your password from the logs

On first boot the app creates your owner account and prints the credentials once:

```
╔══════════════════════════════════════════════════════════════╗
║ Hired is ready — this is your owner account.                 ║
║                                                              ║
║   Sign in   https://hired-production.up.railway.app          ║
║   Email     owner@localhost                                  ║
║   Password  quartz-meadow-falcon-7391                        ║
║                                                              ║
║   This password was generated for you and is shown ONCE.     ║
╚══════════════════════════════════════════════════════════════╝
```

Open the **Deploy Logs** tab on your app service and scroll to the top of the latest
deploy. Copy the password, sign in, then change your email and password from **Settings**.

Database tables are created automatically on every boot — there's no migration step for you
to run, now or after any future update.

<details>
<summary>Optional variables</summary>

| Variable | What it does |
| --- | --- |
| `ADMIN_EMAIL` | Use this address for the owner account instead of `owner@localhost`. |
| `APP_PASSWORD` | Use this as the owner's first password instead of a generated one. |
| `RESET_OWNER_PASSWORD` | Set to `1` and redeploy to generate a fresh owner password and print it again. Remove the variable afterwards. |

</details>

### 6. Connect your AI

Open **Settings** in the app. It opens on **Connections**, because this is the step that
makes everything else work. You already have one waiting; hit **Set up**, pick whichever
assistant you use — each is listed with its own logo — and the exact steps appear, with the
config already filled in with your URL, ready to copy.

| Client | What you paste |
| --- | --- |
| **Claude** (web, desktop, mobile) | The URL, under Settings → Connectors → Add custom connector |
| **Claude Code** | `claude mcp add --transport http --scope user hired "<your URL>"` |
| **ChatGPT** | The URL, as a custom connector |
| **Cursor** | A three-line block in `~/.cursor/mcp.json` |
| **VS Code** | One `code --add-mcp` command, or `.vscode/mcp.json` |
| **Windsurf** | A three-line block in `~/.codeium/windsurf/mcp_config.json` |
| **Anything else** | A standard `streamable-http` entry — or `mcp-remote` if it only speaks stdio |

Hit **Test** next to any connection and the app calls its own endpoint the way a client
would, then tells you how many tools answered — 126, or 158 if you're an admin.

#### One connection per client

**Connect** gives each assistant its own URL. That matters more than it sounds:

- Your laptop dies, or you paste a URL somewhere you shouldn't — **Rotate** or
  **Disconnect** that one client. Everything else stays connected.
- Each row shows when it was last used and what called in, so "is it actually working?"
  stops being a guess.

> A connection URL contains a secret token tied to your account alone — it can't reach
> anyone else's data. Anyone who has it can read and write *yours*, though, so treat it like
> a password.

---

## Inviting other people

**Admin → People → Invitations** → type an email → **Send invite**. They get a link, pick a password, and
land in their own empty workspace.

Email is optional. Until you set up Resend, creating an invite gives you a link to send
however you like — it stays valid for 14 days. Nothing is blocked on email being configured.

### Letting people ask for access

If you run a landing page in front of your instance, point its sign-up form at
`POST /api/waitlist` with a JSON body of `{"email": "...", "name": "...", "context": "..."}`.
Only `email` is required. Requests land in **Admin → People → Waiting for access**, and you get an email the
moment one arrives — no polling an empty screen.

Nothing on that list has access to anything. A request becomes an invite when you press
**Invite** next to it, which is the same invite as any other: a link, 14 days, their own
empty workspace. The row stays afterwards, stamped with the date, so the list is a record
of who asked and when.

The endpoint is open to any origin on purpose — that's what makes it work from a static
site you host anywhere, with nothing to configure. It grants nothing, it never reads
anything back, and it answers identically whether or not an address is already on the list,
so it can't be used to find out who signed up. A honeypot field, a unique index on the
address and a burst ceiling keep the obvious junk out; anything that gets through is one
click to delete.

By conversation: `admin_list_waitlist`, `admin_invite_waitlist_signup`,
`admin_remove_waitlist_signup`.

### Charging for it (optional)

If you host an instance for other people and want them to pay for it, wire it to Stripe
from **Admin → Configuration**: paste an API key — a restricted key with read-only Customers and
Subscriptions is all it needs, and safer than your full secret key — and a webhook signing secret, register the
webhook URL the panel shows you, and put your Stripe Payment Link wherever you send people.
Someone new who pays through the link is invited automatically. If their subscription
lapses they're suspended — sign-in and assistant access stop, data stays — and paying again
turns them back on. An *existing* member who starts paying is connected by you, on purpose,
with `admin_link_billing`: the checkout email is whatever the payer typed, so the webhook
never attaches a subscription to an account that already exists. The owner and anyone you
invited for free are never touched by billing, and a **Resync from Stripe** button
reconciles everything if a webhook ever goes missing. All of it is also reachable by
conversation: `admin_get_billing_config`, `admin_set_billing_config`, `admin_sync_billing`,
`admin_link_billing`.

### Roles

| Role | Can do |
| --- | --- |
| **Owner** | Everything. Created at setup, can't be demoted or deleted. One per instance. |
| **Admin** | Invite people, suspend/delete members, configure email. |
| **Member** | Their own workspace. Never sees the admin area. |

Admins manage *accounts*, not *content*. There is no way — through the UI or through
Claude — for one person to read another's career history, resumes or applications. That's enforced
at the data layer: every query is scoped by owner, and it's a required argument the compiler
won't let a caller omit.

### Setting up email (Resend)

**Admin → Configuration → Email**:

1. Make a free account at [resend.com](https://resend.com).
2. Add and verify the domain you want to send from.
3. Create an API key, paste it in, and set a from address on that domain.
4. Save, then **Send test** to prove it works — if it fails you get Resend's exact reason,
   which is almost always an unverified domain.

Three emails leave an instance: the invitation somebody gets when you add them, the notice you
get when a stranger asks for access, and that test. They carry the instance name and the mark,
and they follow the same near-monochrome palette as the app, dark theme included. **Send test**
picks which one goes out, so you can read the invitation in your own inbox before anyone else
gets it — the sample is the real design with placeholder details and a link that goes nowhere,
so proofreading it costs nobody a real invitation.

You can do all of this by talking to Claude instead: *"is email set up? configure Resend with
this key, then send me the invitation email so I can see it."*

### Signing in with Google (optional)

Passwords always work. Add a Google OAuth client from **Admin → Configuration → Sign-in**
and a **Continue with Google** button appears on the sign-in page too; clear the client ID
and it goes away again. The screen shows the exact redirect URI to register in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials), with a button to
copy it — pasting it character for character is the whole of avoiding
`redirect_uri_mismatch`.

The button is not a way around invitations. Someone coming back from Google is matched in
this order: an account that has used Google here before, then an account with the same
email address *if the instance has a reason to vouch for that address* (the two get linked,
and they keep their password), then an unexpired invitation (accepted on the spot, with no
password ever chosen). Only if none of those match does the **sign-up** setting decide, and
it is off by default — so an invitation you already sent starts working with the Google
button the moment it's configured, and nobody else gets in.

That vouching matters: anyone can change their own email here to any unused address, so
matching on the address alone would let a member set theirs to a colleague's and capture
that colleague's first Google sign-in. An address counts when an admin addressed an
invitation to it, the owner claimed the instance with it, or Google handed it over
verified. Retyping it in Settings clears that, and the way back is to sign in with a
password and press **Connect Google** under Settings → Account.

Turning sign-up on is a real change: anyone who can sign in to Google gets an account. Pair
it with an allowed-domains list unless you mean the whole internet. A Google sign-up is
always a member, never an admin, and an unverified Google email is refused outright —
accounts here are matched by address, so that check is what the whole thing rests on.

By conversation: `admin_get_google_config`, `admin_set_google_config`.

### Mail and calendar (optional, per person)

Each person can connect the accounts recruiters actually write to, under **Settings →
Connections**, and the app reads them live: a contact's page shows the threads with their
address and the meetings they are invited to, a company's page shows everything from its
domain, an application's page shows both under its timeline, and the pipeline's calendar
view carries the interviews from the real calendar. More than one account merges. Nothing
from any account is copied to the server: every page asks the provider when it opens, and
disconnecting revokes what can be revoked and deletes the credential.

Three kinds of account:

- **Google** uses the sign-in client above. Two more things in the Cloud console make it
  work: enable the Gmail API and the Google Calendar API, and add the `gmail.readonly` and
  `calendar.readonly` scopes to the consent screen. Gmail's read scope is one Google calls
  restricted, so leave the consent screen in Testing and list the people who will connect as
  test users rather than going through verification for an instance you host for friends.
- **Microsoft 365 and Outlook.com** need an app registration in Microsoft Entra, set under
  **Admin → Configuration → Accounts**: supported account types set to any directory plus
  personal accounts, a Web redirect URI the screen shows you, the delegated Graph permissions
  `Mail.Read`, `Calendars.Read`, `User.Read` and `offline_access`, and a client secret.
- **Anything else** — Fastmail, iCloud, Yahoo, a university account, a self-hosted server —
  connects by IMAP and CalDAV with an app password, from a form with presets for the common
  ones. It needs nothing from an admin. Either half can be left out.

The app never sends, so there is no SMTP to configure: read-only is what makes handing over
an inbox safe, and the permissions it asks for cannot do anything else.

By conversation: `list_linked_accounts`, `connect_imap_account`, `test_linked_account`,
`disconnect_account`, `list_correspondence`, `search_email`, `get_email_thread`,
`search_calendar`, and the `inbox_review` workflow that reads a week of mail and proposes
what to log. Admins: `admin_get_microsoft_config`, `admin_set_microsoft_config`.

### Everything else you can change

`DATABASE_URL` is the only thing this app asks of its host. Every other setting lives in the
database, so **Admin → Configuration** is all of it on one screen — instance, email, billing
and anything you add — with what each setting does written next to the box you type it in.
Change one and it takes effect on the next request; there is nothing to redeploy.

Secrets show masked and can only be replaced or cleared, never read back. Anything you
change is one line in **Admin → Log**, with your name on it, values included for everything
that isn't a secret. Clearing a value resets it to the default the app ships with, and the
button tells you what that is before you press it.

One of those settings is worth calling out because it changes what somebody sees before they
sign in. **Landing page** is the marketing site in front of your instance, if you run one.
Point it at a site on the same domain as the app — hired.tools and app.hired.tools — and
signing in leaves a flag on the domain above both, so anyone already signed in who lands on
the marketing page is sent straight through to the app instead of reading the pitch again.
The flag says a session exists and nothing else; it carries no identity and no token, and
the session itself never leaves the app. Leave it empty and nothing is written.

You can also add a setting of your own. That's the escape hatch for one that exists before
it has a section — a feature can read a key, and you can set it today rather than waiting
for a screen. Keys are lowercase letters, numbers and underscores.

By conversation: `admin_list_variables`, `admin_set_variable`, `admin_delete_variable`.

---

## What your AI can do once it's connected

126 tools. One hundred and eighteen of them are the data tools across the four areas, the
archive that cuts through all of them, your mail and calendar accounts, and your own
account; the other eight are the workflows below, published as tools as well as prompts,
because prompt support is optional in MCP clients and tool support isn't. Call one and it
hands back a step-by-step plan that it then follows. Admins get 32 more — 31 data tools and
a ninth workflow — and members never even see those in the tool list, so nobody is tempted
by a permission they don't have.

| Workflow | What it does |
| --- | --- |
| **Tailor a resume to a job** | Reads a posting, mines Me for real evidence, drafts and saves a tailored resume, and tells you what it couldn't back up. |
| **Gap report** | Checks a posting against Me before you write anything: which requirements you can evidence, which are thin, which are missing — and the questions that would fill the gaps. |
| **Mine a background into highlights** | Turns a raw, rambling background into polished, reusable resume bullets. |
| **Weekly pipeline review** | What's stalled, who needs chasing, what to do next — with the follow-up messages drafted. |
| **Research a company into the CRM** | Gathers what's known, works out what's missing, and writes it back to their record without flattening what was already there. |
| **Prepare for an interview** | Pulls the posting, the timeline, the company research, the people involved and your own evidence into one prep sheet. |
| **Log what happened this week** | You ramble; it files everything to the right role, application, or note. |
| **Bring the pipeline up to date from your inbox** | Reads a week of your mail and calendar, tells you what moved, and proposes what to log — nothing is written until you say yes. |
| **Invite and onboard someone** *(admin)* | Invites a person, hands you the link if email isn't set up, and drafts the message to send them. |

Every client is instructed never to invent experience, employers, dates, or metrics. If there's
no evidence in Me for something a job asks for, it says so instead of making it up.

Every tool also declares what it does to your data — whether it only reads, whether it can
overwrite or delete, whether it reaches anything outside this instance. Claude sorts its
approval screen by that, so you can hand over the whole read side of the server at once and
still be asked before something gets destroyed. And when a tool's entire job is to give you a
link — a published resume, a rendered PDF, a shared pipeline — it comes back as a link you can
click, not a field buried in a blob of JSON.

[docs.hired.tools](https://docs.hired.tools) is the manual — it's **Docs** in the profile
menu, and every tool is written out there with its arguments, generated from the same array
the server sends so it can't drift. The app used to render its own copy of that list at
`/docs`; one generated list rendered twice is one rendering that goes stale, so that page
is gone and the address redirects.

**Settings → Connections** keeps the parts only your own instance can answer: how many tools
your account actually has, a **Test** that proves it by calling the endpoint, and the three
Claude Skills, which teach an assistant the rules of this place before you have to. Each
comes two ways — the raw `SKILL.md` to drop in `~/.claude/skills/`, and a zip for the upload
box in Claude's apps, which wants a folder rather than a loose file. They're served from the
`skills/` directory of the instance you're running, so what you install is byte-for-byte what
it has.

### The four areas

**Me** — `search_me`, `get_me_snapshot`, roles with unlimited backgrounds
(`append_role_background` adds without overwriting), reusable highlights, notes and standing
rules, plus education, projects, skills and certifications, which
`create_extra` / `update_extra` / `delete_extra` maintain. `import_resume` is the way in for
anyone who already has a resume: paste it to your assistant and the whole thing gets filed in
one call — roles with their bullets, education, skills, contact details — without overwriting
anything already there.

**Resumes** — `get_resume_format` describes the document shape, then `create_resume` /
`update_resume` / `duplicate_resume` build and tailor them. `preview_resume_text` renders a
draft and estimates page count *without* saving, so Claude can check length before
committing, and `check_resume_fit` ranks what to cut when it runs long — the longest
bullets, and which sections are carrying the most weight. `reorder_resume` moves one
section, job or bullet without rewriting the document, so "lead with the Stripe job" costs
one call rather than a full rewrite. `publish_resume` turns one into a shareable link and hands back the URL;
`unpublish_resume` destroys it. `export_resume_pdf` renders a real PDF server-side and
reports the page count it actually came out to. A duplicated resume remembers what it was
tailored from, so `compare_resumes` can say exactly what a variant changed — bullets added,
dropped, reworded — and `list_resumes` carries each resume's track record: how many
applications it went out with, how many reached an interview, how many reached an offer.

**Pipeline** — `capture_job_posting` turns a posting URL into a tracked application in one
move, company and description included. Then applications and stages, an activity timeline,
tasks — `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`, each
task about at most one thing and that thing being an application, a company, a person, a
resume, a role in Me, a note, or nothing at all —
`list_follow_ups` for
what's overdue, `list_schedule` for a whole window of dated work at once, `pipeline_stats` for
the shape of your search, and `diagnose_search`, which reads the funnel and tells you which
step is losing people rather than handing you six numbers to interpret. `export_csv` returns
any of the three lists as a spreadsheet, `get_pipeline_fields` / `set_pipeline_fields` choose
how much each view shows before you open anything, `get_column_widths` /
`set_column_widths` are the same idea for how wide each table column is, and
`list_field_values` says which locations and work modes you already use, so a new application
does not become the third spelling of Remote.

**CRM** — `list_companies` / `get_company` / `create_company` / `update_company` /
`delete_company` for the companies you're talking to, and `get_contact` / `update_contact` /
`delete_contact` for the people at them, each carrying every way to reach them rather than
just a LinkedIn URL. A company's `website` is what puts their logo on your
pipeline. Deleting one archives it and takes its applications with it, and the people at it
stay where they are.

**Archive** — `list_archive` says what has been deleted and when each thing is due to go,
`restore_records` brings it back, and `delete_archived` and `empty_archive` are the only two
acts on the server that cannot be undone. Neither can reach anything that is not already in
the archive, and `empty_archive` refuses unless you pass back the count `list_archive` just
reported — which forces reading the bin to somebody before emptying it.

**Tags** — `list_tags`, `create_tag`, `update_tag`, `delete_tag` and `seed_tags` manage the
one catalogue behind all of it. A tag's `kind` says which list it belongs to — where an
application came from, a company's industry, size or location, how you know a person — so a
location called `Remote` never collides with a way of working called `Remote`. Every writer
takes names or ids: names fold case and are created only when nothing matches.

**Your account** — `whoami` says who this connection belongs to. `list_connections`,
`create_connection`, `rename_connection`, `rotate_connection` and `delete_connection` manage
the wiring itself, so "add this to my work laptop" and "kill the one I pasted in a chat by
mistake" are things you can just say. Listing never returns tokens — creating and rotating
do, because that is the point of them. `set_profile_photo` takes a link or a file and sets
the picture described below.

**Admin** *(admins only)* — `admin_list_users`, `admin_invite_user`, `admin_set_user_role`,
`admin_set_user_active`, `admin_delete_user`, `admin_instance_stats`, plus
`admin_get_email_config` / `admin_set_email_config` / `admin_send_test_email` for wiring up
Resend without leaving the conversation, and `admin_list_variables` / `admin_set_variable` /
`admin_delete_variable` for every other setting the instance stores. These act on accounts
and instance settings only — none of them can read another person's content.

---

## Starting from a resume you already have

The empty workspace is the reason people leave before they start. Ask Claude — *"here's my
resume, file it"* — and `import_resume` puts the whole thing in: jobs with their bullets,
education, skills, contact details, without overwriting anything already there. That path
reads the document properly, and it's the one to use.

Import the same resume again a year later and it adds what changed rather than shrugging: a
job already on file keeps everything it has and gains the bullets it doesn't, with a reworded
line recognised as the one you already had. `preview_resume_import` says what a second import
would do before it does it.

If you haven't connected anything yet, **Import** on the Me page takes the text instead. It
reads headings, so it's a draft rather than an answer, and it's built to be corrected: every
job it found, and every bullet under it, is shown as an editable field before anything is
saved. Where it had to guess — which half of "Northwind Trading — Head of Operations" is the
employer, or which lines are bullets in a document that never used a bullet mark — it says so
on the field it guessed about, rather than as a warning at the top you'd have to go hunting
with. The whole document is filed as a note either way, so anything it missed stays
searchable.

PDFs are deliberately not read directly: a two-column layout comes out interleaved, and a
wrong parse you can't see is worse than a paste.

## The Harvard template

New resumes use the Harvard OCS format by default — the one Harvard's career office hands
out, and the one recruiters have read ten thousand times:

- Times-metric serif, everything at one size (10pt body, 11pt name and headings)
- Name and section headings centred over full-width rules
- Each entry is two justified lines: **organisation** / location, then **role** / dates
- Black and white, half-inch margins, disc bullets indented half an inch
- No accent colours, no columns, nothing an applicant tracking system can trip over

Because it leads with the organisation, fill in **both** company and title on every entry —
Claude is told to do this. For a *Leadership & Activities* section, add an Experience-kind
section and just rename the heading; organisation, role, location and dates all lay out
correctly.

The format is a starting point, not a cage. The Design menu (palette icon in the editor)
switches template, font, accent, size, leading and margins per resume. Sections, the jobs
inside them and the bullets inside those all reorder by dragging the grip on the left — or
with the ⌃/⌄ buttons, or from the keyboard: tab to a grip, press space, and the arrow keys
move it. Harvard's own convention puts Education first — that's right
for students and recent graduates, and wrong for most people with real work history, so the
default order leads with Experience.

The preview is a way in, not just a picture: click any line on the paper — a bullet, a job,
a heading, your name — and the card holding it opens in the rail with that exact field
focused. It works because every block on the page already carries the place in the document
it came from, which is how the page breaks know what to point at.

Nothing you do in the editor is one-way. Undo and redo sit next to the save indicator and
answer to ⌘Z and ⇧⌘Z — except inside a text field, where ⌘Z still takes back what you typed,
which is what you meant. A sentence undoes as a sentence rather than a letter at a time.
Deleting a job or a section also raises a toast that offers it straight back, because a
delete is the one thing worth catching before the autosave does.

The other templates — Classic, Modern, Compact, Editorial — are all still there.

## Where the page ends

The editor draws a line across the preview everywhere the paper runs out, labelled with the
page it starts, and says *"splits here"* when an entry is cut in half by the break. That's
measured, not guessed: a second invisible copy of the document is laid out in page-sized
columns and the browser is asked where it actually broke, so the line lands where the PDF
will break and moves as you type.

When it runs to two pages the badge in the toolbar stops reporting the count and offers to
fix it. Open it and you get what is on the last page in order, the sections you could hide —
kept in the document, off the page, and undoable — and your longest bullets with the words on
the button that removes each one. `check_resume_fit` is the same advice over MCP, so *"what
should I cut to get this to one page?"* answers with the same list.

## One photo, every document

**Settings → Account** takes a profile photo. Drop a file in, drag it around the circle until
your face is where you want it, and that one picture is your avatar in the app *and* the
headshot on your resumes. Change it once and every document that shows it follows — there is
never a second copy to keep in sync. Claude can set it too: *"use the photo on my GitHub
profile."*

Whether a given resume shows it is a design choice like the accent colour: **Design → Photo**
in the editor, or `showPhoto` from a tool. It's off by default, and Harvard never renders one
whatever you set — it's a US academic format, and a face on it is the thing that marks it as
not that format. Classic centres the photo above your name; Modern, Compact and Editorial set
it beside. US and UK applications generally leave photos off; much of Europe and Latin America
expects one.

The picture lives in your row in the database as a data URI, not in a file store, which is why
self-hosting still needs one environment variable and why a published resume paints your face
from the same HTML as the text — nothing to fetch, nothing to expire. The browser crops and
shrinks before uploading, so it costs tens of kilobytes.

## Sharing a resume as a link

Application forms keep asking for a URL, not a file. Open a resume → **Share** → **Create a
link**, and you get an address like:

```
https://your-app.up.railway.app/r/staff-engineer-stripe-k7m2qx4bnp8t
```

Anyone with it can read that one resume without signing in. Ask Claude instead and you skip
the browser entirely: *"publish my Stripe resume and give me the link."*

The privacy model is the address itself, and nothing else. It's long and random, so it can't
be guessed or walked, the page tells search engines not to index it, and it's listed nowhere.
Your private notes on the resume aren't on the public page — but if that resume has the photo
switched on, your face is, so decide that before you publish. That's the whole model — there
are no per-viewer permissions and no passwords, because everyone you'd send this to is
someone you already decided to send it to.

**Withdraw** destroys the address rather than pausing it. The page starts returning "not
found" for everyone immediately, and sharing that resume again gives you a different link —
so a URL you regret sending stays dead.

## Getting a PDF

Open a resume → **PDF**. The file downloads. There is no print dialog and no margin setting
to get wrong.

The server renders the same page you'd have printed by hand, so what you see is what you
get: exactly 8.5in × 11in with the Harvard template's half-inch margins. The output is real
selectable text, not an image, so applicant tracking systems can read it.

Ask Claude instead and you get the page count with it — *"export my Stripe resume"* returns
a download link and tells you it came out to one page, which is the thing you actually
wanted to know before sending it.

No webfont is fetched: the serif stack is Tinos → Times New Roman → Liberation Serif, which
are metrically identical, so the document renders the same on macOS, Windows and Linux with
nothing to download.

<details>
<summary>If your host has no headless browser</summary>

Server-side rendering needs a Chromium on the machine. The Docker image ships one, so a
compose deploy has working one-click PDF from the first boot. Railway's Nixpacks image does
not — on a stock Railway deploy the **PDF** button reports that and the fallback still
works: **⋯ → Open print view**, then your browser's **Save as PDF** with margins set to
**None**. Same document, one more step. `export_resume_pdf` says the same thing rather than
failing silently.

To get the one-click version the image needs a Chromium and a Times-metric serif, and then
`PDF_CHROMIUM_PATH` pointed at the browser (or one of the usual paths, which are checked
automatically). A Dockerfile installing `chromium`, `fonts-croscore` and `fonts-liberation`
gets there — that part is proven — but Railway's healthcheck did not come up on the
resulting container, so it isn't the shipped default yet.

</details>

---

## Notes

- **Everything autosaves.** There is no save button anywhere. A small indicator tells you
  when a change has landed.
- **`⌘K` / `Ctrl+K`** opens a search palette that jumps to any role, resume, or application.
- **Follow-up dates set themselves** when an application changes stage — 7 days after
  applying, 4 after a screen, 3 after a final round. Override any of them by hand.
- **Dark and light** both supported; toggle is top-right.
- **Suspending someone** signs them out everywhere and kills their Claude connection
  immediately — their data is kept. Deleting them removes it all.

---

## Locked out?

Add `RESET_OWNER_PASSWORD=1` to your app service's variables and redeploy. The app prints a
fresh owner password to the logs. Remove the variable afterwards, or it resets again on the
next deploy.

---

## Running it locally

You need Node 20+ and a Postgres database.

```bash
cp .env.example .env      # only DATABASE_URL is required
npm install
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000. Your owner password is printed in the terminal on first start.

## Contributing

Issues and pull requests are welcome.

```bash
npm run typecheck   # tsc, no emit
npm run build       # production build
```

The two things worth knowing before changing anything:

1. **Tenant isolation is a compile-time property.** Every function in `src/lib/data/` takes
   the owning `userId` as its first argument, and every query filters on it. Don't add a
   data function without one — the whole safety story rests on the compiler rejecting
   unscoped calls.
2. **The MCP tools and the UI share one data layer.** Anything you add in `src/lib/data/`
   can be exposed to both; don't fork the logic.

## License

AGPL-3.0 — see [LICENSE](LICENSE).

In practice: self-host it, modify it, run it for yourself and your friends, all free,
forever. The one obligation is that if you run a modified copy as a service for other
people, you publish your modifications. If you'd rather keep changes private, run it
unmodified — or talk to me.

## How it's built

Next.js 15 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Framer Motion · Prisma ·
PostgreSQL.

The MCP server lives in `src/lib/mcp/` and speaks the Streamable HTTP transport directly —
no session state, so it survives restarts and replicas without reconnecting. Tools are
defined once in `src/lib/mcp/tools.ts` and share the same data layer (`src/lib/data/`) as
the UI, so anything an assistant writes shows up in the app immediately and vice versa.

The token lives in the URL path (`/api/mcp/<token>`) because that is the one shape every
client can express — no headers to configure, no OAuth discovery. Clients that insist on a
header can send `Authorization: Bearer <token>` to `/api/mcp` instead; both routes resolve
to the same connection. Setup recipes are data, in `src/lib/mcp/clients.ts` — adding support
for a new client is one entry in that array, no UI changes.
