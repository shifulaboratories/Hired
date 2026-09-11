import type { NoteKind, Prisma, Profile } from "@prisma/client";
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
import { bulletSimilarity, SAME_BULLET } from "@/lib/resume-similarity";
import { isValidTimeZone, SERVER_ZONE } from "@/lib/time";

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

/**
 * The person's profile, or a blank one if they have never had a row.
 *
 * A READ, and that word is load-bearing. This used to create the row when it
 * found none, which was convenient and wrong: `get_profile`, `search_me` and
 * `get_me_snapshot` all go through here, and the three of them are the most
 * called reads on the server. A tool that writes cannot claim readOnlyHint, so
 * the three had to declare themselves writers, and a client that asks before
 * letting a tool write asked before answering "what do you know about me".
 *
 * The row is created by the things that actually change it — see
 * `ensureProfile` — so a person who has never saved anything simply has an
 * empty profile rather than an empty row, which is the same answer without the
 * write. `timeZoneOf` has read it this way all along, for the same reason.
 */
export async function getProfile(userId: string): Promise<Profile> {
  const existing = await db.profile.findUnique({ where: { userId } });
  return existing ?? blankProfile(userId);
}

/**
 * What an account with no profile row looks like.
 *
 * Every column's own default, spelled out rather than inferred, so a field
 * added to the model shows up here as a type error instead of as undefined at
 * render time. The id is empty because there is no row to name, and the only
 * place that reads it is a search hit a blank profile cannot produce. It never
 * leaves the server either way: the MCP payload drops the id and updatedAt, so
 * nothing has to reason about an empty id or a 1970 timestamp.
 */
function blankProfile(userId: string): Profile {
  return {
    id: "",
    userId,
    fullName: "",
    headline: "",
    email: "",
    phone: "",
    location: "",
    website: "",
    linkedin: "",
    github: "",
    twitter: "",
    summary: "",
    background: "",
    boardFields: [],
    listFields: [],
    calendarFields: [],
    columnWidths: {},
    photo: "",
    tourSeenAt: null,
    timeZone: "",
    weeklyDigest: false,
    dailyNudge: false,
    digestHour: 8,
    lastDigestOn: "",
    lastNudgeOn: "",
    // The epoch rather than now: there is no row, so there is no moment it was
    // last written, and a timestamp of "just now" would be a lie a caller could
    // sort on.
    updatedAt: new Date(0),
  };
}

/**
 * Create the profile row if it is missing, and return it.
 *
 * The write half of `getProfile`. Every path that is about to `update` the row
 * calls this first, because `update` on a row that does not exist throws.
 *
 * The empty `update: {}` this used to pass looked like the tidiest possible
 * upsert and was not atomic: with nothing to update, Prisma reads and then
 * inserts rather than emitting ON CONFLICT, and eight concurrent first writes
 * on a fresh account produced seven unique-constraint failures. That is not a
 * hypothetical race — a new account has the browser seeding its time zone at
 * the same moment an assistant writes the profile it was just asked to fill in.
 *
 * Assigning userId to itself gives the update clause a field, which is what
 * makes it one statement. Re-measured the same way afterwards: no failures.
 */
async function ensureProfile(userId: string): Promise<Profile> {
  return db.profile.upsert({ where: { userId }, create: { userId }, update: { userId } });
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
  const profile = await ensureProfile(userId);
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
  await ensureProfile(userId);
  return db.profile.update({ where: { userId }, data: pick(patch, PROFILE_COLUMNS) });
}

/**
 * Which calendar this person is on.
 *
 * A separate writer rather than a key on ProfilePatch, for the same reason
 * setPipelineFields is one: that type is what `importResume` hands an
 * assistant, and reading a CV is no reason to move somebody's clock. Empty
 * clears it back to the host's own zone.
 *
 * Validated here rather than at the edges — a zone this runtime does not know
 * would make every Intl call in src/lib/time.ts throw at render time, a long
 * way from whoever typed it.
 */
export async function setTimeZone(userId: string, timeZone: string) {
  const clean = timeZone.trim();
  if (!isValidTimeZone(clean)) {
    throw new Error(
      `"${clean}" is not a time zone this server knows. Use an IANA name like "America/New_York", or "" for the server's own clock.`,
    );
  }
  await ensureProfile(userId);
  const saved = await db.profile.update({ where: { userId }, data: { timeZone: clean } });
  return { timeZone: saved.timeZone };
}

/**
 * The zone to compute this person's civil dates in, for callers that only have
 * a userId. Deliberately does NOT create a profile row: it is called on read
 * paths, several of them per render, and a read should not write.
 */
