import {
  ActivityType,
  BoardProvider,
  InterviewFormat,
  InterviewOutcome,
  LetterKind,
  NoteKind,
  QuestionKind,
  ReferralStatus,
  Stage,
  TagKind,
  TaskRepeat,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { tagKey } from "@/lib/data/tags";

/**
 * Everything you own, as one file — and back again.
 *
 * `export_csv` answers "give me this list in a spreadsheet". This answers the
 * other question, the one a self-hoster asks before they trust an app with two
 * years of their career: can I get it all out, and could I put it back.
 *
 * What comes out is a single JSON document carrying every record this workspace
 * owns, with the ids it has now so the relations between them survive. What
 * goes back in is the same document, matched against what is already there by
 * natural key — a role by employer and title, a company by name, a job by
 * employer and role — so importing into a workspace that already has material
 * ADDS what is missing and leaves what is there alone. Importing the same file
 * twice does nothing the second time. That is the only behaviour safe to offer
 * without a warning screen, and it is the one people actually want: a restore,
 * not a replacement.
 *
 * Some things are deliberately NOT in the file, and the export says so. The
 * whole decision, model by model, is COVERAGE below; the main ones:
 *
 * - **Connections and linked accounts.** An MCP connection URL is a credential
 *   with full read and write over the workspace, and a mail account carries an
 *   app password. A backup file people email around must not contain either.
 * - **Published slugs.** /r/<slug> and /p/<slug> are live public URLs. Copying
 *   one into a second workspace would either collide or quietly republish
 *   somebody's resume at an address they thought was theirs.
 * - **The review queue.** A proposal is a question waiting for an answer, not a
 *   record of anything.
 * - **Instance-level rows** — accounts, invitations, settings, the audit log.
 *   Those belong to the instance rather than to a person, and no export written
 *   for one account should be able to carry them.
 * - **The profile photo**, for a duller reason: it is a data URI that would
 *   dwarf the rest of the file, and nobody restores a picture from a backup.
 */

/**
 * Bumped when the shape changes in a way an older importer would misread. The
 * importer refuses a version it does not know rather than guessing.
 */
export const EXPORT_VERSION = 1;

export type WorkspaceExport = {
  version: number;
  exportedAt: string;
  /** Named, so a file found in six months says what wrote it. */
  application: "hired";
  excluded: string[];
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
  profile: Record<string, unknown> | null;
};

const EXCLUDED = [
  "MCP connections and their tokens — a connection URL is a credential",
  "linked mail and calendar accounts — they hold app passwords and refresh tokens",
  "published resume and pipeline slugs — those are live public URLs",
  "the review queue — a proposal is a question, not a record",
  "instance-level rows: accounts, invitations, settings, the audit log",
  "your profile photo — a data URI nobody restores from a backup, and it would dwarf the file",
  "attachments — the files you have kept; their bytes would dwarf this document, and pg_dump is the backup that carries them",
  "capture links and queued outgoing mail — the first is a credential, the second is tied to a linked account",
  "version history, the change log and conversations with the built-in assistant — a restore starts its own",
];

/**
 * Every model in the schema, and what the export does with it.
 *
 * Typed over Prisma.ModelName, so a model added to schema.prisma fails the
 * typecheck here until somebody decides whether it is in the file. The export
 * promised "every record this workspace owns" for months while it quietly left
 * out interview rounds, the question bank, referrals and recorded transfers —
 * everything added after the export was written — and nothing noticed, because
 * nothing could. A string is the reason a model stays out; "file" means it is
 * in, under that key.
 */
export const COVERAGE: Record<Prisma.ModelName, { file: string } | { out: string }> = {
  Profile: { file: "profile" },
  Role: { file: "roles" },
  Highlight: { file: "highlights" },
  Education: { file: "education" },
  Project: { file: "projects" },
  SkillGroup: { file: "skillGroups" },
  Certification: { file: "certifications" },
  TransferableSkill: { file: "transferableSkills" },
  Note: { file: "notes" },
  Resume: { file: "resumes" },
  Letter: { file: "letters" },
  Tag: { file: "tags" },
  Company: { file: "companies" },
  Contact: { file: "contacts" },
  ContactCompany: { file: "contactCompanies" },
  Application: { file: "applications" },
  ApplicationTag: { file: "applicationTags" },
  CompanyTag: { file: "companyTags" },
  ContactTag: { file: "contactTags" },
  Activity: { file: "activities" },
  Task: { file: "tasks" },
  Offer: { file: "offers" },
  Interview: { file: "interviews" },
  InterviewInterviewer: { file: "interviewers" },
  InterviewQuestion: { file: "interviewQuestions" },
  Referral: { file: "referrals" },
  SavedView: { file: "savedViews" },
  StageTemplate: { file: "stageTemplates" },
  StageCadence: { file: "stageCadences" },
  CompanyWatch: { file: "companyWatches" },
  McpConnection: { out: "a connection URL is a credential" },
  LinkedAccount: { out: "it holds app passwords and refresh tokens" },
  Outbound: { out: "a queued email is tied to a linked account, which is not in the file either" },
  PipelineShare: { out: "a share slug is a live public URL" },
  CaptureLink: { out: "a capture link is a credential" },
  Proposal: { out: "a proposal is a question, not a record" },
  Attachment: { out: "file bytes would dwarf the document; pg_dump is the backup that carries them" },
  Revision: { out: "history of records that are in the file; a restore starts its own" },
  WriteLog: { out: "which connection wrote what, on an instance the file is leaving" },
  AssistantThread: { out: "conversations with the built-in assistant are not career material" },
  AssistantMessage: { out: "as AssistantThread" },
  SampleLoad: { out: "a marker for sample material, which nobody restores" },
  User: { out: "instance-level: the account itself" },
  Session: { out: "instance-level: a sign-in" },
  Invite: { out: "instance-level" },
  LoginThrottle: { out: "instance-level" },
  AdminAudit: { out: "instance-level" },
  Setting: { out: "instance-level" },
  SystemEvent: { out: "instance-level" },
  WaitlistSignup: { out: "instance-level" },
};

/** Columns stripped on the way out, wherever they appear. */
const WITHHELD = new Set(["slug", "visibility", "publishedAt", "photo"]);

function clean<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    if (WITHHELD.has(name)) continue;
    out[name] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

export async function exportWorkspace(userId: string): Promise<WorkspaceExport> {
  // Archived rows are IN the file, deliberately — the one documented exception
  // to the rule that every read of Company, Contact or Application excludes
  // them. A backup that silently omits the bin is a backup that loses whatever
  // somebody deleted last week and has not yet decided about, and `archivedAt`
  // rides along so a restore puts it back in the bin rather than on the board.
  const where = { userId };
  const [
    profile,
    roles,
    highlights,
    education,
    projects,
    skillGroups,
    certifications,
    notes,
    resumes,
    letters,
    tags,
    companies,
    contacts,
    contactCompanies,
    applications,
    applicationTags,
    companyTags,
    contactTags,
    activities,
    tasks,
    offers,
    savedViews,
    stageTemplates,
    transferableSkills,
    interviews,
    interviewers,
    interviewQuestions,
    referrals,
    stageCadences,
    companyWatches,
  ] = await Promise.all([
    db.profile.findUnique({ where: { userId } }),
    db.role.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.highlight.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.education.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.project.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.skillGroup.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.certification.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.note.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.resume.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.letter.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.tag.findMany({ where, orderBy: { name: "asc" } }),
    db.company.findMany({ where, orderBy: { name: "asc" } }),
    db.contact.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.contactCompany.findMany({ where: { contact: { userId } } }),
    db.application.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.applicationTag.findMany({ where: { application: { userId } } }),
    db.companyTag.findMany({ where: { company: { userId } } }),
    db.contactTag.findMany({ where: { contact: { userId } } }),
    db.activity.findMany({ where, orderBy: { occurredAt: "asc" } }),
    db.task.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.offer.findMany({ where, orderBy: { receivedAt: "asc" } }),
    db.savedView.findMany({ where, orderBy: { name: "asc" } }),
    db.stageTemplate.findMany({ where, orderBy: { sortOrder: "asc" } }),
    db.transferableSkill.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.interview.findMany({ where, orderBy: [{ applicationId: "asc" }, { round: "asc" }] }),
    db.interviewInterviewer.findMany({ where: { interview: { userId } } }),
    db.interviewQuestion.findMany({ where, orderBy: [{ interviewId: "asc" }, { sortOrder: "asc" }] }),
    db.referral.findMany({ where, orderBy: { askedOn: "asc" } }),
    db.stageCadence.findMany({ where }),
    db.companyWatch.findMany({ where, orderBy: { createdAt: "asc" } }),
  ]);

  const data: Record<string, unknown[]> = {
    roles: roles.map(clean),
    highlights: highlights.map(clean),
    education: education.map(clean),
    projects: projects.map(clean),
    skillGroups: skillGroups.map(clean),
    certifications: certifications.map(clean),
    notes: notes.map(clean),
    resumes: resumes.map(clean),
    letters: letters.map(clean),
    tags: tags.map(clean),
    companies: companies.map(clean),
    contacts: contacts.map(clean),
    contactCompanies: contactCompanies.map(clean),
    applications: applications.map(clean),
    applicationTags: applicationTags.map(clean),
    companyTags: companyTags.map(clean),
    contactTags: contactTags.map(clean),
    activities: activities.map(clean),
    tasks: tasks.map(clean),
    offers: offers.map(clean),
    savedViews: savedViews.map(clean),
    stageTemplates: stageTemplates.map(clean),
    transferableSkills: transferableSkills.map(clean),
    interviews: interviews.map(clean),
    interviewers: interviewers.map(clean),
    interviewQuestions: interviewQuestions.map(clean),
    referrals: referrals.map(clean),
    stageCadences: stageCadences.map(clean),
    companyWatches: companyWatches.map(clean),
  };

  const counts: Record<string, number> = {};
  for (const [name, list] of Object.entries(data)) counts[name] = list.length;

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    application: "hired",
    excluded: EXCLUDED,
    counts,
    data,
    profile: profile ? clean(profile) : null,
  };
}

