import type { NoteKind } from "@prisma/client";
import { db } from "@/lib/db";
import type { PipelineView } from "@/lib/pipeline-fields";
import {
  parseWidths,
  withWidths,
  type ColumnList,
  type StoredWidths,
} from "@/lib/column-widths";
import { pick } from "@/lib/data/patch";
import { resolvePhoto } from "@/lib/photo";

/**
 * Every function here takes the owning userId as its first argument, and every
 * query filters on it. Making it a required positional parameter rather than an
 * optional field means the compiler rejects any call site that forgets it —
 * which is the whole defence against one tenant reading another's data.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * A patch that narrows to nothing still has to say whether the record exists —
 * and say it the same way the write path does, rather than surfacing a Prisma
 * stack trace to whoever called the tool.
 */
async function existingOrThrow<T>(
  model: { findFirst: (args: { where: { id: string; userId: string } }) => Promise<T | null> },
  id: string,
  userId: string,
  label: string,
): Promise<T> {
  const found = await model.findFirst({ where: { id, userId } });
  if (!found) throw new Error(`No ${label} with id ${id}`);
  return found;
}

export async function getProfile(userId: string) {
  const existing = await db.profile.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.profile.create({ data: { userId } });
}

/**
 * Which optional fields each pipeline view draws, for this person.
 *
 * A separate writer rather than a key on ProfilePatch, and deliberately: that
 * type is also what `importResume` accepts for its `profile` argument, and an
 * assistant filling in somebody's details off a CV has no business reshaping
 * their board. It also takes the view positionally, so a mistyped one is a
 * compile error rather than a key `pick` silently drops.
 */
export async function setPipelineFields(
  userId: string,
  view: PipelineView,
  fields: string[],
): Promise<{ boardFields: string[]; listFields: string[]; calendarFields: string[] }> {
  const column = { board: "boardFields", list: "listFields", calendar: "calendarFields" } as const;
  const profile = await db.profile.upsert({
    where: { userId },
    create: { userId, [column[view]]: fields },
    update: { [column[view]]: fields },
  });
  return {
    boardFields: profile.boardFields,
    listFields: profile.listFields,
    calendarFields: profile.calendarFields,
  };
}

/**
 * How wide this person's list columns are.
 *
 * A read-modify-write rather than a Json merge, because Prisma has no partial
 * update for a Json column: writing `{ pipeline: { stage: 160 } }` would
 * replace the whole map and drop the CRM's widths with it. The merge is in
 * `withWidths`, which is also where clamping happens, so a tool and a drag
 * handle cannot disagree about what 4000 means.
 *
 * `reset` is how a list goes back to its defaults: it clears that list's own
 * entry rather than writing every column's default width in, so a column added
 * to the catalogue later is sized by the catalogue and not by a stored number
 * that predates it.
 */
export async function setColumnWidths(
  userId: string,
  list: ColumnList,
  widths: Record<string, number>,
  options?: { reset?: boolean },
): Promise<StoredWidths> {
  const profile = await getProfile(userId);
  const next = withWidths(parseWidths(profile.columnWidths), list, widths, options);
  const saved = await db.profile.update({
    where: { userId },
    data: { columnWidths: next },
  });
  return parseWidths(saved.columnWidths);
}

export type ProfilePatch = Partial<{
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
  twitter: string;
  summary: string;
  background: string;
}>;

const PROFILE_COLUMNS = [
  "fullName", "headline", "email", "phone", "location", "website",
  "linkedin", "github", "twitter", "summary", "background",
] as const;

export async function updateProfile(userId: string, patch: ProfilePatch) {
  await getProfile(userId);
  return db.profile.update({ where: { userId }, data: pick(patch, PROFILE_COLUMNS) });
}

/**
 * Set or clear the profile photo.
 *
 * Takes what a person or an assistant actually has — a data URI from the file
 * picker, or a https link to a picture that already exists somewhere — and does
 * the resolving here so the settings page and `set_profile_photo` cannot end up
 * enforcing different limits. An empty string removes the photo.
 */
export async function setProfilePhoto(userId: string, input: string) {
  const resolved = await resolvePhoto(input);
  await getProfile(userId);
  await db.profile.update({ where: { userId }, data: { photo: resolved?.dataUri ?? "" } });
  return resolved
    ? { photo: true, bytes: resolved.bytes, type: resolved.type }
    : { photo: false, bytes: 0, type: "" };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type RoleInput = {
  company: string;
  title: string;
  employmentType?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  summary?: string;
  background?: string;
  tags?: string[];
};

export async function listRoles(userId: string) {
  return db.role.findMany({
    where: { userId },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }, { sortOrder: "asc" }],
    include: { _count: { select: { highlights: true } } },
  });
}

