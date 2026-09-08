import { bulletSimilarity } from "@/lib/resume-similarity";

/**
 * Which of a person's own material stands behind a resume bullet.
 *
 * Pure and free of Prisma, because the same question is asked in two places and
 * has to get the same answer: `trace_resume_evidence` asks it on the server
 * about a saved document, and the editor asks it in the browser about the
 * sentence being typed right now. A bullet the panel calls backed and the
 * editor calls unbacked would make both useless.
 *
 * Note what this is NOT: proof. It is word overlap. A bullet that says
 * something true you never wrote down scores zero, and that is the honest
 * answer — the material is missing, not the achievement.
 */

/** A piece of the person's own material a bullet can be traced to. */
export type EvidenceSource = {
  id: string;
  text: string;
  /** Where it came from: "Staff Engineer — Stripe". */
  role: string;
  /** The Role it belongs to, for narrowing to one job's material. */
  roleId: string | null;
};

export type Backing = {
  /** Best matches first, strongest three at most. */
  sources: (EvidenceSource & { similarity: number })[];
  /** The strongest similarity found, 0 when nothing matched. */
  best: number;
};

/**
 * Below this, an overlap is two sentences sharing ordinary words rather than
 * one standing behind the other. The same threshold the tool has always used;
 * moving it moves both.
 */
export const BACKED = 0.3;

export function backingFor(
  bullet: string,
  sources: EvidenceSource[],
  /**
   * When the resume entry names the Role it was written from, only that job's
   * material can back it — otherwise a bullet about one employer gets
   * "evidence" from a similar bullet about another, which is worse than none.
   */
  roleId?: string,
): Backing {
  const text = bullet.trim();
  if (!text) return { sources: [], best: 0 };
  const pool = roleId ? sources.filter((source) => source.roleId === roleId) : sources;
  const scored = pool
    .map((source) => ({
      ...source,
      similarity: Math.round(bulletSimilarity(source.text, text) * 100) / 100,
    }))
    .filter((source) => source.similarity >= BACKED)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
  return { sources: scored, best: scored[0]?.similarity ?? 0 };
}