export async function timeZoneOf(userId: string): Promise<string> {
  const row = await db.profile.findUnique({ where: { userId }, select: { timeZone: true } });
  return row?.timeZone ?? SERVER_ZONE;
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
  await ensureProfile(userId);
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

/**
 * Ranked search across everything in one person's Me.
 *
 * This used to load every role, highlight, note and project into Node and
 * count substrings. That was honest about one thing — it needed no extensions
 * — and wrong about two. It read the whole of somebody's career history on
 * every keystroke, and it could only find words spelled exactly as typed:
 * "managing engineers" missed "managed three engineers", which is the
 * difference between a resume that cites your own material and one that says
 * you have none.
 *
 * Postgres full-text search fixes both and costs nothing to deploy. `english`
 * is a built-in configuration, not an extension, so `DATABASE_URL` is still the
 * only thing a self-hoster sets.
 *
 * Three decisions worth knowing:
 *
 * - **OR, not AND.** `websearch_to_tsquery` would AND the terms, so
 *   "kubernetes cost savings" would return nothing unless one record held all
 *   three. The query is built by lexing the search text and joining the
 *   lexemes with `|`; ts_rank_cd then ranks a record covering three terms above
 *   one covering a single term, which is the behaviour people actually expect.
 * - **Prefixes on real words only.** Lexemes of four characters or more get
 *   `:*`, so "kubern" finds Kubernetes. Shorter ones stay exact, because "c"
 *   from "C++" as a prefix would match half the database.
 * - **Weighting is a rank term, not a stored vector.** The WHERE clause uses
 *   exactly the expression the GIN indexes are built on; the title-vs-body
 *   weighting is computed afterwards, on the handful of rows that matched.
 *   If those two expressions ever drift, the index simply goes unused and the
 *   search still returns the right answer.
 */
export async function searchMe(userId: string, query: string, limit = 25): Promise<SearchHit[]> {
  const text = query.trim();
  if (text === "") return recentRoles(userId, limit);

  const rows = await db.$queryRaw<
    { kind: string; id: string; title: string; subtitle: string; score: number; excerpt: string }[]
  >`
    WITH q AS (
      SELECT (
        SELECT string_agg(
                 CASE WHEN length(lexeme) >= 4
                      THEN quote_literal(lexeme) || ':*'
                      ELSE quote_literal(lexeme) END,
                 ' | ')
        FROM unnest(to_tsvector('english', ${text}))
      )::tsquery AS tsq
    ),
    docs AS (
      SELECT 'profile' AS kind, p.id AS id,
             CASE WHEN coalesce(p."fullName", '') = '' THEN 'Profile' ELSE p."fullName" END AS title,
             coalesce(p."headline", '') AS subtitle,
             coalesce(p."fullName", '') || ' ' || coalesce(p."headline", '') AS head,
             coalesce(p."fullName", '') || ' ' || coalesce(p."headline", '') || ' ' ||
               coalesce(p."summary", '') || ' ' || coalesce(p."brainDump", '') AS body,
             0::float8 AS boost
      FROM "Profile" p WHERE p."userId" = ${userId}

      UNION ALL
      SELECT 'role', r.id,
             r."title" || ' @ ' || r."company",
             coalesce(r."startDate", '') || (CASE
               WHEN r."isCurrent" THEN ' – Present'
               WHEN coalesce(r."endDate", '') <> '' THEN ' – ' || r."endDate"
               ELSE '' END),
             coalesce(r."company", '') || ' ' || coalesce(r."title", ''),
             coalesce(r."company", '') || ' ' || coalesce(r."title", '') || ' ' ||
               coalesce(r."summary", '') || ' ' || coalesce(r."brainDump", '') || ' ' ||
               hired_words(r."tags"),
             0::float8
      FROM "Role" r WHERE r."userId" = ${userId}

      UNION ALL
      SELECT 'highlight', h.id,
             h."text",
             coalesce(hr."title" || ' @ ' || hr."company", 'Unassigned'),
             coalesce(h."text", ''),
             coalesce(h."text", '') || ' ' || coalesce(h."impact", '') || ' ' ||
               hired_words(h."tags"),
             -- A highlight is already the polished version of something, and
             -- strength is the person's own judgement of it. Worth a nudge, not
             -- worth outranking a direct hit.
             h."strength" * 0.05
      FROM "Highlight" h LEFT JOIN "Role" hr ON hr.id = h."roleId"
      WHERE h."userId" = ${userId} AND h."archived" = false

      UNION ALL
      SELECT 'note', n.id,
             n."title",
             array_to_string(n."tags", ', '),
             coalesce(n."title", ''),
             coalesce(n."title", '') || ' ' || coalesce(n."body", '') || ' ' ||
               hired_words(n."tags"),
             0::float8
      FROM "Note" n WHERE n."userId" = ${userId}

      UNION ALL
      SELECT 'project', pr.id,
             pr."name",
             coalesce(pr."role", ''),
             coalesce(pr."name", '') || ' ' || coalesce(pr."role", ''),
             coalesce(pr."name", '') || ' ' || coalesce(pr."role", '') || ' ' ||
               coalesce(pr."description", '') || ' ' || coalesce(pr."brainDump", '') || ' ' ||
               hired_words(pr."tags"),
             0::float8
      FROM "Project" pr WHERE pr."userId" = ${userId}
    )
    SELECT d.kind, d.id, d.title, d.subtitle,
           (ts_rank_cd(to_tsvector('english', d.head), q.tsq) * 3
            + ts_rank_cd(to_tsvector('english', d.body), q.tsq)
            + d.boost)::float8 AS score,
           ts_headline('english', d.body, q.tsq,
             'MaxFragments=1,MaxWords=44,MinWords=16,StartSel=~~,StopSel=~~,FragmentDelimiter= … ') AS excerpt
    FROM docs d, q
    WHERE q.tsq IS NOT NULL AND to_tsvector('english', d.body) @@ q.tsq
    ORDER BY score DESC, d.title ASC
    LIMIT ${Math.max(1, Math.trunc(limit))}
  `;

  return rows.map((row) => ({
    kind: row.kind as SearchHit["kind"],
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    // ts_headline has no way to mark a match with nothing, so it marks with a
    // sentinel we strip. Plain text is what every caller of this wants.
    excerpt: row.excerpt.replaceAll("~~", "").trim(),
    score: row.score,
  }));
}

/**
 * What comes back for an empty query: the roles, newest first.
 *
 * Not nothing, because the empty search is what an assistant sends when it is
 * orienting itself — "what has this person done" — and a blank answer reads as
 * an empty account.
 */
async function recentRoles(userId: string, limit: number): Promise<SearchHit[]> {
  const roles = await db.role.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: Math.max(1, Math.trunc(limit)),
  });
  return roles.map((role) => ({
    kind: "role" as const,
    id: role.id,
    title: `${role.title} @ ${role.company}`,
    subtitle: [role.startDate, role.isCurrent ? "Present" : role.endDate].filter(Boolean).join(" – "),
    excerpt: role.background.slice(0, 240),
    score: 1,
  }));
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
 * It reads the Profile row directly rather than through `getProfile`. That used
 * to matter because `getProfile` created a row when it found none, and a
 * predicate whose whole job is to report that nothing exists must not bring
 * something into existence to answer. `getProfile` is a pure read now, so this
 * is no longer load-bearing — but the row is still judged on its contents
 * rather than its existence, because blank fields are not a career.
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
 *   - a role already on file — same company+title, matching start date, or
 *     either side undated, which errs toward matching — is NOT created again.
 *     By default the incoming bullets are merged into it: the ones it does not
 *     already have become highlights, and the resume's own wording is appended
 *     to its background. Nothing on the role is edited or removed. Pass
 *     `onExisting: "skip"` for the older behaviour, where a match meant the
 *     whole entry was dropped. Within one payload the date IS part of the
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
 * The summary says exactly what was created, merged into and skipped.
 *
 * `dryRun` does all of the reading and none of the writing, so an assistant can
 * say what an import would do before doing it. It runs inside the same
 * transaction and then rolls it back, which is the only way the preview and the
 * real thing cannot disagree.
 */
