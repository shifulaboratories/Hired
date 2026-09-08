import {
  type CompanyCut,
  type CompanyMissing,
  type CompanySort,
  type ContactCut,
  type ContactMissing,
  type ContactSort,
} from "@/lib/crm-filters";
import { STAGE_LABEL, listApplications, listCompanies, listContacts } from "@/lib/data/pipeline";
import { toListRow, sortRows, type ListSort } from "@/lib/pipeline-list";
import { matchesFilters, type PipelineFilters } from "@/lib/pipeline-filters";

/**
 * Each list, as a file you can open in a spreadsheet.
 *
 * Its own module rather than a corner of pipeline.ts, because an application
 * export needs `matchesFilters` and `src/lib/pipeline-filters.ts` already
 * imports from pipeline.ts — putting these there would close the cycle.
 *
 * What comes out is what you are looking at: the same filters, the same search
 * and the same order as the screen, or just the rows you ticked. An export that
 * quietly returned everything would be worse than no export, because the file
 * looks complete either way.
 */

/**
 * One CSV field.
 *
 * Two separate problems. Quoting handles commas, quotes and the newlines that
 * live in everyone's notes. The leading apostrophe handles the other one: a
 * cell starting =, +, - or @ is a formula to Excel and Sheets, so a note
 * beginning "=2+2" is a spreadsheet that computes, and a crafted one is a
 * spreadsheet that phones home. Prefixing makes it text, which is what it was.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

const day = (date: Date | null | undefined) =>
  date ? date.toISOString().slice(0, 10) : "";

/**
 * Rows to a file.
 *
 * CRLF because that is what the CSV spec says and what Excel is happiest with,
 * and a UTF-8 byte-order mark on the front because without it Excel on Windows
 * reads "Bezós" as mojibake. Every other reader tolerates the mark.
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(cell).join(","), ...rows.map((row) => row.map(cell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** A safe, dated filename: hired-companies-2026-09-03.csv */
export function exportFilename(what: string, now = new Date()): string {
  return `hired-${what}-${now.toISOString().slice(0, 10)}.csv`;
}

const tagNames = (tags: { name: string }[]) => tags.map((tag) => tag.name).join("; ");

const ofKind = (tags: { name: string; kind: string }[], kind: string) =>
  tags.filter((tag) => tag.kind === kind).map((tag) => tag.name).join("; ");

/** Narrow to a ticked selection, keeping the order the list already decided. */
const onlyIds = <T extends { id: string }>(rows: T[], ids?: string[]) => {
  if (!ids || ids.length === 0) return rows;
  const wanted = new Set(ids);
  return rows.filter((row) => wanted.has(row.id));
};

export type CompanyExportOptions = {
  search?: string;
  filter?: CompanyCut;
  tagIds?: string[];
  industryIds?: string[];
  sizeIds?: string[];
  locationIds?: string[];
  missing?: CompanyMissing[];
  sort?: CompanySort;
  dir?: "asc" | "desc";
  /** Only these rows. Empty or absent means everything the filters left. */
  ids?: string[];
};

export async function exportCompaniesCsv(userId: string, options?: CompanyExportOptions) {
  const rows = onlyIds(await listCompanies(userId, options), options?.ids);
  return toCsv(
    [
      "Name",
      "Website",
      "Industry",
      "Size",
      "Location",
      "Tags",
      "Applications",
      "Open applications",
      "People",
      "Last applied",
      "Notes",
      "Link",
    ],
    rows.map((company) => [
      company.name,
      company.website,
      ofKind(company.tags, "INDUSTRY"),
      ofKind(company.tags, "SIZE"),
      ofKind(company.tags, "LOCATION"),
      ofKind(company.tags, "COMPANY"),
      company._count.applications,
      company.openApplications,
      company._count.contacts,
      day(company.lastAppliedAt),
      company.notes,
      `/crm/companies/${company.id}`,
    ]),
  );
}

export type ContactExportOptions = {
  search?: string;
  filter?: ContactCut;
  tagIds?: string[];
  companyIds?: string[];
  quietDays?: number;
  missing?: ContactMissing[];
  sort?: ContactSort;
  dir?: "asc" | "desc";
  ids?: string[];
};

export async function exportContactsCsv(userId: string, options?: ContactExportOptions) {
  const rows = onlyIds(await listContacts(userId, options), options?.ids);
  return toCsv(
    [
      "Name",
      "Title",
      "Companies",
      "Relationship",
      "Tags",
      "Email",
      "Phone",
      "LinkedIn",
      "X",
      "Instagram",
      "GitHub",
      "Website",
      "Other links",
      "Next ping",
      "Last touch",
      "Notes",
      "Link",
    ],
    rows.map((contact) => [
      contact.name,
      contact.title,
      contact.companies.map((company) => company.name).join("; "),
      contact.relationship,
      tagNames(contact.tags),
      contact.email,
      contact.phone,
      contact.linkedin,
      contact.twitter,
      contact.instagram,
      contact.github,
      contact.website,
      contact.otherLinks.join("; "),
      day(contact.nextFollowUpAt),
      day(contact.activities[0]?.occurredAt ?? null),
      contact.notes,
      `/crm/contacts/${contact.id}`,
    ]),
  );
}

export type ApplicationExportOptions = {
  filters?: PipelineFilters;
  sort?: ListSort;
  desc?: boolean;
  ids?: string[];
};

/**
 * The pipeline, as a file.
 *
 * `includeClosed: true` always. Closed applications are exactly what somebody
 * exporting before a clear-out wants a copy of, and listApplications hides them
 * by default — an export that silently dropped every rejection would look
 * complete and be wrong at the only moment it mattered.
 *
 * The order comes from `sortRows`, which is the same pure function the table
 * uses, but the CSV is built from the raw applications: `ListRow` carries what
 * a table cell needs and not the eleven other columns worth exporting.
 */
export async function exportApplicationsCsv(userId: string, options?: ApplicationExportOptions) {
  const applications = await listApplications(userId, { includeClosed: true });
  const kept = onlyIds(
    options?.filters
      ? applications.filter((application) => matchesFilters(application, options.filters!))
      : applications,
    options?.ids,
  );
  const order = sortRows(
    kept.map((application) => toListRow(application, null)),
    options?.sort ?? "updated",
    options?.desc ?? true,
  ).map((row) => row.id);
  const byId = new Map(kept.map((application) => [application.id, application]));

  return toCsv(
    [
      "Company",
      "Role",
      "Stage",
      "Tags",
      "Location",
      "Work mode",
      "Salary",
      "Applied",
      "Next follow-up",
      "Closed",
      "Resume",
      "Days in stage",
      "Days quiet",
      "Activity",
      "Job link",
      "Notes",
      "Link",
    ],
    order.flatMap((id) => {
      const application = byId.get(id);
      if (!application) return [];
      return [
        [
          application.company.name,
          application.roleTitle,
          STAGE_LABEL[application.stage],
          tagNames(application.tags),
          application.location,
          application.workMode,
          application.salaryRange,
          day(application.appliedAt),
          day(application.nextFollowUpAt),
          day(application.closedAt),
          application.resume?.name ?? "",
          application.daysInStage,
          application.quietDays,
          application._count.activities,
          application.jobUrl,
          application.notes,
          `/applications/${application.id}`,
        ],
      ];
    }),
  );
}
