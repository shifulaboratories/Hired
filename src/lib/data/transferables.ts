import { db } from "@/lib/db";
import { termsIn } from "@/lib/posting-terms";
import { searchMe } from "@/lib/data/me";

/**
 * Transferable skills, and what a posting's keywords land on.
 *
 * Why this is a table rather than a sentence in somebody's background: the
 * bridge has to be CHECKABLE. "Salesforce covers HubSpot" written as prose is
 * something a writer has to notice, interpret and trust itself about. Written
 * as a row it is something the app can look up, report against a specific
 * posting, and show back to the person so they can disown it before it reaches
 * a document.
 *
 * The distinction the whole feature turns on: a recorded transfer permits the
 * posting's word in a SKILLS line, marked comparable. It never permits a claim
 * that the work happened at an employer. src/lib/keyword-policy.ts carries that
 * text; this file carries the data it reasons over.
 *
 * userId first and positional, like everything else here.
 */

export type TransferableInput = {
  have: string;
  covers?: string[];
  note?: string;
};

/** Trim, drop blanks, and fold case-insensitive duplicates. */
function cleanList(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export async function listTransferables(userId: string) {
  return db.transferableSkill.findMany({
    where: { userId },
    orderBy: [{ have: "asc" }, { createdAt: "asc" }],
  });
}

export async function createTransferable(userId: string, input: TransferableInput) {
  const have = input.have.trim();
  if (!have) throw new Error("A transferable needs the thing you have actually used.");
  return db.transferableSkill.create({
    data: {
      userId,
      have,
      covers: cleanList(input.covers),
      note: input.note?.trim() ?? "",
    },
  });
}

/**
 * Replaces the fields you send, like every other update in this app. `covers`
 * is a whole list: send it entire or leave it out.
 */
export async function updateTransferable(
  userId: string,
  id: string,
  patch: Partial<TransferableInput>,
) {
  const data: { have?: string; covers?: string[]; note?: string } = {};
  if (patch.have !== undefined) {
    const have = patch.have.trim();
    if (!have) throw new Error("A transferable needs the thing you have actually used.");
    data.have = have;
  }
  if (patch.covers !== undefined) data.covers = cleanList(patch.covers);
  if (patch.note !== undefined) data.note = patch.note.trim();

  const { count } = await db.transferableSkill.updateMany({ where: { id, userId }, data });
  if (count === 0) throw new Error("No transferable with that id.");
  return db.transferableSkill.findFirst({ where: { id, userId } });
}

export async function deleteTransferable(userId: string, id: string) {
  const { count } = await db.transferableSkill.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No transferable with that id.");
}

/**
 * What one posting's keywords land on: evidence, a transfer, or nothing.
 *
 * This is the read that makes the policy usable at the moment somebody is
 * writing, rather than a rule they have to remember. `skills_gap` answers the
 * same question across every posting on the board and is for deciding what to
 * learn; this one is about the job in front of you and is for deciding what to
 * put on the page.
 *
 * `covered` is the interesting bucket and the one to treat carefully: the term
 * is NOT on file, and a transfer they recorded says something they do have
 * reaches it. Under ADJACENT that term may go in a skills line as comparable.
 * Under STRICT or MATCH it is simply a gap with a note attached.
 */
export type KeywordLanding = {
  /** The posting's own spelling. */
  term: string;
  /** Where it was found in their material, when it was. */
  evidence?: { kind: string; id: string; title: string };
  /** The transfer that reaches it, when one does. */
  transfer?: { id: string; have: string; note: string };
};

export type PostingKeywordReport = {
  applicationId: string;
  company: string;
  title: string;
  /** Terms the posting leans on, most-repeated first. */
  onFile: KeywordLanding[];
  covered: KeywordLanding[];
  missing: KeywordLanding[];
  /** True when the posting has no text to read. */
  empty: boolean;
};

/** How many of a posting's terms are worth testing. */
const MAX_TERMS = 40;

/**
 * Read one posting and say where each of its keywords lands.
 *
 * Mirrors skillsGap's judgement deliberately — the same `termsIn` extractor,
 * the same `searchMe` probe, the same batches of five so forty full-text
 * queries do not arrive at one person's connection pool at once. Two different
 * answers to "do they have anything on file for Kubernetes" would be worse
 * than either answer alone.
 */
export async function postingKeywords(
  userId: string,
  applicationId: string,
): Promise<PostingKeywordReport> {
  // archivedAt: null — reading an Application, so the filter is spelled here.
  const application = await db.application.findFirst({
    where: { id: applicationId, userId, archivedAt: null },
    select: {
      id: true,
      roleTitle: true,
      jobDescription: true,
      company: { select: { name: true } },
    },
  });
  if (!application) throw new Error("No application with that id.");

  const base = {
    applicationId: application.id,
    company: application.company?.name ?? "",
    title: application.roleTitle,
  };
  if (!application.jobDescription.trim()) {
    return { ...base, onFile: [], covered: [], missing: [], empty: true };
  }

  // Frequency within this one posting: a tool named four times is what the job
  // is about, one named once is a nice-to-have at the bottom of the advert.
  const frequency = new Map<string, number>();
  for (const term of termsIn(application.jobDescription)) frequency.set(term, 1);
  const lowered = application.jobDescription.toLowerCase();
  for (const term of frequency.keys()) {
    frequency.set(term, lowered.split(term).length - 1);
  }
  const tested = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TERMS)
    .map(([term]) => term);

  const transferables = await listTransferables(userId);
  // One lookup from a covered spelling to the thing that reaches it.
  const bridges = new Map<string, (typeof transferables)[number]>();
  for (const row of transferables) {
    for (const covered of row.covers) bridges.set(covered.toLowerCase(), row);
  }

  const onFile: KeywordLanding[] = [];
  const covered: KeywordLanding[] = [];
  const missing: KeywordLanding[] = [];

  for (let i = 0; i < tested.length; i += 5) {
    const batch = tested.slice(i, i + 5);
    const hits = await Promise.all(batch.map((term) => searchMe(userId, term, 1)));
    batch.forEach((term, index) => {
      const found = hits[index][0];
      if (found) {
        onFile.push({
          term,
          evidence: { kind: found.kind, id: found.id, title: found.title },
        });
        return;
      }
      const bridge = bridges.get(term.toLowerCase());
      if (bridge) {
        covered.push({
          term,
          transfer: { id: bridge.id, have: bridge.have, note: bridge.note },
        });
        return;
      }
      missing.push({ term });
    });
  }

  return { ...base, onFile, covered, missing, empty: false };
}
