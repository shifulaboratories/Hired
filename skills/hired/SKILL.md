---
name: hired
description: Orientation for a connected Hired instance — a person's career knowledge base, resume builder and job-search CRM. Use whenever a Hired connector is available and the conversation touches their career history, a resume, a job application, a company they are considering, or someone they are talking to there. Read this before the first tool call, not after the first mistake.
---

# Working in someone's Hired

Hired is one person's career, on their own server. Everything you touch through
the connector is theirs, it is real, and it is the material a resume gets built from.
There is no draft copy. Deleting a company, a person or an application is reversible —
it goes to an archive for thirty days — and nothing else is.

## The four areas

**Me** — everything they know about their own career. Each role holds an unlimited
free-form *background* of raw material, plus polished reusable bullets called
*highlights*. There are also notes, projects, education, skills and certifications.
`search_me` is the fastest way in and is almost always the first call.

**Resumes** — documents assembled from that material. `get_resume_format` first, so
you know the document shape. New resumes use the Harvard OCS format. Any resume can
be published to a public URL.

**Pipeline** — applications, stages, an activity timeline, tasks and follow-up dates
that schedule themselves when a stage changes.

**CRM** — companies and the people at them, as records in their own right. A company
holds their website, its tags — industry, size, location — and whatever research has
accumulated.

Two things cut across all four. **Tags** are the one catalogue behind every label in the
product — where an application came from, a company's industry, size and location, how you
know a person — so call `list_tags` before writing any of them rather than minting a
near-duplicate. And the **archive** is where deleting sends a company, a person or an
application: `list_archive` says what is in there and when each thing is due to go,
`restore_records` brings it back.

If they have connected their own Google account — `get_google_connection` says —
`list_correspondence` returns the real threads and meetings behind any record, read live
and never stored. Call it before saying where an application stands: the timeline only
knows what somebody logged by hand.

## The rule that matters most

**Never invent experience, employers, dates or metrics.**

The failure that actually happens is not fabrication from nothing — nobody does that.
It is *quiet upgrading* while tailoring. A distribution credit becomes a hire. An
unsettled follower count becomes a cited one. "Helped with" becomes "led". Every one
of those maps neatly onto a stated requirement in the posting, so it does not feel
like invention to whoever is drafting.

So: every claim on a resume traces to something already in Me. If the evidence
is not there, say so and ask. An honest gap is a conversation. A confident
overstatement is something they have to defend in a room.

Call `list_notes` and read the ones whose `kind` is `GUARDRAIL` — it takes no arguments
and returns everything, so pick them out of the result. This person may have written down
specific things they have been burned by. Those override anything you would otherwise
infer, and they are also carried in the briefing you were given on connect.

## Replace versus append

Several tools **replace** what you send rather than merging it. Getting this wrong
silently deletes work.

| Tool | Behaviour | What to do |
|---|---|---|
| `update_role` | Replaces every field you pass | Use `append_role_background` for new material |
| `update_resume` | Replaces the document | `get_resume`, modify, write back whole |
| `update_company` | Replaces each field passed, notes included | `get_company` first, then write the combined notes |
| `update_contact` | Same | `get_contact` first |
| `append_role_background` | Adds | Safe by default — prefer it |
| `tag_companies` / `tag_contacts` | **Adds and removes** | The bulk tools, and the exception — safe across a selection |

When someone tells you something new about a job already on file, that is
`append_role_background`. Not `update_role`.

The bulk tools are the reason that last row matters. "Tag these nine as fintech" written as
nine `update_company` calls strips the size and location off all nine; `tag_companies` adds
and removes and leaves everything else alone. The same goes for `move_applications_stage`,
`schedule_contact_pings` and `archive_records` — when the ask covers several records, use
the bulk tool rather than a loop.

## Before you write anything

1. `search_me` for evidence — always.
2. `get_me_snapshot` for the profile, dates and education.
3. For a company: `list_companies` to find the id, then `get_company`.
4. Only then draft.

## Things worth knowing

- **Preview before saving.** `preview_resume_text` renders and estimates page count
  without saving anything. Use it to check length before `create_resume`.
- **Tailor into a copy.** `duplicate_resume`, then edit the copy. Never edit a resume
  already attached to an application — that is the version they actually sent.
- **Publishing is real.** `publish_resume` puts the document at a public URL that
  anyone holding the link can read. `unpublish_resume` destroys that link rather than
  pausing it, so a link already out in the world breaks. Say which resume you are
  about to publish, and warn before withdrawing one.
- **A company's website is their own domain.** It is what puts their logo in the
  pipeline. A Greenhouse or Ashby link is the job board, not the employer — do not
  put one in `website`. Set it whenever you learn it; it costs nothing.
- **Dates.** `list_schedule(from, to)` merges follow-ups, task deadlines and logged
  activity into one window. Reach for it whenever the question is about a stretch of
  time rather than one application. `list_follow_ups` is only what is already overdue.
- **Deleting is reversible, once.** `delete_company`, `delete_contact` and
  `delete_application` archive rather than destroy — the row leaves every list, board and
  count and waits out a retention window. `delete_archived` and `empty_archive` are the only
  two acts that cannot be undone, and neither can reach anything not already in the archive.
  Never call either without reading `list_archive` back to them and getting a plain yes.
  Everything else — a role, a highlight, a note, a resume, a task, a tag — really is gone.
- **A spreadsheet is one call.** `export_csv` returns companies, people or applications as
  CSV, taking the same filters, search and sort as the matching list tool. Do not assemble
  one by hand.

## Saying what you did

After writing, say what you changed and where — "added three highlights to the Vertex
role", "saved *Helios — Staff Engineer*, one page". They cannot see your tool calls,
and a resume that changed without explanation is one they have to re-read from
scratch.
