import { BoardProvider, PostingStatus, type CompanyWatch } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchBoardJson, probeUrl } from "@/lib/outbound";
import { assertPublicUrl, parsePosting } from "@/lib/posting";
import * as pipeline from "@/lib/data/pipeline";
import * as proposals from "@/lib/data/proposals";

/**
 * The two things this app looks at on the open internet: a company's own jobs
 * board, and whether the posting behind an application is still up.
 *
 * One file for both, because they share the provider resolution, the fetch
 * budget and the politeness delay, and splitting them would mean two files
 * importing each other's private constants.
 *
 * **A watch reads a FEED, never a page.** Greenhouse, Lever and Ashby publish
 * every open role as public JSON off a URL built from a constant host and the
 * company's own slug, so a watch stores the slug and the provider and never
 * fetches a host a third party named. A company whose board is none of the
 * three is refused by name at the moment somebody asks for it, because the
 * alternative — diffing a client-rendered careers page — proposes garbage roles
 * into a review queue whose whole value is that its rows can be trusted.
 *
 * **Nothing here writes to the pipeline.** What a watch finds becomes a
 * CREATE_APPLICATION proposal, and `acceptProposal` is the only thing that
 * creates an application. The liveness check writes five columns on
 * Application and stops: it never moves a stage, and it never logs an Activity
 * — an Activity would reset `quietDays`, which is the number
 * `list_applications(quietForDays:)` and the weekly digest use to answer "what
 * needs chasing", so a robot's fetch would make a silent application look like
 * it had been worked on.
 *
 * Neither CompanyWatch nor the posting columns carry an `archivedAt`. The
 * watches follow their company, and the columns are on the application itself.
 * The cost is the one src/lib/data/offers.ts spells out: every read that does
 * not start from an already-filtered row has to write the parent's filter by
 * hand. There are SIX, each numbered at the line.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** At most ten roles from one board become proposals in one run. */
const MAX_PROPOSALS_PER_RUN = 10;
/** Half of posting.ts's MAX_DESCRIPTION_CHARS. A proposal is read, not stored. */
const MAX_PROPOSAL_DESCRIPTION = 10_000;
/** Between the per-job description fetches Greenhouse needs. */
const BOARD_POLITENESS_MS = 250;
/** A watch is looked at at most this often, however often the sweep runs. */
const WATCH_EVERY_MS = 6 * 60 * 60 * 1000;
/** An application's posting is looked at at most this often. `force` skips it. */
const RECHECK_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
/** Applications per liveness sweep run. */
const MAX_POSTINGS_PER_RUN = 40;
/** Between two requests to the SAME host. Different hosts run concurrently. */
const HOST_POLITENESS_MS = 1_000;
/** How many hosts the liveness check talks to at once. */
const HOST_CONCURRENCY = 4;
/** GONE needs two misses at least this far apart. One bad night is not a fact. */
const SECOND_MISS_AFTER_MS = 20 * 60 * 60 * 1000;

export const PROVIDER_LABEL: Record<BoardProvider, string> = {
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Resolving a board URL
// ---------------------------------------------------------------------------

export type ResolvedBoard =
  | { provider: BoardProvider; slug: string; boardUrl: string }
  | { provider: null; reason: string };

const SLUG_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/** The board page a person would open, per provider. Never fetched by a sweep. */
function boardPageUrl(provider: BoardProvider, slug: string): string {
  switch (provider) {
    case "GREENHOUSE":
      return `https://job-boards.greenhouse.io/${slug}`;
    case "LEVER":
      return `https://jobs.lever.co/${slug}`;
    case "ASHBY":
      return `https://jobs.ashbyhq.com/${slug}`;
  }
}

/** Match a URL against the three board shapes. Pure — no network. */
function matchBoardUrl(url: URL): { provider: BoardProvider; slug: string } | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    // /acme, /acme/jobs/123, /embed/job_board?for=acme, /embed/job_app/acme/...
    const forParam = url.searchParams.get("for");
    if (forParam && SLUG_OK.test(forParam)) return { provider: "GREENHOUSE", slug: forParam };
    const slug = parts[0] === "embed" ? parts[2] : parts[0];
    if (slug && SLUG_OK.test(slug) && slug !== "embed") return { provider: "GREENHOUSE", slug };
    return null;
  }
  if (host === "boards-api.greenhouse.io") {
    // .../v1/boards/acme/jobs/123
    const at = parts.indexOf("boards");
    const slug = at >= 0 ? parts[at + 1] : undefined;
    if (slug && SLUG_OK.test(slug)) return { provider: "GREENHOUSE", slug };
    return null;
  }
  if (host === "jobs.lever.co" || host === "api.lever.co") {
    // jobs.lever.co/acme[/<uuid>], api.lever.co/v0/postings/acme
    const at = parts.indexOf("postings");
    const slug = at >= 0 ? parts[at + 1] : parts[0];
    if (slug && SLUG_OK.test(slug)) return { provider: "LEVER", slug };
    return null;
  }
  if (host === "jobs.ashbyhq.com" || host === "api.ashbyhq.com") {
    const at = parts.indexOf("job-board");
    const slug = at >= 0 ? parts[at + 1] : parts[0];
    if (slug && SLUG_OK.test(slug)) return { provider: "ASHBY", slug };
    return null;
  }
  return null;
}

