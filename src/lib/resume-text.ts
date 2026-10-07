import type { ResumeDoc } from "@/lib/resume-schema";

/**
 * Pure rendering helpers for a resume document — no database, no Node built-ins.
 *
 * They live outside `src/lib/data/` on purpose. Client components need them,
 * and importing them from the data layer dragged the whole module — Prisma and
 * `node:crypto` included — into the browser bundle. It only ever worked by accident; adding one Node
 * import to `resumes.ts` broke the build. Keeping these here means the client
 * imports exactly what it uses.
 */

export function resumeToText(doc: ResumeDoc) {
  const lines: string[] = [];
  const { header } = doc;
  if (header.name) lines.push(header.name);
  if (header.title) lines.push(header.title);
  const contact = [header.email, header.phone, header.location, ...header.links.map((l) => l.url)]
    .filter(Boolean)
    .join(" | ");
  if (contact) lines.push(contact);

  for (const section of doc.sections) {
    if (!section.visible) continue;
    const body: string[] = [];
    if (section.kind === "summary" && section.text) body.push(section.text);
    if (section.kind === "experience") {
      for (const item of section.experience) {
        body.push(
          `${item.title} — ${item.company}${item.location ? `, ${item.location}` : ""} (${item.startDate} – ${item.isCurrent ? "Present" : item.endDate})`,
        );
        if (item.summary) body.push(`  ${item.summary}`);
        for (const b of item.bullets.filter(Boolean)) body.push(`  • ${b}`);
      }
    }
    if (section.kind === "education") {
      for (const item of section.education) {
        body.push(
          `${item.degree}${item.field ? ` in ${item.field}` : ""} — ${item.school} (${item.startDate} – ${item.endDate})`,
        );
        for (const d of item.details.filter(Boolean)) body.push(`  • ${d}`);
      }
    }
    if (section.kind === "projects") {
      for (const item of section.projects) {
        body.push(`${item.name}${item.role ? ` — ${item.role}` : ""}${item.url ? ` (${item.url})` : ""}`);
        if (item.description) body.push(`  ${item.description}`);
        for (const b of item.bullets.filter(Boolean)) body.push(`  • ${b}`);
      }
    }
    if (section.kind === "skills") {
      for (const g of section.skills) body.push(`${g.name}: ${g.skills.join(", ")}`);
    }
    if (section.kind === "certifications") {
      for (const c of section.certifications)
        body.push([c.name, c.issuer, c.date].filter(Boolean).join(" — "));
    }
    if (section.kind === "custom") {
      for (const item of section.items) {
        body.push([item.title, item.subtitle, item.meta].filter(Boolean).join(" — "));
        for (const b of item.bullets.filter(Boolean)) body.push(`  • ${b}`);
      }
    }
    if (body.length) {
      lines.push("", section.heading.toUpperCase(), ...body);
    }
  }
  return lines.join("\n");
}

/**
 * How many estimated lines fit a US-Letter page at the default type settings.
 * One number, read by check_resume_fit and the resume grid's page badge through
 * fitReport — the one estimator. A second one, which counted different things,
 * was removed with preview_resume_text; export_resume_pdf is the measured count.
 */
export const LINES_PER_PAGE = 46;