export async function getRole(userId: string, id: string) {
  return db.role.findFirst({
    where: { id, userId },
    include: { highlights: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
}

export async function createRole(userId: string, input: RoleInput) {
  const count = await db.role.count({ where: { userId } });
  return db.role.create({
    data: {
      userId,
      company: input.company,
      title: input.title,
      employmentType: input.employmentType ?? "Full-time",
      location: input.location ?? "",
      startDate: input.startDate ?? "",
      endDate: input.endDate ?? "",
      isCurrent: input.isCurrent ?? false,
      summary: input.summary ?? "",
      background: input.background ?? "",
      tags: input.tags ?? [],
      sortOrder: count,
    },
  });
}

const ROLE_COLUMNS = [
  "company", "title", "employmentType", "location", "startDate", "endDate",
  "isCurrent", "summary", "background", "tags",
] as const;

export async function updateRole(userId: string, id: string, patch: Partial<RoleInput>) {
  const data = pick(patch, ROLE_COLUMNS);
  if (Object.keys(data).length === 0) return existingOrThrow(db.role, id, userId, "role");
  const { count } = await db.role.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No role with id ${id}`);
  return db.role.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteRole(userId: string, id: string) {
  const { count } = await db.role.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No role with id ${id}`);
  return { id };
}

/** Non-destructive: adds text to the end of the role's background. */
export async function appendToRoleBackground(
  userId: string,
  id: string,
  text: string,
  heading?: string,
) {
  const role = await db.role.findFirst({ where: { id, userId } });
  if (!role) throw new Error(`No role with id ${id}`);
  const stamp = heading ? `\n\n## ${heading}\n` : "\n\n";
  const next = `${role.background}${role.background ? stamp : heading ? `## ${heading}\n` : ""}${text}`.trim();
  return db.role.update({ where: { id: role.id }, data: { background: next } });
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

export type HighlightInput = {
  roleId?: string | null;
  text: string;
  impact?: string;
  tags?: string[];
  strength?: number;
};

export async function listHighlights(userId: string, roleId?: string) {
  return db.highlight.findMany({
    where: { userId, archived: false, ...(roleId ? { roleId } : {}) },
    orderBy: [{ strength: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: { role: { select: { id: true, company: true, title: true } } },
  });
}

export async function createHighlight(userId: string, input: HighlightInput) {
  // A highlight may only hang off a role the same user owns.
  if (input.roleId) {
    const role = await db.role.findFirst({ where: { id: input.roleId, userId } });
    if (!role) throw new Error(`No role with id ${input.roleId}`);
  }
  return db.highlight.create({
    data: {
      userId,
      roleId: input.roleId ?? null,
      text: input.text,
      impact: input.impact ?? "",
      tags: input.tags ?? [],
      strength: clamp(input.strength ?? 3, 1, 5),
    },
  });
}

export async function createHighlights(userId: string, inputs: HighlightInput[]) {
  const created = [];
  for (const input of inputs) created.push(await createHighlight(userId, input));
  return created;
}

const HIGHLIGHT_COLUMNS = ["roleId", "text", "impact", "tags", "strength", "archived"] as const;

export async function updateHighlight(
  userId: string,
  id: string,
  patch: Partial<HighlightInput> & { archived?: boolean },
) {
  // Re-parenting is a read of whatever it points at — listHighlights and
  // searchMe join the role in — so the new parent must be the caller's own,
  // exactly as createHighlight already checks.
  if (patch.roleId) {
    const role = await db.role.findFirst({ where: { id: patch.roleId, userId } });
    if (!role) throw new Error(`No role with id ${patch.roleId}`);
  }
  const data = pick(patch, HIGHLIGHT_COLUMNS) as Record<string, unknown>;
  if (typeof patch.strength === "number") data.strength = clamp(patch.strength, 1, 5);
  if (Object.keys(data).length === 0) return existingOrThrow(db.highlight, id, userId, "highlight");
  const { count } = await db.highlight.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No highlight with id ${id}`);
  return db.highlight.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteHighlight(userId: string, id: string) {
  const { count } = await db.highlight.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No highlight with id ${id}`);
  return { id };
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listNotes(userId: string) {
  return db.note.findMany({
    where: { userId },
    orderBy: [{ kind: "asc" }, { pinned: "desc" }, { updatedAt: "desc" }],
  });
}

/**
 * The user's standing rules, for the briefing every client gets on connect.
 *
 * Kept deliberately small and ordered oldest-first so the briefing is stable
 * between sessions — a rule that moves around in the text reads as a different
 * rule. Capping happens at the call site, which knows the budget.
 */
export async function listGuardrails(userId: string) {
  return db.note.findMany({
    where: { userId, kind: "GUARDRAIL" },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, body: true },
  });
}

export async function createNote(
  userId: string,
  input: { title: string; body?: string; tags?: string[]; pinned?: boolean; kind?: NoteKind },
) {
  return db.note.create({
    data: {
      userId,
      title: input.title,
      body: input.body ?? "",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
      kind: input.kind ?? "NOTE",
    },
  });
}

export async function updateNote(
  userId: string,
  id: string,
  patch: Partial<{ title: string; body: string; tags: string[]; pinned: boolean; kind: NoteKind }>,
) {
  const data = pick(patch, ["title", "body", "tags", "pinned", "kind"] as const);
  if (Object.keys(data).length === 0) return existingOrThrow(db.note, id, userId, "note");
  const { count } = await db.note.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No note with id ${id}`);
  return db.note.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteNote(userId: string, id: string) {
  const { count } = await db.note.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No note with id ${id}`);
  return { id };
}

// ---------------------------------------------------------------------------
// Education / Projects / Skills / Certifications
// ---------------------------------------------------------------------------

export async function listEducation(userId: string) {
  return db.education.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { endDate: "desc" }] });
}

