import type { ResumeImport } from "@/lib/data/me";

/**
 * LinkedIn's own data export, read structurally.
 *
 * `import_resume` exists because a resume is prose an assistant has to
 * interpret, and `resume-parse-linkedin.ts` exists because a pasted profile is
 * prose wearing a layout. The ARCHIVE is neither: it is CSV with column
 * headers, and guessing at it would be throwing away the one export in this
 * product's world that does not need guessing.
 *
 * PURE, beside resume-parse.ts and for the same reason those files are: it is a
 * translation, not a data rule, and it has to run in the browser (the import
 * dialog) and on the server (the tool) without either owning it. There is one
 * definition of "already on file" in this app and it lives in `runImport`; this
 * file never grows a second one — it produces exactly the payload
 * `importResume` already takes and hands it over.
 */

/** One file out of the archive, as it arrived. */
export type ArchiveFile = { name: string; text: string };

/** What a translation found, and what it could not use. */
export type ArchiveReport = {
  /** Files it recognised, by the canonical name, with the row count each gave. */
  read: { file: string; rows: number }[];
  /** Files in the payload it has no reader for. Named, never silently dropped. */
  ignored: string[];
  /** Files it recognised and could not read — a missing header, a truncated row. */
  problems: string[];
};

export type LinkedInApplication = {
  company: string;
  roleTitle: string;
  jobUrl: string;
  /** The date as LinkedIn wrote it, or "" when it gave one that did not parse. */
  appliedAt: string;
};

export type LinkedInConnection = {
  name: string;
  email: string;
  title: string;
  company: string;
  linkedin: string;
  connectedAt: string;
};

export type LinkedInTranslation = {
  /** Exactly the shape me.importResume takes. */
  payload: ResumeImport;
  /** Jobs LinkedIn recorded you applying to. Empty unless `jobs` was asked for. */
  applications: LinkedInApplication[];
  /** Connections worth filing. Empty unless `connections` was asked for. */
  connections: LinkedInConnection[];
  report: ArchiveReport;
};

export const ARCHIVE_MAX_BYTES = 8_000_000;
export const ARCHIVE_MAX_FILE_BYTES = 4_000_000;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A real RFC-4180 reader: quoted fields, doubled quotes, embedded newlines and
 * commas.
 *
 * LinkedIn's `Description` column contains all three, and a split on commas
 * eats the rest of the file the first time somebody's job description has one
 * in it. An unterminated quote at EOF is reported as a problem by the caller
 * rather than thrown: an import that fails whole because of one bad row is an
 * import nobody runs twice.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = csvRows(text);
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const keys = header.map((key) => key.trim());
  return body
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      keys.forEach((key, index) => {
        record[key] = (row[index] ?? "").trim();
      });
      return record;
    });
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Strip a BOM: LinkedIn writes one, and it turns the first header into
  // "﻿First Name", which matches nothing.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** True when a quote was opened and never closed. */
function hasUnbalancedQuote(text: string): boolean {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"') continue;
    if (text[i + 1] === '"') {
      i += 1;
      continue;
    }
    count += 1;
  }
  return count % 2 === 1;
}

// ---------------------------------------------------------------------------
// Which file is which
// ---------------------------------------------------------------------------

/** The basename, lower-cased, so "Jobs/Job Applications.csv" lands. */
function basename(name: string): string {
  return name.split(/[\\/]/).pop()!.trim().toLowerCase();
}

const FILES = {
  profile: "profile.csv",
  positions: "positions.csv",
  education: "education.csv",
  skills: "skills.csv",
  languages: "languages.csv",
  certifications: "certifications.csv",
  projects: "projects.csv",
  emails: "email addresses.csv",
  jobs: "job applications.csv",
  connections: "connections.csv",
} as const;

const KNOWN = new Set<string>(Object.values(FILES));

/**
 * The first value present, by any of its known header spellings.
 *
 * LinkedIn renames headers without notice — `Company Name` has also been
 * `Company`, `Started On` has also been `Start Date` — and the single most
 * likely failure of this whole feature is a rename that makes the import
 * silently read nothing. Aliases plus a row count per file is what makes that
 * visible instead.
 */
function cell(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const found = Object.keys(row).find((key) => key.trim().toLowerCase() === name.toLowerCase());
    if (found && row[found]?.trim()) return row[found].trim();
  }
  return "";
}

/** LinkedIn writes websites as "[PERSONAL:https://…]". Pull the address out. */
function firstUrl(value: string): string {
  const bracketed = value.match(/https?:\/\/[^\],\s]+/);
  return bracketed ? bracketed[0] : value.split(",")[0]?.trim() ?? "";
}

