---
name: hired
description: Orientation for a connected Hired instance — a person's career knowledge base, resume builder and job-search CRM. Use whenever a Hired connector is available and the conversation touches their career history, a resume, a job application, a company they are considering, or someone they are talking to there. Read this before the first tool call, not after the first mistake.
---

# Working in someone's Hired

Hired is one person's career, on their own server. Everything you touch is theirs, it is
real, and it is the material their resumes are built from.

**Me** is everything they know about their own jobs: each role has a free-form background
and polished bullets called highlights, plus notes, projects, education and skills.
**Resumes** and **letters** are documents built from it. The **pipeline** is applications,
stages, a timeline, tasks and follow-ups; **people** are the companies and contacts behind
it. **Tags** are the one catalogue behind every label — call `list_tags` before writing one.

## Never invent experience, employers, dates or metrics

The failure that happens is not fabrication from nothing. It is quiet upgrading while
tailoring: "helped with" becomes "led", a credit becomes a hire, an unsettled number becomes
a cited one. Every claim on a document traces to something in Me. If the evidence is not
there, say so and ask. Read their rules first: `list_notes` with kind `GUARDRAIL`, and the
Rules, Caveats and Open questions that `get_role` reads out of each background. Caveats
never go on a page; open questions are never used.

## Replace versus append

| Tool | Behaviour | So |
|---|---|---|
| `update_role`, `update_resume` | Replace what you send | Read first, modify, write back whole |
| `update_company`, `update_contact` | Replace each field passed, notes included | Read first, write the combined value |
| `append_role_background` | Adds | Use it for anything new about a job on file |
| `tag_records` | Adds and removes | Use it, not a loop of `update_company`, across a selection |

When the ask covers several records, pass them all in one call: `move_application_stage`
with `ids`, `tag_records`, `schedule_contact_pings`, `archive_records`.

## Before you write

1. `search_me` with the posting's own words, then the words they would have used.
2. `get_me_snapshot` for the profile, dates, education and their keyword policy.
3. For a job on the board, `tailor_resume_for_application` makes the tailored copy and
   names the lines nothing in Me backs. Never edit a resume already attached to an
   application — that is the version they sent.
4. `export_resume_pdf` for the real page count; `check_resume_fit` if it runs long, and
   propose the cuts rather than making them.

## Undo, and what has none

Deleting a company, a person or an application puts it in the archive (`list_archive`,
`restore_records`). An assistant's edit to a role or a resume can be put back with
`list_changes` and `restore_revision`. Four acts cannot be undone: `delete_archived`,
`empty_archive`, `merge_companies` and, for admins, `admin_delete_user` — say what will go
and get a plain yes first. Deleting a role, a highlight, a note, a resume or a tag is
permanent too.

## Things worth knowing

- `publish_resume` puts a document at a public link; `unpublish_resume` destroys the link.
  Say which resume, and warn before withdrawing one that may already be out.
- A company's `website` is its own domain, never a Greenhouse or Ashby link.
- `list_schedule(from, to)` is the answer to any question about a stretch of time.
- `export_csv` is the answer to "send me this as a file".

After writing, say what you changed and where — "added three highlights to the Vertex role",
"saved *Helios — Staff Engineer*, one page". They cannot see your tool calls.