export async function createEducation(
  userId: string,
  input: {
    school: string;
    degree?: string;
    field?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    gpa?: string;
    details?: string;
  },
) {
  const count = await db.education.count({ where: { userId } });
  return db.education.create({ data: { ...input, userId, sortOrder: count } });
}

export type EducationPatch = Partial<{
  school: string;
  degree: string;
  field: string;
  location: string;
  startDate: string;
  endDate: string;
  gpa: string;
  details: string;
}>;

export async function updateEducation(userId: string, id: string, patch: EducationPatch) {
  const data = pick(patch, [
    "school", "degree", "field", "location", "startDate", "endDate", "gpa", "details",
  ] as const);
  if (Object.keys(data).length === 0) return existingOrThrow(db.education, id, userId, "education entry");
  const { count } = await db.education.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No education entry with id ${id}`);
  return db.education.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteEducation(userId: string, id: string) {
  const { count } = await db.education.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No education entry with id ${id}`);
  return { id };
}

export async function listProjects(userId: string) {
  return db.project.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
}

export async function createProject(
  userId: string,
  input: {
    name: string;
    role?: string;
    url?: string;
    description?: string;
    background?: string;
    tags?: string[];
    startDate?: string;
    endDate?: string;
  },
) {
  const count = await db.project.count({ where: { userId } });
  return db.project.create({
    data: { ...input, userId, tags: input.tags ?? [], sortOrder: count },
  });
}

export type ProjectPatch = Partial<{
  name: string;
  role: string;
  url: string;
  description: string;
  background: string;
  tags: string[];
  startDate: string;
  endDate: string;
}>;

export async function updateProject(userId: string, id: string, patch: ProjectPatch) {
  const data = pick(patch, [
    "name", "role", "url", "description", "background", "tags", "startDate", "endDate",
  ] as const);
  if (Object.keys(data).length === 0) return existingOrThrow(db.project, id, userId, "project");
  const { count } = await db.project.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No project with id ${id}`);
  return db.project.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteProject(userId: string, id: string) {
  const { count } = await db.project.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No project with id ${id}`);
  return { id };
}

export async function listSkillGroups(userId: string) {
  return db.skillGroup.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } });
}

export async function createSkillGroup(userId: string, input: { name: string; skills?: string[] }) {
  const count = await db.skillGroup.count({ where: { userId } });
  return db.skillGroup.create({
    data: { userId, name: input.name, skills: input.skills ?? [], sortOrder: count },
  });
}

