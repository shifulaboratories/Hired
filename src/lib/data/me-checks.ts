import { db } from "@/lib/db";
import { resumeEvidence } from "@/lib/background";
import { disagreements, figuresIn, type Figure, type FigureUnit } from "@/lib/figures";
import { backingFor, type EvidenceSource } from "@/lib/resume-evidence";
import { parseResumeDoc } from "@/lib/resume-schema";
import { careerTimeline, GAP_MONTHS, monthName } from "@/lib/timeline";
import { listHighlights, listRoles, listSkillGroups, searchMe } from "@/lib/data/me";

/**
 * Checks that read across everything in Me and say what does not add up.
 *
 * Each of these answers a question a person should ask before a resume goes
 * out and rarely does, because the answer is spread over a dozen roles:
 *
 *   figureConflicts   is any number stated two different ways?
 *   unbackedSkills    which listed skills does nothing I have written back up?
 *   highlightUsage    which highlights have I used, and which never?
 *   timelineFor       where are the gaps and the overlaps?
 *
 * All read-only. userId first and positional, like the rest of src/lib/data.
 */

// ---------------------------------------------------------------------------
// Figures stated two ways
// ---------------------------------------------------------------------------

type FigureSource = { kind: "role" | "highlight" | "note" | "resume" | "profile"; id: string; title: string };
type SourcedFigure = Figure & { source: FigureSource };

export type FigureConflict = {
  /** The job it is about, or null for material that belongs to none. */
  roleId: string | null;
  role: string;
  /** What the figures count, stemmed: "follower", "budget". */
  key: string;
  unit: FigureUnit;
  figures: { raw: string; sentence: string; source: FigureSource }[];
};

/**
 * Candidate disagreements between figures about the same thing in the same
 * job. The grouping is a heuristic (src/lib/figures.ts says exactly how), so
 * these are things to LOOK at, not verdicts — which is also why a pair in one
 * sentence ("from $1M to $3M") is never reported unless the sentence says "or"
 * or "both".
 *
 * Scope is what stops two jobs' budgets being called a conflict: a role's
 * background, its highlights and resume entries that name it (by roleId, or by
 * company) are one scope; notes that mention a company join that company's
 * scope; everything else is compared only with everything else.
 */
export async function figureConflicts(userId: string, limit = 25): Promise<FigureConflict[]> {
  const [roles, highlights, notes, resumes, profile] = await Promise.all([
    listRoles(userId),
    listHighlights(userId),
    db.note.findMany({ where: { userId, kind: "NOTE" }, select: { id: true, title: true, body: true } }),
    db.resume.findMany({ where: { userId }, select: { id: true, name: true, data: true } }),
    db.profile.findUnique({ where: { userId }, select: { id: true, summary: true } }),
  ]);

  const byCompany = new Map(roles.map((role) => [role.company.trim().toLowerCase(), role.id]));
  const scopes = new Map<string, SourcedFigure[]>();
  let sentence = 0;
  const add = (scope: string, text: string, source: FigureSource) => {
    if (!text.trim()) return;
    const { figures, sentences } = figuresIn(text, sentence);
    sentence += sentences;
    const list = scopes.get(scope) ?? [];
    for (const figure of figures) list.push({ ...figure, source });
    scopes.set(scope, list);
  };
  /** A company named in free text puts that sentence in the company's scope. */
  const scopeOf = (text: string) => {
    const lower = text.toLowerCase();
    for (const [company, id] of byCompany) {
      if (company.length >= 3 && lower.includes(company)) return id;
    }
    return "";
  };

  for (const role of roles) {
    // Evidence only: a caveat is not a claim, and an open question is already
    // on the list of things to settle, with its doubt written out.
    add(role.id, resumeEvidence(role.background), {
      kind: "role",
      id: role.id,
      title: `${role.title} @ ${role.company}`,
    });
    if (role.summary) add(role.id, role.summary, { kind: "role", id: role.id, title: `${role.title} @ ${role.company}` });
  }
  for (const highlight of highlights) {
    add(highlight.roleId ?? scopeOf(highlight.text), `${highlight.text}. ${highlight.impact}`, {
      kind: "highlight",
      id: highlight.id,
      title: highlight.text.slice(0, 60),
    });
  }
  for (const note of notes) {
    for (const paragraph of note.body.split(/\n\s*\n/)) {
      add(scopeOf(paragraph) || scopeOf(note.title), paragraph, { kind: "note", id: note.id, title: note.title });
    }
  }
  for (const resume of resumes) {
    const doc = parseResumeDoc(resume.data);
    const source: FigureSource = { kind: "resume", id: resume.id, title: resume.name };
    for (const section of doc.sections) {
      if (section.kind === "summary") add("", section.text, source);
      for (const item of section.experience) {
        const scope = item.roleId && roles.some((role) => role.id === item.roleId)
          ? item.roleId
          : byCompany.get(item.company.trim().toLowerCase()) ?? "";
        add(scope, [item.summary, ...item.bullets].join("\n"), source);
      }
    }
  }
  if (profile?.summary) add("", profile.summary, { kind: "profile", id: profile.id, title: "Profile summary" });

  const label = new Map(roles.map((role) => [role.id, `${role.title} @ ${role.company}`]));
  const out: FigureConflict[] = [];
  for (const [scope, figures] of scopes) {
    for (const group of disagreements(figures)) {
      out.push({
        roleId: scope || null,
        role: label.get(scope) ?? "Not tied to one job",
        key: group.key,
        unit: group.unit,
        figures: group.figures.map((figure) => ({
          raw: figure.raw,
          sentence: figure.sentence.length > 220 ? `${figure.sentence.slice(0, 219)}…` : figure.sentence,
          source: figure.source,
        })),
      });
    }
  }
  // Most figures first: a number stated five ways is worth reading before one
  // stated twice.
  out.sort((a, b) => b.figures.length - a.figures.length);
  return out.slice(0, Math.max(1, Math.trunc(limit)));
}