/**
 * Which feed a URL is, following one embedded board if it has to.
 *
 * Step two is what makes this usable from the URL a person actually has: most
 * "careers" pages are an iframe or a redirect to one of the three, so one fetch
 * and a regex over the HTML gets from acme.com/careers to the feed. A page that
 * gives neither is REFUSED — a generic HTML diff is deliberately not built,
 * because a careers page that renders its jobs in JavaScript gives a fetch
 * nothing and one that renders them server-side gives a link soup whose churn
 * would put invented roles in the review queue.
 */
export async function resolveBoard(rawUrl: string): Promise<ResolvedBoard> {
  let url: URL;
  try {
    url = assertPublicUrl(rawUrl);
  } catch (error) {
    return { provider: null, reason: error instanceof Error ? error.message : "That is not a URL." };
  }

  const direct = matchBoardUrl(url);
  if (direct) {
    return { ...direct, boardUrl: boardPageUrl(direct.provider, direct.slug) };
  }

  const probe = await probeUrl(url.toString(), { wantBody: true });
  if (probe.error) {
    return { provider: null, reason: `${url.hostname} did not answer: ${probe.error}` };
  }
  if (!probe.html) {
    return {
      provider: null,
      reason: `${url.hostname} answered ${probe.status} with nothing to read. Hand me the board link itself — boards.greenhouse.io/acme, jobs.lever.co/acme or jobs.ashbyhq.com/acme.`,
    };
  }

  const embedded = [
    /job-boards\.greenhouse\.io\/([A-Za-z0-9._-]+)/,
    /boards\.greenhouse\.io\/embed\/job_board\?for=([A-Za-z0-9._-]+)/,
    /boards\.greenhouse\.io\/([A-Za-z0-9._-]+)/,
    /jobs\.lever\.co\/([A-Za-z0-9._-]+)/,
    /jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)/,
  ];
  const providers: BoardProvider[] = ["GREENHOUSE", "GREENHOUSE", "GREENHOUSE", "LEVER", "ASHBY"];
  for (let i = 0; i < embedded.length; i += 1) {
    const found = probe.html.match(embedded[i]);
    const slug = found?.[1];
    if (slug && SLUG_OK.test(slug) && slug !== "embed") {
      return { provider: providers[i], slug, boardUrl: boardPageUrl(providers[i], slug) };
    }
  }

  return {
    provider: null,
    reason: `Nothing on ${url.hostname} points at a Greenhouse, Lever or Ashby board, and those are the three that publish a feed to read. Workday, SmartRecruiters and a hand-built careers page publish nothing, so nothing was saved — browse that board and paste the links into capture_job_postings instead.`,
  };
}

// ---------------------------------------------------------------------------
// Reading a board
// ---------------------------------------------------------------------------

