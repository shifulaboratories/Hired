# Improving import and the resume editor

A design, not a decision — nothing here is current architecture. Written after a design
pass on 2026-09-06; the pagination half is empirically verified against headless Chromium,
the rest is not yet built. Build it one item at a time.

## Two live bugs found while designing, worth fixing whatever else happens

**`LINES_PER_PAGE` is declared twice.** `src/lib/resume-text.ts:106` exports it under a
comment saying it lives there so the editor's gauge and the grid cannot drift;
`src/components/resume/resume-editor.tsx:87` then declares its own. Both are 46 today, so
nothing is visibly wrong — which is how it will stay until someone changes one. Moot once
measured pagination lands, because the editor stops estimating at all.

**Every document an assistant writes has empty ids, and they are used as React keys.**
`resume-schema.ts` defaults `id` to `""` on sections and items, and `RESUME_DOC_SHAPE`
never mentions `id`, so a document created through `create_resume` / `update_resume` — the
product's main path — carries `id: ""` everywhere. `resume-editor.tsx:314` and
`resume-paper.tsx:89,348,403,455` key their lists on it, so React sees duplicate keys and
can mis-reconcile on reorder. Fix: a pure `ensureIds(doc)` in `resume-schema.ts` run by
`createResume` and `updateResume` before the write. Additive, so invariant 4 holds.

## Measured pagination — verified, ready to build

The editor's page badge comes from `estimateLines()`, which hardcodes ~110 characters per
line and 46 lines per page and never sees `fontSize`, `lineHeight`, `pageMargin` or
`template` — all four one click away in the Design popover. It is styled warning/success,
so it looks authoritative while being structurally unable to be right. Replace it with a
measurement, and draw the page breaks the preview has never shown.

What was measured against `/opt/pw-browsers/chromium` rather than reasoned about:

- **`Math.ceil(height / 1056)` is wrong on 12 of 60 documents**, always undercounting,
  because `break-inside: avoid` on `.rp-block` pushes whole entries to the next page.
- **CSS multicol fragmentation matches paged fragmentation exactly**: a host with
  `column-width: <page content width>; column-gap: 0; column-fill: auto;
  height: <page content height>` gave the same count as the real PDF on 45/45 documents
  spanning 1–14 pages and four page margins — and agreed on *where*, not just how many, on
  30/30. So let Chromium do the fragmentation instead of simulating it.
- `getClientRects()` returns one rect per fragment, so a mid-element break is recoverable.
- Full two-pass measurement costs ~1–3ms, which is cheap enough per keystroke.
- `transform: scale()` corrupts `getBoundingClientRect()`; measure outside the zoom wrapper.

### A shipped defect this exposes

`resume-paper.tsx` puts the page margin on `.resume-paper` as `padding`, and
`globals.css` sets `@page { margin: 0 }`. Padding on a fragmented box is sliced: page 1
gets the top padding, the last page the bottom, **and every page between them gets none**.
A two-page resume printed from this app today has no top margin on page 2 and runs to the
bottom edge of page 1. Fix by moving the margin to the page box — `@page { margin: Npx }`
emitted per document by the print and public routes, `padding: 0` on the paper in print —
after which every page has the same content box and the geometry is one line:
`816 − 2·pageMargin` by `1056 − 2·pageMargin`. Page 1 is pixel-identical before and after;
only the broken pages change. Verify with `preferCSSPageSize` in `src/lib/pdf.ts`.

### Shape

- `.rp-block { break-inside: avoid }` moves out of `@media print` so the measurement host
  sees the same rule. Two copies of the rule that decides where pages break is exactly how
  the preview and the PDF drift apart.
- `resume-paper.tsx` gains one inert attribute, `data-rp`, carrying a positional path
  (`s2/e0/b3`). Positional, not id-based, for the empty-id reason above. It stays a server
  component.
- `src/lib/resume-pagination.ts` — pure, beside `resume-text.ts` and `resume-diff.ts` and
  deliberately out of `src/lib/data/` so the browser can import it without dragging Prisma
  in. Turns raw fragments into `{pages, breaks, used, lastPageFill, fragments}` and
  answers "what is on page N" for cut-to-fit.
- `estimateLines` stays for `preview_resume_text`, which has no browser — but its tool
  description should say it is an estimate and point at `export_resume_pdf` for the
  measured count.

## The rest, not yet designed in this detail

Editor: one `BlockPath` addressing scheme shared by drag, click-to-focus, evidence and the
overflow list; `resume-editor.tsx` split into `components/resume/editor/`; a ref-stable
actions context instead of prop-drilling `onChange` three levels; history as snapshots of
the autosave payload; `@dnd-kit` (already a dependency, already used in `pipeline/board.tsx`)
for reordering; per-bullet evidence from a pure matcher extracted out of
`traceResumeEvidence` — `bulletSimilarity` is already pure; cut-to-fit consuming the page
layout; and pulling a role in from Me.

Import: land on a resume rather than on a tab; show and edit the bullets in the review step
rather than a count; put the parser's per-field confidence on the field it doubts; a
re-import that offers new bullets on roles already on file instead of only skipping them —
which needs a tool before it gets UI; a LinkedIn-shaped reader beside the generic one; and
a narrow PDF path that detects columns and refuses a two-column layout by name rather than
interleaving it silently.