// ---------------------------------------------------------------------------
// Skills with nothing behind them
// ---------------------------------------------------------------------------

/**
 * Every listed skill, and whether anything written about real work mentions
 * it: a role, a highlight, a project or a note. The profile does not count —
 * a summary that says "Python" is the claim, not the evidence.
 *
 * Same full-text search as search_me, in batches of five so forty skills are
 * not forty simultaneous queries on one person's connection pool.
 */
export async function unbackedSkills(userId: string) {
  const groups = await listSkillGroups(userId);
  const skills = groups.flatMap((group) =>
    group.skills.map((skill) => ({ skill: skill.trim(), group: group.name, groupId: group.id })),
  ).filter((row) => row.skill);

  const results: {
    skill: string;
    group: string;
    groupId: string;
    backedBy: { kind: string; id: string; title: string } | null;
  }[] = [];
  for (let i = 0; i < skills.length; i += 5) {
    const batch = skills.slice(i, i + 5);
    const hits = await Promise.all(batch.map((row) => searchMe(userId, row.skill, 5)));
    batch.forEach((row, index) => {
      const found = hits[index].find((hit) => hit.kind !== "profile");
      results.push({ ...row, backedBy: found ? { kind: found.kind, id: found.id, title: found.title } : null });
    });
  }
  return {
    unbacked: results.filter((row) => !row.backedBy),
    backed: results.filter((row) => row.backedBy),
  };
}

// ---------------------------------------------------------------------------
// Where each highlight has been used
// ---------------------------------------------------------------------------

export type HighlightUse = { resumeId: string; name: string; updatedAt: Date };

/**
 * Which resumes carry each highlight, by the same similarity test
 * trace_resume_evidence uses in the other direction — so a highlight is "used"
 * when a bullet is that highlight reworded, not only when it is pasted. Keyed
 * by highlight id; a highlight missing from the map has never been used.
 */
export async function highlightUsage(userId: string): Promise<Map<string, HighlightUse[]>> {
  const [highlights, resumes] = await Promise.all([
    listHighlights(userId),
    db.resume.findMany({
      where: { userId },
      select: { id: true, name: true, data: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const sources: EvidenceSource[] = highlights.map((highlight) => ({
    id: highlight.id,
    text: highlight.text,
    role: "",
    roleId: highlight.roleId,
  }));
  const usage = new Map<string, HighlightUse[]>();
  for (const resume of resumes) {
    const doc = parseResumeDoc(resume.data);
    const seen = new Set<string>();
    for (const section of doc.sections) {
      for (const item of section.experience) {
        for (const bullet of item.bullets) {
          for (const source of backingFor(bullet, sources, item.roleId).sources) {
            if (seen.has(source.id)) continue;
            seen.add(source.id);
            usage.set(source.id, [
              ...(usage.get(source.id) ?? []),
              { resumeId: resume.id, name: resume.name, updatedAt: resume.updatedAt },
            ]);
          }
        }
      }
    }
  }
  return usage;
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

/**
 * Roles in months, with the gaps and overlaps between jobs said in words. An
 * unconfirmed date is carried through, so a gap that exists only because a
 * month was guessed can be told apart from a real one.
 */
export async function timelineFor(userId: string, now = new Date()) {
  const roles = await listRoles(userId);
  const laid = careerTimeline(roles, now);
  const unsure = new Set(
    roles.filter((role) => role.startUnconfirmed || role.endUnconfirmed).map((role) => `${role.title} @ ${role.company}`),
  );
  return {
    roles: laid.roles.map((role) => ({
      id: role.id,
      role: `${role.title} @ ${role.company}`,
      group: role.group,
      employmentType: role.employmentType,
      from: role.start === null ? null : monthName(role.start),
      to: role.isCurrent ? "present" : role.end === null ? null : monthName(role.end),
      datesUnconfirmed: Boolean(role.startUnconfirmed || role.endUnconfirmed),
    })),
    gaps: laid.gaps.map((gap) => ({
      from: monthName(gap.from),
      to: monthName(gap.to),
      months: gap.months,
      after: gap.after,
      before: gap.before,
      // A gap against a guessed month may not be a gap at all.
      mayBeADateError: unsure.has(gap.after) || unsure.has(gap.before),
    })),
    overlaps: laid.overlaps,
    gapThresholdMonths: GAP_MONTHS,
  };
}
