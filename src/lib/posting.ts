/**
 * Turning a job posting URL into the fields an application needs.
 *
 * The reliable source is JSON-LD: Greenhouse, Lever, Ashby, Workday and
 * LinkedIn all embed a schema.org JobPosting block, because Google Jobs
 * requires one. Open Graph tags and the title element are the fallback for
 * everything else. No HTML parser dependency — the interesting content is in
 * script tags and metas, which regex extracts fine; the day that stops being
 * true is the day to add one, not before.
 *
 * The company's website is taken from the posting's hiringOrganization only
 * when it is not a job board. A posting tells you where someone advertises,
 * not who they are — the same rule the logo already follows — so a Greenhouse
 * URL never becomes a company's website.
 */

const FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 4_000_000;
const MAX_DESCRIPTION_CHARS = 20_000;

/** Hosts that publish postings for other companies. Never an employer's own site. */
const JOB_BOARD_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "workday.com",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "wellfound.com",
  "otta.com",
  "smartrecruiters.com",
  "jobvite.com",
  "bamboohr.com",
  "rippling.com",
  "ycombinator.com",
];

const BOARD_LABELS: [string, string][] = [
  ["greenhouse.io", "Greenhouse"],
  ["lever.co", "Lever"],
  ["ashbyhq.com", "Ashby"],
  ["myworkdayjobs.com", "Workday"],
  ["workday.com", "Workday"],
  ["linkedin.com", "LinkedIn"],
  ["indeed.com", "Indeed"],
  ["glassdoor.com", "Glassdoor"],
  ["wellfound.com", "Wellfound"],
  ["otta.com", "Otta"],
  ["smartrecruiters.com", "SmartRecruiters"],
  ["ycombinator.com", "Y Combinator"],
];

export type ParsedPosting = {
  roleTitle: string;
  company: string;
  /** Empty unless the posting names the employer's own site. */
  companyWebsite: string;
  jobDescription: string;
  location: string;
  workMode: string;
  salaryRange: string;
  /** Where the posting lives — "Greenhouse", "LinkedIn", or the hostname. */
  source: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isJobBoard(host: string): boolean {
  return JOB_BOARD_HOSTS.some((board) => host === board || host.endsWith(`.${board}`));
}

/**
 * The fetch, with the guard the URL deserves: this runs on the server on
 * behalf of whoever holds a connection token, so it must not be usable to
 * probe the network the server sits on. Loopback, private ranges and bare IP
 * literals are refused outright. (DNS could still rebind between check and
 * fetch — accepted for a tool whose callers are the instance's own members.)
 */
export async function fetchPostingHtml(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links can be fetched.");
  }
  if (url.username || url.password) throw new Error("Links with credentials aren't fetched.");

  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.includes(":"); // IPv6 literal
  if (privateHost) throw new Error("That address points inside a network, not at a posting.");

  const response = await fetch(url, {
    headers: {
      // Some boards serve a bot wall to the default fetch UA.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`The posting page answered ${response.status}. Is the link still live?`);
  }
  const text = await response.text();
  return text.length > MAX_HTML_BYTES ? text.slice(0, MAX_HTML_BYTES) : text;
}

/** The entities that actually occur in posting HTML; not a general decoder. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"');
}

/** HTML to readable text: block tags become line breaks, the rest is dropped. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|ul|ol)\s*>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function metaContent(html: string, property: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const match = html.match(pattern);
  return decodeEntities((match?.[1] ?? match?.[2] ?? "").trim());
}

type JsonLdJobPosting = {
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string; url?: string; sameAs?: string } | string;
  jobLocation?: unknown;
  jobLocationType?: string;
  employmentType?: string | string[];
  baseSalary?: {
    currency?: string;
    value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string };
  };
};

/** Every JSON-LD block, flattened through @graph and arrays. */
function jsonLdObjects(html: string): Record<string, unknown>[] {
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  const objects: Record<string, unknown>[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === "object") {
          objects.push(item);
          const graph = (item as { "@graph"?: unknown })["@graph"];
          if (Array.isArray(graph)) {
            for (const node of graph) {
              if (node && typeof node === "object") objects.push(node);
            }
          }
        }
      }
    } catch {
      // Malformed JSON-LD is common; the fallbacks below still run.
    }
  }
  return objects;
}

function findJobPosting(html: string): JsonLdJobPosting | null {
  for (const obj of jsonLdObjects(html)) {
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.toLowerCase() === "jobposting")) {
      return obj as JsonLdJobPosting;
    }
  }
  return null;
}

