import type { ResumeDoc } from "@/lib/resume-schema";
import { templateTakesAccent, templateTakesPhoto } from "@/lib/resume-templates";

/**
 * What a machine reads, and what falls out on the way.
 *
 * Pure: no DOM, no Prisma, no browser. Beside resume-fit.ts and for the same
 * reason — the checks are arithmetic over the document, and the one thing that
 * genuinely needs a browser (reading the text back off the printed page) lives
 * in the tool handler where `renderPdf` already does.
 *
 * THERE IS NO SCORE HERE, DELIBERATELY. No two applicant tracking systems parse
 * alike, none of them publishes what it does, and the widely repeated claim
 * that most resumes are auto-rejected by software is not sourced anywhere. A
 * number would be a number this app invented. Every check below is a flat,
 * checkable fact with the reason it matters attached, and `method` says how
 * each verdict was reached so nobody quotes one without knowing.
 */

export type AtsCheck = {
  /** Stable key: "email", "phone", "photo", "headings", "dates", "links", "columns". */
  check: string;
  ok: boolean;
  /** What was actually found. Names the offenders; never a count on its own. */
  detail: string;
  /** Why it matters, in one sentence. Shown as written. */
  why: string;
};

export type AtsReport = {
  checks: AtsCheck[];
  /** Section headings that are not among the conventional set, named. */
  unconventionalHeadings: string[];
  /** Entries whose startDate or endDate is not YYYY-MM. */
  looseDates: { path: string; label: string; value: string }[];
  /** Links whose URL appears nowhere in the extracted text. */
  hiddenUrls: { label: string; url: string }[];
  /** How each verdict was reached. Read it before quoting the result. */
  method: string;
};

/**
 * Headings a parser is likely to recognise without being taught.
 *
 * Lower-cased and matched by containment, so "Professional Experience" and
 * "Work Experience" both pass on "experience". Deliberately short: a long list
 * would pass everything and say nothing.
 */
const CONVENTIONAL = [
  "experience",
  "employment",
  "work history",
  "education",
  "skills",
  "projects",
  "certifications",
  "licenses",
  "summary",
  "profile",
  "objective",
  "publications",
  "awards",
  "honors",
  "honours",
  "volunteer",
  "leadership",
  "activities",
  "languages",
  "interests",
];

const YYYY_MM = /^\d{4}-(0[1-9]|1[0-2])$/;

const METHOD = [
  "Every check reads the DOCUMENT, not a re-extraction of a PDF.",
  "email/phone: the header fields, non-empty after trimming.",
  "headings: each visible section's heading, lower-cased, has to CONTAIN one of a short conventional list; anything else is named rather than failed, because an unusual heading is a risk, not an error.",
  "dates: every experience and education entry's startDate and endDate has to match YYYY-MM exactly. `isCurrent` entries are exempt from the end date.",
  "links: a link fails when its URL does not appear in the flattened text, which happens when a template prints a label and hides the address in the markup.",
  "photo: read off the template and the showPhoto setting together, because two templates print no photograph whatever the setting says.",
  "columns: always one. This app has no two-column template, so the check exists to say so rather than to find anything.",
].join(" ");