/**
 * Add to a role already on file whatever the incoming resume says that it does
 * not already say. Never edits and never removes: this is the only way a
 * second import of an updated document is worth running, and it has to be as
 * safe to repeat as the first one was.
 *
 * A bullet counts as already on file when it reads the same as one of the
 * role's highlights — `bulletSimilarity`, the same measure trace_resume_evidence
 * uses to say a claim traces back to something the person wrote. Exact-match
 * only would file "Cut invoice errors by 22%" beside "Cut invoice errors by 22
 * percent" and call it new.
 */
async function mergeIntoRole(
  tx: Prisma.TransactionClient,
  userId: string,
  roleId: string,
  incoming: ResumeImportRole,
) {
  const role = await tx.role.findFirstOrThrow({
    where: { id: roleId, userId },
    select: { background: true, highlights: { select: { text: true } } },
  });
  const known = role.highlights.map((highlight) => highlight.text);
  const bullets = (incoming.bullets ?? []).filter((bullet) => {
    const text = bullet.text?.trim();
    if (!text) return false;
    return !known.some((existing) => bulletSimilarity(existing, text) >= SAME_BULLET);
  });

  if (bullets.length) {
    await tx.highlight.createMany({
      data: bullets.map((bullet) => ({
        userId,
        roleId,
        text: bullet.text,
        impact: bullet.impact ?? "",
        tags: bullet.tags ?? [],
        strength: clamp(Math.round(bullet.strength ?? 3), 1, 5),
      })),
    });
  }

  // The background is raw material, so it grows rather than being replaced —
  // the same promise append_role_background makes. Only the lines that were
  // actually new go in, under a dated heading, so a person reading it later can
  // tell when this arrived.
  const addition = bullets
    .map((bullet) => `- ${bullet.text}${bullet.impact ? ` (${bullet.impact})` : ""}`)
    .join("\n");
  let backgroundAppended = false;
  if (addition && !role.background.includes(addition)) {
    const heading = `## From a resume imported ${new Date().toISOString().slice(0, 10)}`;
    await tx.role.update({
      where: { id: roleId },
      data: {
        background: role.background.trim()
          ? `${role.background.trim()}\n\n${heading}\n\n${addition}`
          : `${heading}\n\n${addition}`,
      },
    });
    backgroundAppended = true;
  }

  return { bulletsAdded: bullets.length, backgroundAppended };
}