function firstHandle(value: string): string {
  return value.split(",")[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// The translation
// ---------------------------------------------------------------------------

export function translateLinkedInArchive(
  files: ArchiveFile[],
  options?: { jobs?: boolean; connections?: boolean },
): LinkedInTranslation {
  const report: ArchiveReport = { read: [], ignored: [], problems: [] };
  const payload: ResumeImport = {};
  const applications: LinkedInApplication[] = [];
  const connections: LinkedInConnection[] = [];

  const byName = new Map<string, ArchiveFile>();
  for (const file of files) {
    const key = basename(file.name);
    if (!KNOWN.has(key)) {
      report.ignored.push(file.name);
      continue;
    }
    byName.set(key, file);
  }

  /** Read one recognised file, or say why it could not be read. */
  const rowsOf = (key: string, ...expect: string[]): Record<string, string>[] => {
    const file = byName.get(key);
    if (!file) return [];
    if (hasUnbalancedQuote(file.text)) {
      report.problems.push(
        `${file.name} has a quote that is opened and never closed, so everything after it is one field. Nothing from it was read.`,
      );
      return [];
    }
    // Connections.csv opens with a three-line preamble — a "Notes:" line, a
    // sentence about the export, and a blank — BEFORE the header row.
    // Everything else in the archive starts at the header.
    let text = file.text;
    if (expect.length > 0) {
      const lines = text.split("\n");
      const headerAt = lines.findIndex((line) =>
        expect.some((word) => line.toLowerCase().includes(word.toLowerCase())),
      );
      if (headerAt > 0) text = lines.slice(headerAt).join("\n");
      if (headerAt < 0) {
        report.problems.push(
          `${file.name} has no header row naming ${expect.join(" or ")}. It had: ${(lines[0] ?? "").slice(0, 120)}`,
        );
        return [];
      }
    }
    const rows = parseCsv(text);
    report.read.push({ file: file.name, rows: rows.length });
    return rows;
  };

  // --- Profile -------------------------------------------------------------
  const profileRows = rowsOf(FILES.profile, "First Name");
  if (profileRows.length > 0) {
    const row = profileRows[0];
    const name = [cell(row, "First Name"), cell(row, "Last Name")].filter(Boolean).join(" ");
    const website = firstUrl(cell(row, "Websites"));
    const twitter = firstHandle(cell(row, "Twitter Handles"));
    payload.profile = {
      ...(name ? { fullName: name } : {}),
      ...(cell(row, "Headline") ? { headline: cell(row, "Headline") } : {}),
      ...(cell(row, "Summary") ? { summary: cell(row, "Summary") } : {}),
      ...(cell(row, "Geo Location", "Location") ? { location: cell(row, "Geo Location", "Location") } : {}),
      ...(website ? { website } : {}),
      ...(twitter ? { twitter } : {}),
    };
    // Named rather than silently dropped, so nobody has to wonder.
    report.ignored.push(
      "Profile.csv: Address, Birth Date, Zip Code, Instant Messengers, Maiden Name and Industry are not read",
    );
  }

  const emailRows = rowsOf(FILES.emails, "Email Address");
  const primary =
    emailRows.find((row) => cell(row, "Primary").toLowerCase() === "yes") ?? emailRows[0];
  if (primary && cell(primary, "Email Address")) {
    payload.profile = { ...(payload.profile ?? {}), email: cell(primary, "Email Address") };
  }

  // --- Positions -----------------------------------------------------------
  const positions = rowsOf(FILES.positions, "Company Name", "Company");
  if (positions.length > 0) {
    payload.roles = positions
      .map((row) => {
        const finished = cell(row, "Finished On", "End Date");
        return {
          company: cell(row, "Company Name", "Company"),
          title: cell(row, "Title", "Position"),
          location: cell(row, "Location"),
          // Stored as the string LinkedIn gave ("Mar 2021"): Role.startDate is
          // a String column and the rest of the app reads it as text.
          startDate: cell(row, "Started On", "Start Date"),
          endDate: finished,
          // An empty Finished On is the job they are still in.
          isCurrent: finished === "",
          // The whole description goes to BACKGROUND, never to bullets.
          // runImport turns every bullet into a Highlight, so splitting prose
          // on newlines would manufacture achievement lines the person never
          // wrote. Roles from an archive carry no bullets, deliberately.
          background: cell(row, "Description"),
        };
      })
      .filter((role) => role.company && role.title);
    if (payload.roles.length < positions.length) {
      report.problems.push(
        `Positions.csv: ${positions.length - payload.roles.length} row(s) had no employer or no title and were skipped.`,
      );
    }
  }

  // --- Education -----------------------------------------------------------
  const education = rowsOf(FILES.education, "School Name", "School");
  if (education.length > 0) {
    payload.education = education
      .map((row) => ({
        school: cell(row, "School Name", "School"),
        degree: cell(row, "Degree Name", "Degree"),
        startDate: cell(row, "Start Date", "Started On"),
        endDate: cell(row, "End Date", "Finished On"),
        details: [cell(row, "Notes"), cell(row, "Activities")].filter(Boolean).join("\n"),
      }))
      .filter((entry) => entry.school);
  }

  // --- Skills and languages ------------------------------------------------
  const skillGroups: NonNullable<ResumeImport["skillGroups"]> = [];
  const skills = rowsOf(FILES.skills, "Name");
  const skillNames = skills.map((row) => cell(row, "Name")).filter(Boolean);
  if (skillNames.length > 0) skillGroups.push({ name: "Skills", skills: skillNames });

  const languages = rowsOf(FILES.languages, "Name");
  const languageNames = languages
    .map((row) => {
      const proficiency = cell(row, "Proficiency");
      const name = cell(row, "Name");
      return name ? (proficiency ? `${name} (${proficiency})` : name) : "";
    })
    .filter(Boolean);
  if (languageNames.length > 0) skillGroups.push({ name: "Languages", skills: languageNames });
  if (skillGroups.length > 0) payload.skillGroups = skillGroups;

  // --- Certifications ------------------------------------------------------
  const certifications = rowsOf(FILES.certifications, "Name");
  if (certifications.length > 0) {
    payload.certifications = certifications
      .map((row) => ({
        name: cell(row, "Name"),
        issuer: cell(row, "Authority", "Issuer"),
        date: cell(row, "Started On", "Start Date"),
        url: cell(row, "Url", "URL"),
      }))
      .filter((entry) => entry.name);
  }

  // --- Projects ------------------------------------------------------------
  const projects = rowsOf(FILES.projects, "Title", "Name");
  if (projects.length > 0) {
    payload.projects = projects
      .map((row) => ({
        name: cell(row, "Title", "Name"),
        description: cell(row, "Description"),
        url: cell(row, "Url", "URL"),
        startDate: cell(row, "Started On", "Start Date"),
        endDate: cell(row, "Finished On", "End Date"),
      }))
      .filter((entry) => entry.name);
  }

  // --- Applications, only when asked for -----------------------------------
  if (options?.jobs) {
    for (const row of rowsOf(FILES.jobs, "Company Name", "Company")) {
      const company = cell(row, "Company Name", "Company");
      const roleTitle = cell(row, "Job Title", "Title");
      if (!company || !roleTitle) continue;
      applications.push({
        company,
        roleTitle,
        jobUrl: cell(row, "Job Url", "Job URL"),
        appliedAt: cell(row, "Application Date"),
      });
    }
  }

  // --- Connections, only when asked for ------------------------------------
  if (options?.connections) {
    for (const row of rowsOf(FILES.connections, "First Name")) {
      const name = [cell(row, "First Name"), cell(row, "Last Name")].filter(Boolean).join(" ");
      if (!name) continue;
      connections.push({
        name,
        email: cell(row, "Email Address", "Email"),
        title: cell(row, "Position", "Title"),
        company: cell(row, "Company"),
        linkedin: cell(row, "URL", "Url"),
        connectedAt: cell(row, "Connected On"),
      });
    }
  }

  return { payload, applications, connections, report };
}

// ---------------------------------------------------------------------------
// The zip
// ---------------------------------------------------------------------------

/**
 * Read the CSVs out of a LinkedIn archive.
 *
 * The mirror of src/lib/zip.ts, which writes one by hand for the same stated
 * reason — not worth a dependency. It reads the central directory,
 * `DecompressionStream("deflate-raw")` inflates each entry, and everything that
 * is not a `.csv` is skipped.
 *
 * A zip bomb is a real shape here, so an entry whose DECLARED uncompressed size
 * is over the cap is refused before anything is inflated.
 */
export async function unzipEntries(input: Uint8Array): Promise<ArchiveFile[]> {
  // Copied into a plain ArrayBuffer so the slices below are BlobParts whatever
  // the caller handed in — a Uint8Array over a SharedArrayBuffer is not one.
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer);

  // Find the end-of-central-directory record, scanning back from the tail.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That does not look like a zip file.");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const files: ArchiveFile[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (!name.toLowerCase().endsWith(".csv")) continue;
    // Refused BEFORE inflating: the declared size is the only warning a zip
    // bomb gives before it costs memory.
    if (uncompressedSize > ARCHIVE_MAX_FILE_BYTES) continue;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);

    if (method === 0) {
      files.push({ name, text: decoder.decode(raw) });
      continue;
    }
    if (method !== 8) continue;
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
    files.push({ name, text: decoder.decode(inflated) });
  }
  return files;
}
