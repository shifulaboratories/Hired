import type { ActivityType, Stage } from "@prisma/client";
import { TagKind } from "@prisma/client";
import { db } from "@/lib/db";
import { searchMe, type SearchHit } from "@/lib/data/me";
import {
  diagnoseSearch,
  listApplications,
  listRelationships,
  pipelineStats,
  relationshipWeight,
  type ContactStanding,
  type ScheduleEntry,
} from "@/lib/data/pipeline";
import { dueNow as scheduleDueNow, listSchedule } from "@/lib/data/schedule";
import { timeZoneOf } from "@/lib/data/me";
import { weekdayIn } from "@/lib/time";

/**
 * Six questions the app had all the data for and never asked.
 *
 * This file owns no tables and writes nothing. Every function here is an
 * ORDERING over reads that live elsewhere — `listResumes`' outcome counts,
 * `diagnoseSearch`'s stage rules, `listRelationships`' weighting,
 * `schedule.dueNow`'s definition of due. So a rule in here that starts
 * disagreeing with one of those is a bug HERE, not there: the fix is to call
 * the other function, never to reimplement it. That is invariant 2, and this
 * is the file most likely to breach it, because every one of these analyses is
 * one `if` away from being its own second opinion about what an interview is.
 *
 * `userId` is first and every query filters on it, as everywhere. Four of the
 * six spell their own `archivedAt: null`; `contactWarmth` spells none because
 * it issues no query at all, and `workspaceHealth`'s role check deliberately
 * omits one — both say so at the line.
 *
 * The other rule this file follows is that it refuses to turn three
 * applications into a percentage. Every rate is `number | null` and comes back
 * null under MIN_RATE_BASIS. A search is a small sample for months, and a
 * confident-looking 33% read off three rows is worse than no answer: somebody
 * rewrites a resume because of it.
 */

/** Under this, a rate is not a rate. Exported so a caller can make the same call. */
export const MIN_RATE_BASIS = 5;

/**
 * Activity types that can only have come FROM an employer.
 *
 * NOTE, OUTREACH, EMAIL_SENT, FOLLOW_UP and APPLIED are things the person did,
 * and STAGE_CHANGE is bookkeeping. Counting any of those as a response would
 * mean a resume scored well because its owner chased hard.
 */
export const INBOUND_TYPES: ActivityType[] = [
  "EMAIL_RECEIVED",
  "CALL",
  "INTERVIEW",
  "OFFER",
  "REJECTION",
];

/** Stages that prove an application reached a real conversation. Mirrors resumes.ts. */
const INTERVIEWED_STAGES: Stage[] = ["INTERVIEWING", "OFFER", "ACCEPTED"];

const rate = (part: number, whole: number) =>
  whole >= MIN_RATE_BASIS ? Math.round((part / whole) * 100) : null;

const DAY = 86_400_000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// ---------------------------------------------------------------------------
// 1. Which resume actually gets answered
// ---------------------------------------------------------------------------

export type ResumeRow = {
  id: string;
  name: string;
  /** Applications sent with it. Past WISHLIST, archived excluded — listResumes' rule. */
  sent: number;
  /** Of those, how many ever got an inbound touch on or after the day they were applied to. */
  responded: number;
  interviewed: number;
  offers: number;
  /** Null under MIN_RATE_BASIS, so nothing can print 33% off three rows. */
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
  /** Over the ones that got a response and have an appliedAt. A conditional median. */
  medianDaysToFirstResponse: number | null;
  medianBasis: number;
  /** Sent, nothing back, still live. Censored, not a zero. */
  stillWaiting: number;
  confident: boolean;
};

export type ResumePerformance = {
  resumes: ResumeRow[];
  /** Applications sent with no resume recorded. The blind spot, named rather than hidden. */
  noResume: { sent: number; responded: number };
  excluded: { wishlist: number; noAppliedAt: number; answeredBeforeApplying: number };
  /** True when at least two resumes clear MIN_RATE_BASIS — a comparison is possible at all. */
  comparable: boolean;
  definition: string;
  caveats: string[];
};

const RESPONSE_DEFINITION =
  "A response is the first activity on or after the day it was applied to that could only have " +
  "come from them — an email received, a call, an interview, an offer or a rejection — or a move " +
  "into INTERVIEWING. Things the person did (outreach, chasing, notes) never count.";