export type ImportReport = {
  dryRun: boolean;
  created: Record<string, number>;
  skipped: Record<string, number>;
  /** What could not be placed, and why. Never silent. */
  problems: string[];
};

/**
 * A natural key from several fields.
 *
 * Joined on a NUL, not a space. "Acme Data" + "Engineer" and "Acme" + "Data
 * Engineer" produce the same string on a space, so the second of the two is
 * counted as already present and never created. `captureJobPostings` in
 * pipeline.ts picked this separator for the same reason.
 */
const key = (...parts: (string | null | undefined)[]) =>
  parts.map((part) => (part ?? "").trim().toLowerCase()).join("\u0000");

type Row = Record<string, unknown>;

const s = (row: Row, name: string): string =>
  typeof row[name] === "string" ? (row[name] as string) : "";
/**
 * A whole number from the file, clamped to what the column holds.
 *
 * Unbounded, a hand-edited amount above the Int ceiling threw out of the middle
 * of `importWorkspace` and took the accumulated `problems` report with it. The
 * data recovers on a re-run because the matching is additive; the report does
 * not, and the report is the only thing anybody reads.
 */
const MAX_INT = 2_147_483_647;
const int = (row: Row, name: string, fallback = 0): number => {
  const value = row[name];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(-MAX_INT, Math.min(MAX_INT, Math.round(value)));
};
const bool = (row: Row, name: string, fallback = false): boolean =>
  typeof row[name] === "boolean" ? (row[name] as boolean) : fallback;
const strings = (row: Row, name: string): string[] =>
  Array.isArray(row[name]) ? (row[name] as unknown[]).map(String) : [];