function locationText(jobLocation: unknown): string {
  const places = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  for (const place of places) {
    if (!place || typeof place !== "object") continue;
    const address = (place as { address?: unknown }).address;
    if (typeof address === "string") return address;
    if (address && typeof address === "object") {
      const a = address as Record<string, string>;
      const parts = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
  }
  return "";
}

function salaryText(baseSalary: JsonLdJobPosting["baseSalary"]): string {
  const value = baseSalary?.value;
  if (!value) return "";
  const currency = baseSalary?.currency === "USD" ? "$" : baseSalary?.currency ? `${baseSalary.currency} ` : "";
  const fmt = (n: number) => (n >= 1000 ? `${currency}${Math.round(n / 1000)}k` : `${currency}${n}`);
  if (value.minValue && value.maxValue) return `${fmt(value.minValue)} – ${fmt(value.maxValue)}`;
  if (value.value) return fmt(value.value);
  return "";
}

/** "Staff Engineer - Stripe - Careers" -> "Staff Engineer" once the company is known. */
function trimTitle(title: string, company: string): string {
  let cleaned = title.trim();
  const separators = [" - ", " – ", " — ", " | ", " · ", " at "];
  for (const sep of separators) {
    const idx = cleaned.toLowerCase().indexOf(sep === " at " ? " at " : sep);
    if (idx > 0) {
      const tail = cleaned.slice(idx + sep.length).toLowerCase();
      if (
        company &&
        (tail.includes(company.toLowerCase()) ||
          tail.includes("careers") ||
          tail.includes("jobs"))
      ) {
        cleaned = cleaned.slice(0, idx).trim();
      }
    }
  }
  return cleaned;
}

/**
 * Greenhouse's own pages are client-rendered — the HTML a fetch sees names
 * neither the employer nor the job — but the same data sits behind the public
 * unauthenticated API their embeds use. For Greenhouse URLs that API is the
 * source; everything else goes through the generic parse. The API URL is
 * built from constants, so the network guard has nothing to check here.
 */
async function resolveGreenhouse(url: URL): Promise<ParsedPosting | null> {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "boards.greenhouse.io" && host !== "job-boards.greenhouse.io") return null;
  const match = url.pathname.match(/^\/(?:embed\/job_app\/)?([^/]+)\/jobs\/(\d+)/);
  if (!match) return null;
  const [, org, jobId] = match;

  const api = (path: string) =>
    fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(org)}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).then((response) => (response.ok ? response.json() : null)).catch(() => null);

  const [job, board] = await Promise.all([api(`/jobs/${jobId}`), api("")]);
  if (!job || typeof job.title !== "string") return null;

  // `content` is entity-escaped HTML: decode it into HTML, then into text.
  const content = typeof job.content === "string" ? htmlToText(decodeEntities(job.content)) : "";
  return {
    roleTitle: job.title.trim(),
    company:
      (typeof job.company_name === "string" && job.company_name.trim()) ||
      (typeof board?.name === "string" ? board.name.trim() : ""),
    companyWebsite: "",
    jobDescription:
      content.length > MAX_DESCRIPTION_CHARS
        ? `${content.slice(0, MAX_DESCRIPTION_CHARS)}\n\n[truncated]`
        : content,
    location: typeof job.location?.name === "string" ? job.location.name.trim() : "",
    workMode: /remote/i.test(job.location?.name ?? "") ? "Remote" : "",
    salaryRange: "",
    source: "Greenhouse",
  };
}

/**
 * The one entry point capture uses: board API when the URL has one, generic
 * fetch-and-parse otherwise.
 */
export async function loadPosting(rawUrl: string): Promise<ParsedPosting> {
  const target = withScheme(rawUrl);
  let url: URL | null = null;
  try {
    url = new URL(target);
  } catch {
    // fetchPostingHtml throws the legible version of this below.
  }
  if (url) {
    const resolved = await resolveGreenhouse(url);
    if (resolved) return resolved;
  }
  const html = await fetchPostingHtml(target);
  return parsePosting(html, target);
}

/**
 * `boards.greenhouse.io/acme/jobs/123` is a URL to everybody except `new URL`.
 *
 * A link copied out of a phone app, or retyped by hand, routinely arrives with
 * no scheme — and the app answered "That doesn't look like a URL" about a
 * string that plainly is one, which reads as the app being wrong rather than
 * particular. Normalising here rather than at the field means the fix reaches
 * capture_job_posting over MCP too, and everything downstream still runs on the
 * normalised value: the https-only check, the private-host guard and the
 * credentials check are all after this.
 */
function withScheme(raw: string) {
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function parsePosting(html: string, url: string): ParsedPosting {
  const host = hostOf(url);
  const posting = findJobPosting(html);

  const org = posting?.hiringOrganization;
  let company = (typeof org === "string" ? org : org?.name)?.trim() ?? "";
  if (!company) company = metaContent(html, "og:site_name");

  let companyWebsite = "";
  if (typeof org === "object" && org) {
    for (const candidate of [org.sameAs, org.url]) {
      const candidateHost = hostOf(candidate ?? "");
      if (candidateHost && !isJobBoard(candidateHost)) {
        companyWebsite = candidate!.trim();
        break;
      }
    }
  }

  let roleTitle = posting?.title?.trim() ?? "";
  if (!roleTitle) {
    roleTitle = metaContent(html, "og:title");
    if (!roleTitle) {
      const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      roleTitle = decodeEntities(titleTag?.[1] ?? "").trim();
    }
    roleTitle = trimTitle(roleTitle, company);
  }

  let jobDescription = posting?.description ? htmlToText(posting.description) : "";
  if (!jobDescription) jobDescription = metaContent(html, "og:description");
  if (jobDescription.length > MAX_DESCRIPTION_CHARS) {
    jobDescription = `${jobDescription.slice(0, MAX_DESCRIPTION_CHARS)}\n\n[truncated]`;
  }

  const remote = posting?.jobLocationType === "TELECOMMUTE";
  const location = locationText(posting?.jobLocation) || (remote ? "Remote" : "");

  const source =
    BOARD_LABELS.find(([board]) => host === board || host.endsWith(`.${board}`))?.[1] ?? host;

  return {
    roleTitle,
    company,
    companyWebsite,
    jobDescription,
    location,
    workMode: remote ? "Remote" : "",
    salaryRange: salaryText(posting?.baseSalary),
    source,
  };
}
