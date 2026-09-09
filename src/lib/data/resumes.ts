import { randomBytes } from "node:crypto";
import type { Prisma, Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { pick } from "@/lib/data/patch";
import {
  blankSection,
  emptyResumeDoc,
  parseResumeDoc,
  rid,
  type ResumeDoc,
} from "@/lib/resume-schema";
import { getMeSnapshot, listHighlights } from "@/lib/data/me";
import { fitReport } from "@/lib/resume-fit";
import { reorderDoc, type ReorderInput } from "@/lib/resume-reorder";
// Moved out to a pure module so the import can ask the same question of a
// re-imported resume, and so the editor can ask it in the browser about the
// bullet being typed: is there anything of this person's behind this?
import { backingFor, type EvidenceSource } from "@/lib/resume-evidence";
import { LINES_PER_PAGE } from "@/lib/resume-text";

// Rendering helpers live in resume-text.ts (client-safe); re-exported so server
// callers can keep reaching them through this module.
export { resumeToText, estimateLines, estimatePages, LINES_PER_PAGE } from "@/lib/resume-text";

export type ResumeMeta = Partial<{
  name: string;
  targetRole: string;
  targetCompany: string;
  template: string;
  accent: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageMargin: number;
  notes: string;
  isFavorite: boolean;
  showPhoto: boolean;
}>;

export type ResumeListOpts = {
  /** Case-insensitive match against name, target role and target company. */
  search?: string;
  /** "recent" (favourites first, then latest) is the default. */
  sort?: "recent" | "name" | "used";
};

/**
 * A resume's track record, computed from the applications it went out with.
 *
 * This is the question the whole product is arranged around — "which version
 * of me gets callbacks" — and it can only be answered because the documents
 * and the pipeline share a database. An application counts as interviewed if
 * it sits at screen-or-later now, or if its timeline records an interview or
 * a move to one: current stage alone would forget every application that
 * interviewed and then closed, which is most of them.
 */
export type ResumeOutcomes = {
  /** Applications that actually went out — anything past WISHLIST. */
  sent: number;
  /** Of those, how many got as far as talking to somebody. */
  interviewed: number;
  /** How many reached an offer. */
  offers: number;
};

const INTERVIEWED_STAGES: Stage[] = ["INTERVIEWING", "OFFER", "ACCEPTED"];
const OFFER_STAGES: Stage[] = ["OFFER", "ACCEPTED"];

export async function listResumes(userId: string, opts: ResumeListOpts = {}) {
  const search = opts.search?.trim();
  const orderBy: Prisma.ResumeOrderByWithRelationInput[] =
    opts.sort === "name"
      ? [{ name: "asc" }]
      : opts.sort === "used"
        ? [{ applications: { _count: "desc" } }, { updatedAt: "desc" }]
        : [{ isFavorite: "desc" }, { updatedAt: "desc" }];
  const rows = await db.resume.findMany({
    where: {
      userId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { targetRole: { contains: search, mode: "insensitive" as const } },
              { targetCompany: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy,
    include: {
      // Live applications only. A resume's track record is the case for using
      // it again, and an application the person deleted has no place in it —
      // the same rule pipelineStats and diagnoseSearch follow.
      _count: { select: { applications: { where: { archivedAt: null } } } },
      // The base's name is what the lineage chip prints; one join beats a
      // per-card lookup.
      baseResume: { select: { id: true, name: true } },
      // Only what the outcome summary needs: the current stage, and the slice
      // of the timeline that proves an interview or an offer ever happened.
      applications: {
        where: { archivedAt: null },
        select: {
          stage: true,
          activities: {
            where: {
              OR: [
                { type: "INTERVIEW" },
                { type: "OFFER" },
                { toStage: { in: INTERVIEWED_STAGES } },
              ],
            },
            select: { type: true, toStage: true },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const { applications, ...resume } = row;
    const outcomes: ResumeOutcomes = { sent: 0, interviewed: 0, offers: 0 };
    for (const application of applications) {
      if (application.stage === "WISHLIST") continue;
      outcomes.sent += 1;
      const reached = (stages: Stage[], type: "INTERVIEW" | "OFFER") =>
        stages.includes(application.stage) ||
        application.activities.some(
          (activity) =>
            activity.type === type || (activity.toStage !== null && stages.includes(activity.toStage)),
        );
      // An offer proves the interviews happened even when no move to a screen
      // was ever recorded — offers is a subset of interviewed, always.
      const offered = reached(OFFER_STAGES, "OFFER");
      if (offered || reached(INTERVIEWED_STAGES, "INTERVIEW")) outcomes.interviewed += 1;
      if (offered) outcomes.offers += 1;
    }
    return { ...resume, outcomes };
  });
}

/**
 * Just names, for pickers. The full listResumes now carries outcomes — an
 * applications-and-activities join per row — and three screens only ever
 * needed something to put in a dropdown.
 */
export async function listResumeNames(userId: string) {
  return db.resume.findMany({
    where: { userId },
    orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
    select: { id: true, name: true },
  });
}

export async function getResume(userId: string, id: string) {
  const resume = await db.resume.findFirst({
    where: { id, userId },
    include: {
      baseResume: { select: { id: true, name: true } },
      variants: { select: { id: true, name: true }, orderBy: { updatedAt: "desc" } },
      // Where this document actually went. The loop was half-built: an
      // application named its resume and a resume named nothing back, so
      // "which jobs did I send this to" meant reading the pipeline.
      applications: {
        // An archived application is a page this list would link to and the
        // pipeline would refuse to render.
        where: { archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          roleTitle: true,
          stage: true,
          appliedAt: true,
          company: { select: { id: true, name: true, website: true } },
        },
      },
    },
  });
  if (!resume) return null;
  return { ...resume, doc: parseResumeDoc(resume.data), photo: await resumePhoto(userId, resume) };
}

/**
 * The headshot a document should render, or "".
 *
 * The picture is never copied into the resume — it is read from the owner's
 * profile at render time, which is the whole point of one photo across every
 * document. Reading it here rather than in each page means the editor preview,
 * the print page, the PDF and the public link cannot disagree about whether a
 * face appears.
 */
async function resumePhoto(userId: string, resume: { showPhoto: boolean }) {
  if (!resume.showPhoto) return "";
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { photo: true },
  });
  return profile?.photo ?? "";
}

export async function createResume(
  userId: string,
  input: ResumeMeta & { data?: unknown; seedFromMe?: boolean; baseResumeId?: string },
) {
  const doc = input.data
    ? parseResumeDoc(input.data)
    : input.seedFromMe
      ? await buildDocFromMe(userId)
      : emptyResumeDoc();

  // Lineage may only point at the caller's own resume — the id arrives from
  // outside, and the foreign key alone would happily cross tenants.
  if (input.baseResumeId) {
    const base = await db.resume.findFirst({
      where: { id: input.baseResumeId, userId },
      select: { id: true },
    });
    if (!base) throw new Error(`No resume with id ${input.baseResumeId}`);
  }

  return db.resume.create({
    data: {
      userId,
      baseResumeId: input.baseResumeId ?? null,
      name: input.name?.trim() || "Untitled resume",
      targetRole: input.targetRole ?? "",
      targetCompany: input.targetCompany ?? "",
      template: input.template ?? "harvard",
      accent: input.accent ?? "#000000",
      fontFamily: input.fontFamily ?? "serif",
      fontSize: input.fontSize ?? 10,
      lineHeight: input.lineHeight ?? 1.2,
      pageMargin: input.pageMargin ?? 48,
      notes: input.notes ?? "",
      showPhoto: input.showPhoto ?? false,
      data: doc as unknown as object,
    },
  });
}

const RESUME_COLUMNS = [
  "name", "targetRole", "targetCompany", "template", "accent", "fontFamily",
  "fontSize", "lineHeight", "pageMargin", "notes", "isFavorite", "showPhoto",
] as const;

export async function updateResume(
  userId: string,
  id: string,
  patch: ResumeMeta & { data?: unknown },
) {
  // slug / visibility / publishedAt are deliberately absent: publishing goes
  // through publishResume, which allocates an unguessable slug and keeps the
  // promise that a withdrawn address stays dead.
  const data: Record<string, unknown> = pick(patch, RESUME_COLUMNS);
  if (patch.data !== undefined) data.data = parseResumeDoc(patch.data) as unknown as object;
  // A patch of nothing-we-recognise leaves Prisma with no columns to write, and
  // updateMany then reports zero rows — which would raise "no such resume" for a
  // resume that plainly exists. Check ownership directly instead.
  if (Object.keys(data).length === 0) {
    const current = await db.resume.findFirst({ where: { id, userId } });
    if (!current) throw new Error(`No resume with id ${id}`);
    return current;
  }
  const { count } = await db.resume.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error(`No resume with id ${id}`);
  return db.resume.findFirstOrThrow({ where: { id, userId } });
}

/**
 * Point a resume at the one it was tailored from, or unlink it.
 *
 * duplicate_resume sets this for you; this is for documents that already
 * existed, or to re-point one. Refuses itself and refuses a cycle: A tailored
 * from B tailored from A is a lineage that cannot be read in either direction.
 * Both resumes are re-checked against this user — the relation carries no
 * userId of its own.
 */
export async function setResumeBase(userId: string, id: string, baseResumeId: string | null) {
  const resume = await db.resume.findFirst({ where: { id, userId } });
  if (!resume) throw new Error(`No resume with id ${id}`);
  if (baseResumeId === null) {
    return db.resume.update({ where: { id }, data: { baseResumeId: null } });
  }
  if (baseResumeId === id) throw new Error("A resume cannot be tailored from itself.");

  let cursor: string | null = baseResumeId;
  const seen = new Set<string>([id]);
  while (cursor) {
    if (seen.has(cursor)) throw new Error("That would make a loop: the two are already related.");
    seen.add(cursor);
    const next: { baseResumeId: string | null } | null = await db.resume.findFirst({
      where: { id: cursor, userId },
      select: { baseResumeId: true },
    });
    if (!next) throw new Error(`No resume with id ${cursor}`);
    cursor = next.baseResumeId;
  }
  return db.resume.update({ where: { id }, data: { baseResumeId } });
}

/** One bullet, and the material that stands behind it. */
export type BulletEvidence = {
  /** Where the bullet sits: "Staff Engineer — Stripe". */
  entry: string;
  bullet: string;
  /** Best matches first, strongest three at most. */
  evidence: {
    highlightId: string;
    text: string;
    role: string;
    /** 0-1 word overlap with the bullet. 1 means it was used verbatim. */
    similarity: number;
  }[];
};

/**
 * Which of a person's own material backs each claim in a document.
 *
 * Derived rather than recorded, deliberately. A provenance field written when
 * a document is seeded would be right for those documents and silently wrong
 * for every one an assistant wrote or a person edited — and a wrong provenance
 * record is worse than none, because it is believed.
 *
 * A bullet with no evidence is not an accusation. It means the claim is not on
 * file yet — which is exactly the list worth walking before an interview,
 * since those are the lines nobody can expand on from their own notes. When an
 * entry names a role, only that role's highlights can back it: crediting a
 * Stripe line to a note about another employer discredits the whole thing.
 */
/**
 * What to cut when a resume runs long.
 *
 * Ranks rather than measures. The page count here is the same estimate
 * preview_resume_text reports and carries the same caveat — it cannot see the
 * type size or the margins, and only a browser can. export_resume_pdf renders
 * one and reports the real number. What this answers is the question the real
 * number leaves you with: which pieces are big enough to be worth cutting.
 */
export async function resumeFitReport(userId: string, id: string) {
  const resume = await db.resume.findFirst({ where: { id, userId } });
  if (!resume) throw new Error(`No resume with id ${id}`);
  const doc = parseResumeDoc(resume.data);
  const report = fitReport(doc, LINES_PER_PAGE);
  return {
    resume: { id: resume.id, name: resume.name },
    ...report,
    fontSize: resume.fontSize,
    lineHeight: resume.lineHeight,
    pageMargin: resume.pageMargin,
  };
}

/**
 * Move one section, entry or bullet without rewriting the document.
 *
 * The alternative is update_resume, which replaces what you send: an assistant
 * reordering two sections that way has to reproduce the whole document from
 * memory, and the failure mode is silently dropping half a job. This reads,
 * moves and writes back, so nothing can be lost on the way.
 */
export async function reorderResume(userId: string, id: string, input: ReorderInput) {
  const resume = await db.resume.findFirst({ where: { id, userId } });
  if (!resume) throw new Error(`No resume with id ${id}`);
  const { doc, moved } = reorderDoc(parseResumeDoc(resume.data), input);
  await db.resume.update({ where: { id: resume.id }, data: { data: doc as unknown as object } });
  return {
    resume: { id: resume.id, name: resume.name },
    moved,
    sections: doc.sections.map((section, at) => ({
      position: at + 1,
      heading: section.heading || section.kind,
    })),
  };
}

/**
 * The person's own material, in the shape the matcher takes.
 *
 * Highlights only, deliberately: they are the lines somebody chose to keep, and
 * a role's raw background is a wall of text that would match almost anything
 * once it is long enough. The editor's inline marks and this tool have to agree
 * about what counts, so there is one answer to "what is evidence" and it is
 * here.
 */
function evidenceSourcesFrom(
  highlights: Awaited<ReturnType<typeof listHighlights>>,
): EvidenceSource[] {
  return highlights.map((highlight) => ({
    id: highlight.id,
    text: highlight.text,
    role: [highlight.role?.title, highlight.role?.company].filter(Boolean).join(" — "),
    roleId: highlight.roleId,
  }));
}

/**
 * What the editor needs to mark a bullet backed or not, as it is typed.
 *
 * Sent to the browser with the document, so it is capped: a career of five
 * hundred highlights would be a payload nobody asked for on every editor load,
 * and the strongest match for a given bullet is overwhelmingly in the most
 * recent material anyway. The cap is generous enough that hitting it is rare
 * and visible in the number rather than silent.
 */
export async function evidenceSources(userId: string, limit = 400) {
  const highlights = await listHighlights(userId);
  return evidenceSourcesFrom(highlights).slice(0, limit);
}

/**
 * Put one job from Me into a resume that already exists.
 *
 * The alternative was update_resume, which replaces the whole document: adding
 * a job you left off meant sending every word of the resume back, and losing a
 * bullet on the way is a silent kind of loss. This reads, inserts and writes,
 * so nothing else in the document can change.
 *
 * The role is named by id or by what it is called — "the Stripe job" is what a
 * person says, and an assistant that just called list_roles has the id. A job
 * already in the document is refused rather than doubled: two identical entries
 * is never what anyone meant, and the error says where the existing one is.
 */
/**
 * The draft somebody gets for free once their history is in.
 *
 * Reuse before create, so calling this twice — a retried tool call, a second
 * import, a person pressing the button again — cannot mint two documents called
 * "Base resume". Says whether it made one, because "here is your resume" and
 * "here is the resume you already had" are different sentences.
 */
export async function ensureBaseResume(userId: string, name = "Base resume") {
  const existing = (await listResumes(userId)).find((resume) => resume.name === name);
  if (existing) return { id: existing.id, name: existing.name, created: false };
  const made = await createResume(userId, { name, seedFromMe: true });
  return { id: made.id, name: made.name, created: true };
}

export async function addRoleToResume(
  userId: string,
  resumeId: string,
  input: { role: string; section?: string; position?: number; bullets?: number },
) {
  const resume = await db.resume.findFirst({ where: { id: resumeId, userId } });
  if (!resume) throw new Error(`No resume with id ${resumeId}`);

  const roles = await db.role.findMany({
    where: { userId },
    orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }],
    include: { highlights: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (roles.length === 0) {
    throw new Error("There are no roles in Me yet — create_role first, or import a resume.");
  }
  const needle = input.role.trim().toLowerCase();
  const role =
    roles.find((row) => row.id === input.role.trim()) ??
    roles.find((row) => row.company.toLowerCase() === needle || row.title.toLowerCase() === needle) ??
    roles.find(
      (row) =>
        row.company.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle),
    );
  if (!role) {
    const options = roles.map((row) => `${row.title} — ${row.company}`).join("; ");
    throw new Error(`No role matching "${input.role}". Me has: ${options}.`);
  }

  const doc = parseResumeDoc(resume.data);
  const sectionAt = input.section
    ? doc.sections.findIndex(
        (section) =>
          section.kind === "experience" &&
          (section.id === input.section ||
            section.heading.toLowerCase() === input.section!.trim().toLowerCase()),
      )
    : doc.sections.findIndex((section) => section.kind === "experience");
  if (sectionAt === -1) {
    throw new Error(
      input.section
        ? `No experience section called "${input.section}" in this resume.`
        : "This resume has no experience section to put a job in.",
    );
  }
  const section = doc.sections[sectionAt];

  const already = section.experience.findIndex(
    (entry) =>
      entry.roleId === role.id ||
      (entry.company.toLowerCase() === role.company.toLowerCase() &&
        entry.title.toLowerCase() === role.title.toLowerCase()),
  );
  if (already !== -1) {
    throw new Error(
      `"${role.title} — ${role.company}" is already in this resume, at position ${already + 1}.`,
    );
  }

  const entry = entryFromRole(role, role.highlights, input.bullets ?? 6);
  const at =
    input.position === undefined
      ? section.experience.length
      : Math.min(Math.max(input.position, 1), section.experience.length + 1) - 1;
  const experience = [...section.experience];
  experience.splice(at, 0, entry);
  const next: ResumeDoc = {
    ...doc,
    sections: doc.sections.map((each, index) =>
      index === sectionAt ? { ...each, experience } : each,
    ),
  };
  await db.resume.update({
    where: { id: resume.id },
    data: { data: next as unknown as object },
  });

  return {
    resume: { id: resume.id, name: resume.name },
    added: {
      role: `${role.title} — ${role.company}`,
      section: section.heading || "Experience",
      position: at + 1,
      bullets: entry.bullets.length,
      available: role.highlights.length,
    },
  };
}

export async function traceResumeEvidence(userId: string, id: string) {
  const resume = await db.resume.findFirst({ where: { id, userId } });
  if (!resume) throw new Error(`No resume with id ${id}`);
  const highlights = await listHighlights(userId);
  const doc = parseResumeDoc(resume.data);

  const sources = evidenceSourcesFrom(highlights);
  const rows: BulletEvidence[] = [];
  for (const section of doc.sections) {
    for (const item of section.experience) {
      const entry = [item.title, item.company].filter(Boolean).join(" — ") || "Role";
      for (const bullet of item.bullets) {
        const { sources: found } = backingFor(bullet, sources, item.roleId);
        rows.push({
          entry,
          bullet,
          evidence: found.map((source) => ({
            highlightId: source.id,
            text: source.text,
            role: source.role,
            similarity: source.similarity,
          })),
        });
      }
    }
  }
  return {
    resume: { id: resume.id, name: resume.name },
    bullets: rows,
    unbacked: rows.filter((row) => row.evidence.length === 0).length,
  };
}

/**
 * Which document somebody means by "my resume".
 *
 * The original, not a copy: something with variants hanging off it and no base
 * of its own. A favourite wins among equals, because starring one is the
 * clearest statement a person can make about which it is. Returns null for an
 * empty workspace, which the caller has to handle rather than guess around.
 */
export async function pickBaseResume(userId: string) {
  const rows = await db.resume.findMany({
    where: { userId },
    include: { _count: { select: { variants: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (rows.length === 0) return null;
  const originals = rows.filter((row) => row.baseResumeId === null);
  const pool = originals.length > 0 ? originals : rows;
  return (
    pool.find((row) => row.isFavorite) ??
    [...pool].sort((a, b) => b._count.variants - a._count.variants)[0]
  );
}

/**
 * The four-step move this app made everybody do by hand: copy the base, rename
 * it for the job, attach it, open it.
 *
 * With nothing to copy it builds the first document from what is on file
 * rather than refusing — a new person asking for a tailored resume should get
 * one, not an error telling them to go and make a resume first.
 */
export async function createResumeForApplication(
  userId: string,
  applicationId: string,
  options?: { baseId?: string; name?: string },
) {
  const application = await db.application.findFirst({
    where: { id: applicationId, userId, archivedAt: null },
    include: { company: { select: { name: true } } },
  });
  if (!application) throw new Error(`No application with id ${applicationId}`);

  const base = options?.baseId
    ? await db.resume.findFirst({ where: { id: options.baseId, userId } })
    : await pickBaseResume(userId);
  if (options?.baseId && !base) throw new Error(`No resume with id ${options.baseId}`);

  const name = options?.name?.trim() || `${application.company.name} — ${application.roleTitle}`;

  const created = base
    ? await duplicateResume(userId, base.id, name)
    : await createResume(userId, { name, seedFromMe: true });

  const resume = await db.resume.update({
    where: { id: created.id },
    data: { targetCompany: application.company.name, targetRole: application.roleTitle },
  });

  await db.application.update({ where: { id: applicationId }, data: { resumeId: resume.id } });

  return {
    resume,
    basedOn: base ? { id: base.id, name: base.name } : null,
    seededFromMe: !base,
    attachedTo: {
      id: application.id,
      company: application.company.name,
      roleTitle: application.roleTitle,
    },
  };
}

export async function deleteResume(userId: string, id: string) {
  const { count } = await db.resume.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error(`No resume with id ${id}`);
  return { id };
}

export async function duplicateResume(userId: string, id: string, name?: string) {
  const source = await db.resume.findFirst({ where: { id, userId } });
  if (!source) throw new Error(`No resume with id ${id}`);
  return db.resume.create({
    data: {
      userId,
      name: name ?? `${source.name} (copy)`,
      targetRole: source.targetRole,
      targetCompany: source.targetCompany,
      template: source.template,
      accent: source.accent,
      fontFamily: source.fontFamily,
      fontSize: source.fontSize,
      lineHeight: source.lineHeight,
      pageMargin: source.pageMargin,
      showPhoto: source.showPhoto,
      notes: source.notes,
      data: source.data as object,
      // The copy remembers what it was tailored from — flattened to the root,
      // so a copy of a variant still points at the base and lineage stays one
      // level deep, which is all the grid or the diff ever shows.
      baseResumeId: source.baseResumeId ?? source.id,
    },
  });
}

/**
 * Builds a complete first-draft resume document straight from Me.
 * Every role becomes an experience entry; its strongest highlights become the
 * bullets. This is what "Build from my history" and the MCP
 * `create_resume(seed_from_me: true)` call use.
 */

/**
 * A highlight's printable bullet.
 *
 * `impact` is a separate structured field, but a polished highlight almost
 * always already states its own number — people write "Cut p95 latency 40%" in
 * `text` and then fill `impact` with the same thing. Appending unconditionally
 * printed it twice, which made most seeded bullets unusable on first run. So
 * append only when it genuinely adds something.
 */
function bulletFor(text: string, impact: string) {
  const trimmed = impact.trim();
  if (!trimmed) return text;
  const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return flatten(text).includes(flatten(trimmed)) ? text : `${text} — ${trimmed}`;
}

/**
 * One job, as a resume entry.
 *
 * Shared by the whole-document seed and by pulling a single role into a
 * document that already exists, so a job you add later is the same shape as the
 * ones that came with the draft — down to `roleId`, which is what lets the
 * editor narrow a bullet's evidence to this job's own material rather than the
 * whole career.
 *
 * Six bullets, because that is what fits under one job before the page runs
 * out, and the strongest are first in the list already.
 */
export function entryFromRole(
  role: {
    id: string;
    company: string;
    title: string;
    location: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    summary: string;
  },
  highlights: { text: string; impact: string }[],
  limit = 6,
) {
  return {
    id: rid("exp"),
    roleId: role.id,
    company: role.company,
    title: role.title,
    location: role.location,
    startDate: role.startDate,
    endDate: role.endDate,
    isCurrent: role.isCurrent,
    summary: role.summary,
    bullets: highlights.slice(0, limit).map((highlight) => bulletFor(highlight.text, highlight.impact)),
  };
}

export async function buildDocFromMe(userId: string): Promise<ResumeDoc> {
  const { profile, roles, highlights, education, projects, skillGroups, certifications } =
    await getMeSnapshot(userId);

  const links = [
    profile.website && { label: "Website", url: profile.website },
    profile.linkedin && { label: "LinkedIn", url: profile.linkedin },
    profile.github && { label: "GitHub", url: profile.github },
  ].filter(Boolean) as { label: string; url: string }[];

  const doc: ResumeDoc = {
    header: {
      name: profile.fullName,
      title: profile.headline,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      links,
    },
    sections: [],
  };

  const summary = blankSection("summary");
  summary.text = profile.summary;
  doc.sections.push(summary);

  const experience = blankSection("experience");
  experience.experience = roles.map((role) =>
    entryFromRole(
      role,
      highlights.filter((highlight) => highlight.roleId === role.id),
    ),
  );
  doc.sections.push(experience);

  if (projects.length) {
    const section = blankSection("projects");
    section.projects = projects.map((p) => ({
      id: rid("prj"),
      name: p.name,
      role: p.role,
      url: p.url,
      startDate: p.startDate,
      endDate: p.endDate,
      description: p.description,
      bullets: [],
    }));
    doc.sections.push(section);
  }

  if (education.length) {
    const section = blankSection("education");
    section.education = education.map((e) => ({
      id: rid("edu"),
      school: e.school,
      degree: e.degree,
      field: e.field,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      details: e.details ? [e.details] : [],
    }));
    doc.sections.push(section);
  }

  if (skillGroups.length) {
    const section = blankSection("skills");
    section.skills = skillGroups.map((g) => ({ name: g.name, skills: g.skills }));
    doc.sections.push(section);
  }

  if (certifications.length) {
    const section = blankSection("certifications");
    section.certifications = certifications.map((c) => ({
      name: c.name,
      issuer: c.issuer,
      date: c.date,
    }));
    doc.sections.push(section);
  }

  return doc;
}

/** Flat plain-text rendering — handy for Claude to review its own output. */
// ---------------------------------------------------------------------------
// Publishing — a resume gets a URL you can paste into an application form
// ---------------------------------------------------------------------------

/**
 * Slugs are the entire privacy model for an unlisted resume, so the random part
 * carries the weight: 12 base32 characters is ~60 bits, which is not guessable
 * and not enumerable. The readable stem is there so the link doesn't look like
 * spam when you paste it — it only ever contains the resume's own name, which
 * whoever you send it to is about to read anyway.
 */
const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes

function randomSuffix(bytes = 12) {
  const buffer = randomBytes(bytes);
  let out = "";
  for (const byte of buffer) out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  return out;
}

function slugStem(name: string) {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return stem || "resume";
}

/**
 * Publish a resume at /r/<slug> and return the row.
 *
 * Idempotent while published: calling it again keeps the same slug, so a link
 * already sent out doesn't rot. Publishing something that was unpublished mints
 * a NEW slug, because the old link was withdrawn deliberately and reviving it
 * would undo that.
 */
export async function publishResume(userId: string, id: string) {
  const resume = await db.resume.findFirst({ where: { id, userId } });
  if (!resume) throw new Error(`No resume with id ${id}`);

  if (resume.visibility === "UNLISTED" && resume.slug) return resume;

  // The unique index is the real arbiter; retry on the (vanishingly unlikely)
  // collision rather than trusting a pre-check that another request can race.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${slugStem(resume.name)}-${randomSuffix()}`;
    try {
      const { count } = await db.resume.updateMany({
        where: { id, userId },
        data: { slug, visibility: "UNLISTED", publishedAt: new Date() },
      });
      if (count === 0) throw new Error(`No resume with id ${id}`);
      return db.resume.findFirstOrThrow({ where: { id, userId } });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "P2002") throw error;
    }
  }
  throw new Error("Could not allocate a unique link. Try again.");
}

/**
 * Withdraw the public link. The slug is cleared, not just hidden, so the URL is
 * dead for good — publishing again gives a different one.
 */
export async function unpublishResume(userId: string, id: string) {
  const { count } = await db.resume.updateMany({
    where: { id, userId },
    data: { slug: null, visibility: "PRIVATE", publishedAt: null },
  });
  if (count === 0) throw new Error(`No resume with id ${id}`);
  return db.resume.findFirstOrThrow({ where: { id, userId } });
}

/**
 * THE ONE ANONYMOUS READ IN THIS DIRECTORY.
 *
 * Every other function here takes a userId first and filters on it, which is
 * how the compiler keeps tenants apart. A public page has no user, so this one
 * cannot — and that makes it the single place where a mistake is a data leak
 * rather than a type error. It is therefore deliberately narrow:
 *
 *   - it filters on visibility, so a correct slug for a resume that was never
 *     published (or has been withdrawn) returns null rather than the document;
 *   - it returns ONLY what the page renders. `notes` are the owner's private
 *     tailoring notes and must never appear here; nor does userId, nor the
 *     applications this resume is attached to.
 *
 * Do not widen the select. If a public page needs another field, add it here
 * explicitly and ask whether it is really safe to show a stranger.
 */
export async function getResumeBySlug(slug: string) {
  if (!slug) return null;
  const resume = await db.resume.findFirst({
    where: { slug, visibility: "UNLISTED" },
    select: {
      name: true,
      data: true,
      template: true,
      accent: true,
      fontFamily: true,
      fontSize: true,
      lineHeight: true,
      pageMargin: true,
      showPhoto: true,
      updatedAt: true,
      // Only to look up the owner's photo below, and dropped before this
      // returns: the public page renders a document, and the id of the person
      // behind it is not part of one.
      userId: true,
    },
  });
  if (!resume) return null;

  // Publishing a resume with the photo switched on is the consent, and it is
  // the only thing about the owner this reads. With it off nothing is fetched
  // at all — the picture is not loaded and then hidden.
  const photo = await resumePhoto(resume.userId, resume);
  const { userId, ...row } = resume;
  return { ...row, doc: parseResumeDoc(resume.data), photo };
}
