import { db } from "@/lib/db";
import * as me from "@/lib/data/me";
import * as pipeline from "@/lib/data/pipeline";
import {
  ARCHIVE_MAX_BYTES,
  ARCHIVE_MAX_FILE_BYTES,
  translateLinkedInArchive,
  type ArchiveFile,
  type ArchiveReport,
} from "@/lib/linkedin-archive";

/**
 * Importing a LinkedIn archive.
 *
 * NOTHING NEW IS STORED. Every record this writes is a Role, Highlight,
 * Education, Project, SkillGroup, Certification, Profile field, Company,
 * Application or Contact that already exists — there is deliberately no
 * ImportSource table, and a reviewer looking for one should stop looking.
 *
 * It re-implements NO matching. Steps for Me go straight through
 * `me.importResume`, which owns the one definition of "already on file" in this
 * app; the dry run goes through `me.previewResumeImport`, which runs the REAL
 * import inside a transaction and throws to roll it back, so the two cannot
 * disagree about what would happen.
 */

/** Nobody wants eight hundred strangers in their CRM. */
const MAX_CONTACTS_PER_CALL = 200;

export type LinkedInImportOptions = {
  /** What to do about a role already on file. Passed straight to importResume. */
  onExisting?: "merge" | "skip";
  /** Also create applications from Jobs/Job Applications.csv. Default false. */
  jobs?: boolean;
  /**
   * Also create contacts from Connections.csv — only for people whose Company
   * matches a company already on file, live rows only. Default false.
   */
  connections?: boolean;
  dryRun?: boolean;
};

export type LinkedInImportReport = {
  archive: ArchiveReport;
  /** Exactly what importResume / previewResumeImport returned. */
  me: me.ImportReport;
  applications: { created: number; skipped: number; names: string[] };
  contacts: { created: number; skipped: number; unmatched: number; capped: boolean };
  dryRun: boolean;
};

export async function importLinkedInArchive(
  userId: string,
  files: ArchiveFile[],
  options?: LinkedInImportOptions,
): Promise<LinkedInImportReport> {
  if (files.length === 0) throw new Error("No files came through.");

  let total = 0;
  for (const file of files) {
    const size = file.text.length;
    total += size;
    if (size > ARCHIVE_MAX_FILE_BYTES) {
      throw new Error(
        `${file.name} is ${Math.round(size / 1_000_000)}MB, past the ${Math.round(ARCHIVE_MAX_FILE_BYTES / 1_000_000)}MB a single file can be.`,
      );
    }
  }
  if (total > ARCHIVE_MAX_BYTES) {
    throw new Error(
      `Those files come to ${Math.round(total / 1_000_000)}MB, past the ${Math.round(ARCHIVE_MAX_BYTES / 1_000_000)}MB limit. Pass fewer of them — Profile, Positions, Education, Skills and Certifications are the ones that matter.`,
    );
  }

  const dryRun = options?.dryRun === true;
  const translation = translateLinkedInArchive(files, {
    jobs: options?.jobs,
    connections: options?.connections,
  });

  const meReport = dryRun
    ? await me.previewResumeImport(userId, translation.payload, { onExisting: options?.onExisting })
    : await me.importResume(userId, translation.payload, { onExisting: options?.onExisting });

  const report: LinkedInImportReport = {
    archive: translation.report,
    me: meReport,
    applications: { created: 0, skipped: 0, names: [] },
    contacts: { created: 0, skipped: 0, unmatched: 0, capped: false },
    dryRun,
  };

  // Steps below are deliberately OUTSIDE the importResume transaction. They
  // touch different tables, and wrapping a whole career plus sixty
  // applications in one interactive transaction puts it past Prisma's timeout.
  // If one fails halfway, Me is already written and the report says how far it
  // got — re-running is safe because both are matched-and-skipped.

  if (options?.jobs && translation.applications.length > 0) {
    for (const row of translation.applications) {
      const company = dryRun
        ? await db.company.findFirst({
            where: { userId, name: row.company.trim(), archivedAt: null },
            select: { id: true },
          })
        : await pipeline.upsertCompanyByName(userId, row.company);

      // NO ARCHIVE FILTER HERE, and it is the deliberate exception this file
      // carries: a job the person BINNED must not be re-created by re-running
      // the import. The cost is that an archived row blocks a genuinely new
      // application at the same employer and title, which the report names as
      // skipped rather than swallowing.
      const existing = company
        ? await db.application.findFirst({
            where: { userId, companyId: company.id, roleTitle: row.roleTitle.trim() },
            select: { id: true },
          })
        : null;
      if (existing) {
        report.applications.skipped += 1;
        continue;
      }
      if (dryRun) {
        report.applications.created += 1;
        report.applications.names.push(`${row.roleTitle} at ${row.company}`);
        continue;
      }
      await pipeline.createApplication(userId, {
        company: row.company,
        roleTitle: row.roleTitle,
        stage: "APPLIED",
        jobUrl: row.jobUrl,
        appliedAt: row.appliedAt || undefined,
        sources: ["LinkedIn"],
      });
      report.applications.created += 1;
      report.applications.names.push(`${row.roleTitle} at ${row.company}`);
    }
  }

  if (options?.connections && translation.connections.length > 0) {
    // Every LIVE company this person has, once, lower-cased.
    const companies = await db.company.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, name: true },
    });
    const byName = new Map(companies.map((company) => [company.name.trim().toLowerCase(), company]));

    // Live contacts, for the two ways one is already on file.
    const existing = await db.contact.findMany({
      where: { userId, archivedAt: null },
      select: { id: true, name: true, email: true, companies: { select: { companyId: true } } },
    });
    const byEmail = new Set(
      existing.map((contact) => contact.email.trim().toLowerCase()).filter(Boolean),
    );
    const byNameAtCompany = new Set(
      existing.flatMap((contact) =>
        contact.companies.map((link) => `${contact.name.trim().toLowerCase()}@${link.companyId}`),
      ),
    );

    for (const row of translation.connections) {
      const company = byName.get(row.company.trim().toLowerCase());
      if (!company) {
        report.contacts.unmatched += 1;
        continue;
      }
      const email = row.email.trim().toLowerCase();
      if (
        (email && byEmail.has(email)) ||
        byNameAtCompany.has(`${row.name.trim().toLowerCase()}@${company.id}`)
      ) {
        report.contacts.skipped += 1;
        continue;
      }
      if (report.contacts.created >= MAX_CONTACTS_PER_CALL) {
        report.contacts.capped = true;
        report.contacts.unmatched += 1;
        continue;
      }
      if (!dryRun) {
        await pipeline.createContact(userId, {
          name: row.name,
          email: row.email,
          title: row.title,
          linkedin: row.linkedin,
          companyIds: [company.id],
        });
      }
      report.contacts.created += 1;
      if (email) byEmail.add(email);
      byNameAtCompany.add(`${row.name.trim().toLowerCase()}@${company.id}`);
    }
  }

  return report;
}
