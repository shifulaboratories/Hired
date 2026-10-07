---
name: tailor-a-resume
description: How to tailor a resume to a specific job posting using a connected Hired instance — reading the posting for what it actually rewards, mining Me for real evidence, and writing bullets that survive an interview. Use when someone shares a job description and wants a resume for it, asks to tailor or adapt an existing resume, or asks which of their experience matters for a particular role.
---

# Tailoring a resume

The job is not "rewrite this resume with the posting's words in it". Keyword-matching
gets past a filter and then falls apart in the room, because the person across the
table asks a follow-up question and there is nothing behind the bullet.

The job is: find the true things that matter most for *this* role, and lead with them.

## Read the posting for what it rewards

A posting has three layers, and only one of them is worth optimising for.

- **Boilerplate** — "fast-paced environment", "wear many hats", the benefits. Ignore.
- **Stated requirements** — the bullet list. Necessary, not sufficient. Everyone
  applying matches most of these.
- **The actual problem** — what they are hiring someone to *fix*. It is usually in the
  first paragraph, in an odd specific requirement, or in what the team is described as
  about to do. "Scale the billing platform ahead of enterprise launch" tells you more
  than eight bullet points do.

Pull out 8–12 things the posting genuinely cares about, ordered by how much they seem
to matter. Say what you think the real problem is — it is a claim they can correct,
and being wrong out loud is cheap.

## Mine Me, one requirement at a time

For each requirement, `search_me` for it. Search for the *concept*, not the
posting's phrasing — someone's background says "cut the nightly job from 6h to 20m",
not "experience with performance optimisation".

Three outcomes, and all three are fine:

- **Strong evidence.** A highlight or a passage of background with a number in it. Use it.
- **Weak evidence.** Adjacent, real, but not the thing. Use it honestly, positioned as
  what it is. Do not upgrade it.
- **Nothing.** Say so. Do not stretch. A gap you name is a gap they can decide about;
  a gap you paper over is one they find out about in an interview.

Report the gaps explicitly when you are done. That list is often the most useful part
of the whole exercise — it tells them what to go and learn, or which jobs to skip.
The tailor_resume workflow runs this check first and stops there when the question is
"should I even apply" rather than "make me the resume". And every gap a
person answers out loud belongs in Me (append_role_background), so it is covered
for every future posting, not just this one.

## Writing the bullets

A bullet that survives an interview has a shape: **what changed, by how much, because
of what you did.**

> Cut nightly billing runtime from 6h to 20m by rewriting the pipeline in Go — 18x
> faster, and it stopped paging the on-call every Tuesday.

Not:

> Responsible for performance optimisation of billing infrastructure.

Rules that hold up:

- **The number goes in the bullet, not the summary.** Summaries are skimmed.
- **Lead with the outcome, not the technology.** The stack is a detail of how.
- **One idea per bullet.** Two ideas joined by "and" is two bullets or one weak one.
- **Their words for their concepts, your words for your work.** If they say "platform
  reliability" and the background says "uptime", use "reliability" — same idea. Do not
  import a verb the evidence does not support.
- **Never a metric that is not in Me.** If a number is not on file, the bullet
  does not get a number. Ask for it instead.

## The order of operations

1. `get_resume_format` — the document shape and what the fields mean.
2. Read the posting; state the 8–12 requirements and your read of the real problem.
3. `search_me` per requirement. Collect the evidence with its ids.
4. `get_me_snapshot` for profile, dates, education, skills.
5. Draft. Order the experience so the most relevant role leads.
6. `create_resume`, named `"<Company> — <Role>"`, with `targetRole` and
   `targetCompany` set. If you are adapting an existing one, `duplicate_resume` first
   and edit the copy — never the version already attached to an application.
7. `export_resume_pdf` for the real page count; `check_resume_fit` if it runs long.
8. Tell them what you led with, what you cut, and what you could not evidence.

## If there is a company record

`list_companies` then `get_company` — the research notes often carry the thing the
posting does not say: who they know there, what the loop is, why the person wants it.
That shapes the summary line more than the posting does.

## What to hand back

- The resume, saved, with its name.
- The two or three bullets you would defend hardest, and why.
- The requirements you found no evidence for.
- Anything you deliberately left off, so they can put it back.