export async function updateSkillGroup(
  userId: string,
  id: string,
  patch: { name?: string; skills?: string[] },
) {
  const data = pick(patch, ["name", "skills"] as const);
  if (Object.keys(data).length === 0) return existingOrThrow(db.skillGroup, id, userId, "skill group");
  const { count } = await db.skillGroup.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No skill group with id ${id}`);
  return db.skillGroup.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteSkillGroup(userId: string, id: string) {
  const { count } = await db.skillGroup.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No skill group with id ${id}`);
  return { id };
}

export async function listCertifications(userId: string) {
  return db.certification.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } });
}

export async function createCertification(
  userId: string,
  input: { name: string; issuer?: string; date?: string; url?: string },
) {
  const count = await db.certification.count({ where: { userId } });
  return db.certification.create({ data: { ...input, userId, sortOrder: count } });
}

export type CertificationPatch = Partial<{
  name: string;
  issuer: string;
  date: string;
  url: string;
}>;

export async function updateCertification(userId: string, id: string, patch: CertificationPatch) {
  const data = pick(patch, ["name", "issuer", "date", "url"] as const);
  if (Object.keys(data).length === 0) return existingOrThrow(db.certification, id, userId, "certification");
  const { count } = await db.certification.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No certification with id ${id}`);
  return db.certification.findFirstOrThrow({ where: { id, userId } });
}

export async function deleteCertification(userId: string, id: string) {
  const { count } = await db.certification.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No certification with id ${id}`);
  return { id };
}

// ---------------------------------------------------------------------------
// Search — the function Claude leans on hardest
// ---------------------------------------------------------------------------

export type SearchHit = {
  kind: "profile" | "role" | "highlight" | "note" | "project";
  id: string;
  title: string;
  subtitle: string;
  excerpt: string;
  score: number;
};

function scoreText(haystack: string, terms: string[]) {
  const lower = haystack.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index !== -1) {
      score += 1;
      index = lower.indexOf(term, index + term.length);
    }
  }
  return score;
}