export function atsReport(
  doc: ResumeDoc,
  settings: { template: string; showPhoto: boolean },
  /** The flattened text, so a hidden URL can be found by absence from it. */
  text: string,
): AtsReport {
  const checks: AtsCheck[] = [];
  const { header } = doc;

  checks.push({
    check: "email",
    ok: header.email.trim() !== "",
    detail: header.email.trim() || "No email address in the header.",
    why: "A parser that cannot find an address has nothing to key the record on, and a portal usually asks for it again anyway.",
  });
  checks.push({
    check: "phone",
    ok: header.phone.trim() !== "",
    detail: header.phone.trim() || "No phone number in the header.",
    why: "Less important than the address and worth stating either way, because some portals treat a blank as an incomplete application.",
  });

  const showsPhoto = templateTakesPhoto(settings.template) && settings.showPhoto;
  checks.push({
    check: "photo",
    ok: !showsPhoto,
    detail: showsPhoto
      ? `The ${settings.template} template is printing a photograph.`
      : "No photograph on the page.",
    why: "A photograph is an image: it carries no text, it takes room a parser gets nothing from, and in several countries it is a reason a recruiter has to discard the file.",
  });

  const visible = doc.sections.filter((section) => section.visible);
  const unconventionalHeadings = visible
    .map((section) => section.heading.trim())
    .filter(Boolean)
    .filter((heading) => !CONVENTIONAL.some((word) => heading.toLowerCase().includes(word)));
  checks.push({
    check: "headings",
    ok: unconventionalHeadings.length === 0,
    detail:
      unconventionalHeadings.length === 0
        ? `All ${visible.length} headings are conventional ones.`
        : `Not in the conventional set: ${unconventionalHeadings.join(", ")}.`,
    why: "A parser files content under the heading above it. An invented heading is not wrong, but the content under it may end up in a bucket nobody searches.",
  });

  const looseDates: AtsReport["looseDates"] = [];
  visible.forEach((section, sectionIndex) => {
    if (section.kind === "experience") {
      section.experience.forEach((item, index) => {
        const label = `${item.title || "(untitled)"} at ${item.company || "(no employer)"}`;
        if (item.startDate && !YYYY_MM.test(item.startDate)) {
          looseDates.push({ path: `sections[${sectionIndex}].experience[${index}].startDate`, label, value: item.startDate });
        }
        if (!item.isCurrent && item.endDate && !YYYY_MM.test(item.endDate)) {
          looseDates.push({ path: `sections[${sectionIndex}].experience[${index}].endDate`, label, value: item.endDate });
        }
      });
    }
    if (section.kind === "education") {
      section.education.forEach((item, index) => {
        const label = `${item.degree || "(no degree)"} at ${item.school || "(no school)"}`;
        if (item.startDate && !YYYY_MM.test(item.startDate)) {
          looseDates.push({ path: `sections[${sectionIndex}].education[${index}].startDate`, label, value: item.startDate });
        }
        if (item.endDate && !YYYY_MM.test(item.endDate)) {
          looseDates.push({ path: `sections[${sectionIndex}].education[${index}].endDate`, label, value: item.endDate });
        }
      });
    }
  });
  checks.push({
    check: "dates",
    ok: looseDates.length === 0,
    detail:
      looseDates.length === 0
        ? "Every date is YYYY-MM."
        : looseDates.map((row) => `${row.label}: "${row.value}"`).join("; "),
    why: "A date a parser cannot read becomes no date, and a role with no date is a role with no duration — which is the field most filters sort on.",
  });

  const hiddenUrls = header.links
    .filter((link) => link.url.trim() && !text.includes(link.url.trim()))
    .map((link) => ({ label: link.label || "(no label)", url: link.url }));
  checks.push({
    check: "links",
    ok: hiddenUrls.length === 0,
    detail:
      hiddenUrls.length === 0
        ? `All ${header.links.length} links print their address.`
        : hiddenUrls.map((row) => `${row.label} → ${row.url}`).join("; "),
    why: "A link shown as a word with the address only in the markup is, to a text extractor, a word. The ats template prints every URL for exactly this reason.",
  });

  checks.push({
    check: "columns",
    ok: true,
    detail: "One column. This app has no two-column template.",
    why: "Two columns are the single most common real parsing failure — the extractor interleaves them — and it is a failure this app cannot have.",
  });

  if (!templateTakesAccent(settings.template)) {
    checks.push({
      check: "colour",
      ok: true,
      detail: "Black on white; this template ignores the accent colour.",
      why: "Colour is never extracted, so it costs nothing to keep and nothing to drop. It is here so nobody wonders whether it was checked.",
    });
  }

  return { checks, unconventionalHeadings, looseDates, hiddenUrls, method: METHOD };
}

/**
 * Lines in one rendering and not the other, both ways.
 *
 * NOT a diff of two documents — a diff of two renderings of the SAME document,
 * which is the only way to see what the paper drops and what the flattened text
 * invents. A skills group with a name and no skills prints nothing but is in
 * the text; a link whose label is on the page while its address is not shows up
 * the other way round.
 */
export function textDifferences(
  fromDoc: string,
  fromPage: string,
): { onlyInDocument: string[]; onlyOnPage: string[] } {
  const normalise = (value: string) =>
    value
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  const doc = normalise(fromDoc);
  const page = normalise(fromPage);
  const pageSet = new Set(page);
  const docSet = new Set(doc);
  return {
    onlyInDocument: [...new Set(doc.filter((line) => !pageSet.has(line)))].slice(0, 40),
    onlyOnPage: [...new Set(page.filter((line) => !docSet.has(line)))].slice(0, 40),
  };
}