export async function importResume(
  userId: string,
  input: ResumeImport,
  options?: ImportOptions,
) {
  // A full career is dozens of round trips, and Prisma's default 5s
  // interactive-transaction timeout is sized for none of them crossing a
  // region. The one-shot adoption moment must not roll back over latency.
  return db.$transaction((tx) => runImport(tx, userId, input, options), {
    timeout: 60_000,
    maxWait: 10_000,
  });
}

export type ImportOptions = { onExisting?: "merge" | "skip" };
export type ImportReport = Awaited<ReturnType<typeof runImport>>;

async function runImport(
  tx: Prisma.TransactionClient,
  userId: string,
  input: ResumeImport,
  options?: ImportOptions,
) {
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
  // A role already on file that the incoming resume had something new to say
  // about. This is the whole reason a second import is worth running.
  const rolesMerged: {
    id: string;
    company: string;
    title: string;
    bulletsAdded: number;
    backgroundAppended: boolean;
  }[] = [];
  let highlightsCreated = 0;
  const merge = (options?.onExisting ?? "merge") === "merge";
  if (input.roles?.length) {
    const existing = await tx.role.findMany({
      where: { userId },
      select: { id: true, company: true, title: true, startDate: true },
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
    // The row behind a clash, so the merge has something to merge into. Same
    // rule as clashesWithExisting, and the first match wins: two stints that
    // both match an undated incoming role are indistinguishable, and picking
    // the earlier one is at least deterministic.
    const roleBehind = (key: string, startDate: string) =>
      existing.find(
        (role) =>
          `${normalised(role.company)}|${normalised(role.title)}` === key &&
          (!role.startDate.trim() || !startDate || role.startDate.trim() === startDate),
      );
    // Within the payload, the date is part of a stint's identity — so a
    // boomerang career imports whole instead of losing its second stint.
    const seenInPayload = new Set<string>();
    let sortOrder = await tx.role.count({ where: { userId } });
    for (const role of input.roles) {
      const key = `${normalised(role.company)}|${normalised(role.title)}`;
      const startDate = (role.startDate ?? "").trim();
      const payloadKey = `${key}|${normalised(startDate)}`;
      // The same stint twice in one payload is a parse artefact, not news.
      if (seenInPayload.has(payloadKey)) {
        rolesSkipped.push({ company: role.company, title: role.title });
        continue;
      }
      if (clashesWithExisting(key, startDate)) {
        const onFile = merge ? roleBehind(key, startDate) : undefined;
        if (!onFile) {
          rolesSkipped.push({ company: role.company, title: role.title });
          continue;
        }
        const added = await mergeIntoRole(tx, userId, onFile.id, role);
        highlightsCreated += added.bulletsAdded;
        if (added.bulletsAdded > 0 || added.backgroundAppended) {
          rolesMerged.push({
            id: onFile.id,
            company: onFile.company,
            title: onFile.title,
            ...added,
          });
        } else {
          rolesSkipped.push({ company: role.company, title: role.title });
        }
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
    roles: { created: rolesCreated, merged: rolesMerged, skipped: rolesSkipped },
    highlightsCreated,
    education,
    projects,
    skillGroups,
    certifications,
  };
}

/**
 * What an import would do, without doing it.
 *
 * Runs the real thing inside a transaction and then throws, so Prisma rolls it
 * back — a second implementation that only reads would be a second set of rules
 * about what counts as already on file, and the two would drift the first time
 * either was touched. The report is the same shape the real import returns.
 */
export async function previewResumeImport(
  userId: string,
  input: ResumeImport,
  options?: ImportOptions,
) {
  const ROLLBACK = "resume-import-dry-run";
  try {
    await db.$transaction(
      async (tx) => {
        const report = await runImport(tx, userId, input, options);
        // The only way out of a transaction without a commit.
        throw Object.assign(new Error(ROLLBACK), { report });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK) {
      return (error as Error & { report: ImportReport }).report;
    }
    throw error;
  }
  throw new Error("The dry run committed, which it must never do.");
}