/** A role as a feed describes it, whichever feed it was. */
export type BoardRole = {
  /** The provider's own id, as a string. What `seenIds` holds. */
  externalId: string;
  title: string;
  url: string;
  location: string;
  workMode: string;
  salaryRange: string;
  postedAt: Date | null;
  /** Empty on Greenhouse until fetchRoleDescription is called for it. */
  description: string;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const asDate = (value: unknown): Date | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

function feedUrl(provider: BoardProvider, slug: string): string {
  const safe = encodeURIComponent(slug);
  switch (provider) {
    case "GREENHOUSE":
      // NOT `?content=true`. That returns the whole board WITH descriptions —
      // 5.2 MB for a 667-role board, measured — which is past posting.ts's own
      // 4 MB cap and would be the single largest fetch in the app. The index
      // plus at most ten per-job calls is the shape; see fetchRoleDescription.
      return `https://boards-api.greenhouse.io/v1/boards/${safe}/jobs`;
    case "LEVER":
      return `https://api.lever.co/v0/postings/${safe}?mode=json`;
    case "ASHBY":
      return `https://api.ashbyhq.com/posting-api/job-board/${safe}`;
  }
}

/** One feed read. Pure of the database; throws a sentence on a refusal. */
export async function readBoard(
  provider: BoardProvider,
  slug: string,
): Promise<{ roles: BoardRole[]; boardName: string }> {
  return rolesFromFeed(provider, await fetchBoardJson<Record<string, unknown>>(feedUrl(provider, slug)));
}

/**
 * Three feeds, one shape. Pure and exported so the mapping can be checked
 * against a recorded response without a network — the three differ in every
 * field name, and Ashby's `isListed` is a filter that fails silently if it is
 * ever dropped.
 */
export function rolesFromFeed(
  provider: BoardProvider,
  payload: Record<string, unknown>,
): { roles: BoardRole[]; boardName: string } {
  if (provider === "GREENHOUSE") {
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    return {
      boardName: "",
      roles: jobs.map((job: Record<string, unknown>) => {
        const location = text((job.location as Record<string, unknown> | undefined)?.name);
        return {
          externalId: String(job.id ?? ""),
          title: text(job.title),
          url: text(job.absolute_url),
          location,
          workMode: /remote/i.test(location) ? "Remote" : "",
          salaryRange: "",
          postedAt: asDate(job.updated_at) ?? asDate(job.first_published),
          description: "",
        };
      }),
    };
  }

  if (provider === "LEVER") {
    // Lever's feed IS the array, and it always carries descriptions: there is
    // no index-only mode. 1.1 MB for 72 postings, measured.
    const jobs = Array.isArray(payload) ? (payload as unknown as Record<string, unknown>[]) : [];
    return {
      boardName: "",
      roles: jobs.map((job) => {
        const categories = (job.categories ?? {}) as Record<string, unknown>;
        const salary = (job.salaryRange ?? {}) as Record<string, unknown>;
        return {
          externalId: String(job.id ?? ""),
          title: text(job.text),
          url: text(job.hostedUrl) || text(job.applyUrl),
          location: text(categories.location),
          workMode: text(job.workplaceType),
          salaryRange:
            typeof salary.min === "number" && typeof salary.max === "number"
              ? `${text(salary.currency)} ${salary.min}–${salary.max}${salary.interval ? ` / ${text(salary.interval)}` : ""}`.trim()
              : "",
          postedAt: asDate(job.createdAt),
          description: text(job.descriptionPlain),
        };
      }),
    };
  }

  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  return {
    boardName: text(payload.title),
    roles: jobs
      // `isListed: false` rows are on the feed and NOT on the board. Proposing
      // one offers a role nobody can apply for.
      .filter((job: Record<string, unknown>) => job.isListed !== false)
      .map((job: Record<string, unknown>) => ({
        externalId: String(job.id ?? ""),
        title: text(job.title),
        url: text(job.jobUrl) || text(job.applyUrl),
        location: text(job.location),
        workMode: job.isRemote === true ? "Remote" : text(job.workplaceType),
        salaryRange: "",
        postedAt: asDate(job.publishedAt),
        description: text(job.descriptionPlain),
      })),
  };
}

/** Greenhouse only: the description for one job, off the per-job endpoint. */
async function fetchRoleDescription(slug: string, externalId: string): Promise<string> {
  try {
    const job = await fetchBoardJson<Record<string, unknown>>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(externalId)}`,
    );
    const content = typeof job.content === "string" ? job.content : "";
    return htmlish(content);
  } catch {
    // A description that would not load is not a reason to drop the role.
    return "";
  }
}

/** Greenhouse's `content` is entity-escaped HTML. Decode, then strip. */
function htmlish(raw: string): string {
  const decoded = raw
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  return decoded
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string): string {
  return value.length > MAX_PROPOSAL_DESCRIPTION
    ? `${value.slice(0, MAX_PROPOSAL_DESCRIPTION)}\n\n[truncated]`
    : value;
}

// ---------------------------------------------------------------------------
// Watches
// ---------------------------------------------------------------------------

export type WatchFilters = { titleTerms?: string[]; locationTerms?: string[] };

export type WatchView = Omit<CompanyWatch, "userId"> & {
  company: { id: string; name: string };
  providerLabel: string;
};

const watchInclude = { company: { select: { id: true, name: true } } } as const;

type WatchRow = CompanyWatch & { company: { id: string; name: string } };

function toView(row: WatchRow): WatchView {
  const { userId: _userId, ...rest } = row;
  return { ...rest, providerLabel: PROVIDER_LABEL[row.provider] };
}

const cleanTerms = (terms?: string[]): string[] =>
  (terms ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);

/** ANY of the title terms AND ANY of the location terms. Empty means anything. */
export function matchesFilters(role: BoardRole, watch: { titleTerms: string[]; locationTerms: string[] }): boolean {
  const title = role.title.toLowerCase();
  if (watch.titleTerms.length > 0 && !watch.titleTerms.some((term) => title.includes(term))) {
    return false;
  }
  if (watch.locationTerms.length > 0) {
    const where = `${role.location} ${role.workMode}`.toLowerCase();
    if (!watch.locationTerms.some((term) => where.includes(term))) return false;
  }
  return true;
}

export async function listCompanyWatches(userId: string): Promise<WatchView[]> {
  // ARCHIVE FILTER 1 of 6: a watch on an archived company is not shown.
  const rows = await db.companyWatch.findMany({
    where: { userId, company: { archivedAt: null } },
    include: watchInclude,
    orderBy: [{ enabled: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}

export type WatchResult =
  | { watched: true; watch: WatchView; rolesOnBoard: number; queued: number; baseline: boolean }
  | { watched: false; reason: string };

export async function watchCompanyBoard(
  userId: string,
  input: {
    companyId?: string;
    company?: string;
    boardUrl: string;
    titleTerms?: string[];
    locationTerms?: string[];
    proposeExisting?: boolean;
  },
): Promise<WatchResult> {
  const resolved = await resolveBoard(input.boardUrl);
  if (resolved.provider === null) return { watched: false, reason: resolved.reason };

  // Read the board BEFORE writing anything, so a slug that resolves but does
  // not exist leaves no row behind.
  let board: { roles: BoardRole[]; boardName: string };
  try {
    board = await readBoard(resolved.provider, resolved.slug);
  } catch (error) {
    return {
      watched: false,
      reason: `That looks like a ${PROVIDER_LABEL[resolved.provider]} board for "${resolved.slug}", but reading it failed: ${
        error instanceof Error ? error.message : "the feed did not answer"
      }`,
    };
  }

  let companyId = input.companyId;
  if (companyId) {
    // ARCHIVE FILTER 2 of 6: watching an archived company's board is refused.
    const found = await db.company.findFirst({
      where: { id: companyId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!found) return { watched: false, reason: "No live company with that id." };
  } else {
    const name = (input.company || board.boardName || resolved.slug).trim();
    // upsertCompanyByName matches live rows only — see its comment.
    const company = await pipeline.upsertCompanyByName(userId, name);
    companyId = company.id;
  }

  const titleTerms = cleanTerms(input.titleTerms);
  const locationTerms = cleanTerms(input.locationTerms);

  const existing = await db.companyWatch.findUnique({
    where: { userId_provider_slug: { userId, provider: resolved.provider, slug: resolved.slug } },
  });

  // The first look is a BASELINE: everything on the board today is marked seen
  // and nothing is proposed. Without this a watch on a 667-role board arrives
  // as 667 rows in a review queue whose entire value is that its rows are worth
  // reading. `proposeExisting` is the deliberate opt-out.
  const allIds = board.roles.map((role) => role.externalId).filter(Boolean);
  const baseline = !existing && input.proposeExisting !== true;

  const row = await db.companyWatch.upsert({
    where: { userId_provider_slug: { userId, provider: resolved.provider, slug: resolved.slug } },
    create: {
      userId,
      companyId,
      provider: resolved.provider,
      slug: resolved.slug,
      boardUrl: resolved.boardUrl,
      titleTerms,
      locationTerms,
      seenIds: baseline ? allIds : [],
      lastCheckedAt: baseline ? new Date() : null,
    },
    update: { titleTerms, locationTerms, boardUrl: resolved.boardUrl, enabled: true },
    include: watchInclude,
  });

  if (baseline) {
    return { watched: true, watch: toView(row), rolesOnBoard: board.roles.length, queued: 0, baseline: true };
  }

  const report = await runWatch(userId, row, board);
  const after = await db.companyWatch.findUniqueOrThrow({ where: { id: row.id }, include: watchInclude });
  return {
    watched: true,
    watch: toView(after),
    rolesOnBoard: board.roles.length,
    queued: report.queued,
    baseline: false,
  };
}

export async function updateCompanyWatch(
  userId: string,
  id: string,
  patch: WatchFilters & { enabled?: boolean },
): Promise<WatchView> {
  const { count } = await db.companyWatch.updateMany({
    where: { id, userId },
    data: {
      ...(patch.titleTerms !== undefined ? { titleTerms: cleanTerms(patch.titleTerms) } : {}),
      ...(patch.locationTerms !== undefined ? { locationTerms: cleanTerms(patch.locationTerms) } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    },
  });
  if (count === 0) throw new Error("No such watch");
  const row = await db.companyWatch.findFirstOrThrow({ where: { id, userId }, include: watchInclude });
  return toView(row);
}

export async function unwatchCompanyBoard(userId: string, id: string): Promise<{ deleted: boolean }> {
  const { count } = await db.companyWatch.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such watch");
  return { deleted: true };
}

export type WatchRunReport = {
  watchId: string;
  company: string;
  provider: string;
  rolesOnBoard: number;
  matched: number;
  queued: number;
  /** Matched, but the run's cap of ten was already full. Picked up next time. */
  heldBack: number;
  skippedSeen: number;
  error: string;
};

export type CheckReport = { checked: WatchRunReport[]; queued: number };

/**
 * (seen ∪ proposed) ∩ still-on-the-board.
 *
 * Pruning to what the board still lists keeps the array bounded by the size of
 * the board rather than by time. Getting the intersection backwards — pruning
 * to what was proposed — makes every role on the board proposable again on the
 * next run, which is the failure that fills somebody's review queue with six
 * hundred rows. Pure and exported so that cannot regress unnoticed.
 */
export function nextSeenIds(seen: string[], proposed: string[], onBoard: Set<string>): string[] {
  return [...new Set([...seen, ...proposed])].filter((id) => onBoard.has(id));
}

/**
 * One watch, against a board already read. Queues; never creates.
 *
 * Split out from checkCompanyBoards so watchCompanyBoard can reuse it with the
 * board it has already fetched, rather than asking for the same 400 KB twice.
 */
async function runWatch(
  userId: string,
  watch: WatchRow,
  board: { roles: BoardRole[]; boardName: string },
): Promise<WatchRunReport> {
  const seen = new Set(watch.seenIds);
  const idsOnBoard = new Set(board.roles.map((role) => role.externalId).filter(Boolean));

  const matched = board.roles.filter((role) => role.externalId && matchesFilters(role, watch));
  const candidates = matched.filter((role) => !seen.has(role.externalId));
  const ordered = [...candidates].sort(
    (a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0),
  );
  const take = ordered.slice(0, MAX_PROPOSALS_PER_RUN);

  for (const role of take) {
    if (role.description || watch.provider !== "GREENHOUSE") continue;
    role.description = await fetchRoleDescription(watch.slug, role.externalId);
    await sleep(BOARD_POLITENESS_MS);
  }

  const items: proposals.ProposalInput[] = take.map((role) => ({
    kind: "CREATE_APPLICATION" as const,
    summary: `${role.title} at ${watch.company.name}${role.location ? ` — ${role.location}` : ""}`,
    evidence: `New on their ${PROVIDER_LABEL[watch.provider]} board${role.postedAt ? `, posted ${role.postedAt.toISOString().slice(0, 10)}` : ""}. ${role.url}`,
    source: "board_watch",
    payload: {
      company: watch.company.name,
      // Never a board host as a company website — the same rule parsePosting
      // follows. A posting says where somebody advertises, not who they are.
      companyWebsite: "",
      roleTitle: role.title,
      jobUrl: role.url,
      jobDescription: truncate(role.description),
      location: role.location,
      workMode: role.workMode,
      salaryRange: role.salaryRange,
      sources: [PROVIDER_LABEL[watch.provider]],
    },
  }));

  const result = items.length > 0 ? await proposals.proposeChanges(userId, items) : { queued: [], refused: [] };

  const nextSeen = nextSeenIds(watch.seenIds, take.map((role) => role.externalId), idsOnBoard);

  await db.companyWatch.update({
    where: { id: watch.id },
    data: {
      seenIds: nextSeen,
      lastCheckedAt: new Date(),
      ...(result.queued.length > 0
        ? { lastFoundAt: new Date(), proposed: { increment: result.queued.length } }
        : {}),
      lastError: "",
      lastErrorAt: null,
    },
  });

  return {
    watchId: watch.id,
    company: watch.company.name,
    provider: PROVIDER_LABEL[watch.provider],
    rolesOnBoard: board.roles.length,
    matched: matched.length,
    queued: result.queued.length,
    // NOT marked seen, deliberately: the next run picks them up.
    heldBack: Math.max(0, candidates.length - take.length),
    skippedSeen: matched.length - candidates.length,
    error: "",
  };
}

/** One watch, or every watch this person has. Queues; never creates. */
export async function checkCompanyBoards(
  userId: string,
  options?: { watchId?: string; limit?: number },
): Promise<CheckReport> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  // ARCHIVE FILTER 3 of 6.
  const watches = await db.companyWatch.findMany({
    where: {
      userId,
      company: { archivedAt: null },
      ...(options?.watchId ? { id: options.watchId } : { enabled: true }),
    },
    include: watchInclude,
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit,
  });
  if (watches.length === 0 && options?.watchId) throw new Error("No such watch");

  const checked: WatchRunReport[] = [];
  for (const watch of watches) {
    try {
      const board = await readBoard(watch.provider, watch.slug);
      checked.push(await runWatch(userId, watch, board));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "That board did not answer.";
      await db.companyWatch.update({
        where: { id: watch.id },
        data: { lastCheckedAt: new Date(), lastError: reason, lastErrorAt: new Date() },
      });
      checked.push({
        watchId: watch.id,
        company: watch.company.name,
        provider: PROVIDER_LABEL[watch.provider],
        rolesOnBoard: 0,
        matched: 0,
        queued: 0,
        heldBack: 0,
        skippedSeen: 0,
        error: reason,
      });
    }
    await sleep(BOARD_POLITENESS_MS);
  }

  return { checked, queued: checked.reduce((total, row) => total + row.queued, 0) };
}

export type BoardSweepReport = { considered: number; checked: number; queued: number; failed: number };

/**
 * Instance-wide. No userId — this is the scheduled run, and the same argument
 * `sweepArchive` and `runDigestSweep` make applies: there is no caller to
 * resolve, so the filters have to carry the isolation themselves.
 */
export async function sweepCompanyWatches(now = new Date()): Promise<BoardSweepReport> {
  const due = new Date(now.getTime() - WATCH_EVERY_MS);
  // ARCHIVE FILTER 4 of 6, plus the suspension filter. Without the first, a
  // company somebody binned three months ago keeps getting its board polled.
  const watches = await db.companyWatch.findMany({
    where: {
      enabled: true,
      company: { archivedAt: null },
      user: { isActive: true },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: due } }],
    },
    include: watchInclude,
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: 50,
  });

  const report: BoardSweepReport = { considered: watches.length, checked: 0, queued: 0, failed: 0 };
  for (const watch of watches) {
    try {
      const board = await readBoard(watch.provider, watch.slug);
      const run = await runWatch(watch.userId, watch, board);
      report.checked += 1;
      report.queued += run.queued;
    } catch (error) {
      report.failed += 1;
      await db.companyWatch.update({
        where: { id: watch.id },
        data: {
          lastCheckedAt: new Date(),
          lastError: error instanceof Error ? error.message : "That board did not answer.",
          lastErrorAt: new Date(),
        },
      });
    }
    await sleep(BOARD_POLITENESS_MS);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Posting liveness
// ---------------------------------------------------------------------------

export type PostingReading = {
  applicationId: string;
  company: string;
  roleTitle: string;
  status: PostingStatus;
  note: string;
  /** True only when this reading changed the stored status. */
  changed: boolean;
};

type Candidate = {
  id: string;
  roleTitle: string;
  jobUrl: string;
  postingStatus: PostingStatus;
  postingMisses: number;
  postingGoneSince: Date | null;
  postingCheckedAt: Date | null;
  company: { name: string };
};

/** What one look at one URL found, before the two-strike rule is applied. */
export type Look = { gone: boolean; live: boolean; note: string; unreachable: boolean };

async function lookAtPosting(jobUrl: string): Promise<Look> {
  const board = (() => {
    try {
      return matchBoardUrl(assertPublicUrl(jobUrl));
    } catch {
      return null;
    }
  })();

  // Ask the feed where there is one: it is the only reading here that is not a
  // guess. Greenhouse's per-job endpoint 404s cleanly for a job that is gone,
  // and a Lever or Ashby id absent from the board feed is gone.
  if (board) {
    const id = postingIdIn(jobUrl, board.provider);
    if (id) {
      try {
        if (board.provider === "GREENHOUSE") {
          await fetchBoardJson<Record<string, unknown>>(
            `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs/${encodeURIComponent(id)}`,
          );
          return { gone: false, live: true, note: "", unreachable: false };
        }
        const feed = await readBoard(board.provider, board.slug);
        const still = feed.roles.some((role) => role.externalId === id);
        return still
          ? { gone: false, live: true, note: "", unreachable: false }
          : { gone: true, live: false, note: "no longer on their board", unreachable: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/404/.test(message)) {
          return { gone: true, live: false, note: "404 from their board", unreachable: false };
        }
        return { gone: false, live: false, note: message || "the board did not answer", unreachable: true };
      }
    }
  }

  const probe = await probeUrl(jobUrl, { wantBody: true });
  if (probe.error || probe.status === 0) {
    return { gone: false, live: false, note: probe.error || "nothing answered", unreachable: true };
  }
  if (probe.status === 404 || probe.status === 410) {
    return { gone: true, live: false, note: `${probe.status}`, unreachable: false };
  }
  if (probe.status === 401 || probe.status === 403 || probe.status === 429 || probe.status >= 500) {
    return { gone: false, live: false, note: `answered ${probe.status}`, unreachable: true };
  }
  if (probe.status >= 200 && probe.status < 300) {
    const parsed = parsePosting(probe.html, probe.finalUrl);
    if (parsed.roleTitle) return { gone: false, live: true, note: "", unreachable: false };
    // NEVER gone. A client-rendered board answers exactly like this whether the
    // job exists or not — Ashby returns 200 for an id that never existed.
    const final = (() => {
      try {
        const url = new URL(probe.finalUrl);
        return `${url.hostname}${url.pathname}`;
      } catch {
        return probe.finalUrl;
      }
    })();
    return {
      gone: false,
      live: false,
      note: probe.hops > 0
        ? `redirected to ${final}`
        : "answered 200 but the page no longer names a role",
      unreachable: false,
    };
  }
  return { gone: false, live: false, note: `answered ${probe.status}`, unreachable: false };
}

/** The job's own id inside its posting URL, for the feed lookups above. */
function postingIdIn(jobUrl: string, provider: BoardProvider): string | null {
  let parts: string[];
  try {
    parts = new URL(jobUrl).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  if (provider === "GREENHOUSE") {
    const at = parts.indexOf("jobs");
    return at >= 0 && /^\d+$/.test(parts[at + 1] ?? "") ? parts[at + 1] : null;
  }
  // Lever and Ashby both end in the posting's uuid.
  const last = parts[parts.length - 1] ?? "";
  return /^[0-9a-f-]{20,}$/i.test(last) ? last : null;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
};

/**
 * Read the postings behind applications and write what the host said.
 *
 * Writes five columns and NOTHING else. No stage move, no Activity — see the
 * file header for why the second one matters more than it looks.
 */
export async function checkPostings(
  userId: string,
  options?: { applicationId?: string; limit?: number; force?: boolean },
): Promise<{ checked: PostingReading[]; gone: number; skipped: number }> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  // ARCHIVE FILTER 5 of 6. TERMINAL_STAGES too: a posting behind an accepted or
  // lost application is nobody's question.
  const rows = await db.application.findMany({
    where: {
      userId,
      archivedAt: null,
      jobUrl: { not: "" },
      ...(options?.applicationId
        ? { id: options.applicationId }
        : { stage: { notIn: pipeline.TERMINAL_STAGES } }),
    },
    select: {
      id: true,
      roleTitle: true,
      jobUrl: true,
      postingStatus: true,
      postingMisses: true,
      postingGoneSince: true,
      postingCheckedAt: true,
      company: { select: { name: true } },
    },
    orderBy: { postingCheckedAt: { sort: "asc", nulls: "first" } },
    take: options?.applicationId ? 1 : limit,
  });

  return runPostingChecks(rows, { force: options?.force === true });
}

async function runPostingChecks(
  rows: Candidate[],
  options: { force: boolean },
  now = new Date(),
): Promise<{ checked: PostingReading[]; gone: number; skipped: number }> {
  const fresh = new Date(now.getTime() - RECHECK_EVERY_MS);
  const due = rows.filter(
    (row) => options.force || !row.postingCheckedAt || row.postingCheckedAt < fresh,
  );
  const skipped = rows.length - due.length;

  // Grouped by host and issued serially per host with a gap, because forty
  // applications at Greenhouse fired at once gets an instance's IP rate-limited
  // for everybody on it — including capture_job_posting.
  const byHost = new Map<string, Candidate[]>();
  for (const row of due) {
    const host = hostOf(row.jobUrl);
    byHost.set(host, [...(byHost.get(host) ?? []), row]);
  }

  const checked: PostingReading[] = [];
  const hosts = [...byHost.entries()];
  for (let i = 0; i < hosts.length; i += HOST_CONCURRENCY) {
    const slice = hosts.slice(i, i + HOST_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ([, applications]) => {
        const readings: PostingReading[] = [];
        // A host that says 429 or 5xx is dropped for the rest of the run.
        let hostDown = "";
        for (const application of applications) {
          if (readings.length > 0) await sleep(HOST_POLITENESS_MS);
          const look = hostDown
            ? { gone: false, live: false, note: hostDown, unreachable: true }
            : await lookAtPosting(application.jobUrl);
          if (look.unreachable && /429|50\d/.test(look.note)) hostDown = look.note;
          readings.push(await applyLook(application, look, now));
        }
        return readings;
      }),
    );
    for (const batch of results) checked.push(...batch);
  }

  return { checked, gone: checked.filter((row) => row.status === "GONE").length, skipped };
}

/**
 * The two-strike rule, on its own and pure.
 *
 * This is the feature's credibility in eleven lines: GONE needs TWO readings
 * that both came back gone, at least twenty hours apart, because one bad night
 * at a CDN telling a dozen people their live applications are dead would cost
 * more trust than the whole feature is worth. An unreachable host says nothing
 * about the role and deliberately does not advance the counter. Exported so it
 * can be checked without a network, which is the only way this stays right.
 */
export function decidePostingStatus(
  look: Look,
  previous: { postingMisses: number; postingGoneSince: Date | null; postingCheckedAt: Date | null },
  now: Date,
): { status: PostingStatus; misses: number; goneSince: Date | null; note: string } {
  if (look.unreachable) {
    return {
      status: "UNREACHABLE",
      misses: previous.postingMisses,
      goneSince: previous.postingGoneSince,
      note: look.note,
    };
  }
  if (look.live) {
    return { status: "LIVE", misses: 0, goneSince: null, note: "" };
  }
  if (look.gone) {
    const misses = previous.postingMisses + 1;
    const longEnough =
      !previous.postingCheckedAt ||
      now.getTime() - previous.postingCheckedAt.getTime() >= SECOND_MISS_AFTER_MS;
    const confirmed = misses >= 2 && longEnough;
    return {
      status: confirmed ? "GONE" : "UNCLEAR",
      misses,
      goneSince: previous.postingGoneSince ?? now,
      note: confirmed ? look.note : `${look.note} — looking again tomorrow before calling it`,
    };
  }
  return {
    status: "UNCLEAR",
    misses: previous.postingMisses,
    goneSince: previous.postingGoneSince,
    note: look.note,
  };
}

/** Writes the five columns, and nothing else. No stage, no Activity. */
async function applyLook(application: Candidate, look: Look, now: Date): Promise<PostingReading> {
  const { status, misses, goneSince, note } = decidePostingStatus(look, application, now);

  await db.application.update({
    where: { id: application.id },
    data: {
      postingStatus: status,
      postingCheckedAt: now,
      postingMisses: misses,
      postingGoneSince: goneSince,
      postingNote: note,
    },
  });

  return {
    applicationId: application.id,
    company: application.company.name,
    roleTitle: application.roleTitle,
    status,
    note,
    changed: status !== application.postingStatus,
  };
}

export type PostingSweepReport = { considered: number; checked: number; gone: number };

/** Instance-wide. No userId — see the file header, same argument as sweepArchive. */
export async function sweepPostings(now = new Date()): Promise<PostingSweepReport> {
  const fresh = new Date(now.getTime() - RECHECK_EVERY_MS);
  // ARCHIVE FILTER 6 of 6, plus the suspension filter. Missing the first means
  // the instance keeps fetching postings for jobs people deleted.
  const rows = await db.application.findMany({
    where: {
      archivedAt: null,
      jobUrl: { not: "" },
      stage: { notIn: pipeline.TERMINAL_STAGES },
      user: { isActive: true },
      OR: [{ postingCheckedAt: null }, { postingCheckedAt: { lt: fresh } }],
    },
    select: {
      id: true,
      roleTitle: true,
      jobUrl: true,
      postingStatus: true,
      postingMisses: true,
      postingGoneSince: true,
      postingCheckedAt: true,
      company: { select: { name: true } },
    },
    orderBy: { postingCheckedAt: { sort: "asc", nulls: "first" } },
    take: MAX_POSTINGS_PER_RUN,
  });

  const result = await runPostingChecks(rows, { force: false }, now);
  return { considered: rows.length, checked: result.checked.length, gone: result.gone };
}
