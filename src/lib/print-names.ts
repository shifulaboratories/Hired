/**
 * What a printed document is called, and how a link looks on paper.
 *
 * The print pages and the PDF routes both name the file. They used to name it
 * after the document's own label — "v10 — Ode with Anthropic: Associate
 * Principal" — which is a filing name for the owner and exactly what should not
 * land in a recruiter's downloads folder. Worse, the print page's title was
 * set from an effect that Next's own <title> overwrote, so a PDF saved from the
 * print dialog was called "Hired.pdf". The convention a hiring manager expects
 * is the person's name and the kind of document, so that is what both use.
 */

/** "Alex Rivera Resume", falling back to the document's own name when the header has none. */
export function documentTitle(person: string | null | undefined, kind: string, fallback: string) {
  const name = (person ?? "").trim();
  if (name) return `${name} ${titleCase(kind)}`;
  return fallback.trim() || titleCase(kind);
}

/** The same title as a download name: "Alex-Rivera-Resume.pdf". */
export function pdfFileName(title: string, fallback: string) {
  const stem = title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || fallback;
  return `${stem}.pdf`;
}

/**
 * A Content-Disposition value for that name. A header is ASCII, so the plain
 * filename= drops anything else and filename*= carries the real name for every
 * browser that reads it — which is all of them — so "José" stays "José".
 */
export function attachmentDisposition(title: string, fallback: string) {
  const name = pdfFileName(title, fallback);
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || `${fallback}.pdf`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * A link as it should read on paper: no scheme, no www., no trailing slash.
 * "https://www.linkedin.com/in/alex/" prints as "linkedin.com/in/alex".
 */
export function displayUrl(url: string) {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

function titleCase(text: string) {
  return text.replace(/(^|[\s-])(\p{Ll})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}