const date = (row: Row, name: string): Date | null => {
  const value = row[name];
  if (typeof value !== "string" || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const rowsOf = (doc: WorkspaceExport, name: string): Row[] =>
  Array.isArray(doc.data?.[name]) ? (doc.data[name] as Row[]) : [];

/**
 * An enum value from the file, or the default.
 *
 * The document is JSON somebody could have hand-edited, so a stage of
 * "INTERVIEWING " or "Offer" must not reach Prisma and blow up halfway through
 * a restore. Anything unrecognised falls back rather than throwing: losing one
 * field is recoverable, losing the rest of the import is not.
 */
function enumOf<T extends Record<string, string>>(
  values: T,
  value: string,
  fallback: T[keyof T],
): T[keyof T] {
  const upper = value.trim().toUpperCase();
  return (Object.values(values) as string[]).includes(upper) ? (upper as T[keyof T]) : fallback;
}

/** The same, where null is a legitimate answer. */
function maybeEnum<T extends Record<string, string>>(values: T, value: string): T[keyof T] | null {
  const upper = value.trim().toUpperCase();
  return (Object.values(values) as string[]).includes(upper) ? (upper as T[keyof T]) : null;
}

/**
 * Whether a row is in the bin, as a key part.
 *
 * A restored job and a binned one of the same name are two different records —
 * `Company.archiveKey` exists so the database agrees — so the natural key has
 * to tell them apart or one of them swallows the other.
 */
const binned = (archivedAt: Date | null) => (archivedAt ? "archived" : "live");

/** A placeholder id a dry run hands out. Never reaches the database. */
const isDry = (id: string | null | undefined) => Boolean(id?.startsWith("dry:"));
const real = (id: string | null | undefined) => (id && !isDry(id) ? id : null);

/**
 * Put a workspace export back.
 *
 * Additive and matched by natural key, so it is a restore rather than a
 * replacement: what is already here is left exactly as it is and only what is
 * missing gets written. Running the same file twice adds nothing the second
 * time — the probe asserts that, because it is the property that makes this
 * safe to offer without a warning screen.
 *
 * `dryRun` does every lookup and no write, and reports the same numbers. Reach
 * for it first on any file you did not write yourself.
 */
export async function importWorkspace(
  userId: string,
  doc: WorkspaceExport,
  options?: { dryRun?: boolean },
): Promise<ImportReport> {
  const dryRun = options?.dryRun ?? false;
  const created: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const problems: string[] = [];
  const bump = (bucket: Record<string, number>, name: string) => {
    bucket[name] = (bucket[name] ?? 0) + 1;
  };

  if (!doc || typeof doc !== "object" || doc.application !== "hired") {
    throw new Error('That is not a Hired export. The file must carry application: "hired".');
  }
  if (doc.version !== EXPORT_VERSION) {
    throw new Error(
      `This file is version ${doc.version}, and this instance reads version ${EXPORT_VERSION}. Export it again from the instance that wrote it, or upgrade this one.`,
    );
  }

  // Old id to new id, per area. Everything below resolves its parents through
  // these rather than trusting an id from the file to mean anything here.
  const map = {
    role: new Map<string, string>(),
    resume: new Map<string, string>(),
    tag: new Map<string, string>(),
    company: new Map<string, string>(),
    contact: new Map<string, string>(),
    application: new Map<string, string>(),
    note: new Map<string, string>(),
    activity: new Map<string, string>(),
    interview: new Map<string, string>(),
  };

  // Profile: fills blanks, never overwrites. Somebody restoring a backup into
  // a workspace they have already started should not lose the headline they
  // just wrote.
  if (doc.profile) {
    const existing = await db.profile.findUnique({ where: { userId } });
    const patch: Record<string, string> = {};
    for (const field of [
      "fullName",
      "headline",
      "email",
      "phone",
      "location",
      "website",
      "linkedin",
      "github",
      "twitter",
      "summary",
      "background",
      "timeZone",
    ] as const) {
      const incoming = s(doc.profile, field);
      const current = existing ? ((existing as unknown as Row)[field] as string) : "";
      if (incoming && !current) patch[field] = incoming;
    }
    // The keyword policy has a default rather than a blank, so "empty" here
    // means still on that default.
    const policy = s(doc.profile, "keywordPolicy");
    if (policy && policy !== "MATCH" && (!existing || existing.keywordPolicy === "MATCH")) {
      patch.keywordPolicy = policy;
    }
    if (Object.keys(patch).length > 0) {
      if (!dryRun) {
        await db.profile.upsert({ where: { userId }, update: patch, create: { userId, ...patch } });
      }
      created.profileFields = Object.keys(patch).length;
    } else {
      bump(skipped, "profile");
    }
  }

  const liveTags = await db.tag.findMany({ where: { userId } });
  const tagByKey = new Map(liveTags.map((tag) => [key(tag.kind, tag.name), tag.id]));
  for (const row of rowsOf(doc, "tags")) {
    const k = key(s(row, "kind"), s(row, "name"));
    const found = tagByKey.get(k);
    if (found) {
      map.tag.set(s(row, "id"), found);
      bump(skipped, "tags");
      continue;
    }
    bump(created, "tags");
    if (dryRun) {
      map.tag.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.tag.create({
      data: {
        userId,
        kind: enumOf(TagKind, s(row, "kind"), TagKind.APPLICATION),
        name: s(row, "name"),
        // The normalised form is a column because Postgres cannot index a
        // function through Prisma; tagKey owns that rule, here as everywhere.
        key: tagKey(s(row, "name")),
        color: s(row, "color") || "slate",
      },
    });
    tagByKey.set(k, made.id);
    map.tag.set(s(row, "id"), made.id);
  }

  const liveRoles = await db.role.findMany({ where: { userId } });
  const roleByKey = new Map(liveRoles.map((role) => [key(role.company, role.title), role.id]));
  for (const row of rowsOf(doc, "roles")) {
    const k = key(s(row, "company"), s(row, "title"));
    const found = roleByKey.get(k);
    if (found) {
      map.role.set(s(row, "id"), found);
      bump(skipped, "roles");
      continue;
    }
    bump(created, "roles");
    if (dryRun) {
      map.role.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.role.create({
      data: {
        userId,
        company: s(row, "company"),
        title: s(row, "title"),
        employmentType: s(row, "employmentType") || "Full-time",
        location: s(row, "location"),
        startDate: s(row, "startDate"),
        endDate: s(row, "endDate"),
        isCurrent: bool(row, "isCurrent"),
        summary: s(row, "summary"),
        background: s(row, "background"),
        tags: strings(row, "tags"),
        startUnconfirmed: bool(row, "startUnconfirmed"),
        endUnconfirmed: bool(row, "endUnconfirmed"),
        sortOrder: int(row, "sortOrder"),
      },
    });
    roleByKey.set(k, made.id);
    map.role.set(s(row, "id"), made.id);
  }

  const liveHighlights = await db.highlight.findMany({ where: { userId } });
  const highlightKeys = new Set(liveHighlights.map((row) => key(row.text)));
  for (const row of rowsOf(doc, "highlights")) {
    const k = key(s(row, "text"));
    if (highlightKeys.has(k)) {
      bump(skipped, "highlights");
      continue;
    }
    highlightKeys.add(k);
    bump(created, "highlights");
    if (dryRun) continue;
    await db.highlight.create({
      data: {
        userId,
        roleId: real(map.role.get(s(row, "roleId"))),
        text: s(row, "text"),
        impact: s(row, "impact"),
        tags: strings(row, "tags"),
        strength: int(row, "strength", 3),
        archived: bool(row, "archived"),
        sortOrder: int(row, "sortOrder"),
      },
    });
  }

  await plain(
    "education",
    (row) => key(s(row, "school"), s(row, "degree"), s(row, "field")),
    (await db.education.findMany({ where: { userId } })).map((row) =>
      key(row.school, row.degree, row.field),
    ),
    async (row) => {
      await db.education.create({
        data: {
          userId,
          school: s(row, "school"),
          degree: s(row, "degree"),
          field: s(row, "field"),
          location: s(row, "location"),
          startDate: s(row, "startDate"),
          endDate: s(row, "endDate"),
          gpa: s(row, "gpa"),
          details: s(row, "details"),
          sortOrder: int(row, "sortOrder"),
        },
      });
    },
  );

  await plain(
    "projects",
    (row) => key(s(row, "name")),
    (await db.project.findMany({ where: { userId } })).map((row) => key(row.name)),
    async (row) => {
      await db.project.create({
        data: {
          userId,
          name: s(row, "name"),
          role: s(row, "role"),
          url: s(row, "url"),
          description: s(row, "description"),
          background: s(row, "background"),
          tags: strings(row, "tags"),
          startDate: s(row, "startDate"),
          endDate: s(row, "endDate"),
          sortOrder: int(row, "sortOrder"),
        },
      });
    },
  );

  await plain(
    "skillGroups",
    (row) => key(s(row, "name")),
    (await db.skillGroup.findMany({ where: { userId } })).map((row) => key(row.name)),
    async (row) => {
      await db.skillGroup.create({
        data: {
          userId,
          name: s(row, "name"),
          skills: strings(row, "skills"),
          sortOrder: int(row, "sortOrder"),
        },
      });
    },
  );

  await plain(
    "certifications",
    (row) => key(s(row, "name"), s(row, "issuer")),
    (await db.certification.findMany({ where: { userId } })).map((row) => key(row.name, row.issuer)),
    async (row) => {
      await db.certification.create({
        data: {
          userId,
          name: s(row, "name"),
          issuer: s(row, "issuer"),
          date: s(row, "date"),
          url: s(row, "url"),
          sortOrder: int(row, "sortOrder"),
        },
      });
    },
  );

  const liveNotes = await db.note.findMany({ where: { userId } });
  const noteByKey = new Map(
    liveNotes.map((note) => [key(note.title, note.body.slice(0, 80)), note.id]),
  );
  for (const row of rowsOf(doc, "notes")) {
    const k = key(s(row, "title"), s(row, "body").slice(0, 80));
    const found = noteByKey.get(k);
    if (found) {
      map.note.set(s(row, "id"), found);
      bump(skipped, "notes");
      continue;
    }
    bump(created, "notes");
    if (dryRun) {
      map.note.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.note.create({
      data: {
        userId,
        title: s(row, "title"),
        body: s(row, "body"),
        kind: enumOf(NoteKind, s(row, "kind"), NoteKind.NOTE),
        tags: strings(row, "tags"),
        pinned: bool(row, "pinned"),
        // Roles are put back before notes, so a note about a job lands on
        // that job again — or on nothing, when the role was not in the file.
        roleId: real(map.role.get(s(row, "roleId"))),
      },
    });
    noteByKey.set(k, made.id);
    map.note.set(s(row, "id"), made.id);
  }

  const liveResumes = await db.resume.findMany({ where: { userId } });
  const resumeByName = new Map(liveResumes.map((resume) => [key(resume.name), resume.id]));
  for (const row of rowsOf(doc, "resumes")) {
    const k = key(s(row, "name"));
    const found = resumeByName.get(k);
    if (found) {
      map.resume.set(s(row, "id"), found);
      bump(skipped, "resumes");
      continue;
    }
    bump(created, "resumes");
    if (dryRun) {
      map.resume.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.resume.create({
      data: {
        userId,
        name: s(row, "name"),
        targetRole: s(row, "targetRole"),
        targetCompany: s(row, "targetCompany"),
        template: s(row, "template") || "harvard",
        accent: s(row, "accent") || "#000000",
        fontFamily: s(row, "fontFamily") || "serif",
        fontSize: int(row, "fontSize", 10),
        lineHeight: typeof row.lineHeight === "number" ? (row.lineHeight as number) : 1.2,
        pageMargin: int(row, "pageMargin", 48),
        showPhoto: bool(row, "showPhoto"),
        data: (row.data ?? {}) as Prisma.InputJsonValue,
        notes: s(row, "notes"),
        isFavorite: bool(row, "isFavorite"),
      },
    });
    resumeByName.set(k, made.id);
    map.resume.set(s(row, "id"), made.id);
  }

  // Lineage in a second pass: a variant can appear before its base in the file.
  if (!dryRun) {
    for (const row of rowsOf(doc, "resumes")) {
      const base = real(map.resume.get(s(row, "baseResumeId")));
      const self = real(map.resume.get(s(row, "id")));
      if (!base || !self || base === self) continue;
      await db.resume
        .update({ where: { id: self }, data: { baseResumeId: base } })
        .catch(() => problems.push(`Could not restore the lineage of resume "${s(row, "name")}".`));
    }
  }

  // Archived rows are matched too, keyed by their archived state, so a second
  // import of the same file finds the archived copy it wrote the first time
  // rather than writing another. Matching only live rows was the first fix and
  // it was half of one: it stopped a restore attaching a job to a binned
  // employer, and left every archived row duplicating without limit on a
  // re-import. `binned` is what keeps the two apart.
  const allCompanies = await db.company.findMany({ where: { userId } });
  const companyByName = new Map(
    allCompanies.map((company) => [key(company.name, binned(company.archivedAt)), company.id]),
  );
  for (const row of rowsOf(doc, "companies")) {
    const k = key(s(row, "name"), binned(date(row, "archivedAt")));
    const found = companyByName.get(k);
    if (found) {
      map.company.set(s(row, "id"), found);
      bump(skipped, "companies");
      continue;
    }
    bump(created, "companies");
    if (dryRun) {
      map.company.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.company.create({
      data: {
        userId,
        name: s(row, "name"),
        website: s(row, "website"),
        notes: s(row, "notes"),
        // The bin comes back as the bin. Without these two a restore puts
        // everything somebody deleted back on the board, which the export's own
        // comment promises it will not.
        archivedAt: date(row, "archivedAt"),
        archiveKey: s(row, "archiveKey"),
      },
    });
    companyByName.set(k, made.id);
    map.company.set(s(row, "id"), made.id);
  }

  const allContacts = await db.contact.findMany({ where: { userId } });
  const contactByKey = new Map(
    allContacts.map((row) => [key(row.name, row.email, binned(row.archivedAt)), row.id]),
  );
  for (const row of rowsOf(doc, "contacts")) {
    const k = key(s(row, "name"), s(row, "email"), binned(date(row, "archivedAt")));
    const found = contactByKey.get(k);
    if (found) {
      map.contact.set(s(row, "id"), found);
      bump(skipped, "contacts");
      continue;
    }
    bump(created, "contacts");
    if (dryRun) {
      map.contact.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.contact.create({
      data: {
        userId,
        name: s(row, "name"),
        title: s(row, "title"),
        email: s(row, "email"),
        phone: s(row, "phone"),
        relationship: s(row, "relationship"),
        linkedin: s(row, "linkedin"),
        twitter: s(row, "twitter"),
        instagram: s(row, "instagram"),
        github: s(row, "github"),
        website: s(row, "website"),
        otherLinks: strings(row, "otherLinks"),
        notes: s(row, "notes"),
        nextFollowUpAt: date(row, "nextFollowUpAt"),
        archivedAt: date(row, "archivedAt"),
      },
    });
    contactByKey.set(k, made.id);
    map.contact.set(s(row, "id"), made.id);
  }

  // Live rows only, here and for companies and contacts above. Matching a name
  // against something in the bin would attach a restored job to an employer the
  // person has deleted — a row on the board whose company is not. The archived
  // copy stays where it is and the import adds a live one beside it, which is
  // what `Company.archiveKey` exists to allow.
  const allApplications = await db.application.findMany({
    where: { userId },
    include: { company: { select: { name: true } } },
  });
  const applicationByKey = new Map(
    allApplications.map((row) => [
      key(row.company.name, row.roleTitle, binned(row.archivedAt)),
      row.id,
    ]),
  );
  const companyNameOf = new Map(
    rowsOf(doc, "companies").map((row) => [s(row, "id"), s(row, "name")]),
  );
  for (const row of rowsOf(doc, "applications")) {
    const k = key(
      companyNameOf.get(s(row, "companyId")) ?? "",
      s(row, "roleTitle"),
      binned(date(row, "archivedAt")),
    );
    const found = applicationByKey.get(k);
    if (found) {
      map.application.set(s(row, "id"), found);
      bump(skipped, "applications");
      continue;
    }
    // The employer check runs on a dry run too. It sat below the early return
    // once, so a file whose application named a company it did not carry was
    // reported as one creation with no problems by the preview and as zero
    // creations with a problem by the real thing — which defeats the only
    // reason to preview.
    const companyId = dryRun
      ? (map.company.get(s(row, "companyId")) ?? null)
      : real(map.company.get(s(row, "companyId")));
    if (!companyId) {
      problems.push(`Skipped "${s(row, "roleTitle")}": its employer is not in the file.`);
      bump(skipped, "applications");
      continue;
    }
    bump(created, "applications");
    if (dryRun) {
      map.application.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.application.create({
      data: {
        userId,
        companyId,
        roleTitle: s(row, "roleTitle"),
        stage: enumOf(Stage, s(row, "stage"), Stage.WISHLIST),
        interviewRound: int(row, "interviewRound"),
        roundLabel: s(row, "roundLabel"),
        jobUrl: s(row, "jobUrl"),
        jobDescription: s(row, "jobDescription"),
        location: s(row, "location"),
        workMode: s(row, "workMode"),
        salaryRange: s(row, "salaryRange"),
        notes: s(row, "notes"),
        appliedAt: date(row, "appliedAt"),
        nextFollowUpAt: date(row, "nextFollowUpAt"),
        closedAt: date(row, "closedAt"),
        archivedAt: date(row, "archivedAt"),
        resumeId: real(map.resume.get(s(row, "resumeId"))),
        sortOrder: int(row, "sortOrder"),
      },
    });
    applicationByKey.set(k, made.id);
    map.application.set(s(row, "id"), made.id);
  }

  const linked = async <T>(load: Promise<T[]>, left: (row: T) => string, right: (row: T) => string) =>
    new Set((await load).map((row) => `${left(row)} ${right(row)}`));

  await join(
    "contactCompanies",
    "contactId",
    "contact",
    "companyId",
    "company",
    await linked(
      db.contactCompany.findMany({ where: { contact: { userId } } }),
      (row) => row.contactId,
      (row) => row.companyId,
    ),
    (a, b) =>
      db.contactCompany.upsert({
        where: { contactId_companyId: { contactId: a, companyId: b } },
        update: {},
        create: { contactId: a, companyId: b },
      }),
  );
  await join(
    "applicationTags",
    "applicationId",
    "application",
    "tagId",
    "tag",
    await linked(
      db.applicationTag.findMany({ where: { application: { userId } } }),
      (row) => row.applicationId,
      (row) => row.tagId,
    ),
    (a, b) =>
      db.applicationTag.upsert({
        where: { applicationId_tagId: { applicationId: a, tagId: b } },
        update: {},
        create: { applicationId: a, tagId: b },
      }),
  );
  await join(
    "companyTags",
    "companyId",
    "company",
    "tagId",
    "tag",
    await linked(
      db.companyTag.findMany({ where: { company: { userId } } }),
      (row) => row.companyId,
      (row) => row.tagId,
    ),
    (a, b) =>
      db.companyTag.upsert({
        where: { companyId_tagId: { companyId: a, tagId: b } },
        update: {},
        create: { companyId: a, tagId: b },
      }),
  );
  await join(
    "contactTags",
    "contactId",
    "contact",
    "tagId",
    "tag",
    await linked(
      db.contactTag.findMany({ where: { contact: { userId } } }),
      (row) => row.contactId,
      (row) => row.tagId,
    ),
    (a, b) =>
      db.contactTag.upsert({
        where: { contactId_tagId: { contactId: a, tagId: b } },
        update: {},
        create: { contactId: a, tagId: b },
      }),
  );

  // Matched on parent, instant and the first words of the body: the same
  // interview logged twice would otherwise double on every re-import.
  const liveActivities = await db.activity.findMany({ where: { userId } });
  const activityKey = (row: { applicationId: string | null; contactId: string | null; occurredAt: Date; body: string }) =>
    key(row.applicationId ?? row.contactId, row.occurredAt.toISOString(), row.body.slice(0, 80));
  const activityByKey = new Map(liveActivities.map((row) => [activityKey(row), row.id]));
  const activityKeys = new Set(activityByKey.keys());
  for (const row of rowsOf(doc, "activities")) {
    const applicationId = map.application.get(s(row, "applicationId"));
    const contactId = map.contact.get(s(row, "contactId"));
    const parent = applicationId ?? contactId;
    if (!parent) {
      bump(skipped, "activities");
      continue;
    }
    const when = date(row, "occurredAt") ?? new Date(0);
    const k = key(parent, when.toISOString(), s(row, "body").slice(0, 80));
    if (activityKeys.has(k)) {
      const already = activityByKey.get(k);
      if (already) map.activity.set(s(row, "id"), already);
      bump(skipped, "activities");
      continue;
    }
    activityKeys.add(k);
    bump(created, "activities");
    if (dryRun || isDry(parent)) continue;
    const madeActivity = await db.activity.create({
      data: {
        userId,
        applicationId: real(applicationId),
        // Exactly one parent, application first. addActivity refuses a row with
        // both, so a file carrying one is already malformed; keeping the job is
        // the better half to keep.
        contactId: applicationId ? null : real(contactId),
        type: enumOf(ActivityType, s(row, "type"), ActivityType.NOTE),
        body: s(row, "body"),
        fromStage: maybeEnum(Stage, s(row, "fromStage")),
        toStage: maybeEnum(Stage, s(row, "toStage")),
        occurredAt: when,
      },
    });
    map.activity.set(s(row, "id"), madeActivity.id);
  }

  // The due date is in the key. Without it three standalone "Update resume"
  // tasks with three different dates collapse into one, because an unattached
  // task contributes no parent id to distinguish them.
  const liveTasks = await db.task.findMany({ where: { userId } });
  const taskKey = (title: string, applicationId: string | null, dueAt: Date | null) =>
    key(title, applicationId, dueAt ? dueAt.toISOString() : "");
  const taskKeys = new Set(liveTasks.map((row) => taskKey(row.title, row.applicationId, row.dueAt)));
  for (const row of rowsOf(doc, "tasks")) {
    const applicationId = map.application.get(s(row, "applicationId")) ?? null;
    const k = taskKey(s(row, "title"), applicationId, date(row, "dueAt"));
    if (taskKeys.has(k)) {
      bump(skipped, "tasks");
      continue;
    }
    taskKeys.add(k);
    bump(created, "tasks");
    if (dryRun) continue;
    await db.task.create({
      data: {
        userId,
        title: s(row, "title"),
        detail: s(row, "detail"),
        dueAt: date(row, "dueAt"),
        done: bool(row, "done"),
        doneAt: date(row, "doneAt"),
        applicationId: real(applicationId),
        companyId: real(map.company.get(s(row, "companyId"))),
        contactId: real(map.contact.get(s(row, "contactId"))),
        resumeId: real(map.resume.get(s(row, "resumeId"))),
        roleId: real(map.role.get(s(row, "roleId"))),
        noteId: real(map.note.get(s(row, "noteId"))),
        repeatUnit: maybeEnum(TaskRepeat, s(row, "repeatUnit")),
        repeatEvery: int(row, "repeatEvery", 1),
        repeatUntil: date(row, "repeatUntil"),
        repeatAnchor: date(row, "repeatAnchor"),
        repeatFrom: s(row, "repeatFrom") || null,
      },
    });
  }

  // The amounts are part of the key, not just the instant. Two versions
  // recorded on the same day — the opening number and the improved one, which
  // is exactly the shape this model exists to hold — share a receivedAt once
  // `toDate` has mapped both bare dates to 09:00, and one of them would be
  // dropped on every round trip.
  const liveOffers = await db.offer.findMany({ where: { userId } });
  const offerKey = (row: {
    applicationId: string;
    receivedAt: Date;
    baseAmount: number;
    bonusAmount: number;
    equityAmount: number;
    signOnAmount: number;
  }) =>
    key(
      row.applicationId,
      row.receivedAt.toISOString(),
      String(row.baseAmount),
      String(row.bonusAmount),
      String(row.equityAmount),
      String(row.signOnAmount),
    );
  const offerKeys = new Set(liveOffers.map(offerKey));
  for (const row of rowsOf(doc, "offers")) {
    const applicationId = map.application.get(s(row, "applicationId"));
    if (!applicationId) {
      bump(skipped, "offers");
      continue;
    }
    const when = date(row, "receivedAt") ?? new Date(0);
    const k = offerKey({
      applicationId,
      receivedAt: when,
      baseAmount: int(row, "baseAmount"),
      bonusAmount: int(row, "bonusAmount"),
      equityAmount: int(row, "equityAmount"),
      signOnAmount: int(row, "signOnAmount"),
    });
    if (offerKeys.has(k)) {
      bump(skipped, "offers");
      continue;
    }
    offerKeys.add(k);
    bump(created, "offers");
    if (dryRun || isDry(applicationId)) continue;
    await db.offer.create({
      data: {
        userId,
        applicationId,
        currency: s(row, "currency") || "USD",
        baseAmount: int(row, "baseAmount"),
        bonusAmount: int(row, "bonusAmount"),
        equityAmount: int(row, "equityAmount"),
        signOnAmount: int(row, "signOnAmount"),
        terms: s(row, "terms"),
        vesting: s(row, "vesting"),
        receivedAt: when,
        respondBy: date(row, "respondBy"),
        startsOn: date(row, "startsOn"),
      },
    });
  }

  const liveLetters = await db.letter.findMany({ where: { userId } });
  const letterKeys = new Set(liveLetters.map((row) => key(row.title, row.body.slice(0, 80))));
  for (const row of rowsOf(doc, "letters")) {
    const k = key(s(row, "title"), s(row, "body").slice(0, 80));
    if (letterKeys.has(k)) {
      bump(skipped, "letters");
      continue;
    }
    letterKeys.add(k);
    bump(created, "letters");
    if (dryRun) continue;
    await db.letter.create({
      data: {
        userId,
        kind: enumOf(LetterKind, s(row, "kind"), LetterKind.COVER_LETTER),
        title: s(row, "title"),
        body: s(row, "body"),
        recipient: s(row, "recipient"),
        applicationId: real(map.application.get(s(row, "applicationId"))),
        contactId: real(map.contact.get(s(row, "contactId"))),
        resumeId: real(map.resume.get(s(row, "resumeId"))),
        sentAt: date(row, "sentAt"),
      },
    });
  }

  await plain(
    "savedViews",
    (row) => key(s(row, "name")),
    (await db.savedView.findMany({ where: { userId } })).map((row) => key(row.name)),
    async (row) => {
      await db.savedView.create({
        data: { userId, name: s(row, "name"), query: s(row, "query") },
      });
    },
  );

  await plain(
    "stageTemplates",
    (row) => key(s(row, "stage"), s(row, "title")),
    (await db.stageTemplate.findMany({ where: { userId } })).map((row) => key(row.stage, row.title)),
    async (row) => {
      await db.stageTemplate.create({
        data: {
          userId,
          stage: enumOf(Stage, s(row, "stage"), Stage.APPLIED),
          title: s(row, "title"),
          detail: s(row, "detail"),
          dueInDays: typeof row.dueInDays === "number" ? (row.dueInDays as number) : null,
          enabled: bool(row, "enabled", true),
          sortOrder: int(row, "sortOrder"),
        },
      });
    },
  );

  await plain(
    "transferableSkills",
    (row) => key(s(row, "have")),
    (await db.transferableSkill.findMany({ where: { userId } })).map((row) => key(row.have)),
    async (row) => {
      await db.transferableSkill.create({
        data: { userId, have: s(row, "have"), covers: strings(row, "covers"), note: s(row, "note") },
      });
    },
  );

  // A cadence is one row per stage, so "already there" is any row for that
  // stage, whatever its number: the one on this instance is the newer choice.
  await plain(
    "stageCadences",
    (row) => key(s(row, "stage")),
    (await db.stageCadence.findMany({ where: { userId } })).map((row) => key(row.stage)),
    async (row) => {
      await db.stageCadence.create({
        data: {
          userId,
          stage: enumOf(Stage, s(row, "stage"), Stage.APPLIED),
          days: typeof row.days === "number" ? int(row, "days") : null,
        },
      });
    },
  );

  // Rounds after their applications and the timeline, so each finds its job
  // and the line it wrote. Matched on the job and the round number, which is
  // what a person means by "the second interview at Acme".
  const liveInterviews = await db.interview.findMany({ where: { userId } });
  const interviewByKey = new Map(
    liveInterviews.map((row) => [key(row.applicationId, String(row.round), row.label), row.id]),
  );
  for (const row of rowsOf(doc, "interviews")) {
    const applicationId = map.application.get(s(row, "applicationId"));
    if (!applicationId) {
      bump(skipped, "interviews");
      continue;
    }
    const k = key(applicationId, String(int(row, "round", 1)), s(row, "label"));
    const found = interviewByKey.get(k);
    if (found) {
      map.interview.set(s(row, "id"), found);
      bump(skipped, "interviews");
      continue;
    }
    bump(created, "interviews");
    if (dryRun || isDry(applicationId)) {
      map.interview.set(s(row, "id"), `dry:${k}`);
      continue;
    }
    const made = await db.interview.create({
      data: {
        userId,
        applicationId,
        round: int(row, "round", 1),
        label: s(row, "label"),
        format: enumOf(InterviewFormat, s(row, "format"), InterviewFormat.VIDEO),
        outcome: enumOf(InterviewOutcome, s(row, "outcome"), InterviewOutcome.SCHEDULED),
        scheduledAt: date(row, "scheduledAt"),
        durationMins: int(row, "durationMins"),
        location: s(row, "location"),
        prep: s(row, "prep"),
        debrief: s(row, "debrief"),
        calendarEventId: s(row, "calendarEventId"),
        activityId: real(map.activity.get(s(row, "activityId"))),
      },
    });
    interviewByKey.set(k, made.id);
    map.interview.set(s(row, "id"), made.id);
  }

  await join(
    "interviewers",
    "interviewId",
    "interview",
    "contactId",
    "contact",
    await linked(
      db.interviewInterviewer.findMany({ where: { interview: { userId } } }),
      (row) => row.interviewId,
      (row) => row.contactId,
    ),
    (a, b) =>
      db.interviewInterviewer.upsert({
        where: { interviewId_contactId: { interviewId: a, contactId: b } },
        update: {},
        create: { interviewId: a, contactId: b },
      }),
  );

  const liveQuestions = await db.interviewQuestion.findMany({ where: { userId } });
  const questionKeys = new Set(liveQuestions.map((row) => key(row.interviewId, row.key)));
  for (const row of rowsOf(doc, "interviewQuestions")) {
    const interviewId = map.interview.get(s(row, "interviewId"));
    const question = s(row, "question");
    if (!interviewId || !question) {
      bump(skipped, "interviewQuestions");
      continue;
    }
    const k = key(interviewId, s(row, "key") || question);
    if (questionKeys.has(k)) {
      bump(skipped, "interviewQuestions");
      continue;
    }
    questionKeys.add(k);
    bump(created, "interviewQuestions");
    if (dryRun || isDry(interviewId)) continue;
    await db.interviewQuestion.create({
      data: {
        userId,
        interviewId,
        kind: enumOf(QuestionKind, s(row, "kind"), QuestionKind.BEHAVIOURAL),
        question,
        key: s(row, "key") || question.toLowerCase(),
        answer: s(row, "answer"),
        confidence: int(row, "confidence"),
        better: s(row, "better"),
        sortOrder: int(row, "sortOrder"),
      },
    });
  }

  // Matched on who, about what, and when it was asked: one person asked twice
  // about one job a month apart is two asks, and both are the record.
  const liveReferrals = await db.referral.findMany({ where: { userId } });
  const referralKey = (contactId: string, about: string | null, askedOn: Date | null) =>
    key(contactId, about, askedOn ? askedOn.toISOString() : "");
  const referralKeys = new Set(
    liveReferrals.map((row) => referralKey(row.contactId, row.applicationId ?? row.companyId, row.askedOn)),
  );
  for (const row of rowsOf(doc, "referrals")) {
    const contactId = map.contact.get(s(row, "contactId"));
    if (!contactId) {
      problems.push("Skipped a referral: the person it was asked of is not in the file.");
      bump(skipped, "referrals");
      continue;
    }
    const applicationId = map.application.get(s(row, "applicationId")) ?? null;
    const companyId = map.company.get(s(row, "companyId")) ?? null;
    const askedOn = date(row, "askedOn");
    const k = referralKey(contactId, applicationId ?? companyId, askedOn);
    if (referralKeys.has(k)) {
      bump(skipped, "referrals");
      continue;
    }
    referralKeys.add(k);
    bump(created, "referrals");
    if (dryRun || isDry(contactId)) continue;
    await db.referral.create({
      data: {
        userId,
        contactId,
        applicationId: real(applicationId),
        companyId: real(companyId),
        status: enumOf(ReferralStatus, s(row, "status"), ReferralStatus.ASKED),
        askedOn: askedOn ?? new Date(),
        statusOn: date(row, "statusOn") ?? askedOn ?? new Date(),
        notes: s(row, "notes"),
        thankedAt: date(row, "thankedAt"),
      },
    });
  }

  const liveWatches = await db.companyWatch.findMany({ where: { userId } });
  const watchKeys = new Set(liveWatches.map((row) => key(row.provider, row.slug)));
  for (const row of rowsOf(doc, "companyWatches")) {
    const companyId = map.company.get(s(row, "companyId"));
    const provider = maybeEnum(BoardProvider, s(row, "provider"));
    if (!companyId || !provider || !s(row, "slug")) {
      bump(skipped, "companyWatches");
      continue;
    }
    const k = key(provider, s(row, "slug"));
    if (watchKeys.has(k)) {
      bump(skipped, "companyWatches");
      continue;
    }
    watchKeys.add(k);
    bump(created, "companyWatches");
    if (dryRun || isDry(companyId)) continue;
    await db.companyWatch.create({
      data: {
        userId,
        companyId,
        provider,
        slug: s(row, "slug"),
        boardUrl: s(row, "boardUrl"),
        titleTerms: strings(row, "titleTerms"),
        locationTerms: strings(row, "locationTerms"),
        // What it has already seen comes along, so the first look after a
        // restore does not propose every role on the board again.
        seenIds: strings(row, "seenIds"),
        proposed: int(row, "proposed"),
        enabled: bool(row, "enabled", true),
      },
    });
  }

  return { dryRun, created, skipped, problems };

  /** The shape six collections share: match on a key, else create. */
  async function plain(
    name: string,
    keyOf: (row: Row) => string,
    existing: string[],
    write: (row: Row) => Promise<void>,
  ) {
    const seen = new Set(existing);
    for (const row of rowsOf(doc, name)) {
      const k = keyOf(row);
      if (seen.has(k)) {
        bump(skipped, name);
        continue;
      }
      seen.add(k);
      bump(created, name);
      if (dryRun) continue;
      await write(row);
    }
  }

  /**
   * A join table: both sides through the id map, or the row is dropped.
   *
   * The upsert makes re-linking harmless in the database, but the report has to
   * be honest about it — a second import claiming it created four links when it
   * created none is exactly the kind of number that makes people stop reading
   * the report. So a link already present is counted as skipped.
   */
  async function join(
    name: string,
    leftField: string,
    leftMap: keyof typeof map,
    rightField: string,
    rightMap: keyof typeof map,
    existing: Set<string>,
    write: (left: string, right: string) => Promise<unknown>,
  ) {
    for (const row of rowsOf(doc, name)) {
      const left = map[leftMap].get(s(row, leftField));
      const right = map[rightMap].get(s(row, rightField));
      if (!left || !right || existing.has(`${left} ${right}`)) {
        bump(skipped, name);
        continue;
      }
      existing.add(`${left} ${right}`);
      bump(created, name);
      if (dryRun || isDry(left) || isDry(right)) continue;
      await write(left, right);
    }
  }
}