export async function resumePerformance(userId: string): Promise<ResumePerformance> {
  const [resumes, applications] = await Promise.all([
    db.resume.findMany({ where: { userId }, select: { id: true, name: true } }),
    db.application.findMany({
      // Archived out: a binned application is not evidence about a document.
      where: { userId, archivedAt: null },
      select: {
        id: true,
        stage: true,
        resumeId: true,
        appliedAt: true,
        activities: {
          select: { type: true, toStage: true, occurredAt: true },
          orderBy: { occurredAt: "asc" },
        },
      },
    }),
  ]);

  const excluded = { wishlist: 0, noAppliedAt: 0, answeredBeforeApplying: 0 };
  type Tally = { sent: number; responded: number; interviewed: number; offers: number; waiting: number; days: number[] };
  const blank = (): Tally => ({ sent: 0, responded: 0, interviewed: 0, offers: 0, waiting: 0, days: [] });
  const byResume = new Map<string, Tally>();
  const orphan = blank();

  for (const application of applications) {
    if (application.stage === "WISHLIST") {
      excluded.wishlist += 1;
      continue;
    }
    const tally = application.resumeId
      ? (byResume.get(application.resumeId) ?? byResume.set(application.resumeId, blank()).get(application.resumeId)!)
      : orphan;

    tally.sent += 1;

    const offered =
      application.stage === "OFFER" ||
      application.stage === "ACCEPTED" ||
      application.activities.some((a) => a.type === "OFFER" || a.toStage === "OFFER");
    const interviewed =
      offered ||
      INTERVIEWED_STAGES.includes(application.stage) ||
      application.activities.some(
        (a) => a.type === "INTERVIEW" || (a.toStage !== null && INTERVIEWED_STAGES.includes(a.toStage)),
      );
    if (offered) tally.offers += 1;
    if (interviewed) tally.interviewed += 1;

    // The first thing that could only have come from them. Anything dated
    // before appliedAt is a conversation that started some other way — a
    // recruiter who reached out first — and counting it would credit the
    // resume for a reply it never earned.
    const inbound = application.activities.filter(
      (a) => INBOUND_TYPES.includes(a.type) || a.toStage === "INTERVIEWING",
    );
    if (inbound.length === 0) {
      if (!interviewed) tally.waiting += 1;
      continue;
    }

    if (!application.appliedAt) {
      // It answered, so it counts as a response; there is just no clock to
      // measure it against.
      excluded.noAppliedAt += 1;
      tally.responded += 1;
      continue;
    }

    const first = inbound.find((a) => a.occurredAt.getTime() >= application.appliedAt!.getTime());
    if (!first) {
      excluded.answeredBeforeApplying += 1;
      tally.responded += 1;
      continue;
    }
    tally.responded += 1;
    tally.days.push(Math.max(0, Math.round((first.occurredAt.getTime() - application.appliedAt.getTime()) / DAY)));
  }

  const rows: ResumeRow[] = resumes.map((resume) => {
    const tally = byResume.get(resume.id) ?? blank();
    return {
      id: resume.id,
      name: resume.name,
      sent: tally.sent,
      responded: tally.responded,
      interviewed: tally.interviewed,
      offers: tally.offers,
      responseRate: rate(tally.responded, tally.sent),
      interviewRate: rate(tally.interviewed, tally.sent),
      offerRate: rate(tally.offers, tally.sent),
      medianDaysToFirstResponse: median(tally.days),
      medianBasis: tally.days.length,
      stillWaiting: tally.waiting,
      confident: tally.sent >= MIN_RATE_BASIS,
    };
  });

  rows.sort(
    (a, b) => b.sent - a.sent || (b.responseRate ?? -1) - (a.responseRate ?? -1) || a.name.localeCompare(b.name),
  );

  const caveats: string[] = [];
  if (rows.filter((row) => row.confident).length < 2) {
    caveats.push(
      `Fewer than two resumes have ${MIN_RATE_BASIS} applications behind them, so these cannot be compared yet. Quote the counts, not a rate.`,
    );
  }
  if (orphan.sent > 0) {
    caveats.push(
      `${orphan.sent} application${orphan.sent === 1 ? " has" : "s have"} no resume recorded, so ${orphan.sent === 1 ? "it is" : "they are"} in none of these rows.`,
    );
  }
  if (excluded.answeredBeforeApplying > 0) {
    caveats.push(
      `${excluded.answeredBeforeApplying} answered before the applied date — inbound conversations rather than replies — so they count as responses but not in the median.`,
    );
  }

  return {
    resumes: rows,
    noResume: { sent: orphan.sent, responded: orphan.responded },
    excluded,
    comparable: rows.filter((row) => row.confident).length >= 2,
    definition: RESPONSE_DEFINITION,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// 2. Where applications die
// ---------------------------------------------------------------------------

export type LossCut = {
  /** A tag id, or a synthetic key for the buckets that are not tags. */
  key: string;
  label: string;
  /** A palette token where this came from a tag, "" otherwise. Never a hex. */
  tone: string;
  lost: number;
  total: number;
  lossRate: number | null;
  confident: boolean;
};

export type LossReport = {
  /** Where they died: the stage they were in when it ended, not the stage they ended at. */
  byStage: LossCut[];
  byReason: LossCut[];
  bySource: LossCut[];
  byIndustry: LossCut[];
  bySize: LossCut[];
  byLocation: LossCut[];
  /** How many endings had a recorded move to LOST, and how many had to be inferred. */
  provenance: { recorded: number; inferred: number };
  lost: number;
  population: number;
  confident: boolean;
  caveats: string[];
};

const STAGE_LABELS: Record<string, string> = {
  WISHLIST: "Wishlist",
  APPLIED: "Applied",
  INTERVIEWING: "Interviewing",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  LOST: "Lost",
};

export async function lossReport(userId: string): Promise<LossReport> {
  const applications = await db.application.findMany({
    // Archived out: you binned it, so it is not evidence about your search.
    where: { userId, archivedAt: null },
    select: {
      id: true,
      stage: true,
      appliedAt: true,
      interviewRound: true,
      tags: { select: { tag: { select: { id: true, name: true, kind: true, color: true } } } },
      company: {
        select: {
          tags: { select: { tag: { select: { id: true, name: true, kind: true, color: true } } } },
        },
      },
      activities: {
        where: { toStage: { not: null } },
        select: { fromStage: true, toStage: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
      },
    },
  });

  const live = applications.filter((a) => a.stage !== "WISHLIST");
  const provenance = { recorded: 0, inferred: 0 };

  /**
   * The stage an application was in when it ended.
   *
   * The LATEST move to LOST, not the first: an application can bounce out and
   * back. When there is no such move — imported without its timeline, or
   * created straight at LOST — fall back to the same "how far did it ever get"
   * rule diagnoseSearch uses, rather than inventing a second one.
   */
  const diedIn = (application: (typeof live)[number]): Stage => {
    const move = application.activities.find((a) => a.toStage === "LOST" && a.fromStage !== null);
    if (move?.fromStage) {
      provenance.recorded += 1;
      return move.fromStage;
    }
    provenance.inferred += 1;
    if (application.interviewRound > 0) return "INTERVIEWING";
    if (application.activities.some((a) => a.toStage === "INTERVIEWING")) return "INTERVIEWING";
    return "APPLIED";
  };

  /** How far an application ever got, so a stage's denominator is "everyone who reached it". */
  const reached = (application: (typeof live)[number]): Stage[] => {
    const seen = new Set<Stage>(["APPLIED"]);
    if (application.interviewRound > 0) seen.add("INTERVIEWING");
    if (INTERVIEWED_STAGES.includes(application.stage)) seen.add("INTERVIEWING");
    if (application.stage === "OFFER" || application.stage === "ACCEPTED") seen.add("OFFER");
    for (const activity of application.activities) {
      if (activity.toStage && activity.toStage !== "LOST") seen.add(activity.toStage);
    }
    return [...seen];
  };

  const lostRows = live.filter((a) => a.stage === "LOST");

  const stageBuckets = new Map<string, { lost: number; total: number }>();
  for (const application of live) {
    for (const stage of reached(application)) {
      const bucket = stageBuckets.get(stage) ?? { lost: 0, total: 0 };
      bucket.total += 1;
      stageBuckets.set(stage, bucket);
    }
  }
  for (const application of lostRows) {
    const stage = diedIn(application);
    const bucket = stageBuckets.get(stage) ?? { lost: 0, total: 0 };
    bucket.lost += 1;
    // A stage it died in but that `reached` did not see — an inferred
    // INTERVIEWING, say — still needs a denominator of at least one.
    if (bucket.total === 0) bucket.total = 1;
    stageBuckets.set(stage, bucket);
  }

  const cut = (buckets: Map<string, { lost: number; total: number; label: string; tone: string }>) =>
    [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: bucket.label,
        tone: bucket.tone,
        lost: bucket.lost,
        total: bucket.total,
        lossRate: rate(bucket.lost, bucket.total),
        confident: bucket.total >= MIN_RATE_BASIS,
      }))
      .sort((a, b) => (b.lossRate ?? -1) - (a.lossRate ?? -1) || b.total - a.total);

  /** One cut over a tag kind, taken from the application or from its company. */
  const byTagKind = (kind: TagKind, from: "application" | "company", noneLabel: string) => {
    const buckets = new Map<string, { lost: number; total: number; label: string; tone: string }>();
    for (const application of live) {
      const links = from === "application" ? application.tags : application.company.tags;
      const tags = links.map((link) => link.tag).filter((tag) => tag.kind === kind);
      const entries =
        tags.length > 0
          ? tags.map((tag) => ({ key: tag.id, label: tag.name, tone: tag.color }))
          : [{ key: "__none__", label: noneLabel, tone: "" }];
      for (const entry of entries) {
        const bucket = buckets.get(entry.key) ?? { lost: 0, total: 0, label: entry.label, tone: entry.tone };
        bucket.total += 1;
        if (application.stage === "LOST") bucket.lost += 1;
        buckets.set(entry.key, bucket);
      }
    }
    return cut(buckets);
  };

  const byStage = cut(
    new Map(
      [...stageBuckets.entries()].map(([stage, bucket]) => [
        stage,
        { ...bucket, label: STAGE_LABELS[stage] ?? stage, tone: "" },
      ]),
    ),
  );

  const caveats: string[] = [];
  if (live.length < MIN_RATE_BASIS) {
    caveats.push(
      `Only ${live.length} application${live.length === 1 ? "" : "s"} past wishlist. Every rate here is null; read the counts.`,
    );
  }
  if (provenance.inferred > 0) {
    caveats.push(
      `${provenance.inferred} ending${provenance.inferred === 1 ? "" : "s"} had no recorded stage move, so the stage it died in was inferred from how far it got.`,
    );
  }

  return {
    byStage,
    byReason: byTagKind(TagKind.LOSS, "application", "No reason recorded"),
    bySource: byTagKind(TagKind.APPLICATION, "application", "No source recorded"),
    byIndustry: byTagKind(TagKind.INDUSTRY, "company", "No industry recorded"),
    bySize: byTagKind(TagKind.SIZE, "company", "No size recorded"),
    byLocation: byTagKind(TagKind.LOCATION, "company", "No location recorded"),
    provenance,
    lost: lostRows.length,
    population: live.length,
    confident: live.length >= MIN_RATE_BASIS,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// 3. What every posting keeps asking for that Me cannot back up
// ---------------------------------------------------------------------------

export type SkillsGapTerm = {
  term: string;
  /** Distinct postings it appeared in. Not occurrences — that is the whole trick. */
  postings: number;
  share: number;
  standing: "BACKED" | "THIN" | "MISSING";
  evidence: { kind: SearchHit["kind"]; id: string; title: string; excerpt: string }[];
};

export type SkillsGapReport = {
  /** The reliable list. Read this one. */
  missing: SkillsGapTerm[];
  thin: SkillsGapTerm[];
  backed: SkillsGapTerm[];
  postingsRead: number;
  applicationsWithoutPosting: number;
  termsTested: number;
  confident: boolean;
  method: string;
  caveats: string[];
};

const MAX_POSTINGS = 120;
const MIN_POSTINGS_FOR_CONFIDENCE = 5;

/**
 * Words that carry no information about a job.
 *
 * NOT quick-log.ts's STOPWORDS, which stops "engineer", "software" and
 * "manager" because it is trying not to mistake a role title for a company
 * name. Those are exactly the words that matter here. Two vocabularies for two
 * questions is not a fork; a fork would be two answers to one question.
 */
const POSTING_NOISE = new Set([
  "a", "about", "across", "all", "also", "an", "and", "any", "are", "as", "at", "be", "been",
  "being", "both", "but", "by", "can", "do", "does", "each", "for", "from", "has", "have", "how",
  "if", "in", "into", "is", "it", "its", "may", "more", "most", "must", "no", "not", "of", "on",
  "or", "other", "our", "out", "over", "per", "plus", "so", "some", "such", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "through", "to", "up", "us",
  "use", "using", "we", "well", "what", "when", "where", "which", "while", "who", "will", "with",
  "within", "would", "you", "your",
  // Job-posting furniture: present in every listing, meaningless as a signal.
  "ability", "able", "apply", "benefits", "candidate", "candidates", "company", "compensation",
  "equal", "etc", "excellent", "experience", "including", "job", "looking", "opportunity",
  "position", "preferred", "qualifications", "requirements", "required", "responsibilities",
  "role", "salary", "strong", "team", "teams", "work", "working", "years",
]);

/**
 * One posting as runs of words, split wherever a bigram must not span.
 *
 * The runs matter. A first version split on every non-word character and then
 * paired adjacent words, which turned "Kubernetes, Postgres and distributed
 * systems" into the term "kubernetes postgres" — two items of a list read as a
 * phrase. That is not a nitpick: the bigram then has the same document
 * frequency as "kubernetes", swallows it by the rule below, and the report
 * offers a skill nobody has ever asked for while hiding the one they did.
 * So a comma, a full stop, a slash, a bracket or a newline ends a run.
 */
function runsIn(text: string): string[][] {
  // Defensive: htmlToText already strips tags on capture, but a description
  // pasted straight into update_application has been through nothing.
  const clean = text.replace(/<[^>]*>/g, " ").toLowerCase();
  return clean
    .split(/[,;:.!?()[\]{}"'|/\\\n\r•]+/)
    .map((run) =>
      run
        .split(/[^a-z0-9+#.-]+/)
        .map((word) => word.replace(/^[.+#-]+|[.+#-]+$/g, ""))
        .filter((word) => word.length >= 2 && !/^\d+$/.test(word)),
    )
    .filter((run) => run.length > 0);
}

/** The distinct terms one posting contains: unigrams, plus bigrams of two real words. */
function termsIn(text: string): Set<string> {
  const terms = new Set<string>();
  for (const run of runsIn(text)) {
    for (let i = 0; i < run.length; i += 1) {
      const word = run[i];
      if (!POSTING_NOISE.has(word)) terms.add(word);
      const next = run[i + 1];
      if (next && !POSTING_NOISE.has(word) && !POSTING_NOISE.has(next)) terms.add(`${word} ${next}`);
    }
  }
  return terms;
}

export async function skillsGap(
  userId: string,
  options?: { limit?: number; minPostings?: number },
): Promise<SkillsGapReport> {
  const limit = Math.min(Math.max(options?.limit ?? 40, 1), 80);

  const [postings, withoutPosting] = await Promise.all([
    db.application.findMany({
      // Archived out; wishlist rows IN — a job captured and never applied to
      // still describes work they want.
      where: { userId, archivedAt: null, jobDescription: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: MAX_POSTINGS,
      select: { id: true, jobDescription: true },
    }),
    db.application.count({ where: { userId, archivedAt: null, jobDescription: "" } }),
  ]);

  const frequency = new Map<string, number>();
  for (const posting of postings) {
    for (const term of termsIn(posting.jobDescription)) {
      frequency.set(term, (frequency.get(term) ?? 0) + 1);
    }
  }

  const floor = options?.minPostings ?? Math.max(3, Math.ceil(postings.length * 0.25));
  let candidates = [...frequency.entries()].filter(([, count]) => count >= floor);

  // Drop a unigram swallowed by a bigram with the same document frequency, so
  // "kubernetes" disappears when "kubernetes operators" appears in exactly the
  // same postings and the list is not the same fact twice.
  const bigrams = candidates.filter(([term]) => term.includes(" "));
  const swallowed = new Set<string>();
  for (const [bigram, count] of bigrams) {
    for (const half of bigram.split(" ")) {
      if (frequency.get(half) === count) swallowed.add(half);
    }
  }
  candidates = candidates.filter(([term]) => !swallowed.has(term));
  candidates.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const tested = candidates.slice(0, limit);

  // Bounded concurrency, the shape captureJobPostings already uses. Each of
  // these is a Postgres full-text query; forty at once is a thundering herd on
  // one person's connection pool.
  const terms: SkillsGapTerm[] = [];
  for (let i = 0; i < tested.length; i += 5) {
    const batch = tested.slice(i, i + 5);
    const hits = await Promise.all(batch.map(([term]) => searchMe(userId, term, 3)));
    batch.forEach(([term, count], index) => {
      const found = hits[index];
      terms.push({
        term,
        postings: count,
        share: postings.length === 0 ? 0 : Math.round((count / postings.length) * 100),
        // By how many DISTINCT records matched, never by score: ts_rank_cd is
        // not normalised and is not comparable across queries, so a score floor
        // would be a number dressed up as a judgement.
        standing: found.length === 0 ? "MISSING" : found.length === 1 ? "THIN" : "BACKED",
        evidence: found.map((hit) => ({
          kind: hit.kind,
          id: hit.id,
          title: hit.title,
          excerpt: hit.excerpt,
        })),
      });
    });
  }

  const caveats: string[] = [];
  if (postings.length < MIN_POSTINGS_FOR_CONFIDENCE) {
    caveats.push(
      `Only ${postings.length} posting${postings.length === 1 ? " was" : "s were"} captured, so this is not yet a pattern. Capture more with capture_job_postings.`,
    );
  }
  if (withoutPosting > 0) {
    caveats.push(
      `${withoutPosting} application${withoutPosting === 1 ? " has" : "s have"} no posting text, so ${withoutPosting === 1 ? "it was" : "they were"} not read.`,
    );
  }

  return {
    missing: terms.filter((term) => term.standing === "MISSING"),
    thin: terms.filter((term) => term.standing === "THIN"),
    backed: terms.filter((term) => term.standing === "BACKED"),
    postingsRead: postings.length,
    applicationsWithoutPosting: withoutPosting,
    termsTested: terms.length,
    confident: postings.length >= MIN_POSTINGS_FOR_CONFIDENCE,
    method:
      "Terms are counted by how many DISTINCT postings contain them, so one long posting saying " +
      "'Kubernetes' twelve times cannot outrank a word in eight different ones. Each surviving term " +
      "is then looked up in Me with search_me, which ORs its words — that makes matching as easy as " +
      "possible, so MISSING is strong evidence of a real gap, and BACKED is weak (a two-word term " +
      "can be backed on one of its words alone). Read the missing list; treat backed as a hint.",
    caveats,
  };
}

// ---------------------------------------------------------------------------
// 4. Who has gone cold, weighted by what they were worth
// ---------------------------------------------------------------------------

/**
 * How fast a relationship's VALUE fades.
 *
 * Not CONTACT_QUIET_AFTER (30 days), which is when silence becomes worth
 * noticing — that happens sooner than the worth of the relationship halves.
 * Forty-five days leaves a referral at a quarter after three months, which is
 * the shape people recognise. Nothing benchmarks this number and no tool ever
 * prints it; it only decides an order.
 */
export const WARMTH_HALF_LIFE_DAYS = 45;

export type WarmContact = ContactStanding & {
  /** The ordering weight listRelationships already uses. */
  value: number;
  /** 1 on the day you last spoke, a half at WARMTH_HALF_LIFE_DAYS. */
  decay: number;
  /** value × decay. An ORDER, not a measurement. Never show it to anybody. */
  warmth: number;
  /** value × (1 − decay). What has been lost, which is what the chase list sorts by. */
  lost: number;
  /** From `decay` alone, so the bands and the curve cannot drift apart. */
  standing: "WARM" | "COOLING" | "COLD";
};

export type ContactWarmth = {
  /** Everyone who earned something and has gone quiet, most value lost first. */
  cooling: WarmContact[];
  contacts: WarmContact[];
  confident: boolean;
  method: string;
};

export async function contactWarmth(userId: string, now = new Date()): Promise<ContactWarmth> {
  // No archive filter spelled here, and that is correct: this function issues
  // no query. listRelationships does, and filters there.
  const { contacts, worthKeepingWarm, confident } = await listRelationships(userId, now);

  const warm = (standing: ContactStanding): WarmContact => {
    const value = relationshipWeight(standing);
    const decay = 0.5 ** (standing.quietDays / WARMTH_HALF_LIFE_DAYS);
    return {
      ...standing,
      value,
      decay,
      warmth: value * decay,
      lost: value * (1 - decay),
      standing: decay >= 0.75 ? "WARM" : decay >= 0.4 ? "COOLING" : "COLD",
    };
  };

  const coolingIds = new Set(worthKeepingWarm.map((row) => row.id));
  const all = contacts.map(warm);

  return {
    contacts: [...all].sort((a, b) => b.warmth - a.warmth),
    // Membership is listRelationships' decision, not re-made here. Only the
    // order is this function's: by what has been lost, so a referral that got
    // an interview and went quiet outranks a recruiter who cold-mailed once.
    cooling: all.filter((row) => coolingIds.has(row.id)).sort((a, b) => b.lost - a.lost),
    confident,
    method:
      "Ordered by what a person was worth to this search multiplied by how much of it silence has " +
      "taken back — an offer they are attached to counts for most, an application at a company they " +
      "represent for least, and the value halves every " +
      `${WARMTH_HALF_LIFE_DAYS} days of silence. It is an order, not a score; do not read the numbers out.`,
  };
}

// ---------------------------------------------------------------------------
// 5. What is thin
// ---------------------------------------------------------------------------

export type HealthCheckKey =
  | "company-industry"
  | "application-source"
  | "contact-relationship"
  | "role-highlights"
  | "resume-unused";

export type HealthCheck = {
  key: HealthCheckKey;
  label: string;
  count: number;
  /** The denominator, so "3 of 4" is sayable and "3 of 90" is not read as a crisis. */
  of: number;
  why: string;
  /** The tool that fixes it, named, so the next call is obvious. */
  fix: string;
  examples: { id: string; name: string }[];
};

export type WorkspaceHealth = {
  checks: HealthCheck[];
  /** The keys that came back empty, so "nothing to fix here" is sayable. */
  clean: HealthCheckKey[];
  totals: { companies: number; applications: number; contacts: number; roles: number; resumes: number };
};

export async function workspaceHealth(
  userId: string,
  options?: { examples?: number },
): Promise<WorkspaceHealth> {
  const take = Math.min(Math.max(options?.examples ?? 5, 1), 25);
  const weekAgo = new Date(Date.now() - 7 * DAY);

  const [
    companies,
    applications,
    contacts,
    roles,
    resumes,
    totals,
  ] = await Promise.all([
    db.company.findMany({
      where: { userId, archivedAt: null, tags: { none: { tag: { kind: TagKind.INDUSTRY } } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.application.findMany({
      where: {
        userId,
        archivedAt: null,
        // A job not applied to has no channel yet, so it is not a gap.
        stage: { not: "WISHLIST" },
        tags: { none: { tag: { kind: TagKind.APPLICATION } } },
      },
      select: { id: true, roleTitle: true, company: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    db.contact.findMany({
      // Both ways of saying how you know somebody, because having neither is
      // the gap: the free-text column and the CONTACT tags.
      where: {
        userId,
        archivedAt: null,
        relationship: "",
        tags: { none: { tag: { kind: TagKind.CONTACT } } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.role.findMany({
      // No archivedAt, deliberately: Role is not one of the three archivable
      // models. A reader auditing archive filters will stop here otherwise.
      where: { userId, highlights: { none: {} } },
      select: { id: true, title: true, company: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.resume.findMany({
      // `none: { archivedAt: null }` IS the archive filter, spelled inside the
      // relation: a resume whose only application was archived is unused again,
      // which is honest. The grace period stops a resume written this morning
      // from being a finding.
      where: { userId, applications: { none: { archivedAt: null } }, createdAt: { lt: weekAgo } },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
    }),
    Promise.all([
      db.company.count({ where: { userId, archivedAt: null } }),
      db.application.count({ where: { userId, archivedAt: null } }),
      db.contact.count({ where: { userId, archivedAt: null } }),
      db.role.count({ where: { userId } }),
      db.resume.count({ where: { userId } }),
    ]),
  ]);

  const [companyTotal, applicationTotal, contactTotal, roleTotal, resumeTotal] = totals;

  const built: HealthCheck[] = [
    {
      key: "company-industry",
      label: "Companies with no industry",
      count: companies.length,
      of: companyTotal,
      why: "Loss and conversion cut by industry are empty without it — the first thing you ask when a pattern appears.",
      fix: "tag_companies",
      examples: companies.slice(0, take).map((row) => ({ id: row.id, name: row.name })),
    },
    {
      key: "application-source",
      label: "Applications with no source",
      count: applications.length,
      of: applicationTotal,
      why: "Where applications come from is the single strongest signal in the search, and diagnose_search cannot use what is not recorded.",
      fix: "update_application with tags",
      examples: applications
        .slice(0, take)
        .map((row) => ({ id: row.id, name: `${row.roleTitle} at ${row.company.name}` })),
    },
    {
      key: "contact-relationship",
      label: "People with no relationship recorded",
      count: contacts.length,
      of: contactTotal,
      why: "A recruiter and a former manager need different messages, and nothing can tell them apart without this.",
      fix: "tag_contacts, or update_contact",
      examples: contacts.slice(0, take).map((row) => ({ id: row.id, name: row.name })),
    },
    {
      key: "role-highlights",
      label: "Roles with no highlights",
      count: roles.length,
      of: roleTotal,
      why: "A resume is assembled from highlights. A role with none contributes nothing however good the background is.",
      fix: "mine_role_background, then create_highlights",
      examples: roles.slice(0, take).map((row) => ({ id: row.id, name: `${row.title} at ${row.company}` })),
    },
    {
      key: "resume-unused",
      label: "Resumes never attached to anything",
      count: resumes.length,
      of: resumeTotal,
      why: "Either it should go out with something, or it is a dead draft crowding the list.",
      fix: "tailor_resume_for_application, or delete_resume",
      examples: resumes.slice(0, take).map((row) => ({ id: row.id, name: row.name })),
    },
  ];

  const found = built.filter((check) => check.count > 0);
  found.sort((a, b) => b.count / Math.max(1, b.of) - a.count / Math.max(1, a.of));

  return {
    checks: found,
    clean: built.filter((check) => check.count === 0).map((check) => check.key),
    totals: {
      companies: companyTotal,
      applications: applicationTotal,
      contacts: contactTotal,
      roles: roleTotal,
      resumes: resumeTotal,
    },
  };
}

// ---------------------------------------------------------------------------
// 6. What changed, what is due, what has gone quiet, what first
// ---------------------------------------------------------------------------

export type BriefAction = {
  kind: "OFFER" | "FOLLOW_UP" | "MEETING" | "TASK" | "PING" | "QUIET";
  title: string;
  detail: string;
  /** Whichever id this is about. At most one is set. */
  applicationId: string | null;
  contactId: string | null;
  taskId: string | null;
  /** Why this is above the next one. One clause. */
  because: string;
};

export type MorningBrief = {
  since: Date;
  now: Date;
  until: Date;
  due: Awaited<ReturnType<typeof scheduleDueNow>>;
  changed: ScheduleEntry[];
  ahead: ScheduleEntry[];
  quiet: Awaited<ReturnType<typeof listApplications>>;
  stats: Awaited<ReturnType<typeof pipelineStats>>;
  verdict: { headline: string; detail: string; weakest: string | null } | null;
  /** The ordered answer to "what first". Empty is a real answer. */
  first: BriefAction[];
};

export async function morningBrief(
  userId: string,
  options?: {
    sinceDays?: number;
    aheadDays?: number;
    quietAfterDays?: number;
    first?: number;
    includeVerdict?: boolean;
  },
): Promise<MorningBrief> {
  const now = new Date();
  const zone = await timeZoneOf(userId);
  // Monday reaches back over the weekend. weekdayIn returns ISO 1-7 and falls
  // back to 0 on an unrecognised zone, which is not 1 — so an unknown zone
  // quietly gets the one-day window rather than the three-day one.
  const sinceDays = options?.sinceDays ?? (weekdayIn(now, zone) === 1 ? 3 : 1);
  const aheadDays = options?.aheadDays ?? 7;
  const quietAfterDays = options?.quietAfterDays ?? 14;
  const firstCount = Math.min(Math.max(options?.first ?? 5, 1), 15);

  const since = new Date(now.getTime() - sinceDays * DAY);
  const until = new Date(now.getTime() + aheadDays * DAY);

  const [due, window, quiet, stats, diagnosis] = await Promise.all([
    scheduleDueNow(userId, 0),
    // One call over the whole window, split in Node. Two calls would mean two
    // round trips to the person's real calendar on a tool run every morning.
    listSchedule(userId, since, until),
    listApplications(userId, { quietForDays: quietAfterDays }),
    pipelineStats(userId),
    options?.includeVerdict ? diagnoseSearch(userId) : Promise.resolve(null),
  ]);

  const changed = window
    .filter((entry) => entry.date <= now && entry.kind === "ACTIVITY")
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const ahead = window
    .filter((entry) => entry.date > now)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const first: BriefAction[] = [];
  const push = (action: BriefAction) => {
    if (first.length < firstCount) first.push(action);
  };

  // The order is opinionated and carries its reason on every row.
  for (const offer of due.offers) {
    push({
      kind: "OFFER",
      title: offer.title,
      detail: offer.detail,
      // DueItem carries one id whose meaning is its kind: the application for
      // an OFFER or an APPLICATION, the contact for a CONTACT, the task for a
      // TASK. Read it accordingly rather than hoping for a named column.
      applicationId: offer.id,
      contactId: null,
      taskId: null,
      because: "Missing a follow-up costs you a day; missing a respond-by costs you the job.",
    });
  }
  for (const followUp of due.followUps.filter((item) => item.overdue)) {
    push({
      kind: "FOLLOW_UP",
      title: followUp.title,
      detail: followUp.detail,
      applicationId: followUp.id,
      contactId: null,
      taskId: null,
      because: "Already overdue, and the longer it sits the odder the message reads.",
    });
  }
  for (const entry of ahead.filter((row) => row.kind === "MEETING" && row.date.getTime() - now.getTime() < DAY)) {
    push({
      kind: "MEETING",
      title: entry.title,
      detail: entry.detail,
      applicationId: entry.applicationId,
      contactId: entry.contactId,
      taskId: null,
      because: "It is on the calendar today, so everything else can wait behind it.",
    });
  }
  for (const task of due.tasks) {
    push({
      kind: "TASK",
      title: task.title,
      detail: task.detail,
      applicationId: null,
      contactId: null,
      taskId: task.id,
      because: task.overdue ? "Late." : "Due today.",
    });
  }
  for (const ping of due.pings) {
    push({
      kind: "PING",
      title: ping.title,
      detail: ping.detail,
      applicationId: null,
      contactId: ping.id,
      taskId: null,
      because: "You set a date to get back in touch and it has come round.",
    });
  }
  for (const application of quiet) {
    push({
      kind: "QUIET",
      title: `${application.roleTitle} at ${application.company.name}`,
      detail: `Nothing logged for ${application.quietDays} days.`,
      applicationId: application.id,
      contactId: null,
      taskId: null,
      because: "Silence this long usually means it is over, and finding out is one message.",
    });
  }

  return {
    since,
    now,
    until,
    due,
    changed,
    ahead,
    quiet,
    stats,
    // Only when asked for AND only when it says it is confident — the same
    // restraint weeklyContent shows. A brief carrying six findings is a brief
    // nobody acts on.
    verdict:
      diagnosis && diagnosis.confident
        ? {
            headline: diagnosis.headline,
            detail: diagnosis.detail,
            weakest: diagnosis.weakest,
          }
        : null,
    first,
  };
}

// ---------------------------------------------------------------------------
// How old is what you know
// ---------------------------------------------------------------------------

export type StaleCompany = {
  id: string;
  name: string;
  /** What a person would call the state: "never", "stale", "fresh". */
  state: "never" | "stale" | "fresh";
  researchedAt: Date | null;
  daysOld: number | null;
  /** Live applications riding on it, which is what makes staleness cost something. */
  liveApplications: number;
  /** The nearest thing coming up that this research is for, if there is one. */
  nextUp: { applicationId: string; roleTitle: string; when: Date; what: string } | null;
  why: string;
};

/** Past this, research is old enough that a company has plausibly moved. */
export const RESEARCH_STALE_AFTER_DAYS = 60;

/**
 * Which companies you are about to talk to and know nothing current about.
 *
 * `Company.notes` has an `updatedAt` on its row and nothing finer, so "when was
 * this researched" is approximate on purpose — ANY edit to the company counts,
 * and being generous costs one company appearing as fresh when only its website
 * was fixed. The alternative is a `researchedAt` column that something has to
 * remember to stamp, which is a column that drifts.
 *
 * It is ordered by WHAT IS COMING UP, not by age: research that is a year old
 * on a company with nothing live is not a problem, and research that is nine
 * weeks old on the one you have a final with on Thursday is. A list sorted by
 * age would put those the wrong way round.
 */
export async function researchFreshness(
  userId: string,
  options?: { staleAfterDays?: number; aheadDays?: number; now?: Date },
): Promise<{ companies: StaleCompany[]; staleAfterDays: number; checked: number }> {
  const now = options?.now ?? new Date();
  const staleAfterDays = Math.min(Math.max(options?.staleAfterDays ?? RESEARCH_STALE_AFTER_DAYS, 1), 365);
  const aheadDays = Math.min(Math.max(options?.aheadDays ?? 21, 1), 90);
  const ahead = new Date(now.getTime() + aheadDays * 86_400_000);

  // Archive filter, spelled by hand, and again on the nested applications.
  const companies = await db.company.findMany({
    where: { userId, archivedAt: null, applications: { some: { archivedAt: null, closedAt: null } } },
    select: {
      id: true,
      name: true,
      notes: true,
      updatedAt: true,
      applications: {
        where: { archivedAt: null, closedAt: null },
        select: {
          id: true,
          roleTitle: true,
          stage: true,
          nextFollowUpAt: true,
          interviews: {
            where: { scheduledAt: { gte: now, lte: ahead } },
            orderBy: { scheduledAt: "asc" },
            take: 1,
            select: { scheduledAt: true, label: true },
          },
        },
      },
    },
  });

  const rows: StaleCompany[] = [];
  for (const company of companies) {
    const researched = company.notes.trim() ? company.updatedAt : null;
    const daysOld = researched
      ? Math.floor((now.getTime() - researched.getTime()) / 86_400_000)
      : null;
    const state: StaleCompany["state"] =
      researched === null ? "never" : daysOld! >= staleAfterDays ? "stale" : "fresh";

    // The soonest thing this research is actually for: a booked interview
    // first, because that is the one with a date somebody else set.
    let nextUp: StaleCompany["nextUp"] = null;
    for (const application of company.applications) {
      const interview = application.interviews[0];
      const candidate = interview?.scheduledAt
        ? { when: interview.scheduledAt, what: interview.label || "an interview" }
        : application.nextFollowUpAt && application.nextFollowUpAt <= ahead
          ? { when: application.nextFollowUpAt, what: "a follow-up" }
          : null;
      if (!candidate) continue;
      if (!nextUp || candidate.when < nextUp.when) {
        nextUp = {
          applicationId: application.id,
          roleTitle: application.roleTitle,
          when: candidate.when,
          what: candidate.what,
        };
      }
    }

    if (state === "fresh" && nextUp === null) continue;

    rows.push({
      id: company.id,
      name: company.name,
      state,
      researchedAt: researched,
      daysOld,
      liveApplications: company.applications.length,
      nextUp,
      why:
        state === "never"
          ? nextUp
            ? `Nothing on file about them, and there is ${nextUp.what} on the ${nextUp.when.toISOString().slice(0, 10)}.`
            : "Nothing on file about them, and something live riding on it."
          : state === "stale"
            ? nextUp
              ? `Last looked at ${daysOld} days ago, and there is ${nextUp.what} on the ${nextUp.when.toISOString().slice(0, 10)}.`
              : `Last looked at ${daysOld} days ago.`
            : `Researched ${daysOld} days ago — recent enough, and listed only because there is ${nextUp!.what} coming up.`,
    });
  }

  // What is coming up first, then what is oldest. A list sorted by age alone
  // buries the one that matters on Thursday under a year-old wishlist row.
  rows.sort((a, b) => {
    if (a.nextUp && b.nextUp) return a.nextUp.when.getTime() - b.nextUp.when.getTime();
    if (a.nextUp) return -1;
    if (b.nextUp) return 1;
    return (b.daysOld ?? Number.MAX_SAFE_INTEGER) - (a.daysOld ?? Number.MAX_SAFE_INTEGER);
  });

  return { companies: rows, staleAfterDays, checked: companies.length };
}