function excerptAround(haystack: string, terms: string[], radius = 180) {
  const lower = haystack.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }
  if (at === -1) return haystack.slice(0, radius * 2).trim();
  const start = Math.max(0, at - radius / 2);
  const slice = haystack.slice(start, start + radius * 2).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + radius * 2 < haystack.length ? "…" : ""}`;
}

/**
 * Ranked full-text search across everything in one user's Me. Deliberately
 * done in application code rather than Postgres FTS so it works identically on
 * a fresh database with zero extensions to configure.
 */
export async function searchMe(userId: string, query: string, limit = 25): Promise<SearchHit[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9+#.-]/g, ""))
    .filter((t) => t.length > 1);

  const [profile, roles, highlights, notes, projects] = await Promise.all([
    getProfile(userId),
    db.role.findMany({ where: { userId } }),
    db.highlight.findMany({
      where: { userId, archived: false },
      include: { role: { select: { company: true, title: true } } },
    }),
    db.note.findMany({ where: { userId } }),
    db.project.findMany({ where: { userId } }),
  ]);

  const hits: SearchHit[] = [];

  if (terms.length === 0) {
    for (const role of roles.slice(0, limit)) {
      hits.push({
        kind: "role",
        id: role.id,
        title: `${role.title} @ ${role.company}`,
        subtitle: [role.startDate, role.isCurrent ? "Present" : role.endDate]
          .filter(Boolean)
          .join(" – "),
        excerpt: role.background.slice(0, 240),
        score: 1,
      });
    }
    return hits;
  }

  const profileBlob = [profile.summary, profile.background, profile.headline].join("\n");
  const profileScore = scoreText(profileBlob, terms);
  if (profileScore > 0) {
    hits.push({
      kind: "profile",
      id: profile.id,
      title: profile.fullName || "Profile",
      subtitle: profile.headline,
      excerpt: excerptAround(profileBlob, terms),
      score: profileScore,
    });
  }

  for (const role of roles) {
    const blob = [role.company, role.title, role.summary, role.background, role.tags.join(" ")].join(
      "\n",
    );
    const score = scoreText(blob, terms) + scoreText(`${role.company} ${role.title}`, terms) * 3;
    if (score > 0) {
      hits.push({
        kind: "role",
        id: role.id,
        title: `${role.title} @ ${role.company}`,
        subtitle: [role.startDate, role.isCurrent ? "Present" : role.endDate]
          .filter(Boolean)
          .join(" – "),
        excerpt: excerptAround(blob, terms),
        score,
      });
    }
  }

  for (const h of highlights) {
    const blob = [h.text, h.impact, h.tags.join(" ")].join("\n");
    const score = scoreText(blob, terms) * 2 + h.strength * 0.1;
    if (scoreText(blob, terms) > 0) {
      hits.push({
        kind: "highlight",
        id: h.id,
        title: h.text,
        subtitle: h.role ? `${h.role.title} @ ${h.role.company}` : "Unassigned",
        excerpt: h.impact,
        score,
      });
    }
  }

  for (const n of notes) {
    const blob = [n.title, n.body, n.tags.join(" ")].join("\n");
    const score = scoreText(blob, terms);
    if (score > 0) {
      hits.push({
        kind: "note",
        id: n.id,
        title: n.title,
        subtitle: n.tags.join(", "),
        excerpt: excerptAround(blob, terms),
        score,
      });
    }
  }

  for (const p of projects) {
    const blob = [p.name, p.role, p.description, p.background, p.tags.join(" ")].join("\n");
    const score = scoreText(blob, terms);
    if (score > 0) {
      hits.push({
        kind: "project",
        id: p.id,
        title: p.name,
        subtitle: p.role,
        excerpt: excerptAround(blob, terms),
        score,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Everything in one payload — used to seed a resume and by `get_me_snapshot`. */
export async function getMeSnapshot(userId: string) {
  const [profile, roles, highlights, education, projects, skillGroups, certifications, notes] =
    await Promise.all([
      getProfile(userId),
      listRoles(userId),
      listHighlights(userId),
      listEducation(userId),
      listProjects(userId),
      listSkillGroups(userId),
      listCertifications(userId),
      listNotes(userId),
    ]);
  return { profile, roles, highlights, education, projects, skillGroups, certifications, notes };
}

/**
 * Whether there is anything here yet.
 *
 * The briefing every MCP client receives branches on this, so it runs on every
 * `initialize` — which is why it asks for one id per table rather than counting,
 * and why it is a single round trip.
 *
 * It reads the Profile row directly rather than through `getProfile`, which
 * creates one when it finds none. A predicate whose whole job is to report that
 * nothing exists must not bring something into existence to answer, and it must
 * not then read its own row back as evidence of a filled-in workspace. The row
 * is judged on its contents for the same reason: blank fields are not a career.
 *
 * Deliberately Me-only. Someone can have applications and nothing filed here — that is
 * exactly the person this predicate exists to catch, because they have a
 * pipeline and nothing to build a resume out of.
 */
export async function meIsEmpty(userId: string) {
  const id = { select: { id: true } };
  const where = { where: { userId } };
  const [profile, role, highlight, note, education, project, skillGroup, certification] =
    await Promise.all([
      db.profile.findFirst({ where: { userId }, select: { fullName: true, headline: true, summary: true, background: true } }),
      db.role.findFirst({ ...where, ...id }),
      db.highlight.findFirst({ ...where, ...id }),
      db.note.findFirst({ ...where, ...id }),
      db.education.findFirst({ ...where, ...id }),
      db.project.findFirst({ ...where, ...id }),
      db.skillGroup.findFirst({ ...where, ...id }),
      db.certification.findFirst({ ...where, ...id }),
    ]);

  const profileIsBlank = !profile || ![profile.fullName, profile.headline, profile.summary, profile.background].some((field) => field?.trim());

  return profileIsBlank && !role && !highlight && !note && !education && !project && !skillGroup && !certification;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Import — a pasted resume fills in Me in one call
// ---------------------------------------------------------------------------

export type ResumeImportBullet = {
  text: string;
  impact?: string;
  tags?: string[];
  strength?: number;
};

export type ResumeImportRole = RoleInput & { bullets?: ResumeImportBullet[] };

export type ResumeImport = {
  profile?: ProfilePatch;
  roles?: ResumeImportRole[];
  education?: {
    school: string;
    degree?: string;
    field?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    gpa?: string;
    details?: string;
  }[];
  projects?: {
    name: string;
    role?: string;
    url?: string;
    description?: string;
    background?: string;
    tags?: string[];
    startDate?: string;
    endDate?: string;
  }[];
  skillGroups?: { name: string; skills?: string[] }[];
  certifications?: { name: string; issuer?: string; date?: string; url?: string }[];
};

const normalised = (value: string) => value.trim().toLowerCase();

/**
 * Fill in Me from a parsed resume, additively and in one transaction.
 *
 * The caller (an assistant reading a pasted document) does the parsing; this
 * does the filing, and its one promise is that nothing already here is lost:
 *
 *   - profile fields fill only where they are currently empty;
 *   - a role is skipped when one already exists at the same company+title
 *     whose start date matches — or when either side has no date to compare,
 *     which errs toward skipping. Within one payload the date IS part of the
 *     identity, so a boomerang career (two stints, same employer, same
 *     title, different dates) imports as two roles rather than losing one;
 *   - an education entry is skipped on school+degree+field, a project or
 *     certification on name — skipped, never merged into, so re-importing
 *     the same document is a no-op rather than a duplicate of someone's
 *     history;
 *   - a skill group with an existing name has its skills unioned in.
 *
 * Each created role gets its bullets saved as highlights, and the raw
 * material lands in the role's background so search_me can mine it.
 * The summary says exactly what was created and what was skipped.
 */
export async function importResume(userId: string, input: ResumeImport) {
  return db.$transaction(async (tx) => {
    // Profile: fill the blanks, leave everything a person already wrote.
    const profileFieldsFilled: string[] = [];
    if (input.profile) {
      const current =
        (await tx.profile.findUnique({ where: { userId } })) ??
        (await tx.profile.create({ data: { userId } }));
      const patch: Record<string, string> = {};
      for (const key of Object.keys(input.profile) as (keyof ProfilePatch)[]) {
        const incoming = input.profile[key]?.trim();
        if (!incoming) continue;
        if ((current[key] ?? "").trim()) continue;
        patch[key] = incoming;
        profileFieldsFilled.push(key);
      }
      if (Object.keys(patch).length) {
        await tx.profile.update({ where: { userId }, data: patch });
      }
    }

    // Roles, and their bullets as highlights.
    const rolesCreated: { id: string; company: string; title: string }[] = [];
    const rolesSkipped: { company: string; title: string }[] = [];
    let highlightsCreated = 0;
    if (input.roles?.length) {
      const existing = await tx.role.findMany({
        where: { userId },
        select: { company: true, title: true, startDate: true },
      });
      // company|title → the start dates already on file there. An incoming
      // role clashes when a stint at that company+title has the same start
      // date, or when either side has no date to compare against.
      const datesOnFile = new Map<string, string[]>();
      for (const role of existing) {
        const key = `${normalised(role.company)}|${normalised(role.title)}`;
        datesOnFile.set(key, [...(datesOnFile.get(key) ?? []), role.startDate.trim()]);
      }
      const clashesWithExisting = (key: string, startDate: string) => {
        const dates = datesOnFile.get(key);
        if (!dates) return false;
        return dates.some((date) => !date || !startDate || date === startDate);
      };
      // Within the payload, the date is part of a stint's identity — so a
      // boomerang career imports whole instead of losing its second stint.
      const seenInPayload = new Set<string>();
      let sortOrder = await tx.role.count({ where: { userId } });
      for (const role of input.roles) {
        const key = `${normalised(role.company)}|${normalised(role.title)}`;
        const startDate = (role.startDate ?? "").trim();
        const payloadKey = `${key}|${normalised(startDate)}`;
        if (seenInPayload.has(payloadKey) || clashesWithExisting(key, startDate)) {
          rolesSkipped.push({ company: role.company, title: role.title });
          continue;
        }
        seenInPayload.add(payloadKey);
        datesOnFile.set(key, [...(datesOnFile.get(key) ?? []), startDate]);
        const bullets = (role.bullets ?? []).filter((bullet) => bullet.text?.trim());
        // The background is what search_me mines; the resume's own lines are
        // the person's claims, so they belong there even before richer material.
        const background =
          role.background?.trim() ||
          (bullets.length
            ? `## Imported from resume\n\n${bullets
                .map((bullet) => `- ${bullet.text}${bullet.impact ? ` (${bullet.impact})` : ""}`)
                .join("\n")}`
            : "");
        const created = await tx.role.create({
          data: {
            userId,
            company: role.company,
            title: role.title,
            employmentType: role.employmentType ?? "Full-time",
            location: role.location ?? "",
            startDate: role.startDate ?? "",
            endDate: role.endDate ?? "",
            isCurrent: role.isCurrent ?? false,
            summary: role.summary ?? "",
            background,
            tags: role.tags ?? [],
            sortOrder: sortOrder++,
          },
        });
        rolesCreated.push({ id: created.id, company: created.company, title: created.title });
        if (bullets.length) {
          // One round trip per role, not per bullet: a full career inside one
          // interactive transaction is exactly where per-row awaits add up.
          // Strength is rounded because the column is an Int and a well-meant
          // 3.5 must not roll the whole import back.
          await tx.highlight.createMany({
            data: bullets.map((bullet) => ({
              userId,
              roleId: created.id,
              text: bullet.text,
              impact: bullet.impact ?? "",
              tags: bullet.tags ?? [],
              strength: clamp(Math.round(bullet.strength ?? 3), 1, 5),
            })),
          });
          highlightsCreated += bullets.length;
        }
      }
    }

    // Education, projects, certifications: create what is new, skip the rest.
    const education = { created: 0, skipped: 0 };
    if (input.education?.length) {
      const existing = await tx.education.findMany({
        where: { userId },
        select: { school: true, degree: true, field: true },
      });
      // field is part of the key so two degree-less programs at one school —
      // two certificates, say — both survive the import.
      const seen = new Set(
        existing.map((e) => `${normalised(e.school)}|${normalised(e.degree)}|${normalised(e.field)}`),
      );
      let sortOrder = await tx.education.count({ where: { userId } });
      for (const entry of input.education) {
        const key = `${normalised(entry.school)}|${normalised(entry.degree ?? "")}|${normalised(entry.field ?? "")}`;
        if (seen.has(key)) {
          education.skipped += 1;
          continue;
        }
        seen.add(key);
        await tx.education.create({ data: { ...entry, userId, sortOrder: sortOrder++ } });
        education.created += 1;
      }
    }

    const projects = { created: 0, skipped: 0 };
    if (input.projects?.length) {
      const existing = await tx.project.findMany({ where: { userId }, select: { name: true } });
      const seen = new Set(existing.map((p) => normalised(p.name)));
      let sortOrder = await tx.project.count({ where: { userId } });
      for (const entry of input.projects) {
        if (seen.has(normalised(entry.name))) {
          projects.skipped += 1;
          continue;
        }
        seen.add(normalised(entry.name));
        await tx.project.create({
          data: { ...entry, userId, tags: entry.tags ?? [], sortOrder: sortOrder++ },
        });
        projects.created += 1;
      }
    }

    // Skill groups merge: skills are a set, and "Languages" existing already
    // is not a reason to drop the three new ones the resume lists.
    const skillGroups = { created: 0, merged: 0 };
    if (input.skillGroups?.length) {
      const existing = await tx.skillGroup.findMany({ where: { userId } });
      let sortOrder = existing.length;
      for (const group of input.skillGroups) {
        const match = existing.find((g) => normalised(g.name) === normalised(group.name));
        if (match) {
          const merged = [...new Set([...match.skills, ...(group.skills ?? [])])];
          if (merged.length > match.skills.length) {
            await tx.skillGroup.update({ where: { id: match.id }, data: { skills: merged } });
            skillGroups.merged += 1;
          }
          continue;
        }
        await tx.skillGroup.create({
          data: { userId, name: group.name, skills: group.skills ?? [], sortOrder: sortOrder++ },
        });
        skillGroups.created += 1;
      }
    }

    const certifications = { created: 0, skipped: 0 };
    if (input.certifications?.length) {
      const existing = await tx.certification.findMany({ where: { userId }, select: { name: true } });
      const seen = new Set(existing.map((c) => normalised(c.name)));
      let sortOrder = await tx.certification.count({ where: { userId } });
      for (const entry of input.certifications) {
        if (seen.has(normalised(entry.name))) {
          certifications.skipped += 1;
          continue;
        }
        seen.add(normalised(entry.name));
        await tx.certification.create({ data: { ...entry, userId, sortOrder: sortOrder++ } });
        certifications.created += 1;
      }
    }

    return {
      profileFieldsFilled,
      roles: { created: rolesCreated, skipped: rolesSkipped },
      highlightsCreated,
      education,
      projects,
      skillGroups,
      certifications,
    };
    // A full career is dozens of round trips, and Prisma's default 5s
    // interactive-transaction timeout is sized for none of them crossing a
    // region. The one-shot adoption moment must not roll back over latency.
  }, { timeout: 60_000, maxWait: 10_000 });
}
