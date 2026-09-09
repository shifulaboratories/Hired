import type { ActivityType, NoteKind, Stage, User, UserRole } from "@prisma/client";
import * as me from "@/lib/data/me";
import { civilInstant } from "@/lib/time";
import * as resumes from "@/lib/data/resumes";
import * as pipeline from "@/lib/data/pipeline";
import * as tags from "@/lib/data/tags";
import type { TagKind } from "@prisma/client";
import * as views from "@/lib/data/views";
import * as audit from "@/lib/data/audit";
import * as system from "@/lib/data/system";
import * as pipelineShare from "@/lib/data/pipeline-share";
import * as users from "@/lib/data/users";
import * as waitlist from "@/lib/data/waitlist";
import * as archive from "@/lib/data/archive";
import {
  FIELDS,
  NO_FIELDS,
  PIPELINE_VIEWS,
  visibleFields,
} from "@/lib/pipeline-fields";
import {
  COLUMNS,
  COLUMN_LISTS,
  LIST_LABEL,
  columnKeys,
  parseWidths,
  widthsFor,
} from "@/lib/column-widths";
import {
  exportApplicationsCsv,
  exportCompaniesCsv,
  exportContactsCsv,
  exportFilename,
} from "@/lib/data/export";
import { parsePipelineFilters } from "@/lib/pipeline-filters";
import * as connections from "@/lib/data/connections";
import * as onboarding from "@/lib/data/onboarding";
import * as accountsData from "@/lib/data/accounts";
import * as schedule from "@/lib/data/schedule";
import {
  getSettings,
  updateSettings,
  emailIsConfigured,
  billingIsConfigured,
  googleIsConfigured,
  microsoftIsConfigured,
  maskSecret,
  listVariables,
  setVariables,
  deleteVariable,
} from "@/lib/settings";
import { billedUserCount, linkBillingCustomer, syncAllBilling } from "@/lib/billing";
import { renderEmailTemplate, sendEmail } from "@/lib/email";
import { isAdmin, createEphemeralSession, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { parseResumeDoc, RESUME_DOC_SHAPE } from "@/lib/resume-schema";
import { diffResumeDocs } from "@/lib/resume-diff";
import { renderPdf, pdfRenderingAvailable } from "@/lib/pdf";
import { clientName, clientsById, guessClient } from "@/lib/mcp/clients";

type Json = Record<string, unknown>;

/**
 * Every tool call runs as exactly one user. The token in the connection URL
 * resolves to them, and `ctx.userId` is threaded into every data call, so a
 * connector can only ever reach its own owner's data.
 */
export type McpContext = {
  userId: string;
  user: User;
  /** The connection this call arrived on, so connection tools can tell which. */
  connectionId: string;
  /** Where this instance is reachable, for building invite links. */
  baseUrl: string;
};

/**
 * What a tool does to the world, in the four hints MCP defines.
 *
 * These are not documentation — Claude groups a connector's tools by them in the
 * approval UI, so a missing hint is the difference between someone allowing the
 * read side of this server outright and being asked about `search_me` as
 * often as about `delete_resume`.
 *
 * Two of the four default to the DANGEROUS value when omitted (`destructiveHint`
 * and `openWorldHint` are both true by default), which is why every tool here
 * states all four rather than the interesting ones. `annotationsFor` below is
 * what enforces that.
 *
 * The rule for `destructiveHint` in this codebase: replacing a field's contents
 * is destructive, appending to them is not. That is why `update_role` is
 * destructive and `append_role_background` — which exists because `update_role`
 * was eating people's notes — is not.
 */
export type McpAnnotations = {
  /** True only if the tool writes nothing at all: no row, no email, no link, no audit entry. */
  readOnlyHint: boolean;
  /** True if it may overwrite or delete. Meaningless when readOnlyHint is true. */
  destructiveHint: boolean;
  /** True if calling it twice with the same arguments does nothing the second time. */
  idempotentHint: boolean;
  /** True if it reaches an unbounded set of external things. Almost nothing here does. */
  openWorldHint: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  /** Required, because two of the four hints default to the dangerous value. */
  annotations: McpAnnotations;
  /** Admin-only tools are hidden from tools/list for members, not just refused. */
  adminOnly?: boolean;
  handler: (args: Json, ctx: McpContext) => Promise<unknown>;
};

/**
 * A link a client can render as an attachment instead of a URL buried in JSON.
 *
 * `export_resume_pdf` and `publish_resume` exist to hand somebody a link. Before
 * this they returned it as one field of a serialised object, so whether the user
 * ever saw something clickable depended on the model quoting it back. A
 * `resource_link` block is the protocol's own answer to that.
 */
export type ResourceLink = {
  type: "resource_link";
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

const RESULT_LINKS = Symbol("mcp.result.links");

type LinkedResult = { [RESULT_LINKS]: ResourceLink[]; data: unknown };

/**
 * Attach links to a tool result. The data half is serialised exactly as it would
 * have been, so a client that ignores resource links loses nothing.
 *
 * The marker is a symbol so that a result which somehow reaches `JSON.stringify`
 * without being unwrapped degrades to plain nested JSON rather than to garbage.
 */
export function withLinks(data: unknown, links: ResourceLink[]): LinkedResult {
  return { [RESULT_LINKS]: links, data };
}

/** Split a handler's return value into the JSON body and any links it carried. */
export function splitLinks(result: unknown): { data: unknown; links: ResourceLink[] } {
  if (result && typeof result === "object" && RESULT_LINKS in result) {
    const linked = result as LinkedResult;
    return { data: linked.data, links: linked[RESULT_LINKS] };
  }
  return { data: result, links: [] };
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const strArray = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

function object(properties: Json, required: string[] = []): Json {
  return { type: "object", properties, required, additionalProperties: false };
}

const s = (args: Json, key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
const n = (args: Json, key: string) => (typeof args[key] === "number" ? (args[key] as number) : undefined);
const b = (args: Json, key: string) => (typeof args[key] === "boolean" ? (args[key] as boolean) : undefined);
const a = (args: Json, key: string) =>
  Array.isArray(args[key]) ? (args[key] as string[]).map(String) : undefined;

/** Like requiredArray, but an empty list is a meaningful answer here. */
function requiredArrayAllowingEmpty(args: Json, key: string): string[] {
  const value = a(args, key);
  if (!value) throw new Error(`Missing required array argument "${key}"`);
  return value;
}

function requiredArray(args: Json, key: string): string[] {
  const value = a(args, key);
  if (!value || value.length === 0) {
    throw new Error(`Missing required array argument "${key}"`);
  }
  return value;
}

function required(args: Json, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string argument "${key}"`);
  }
  return value;
}

/**
 * One reading of an import payload, for the two tools that take one.
 *
 * import_resume and preview_resume_import share a schema of about a hundred
 * lines. Two copies of the code that walks it would disagree the day either
 * gained a field, and a preview of something other than what the import will do
 * is worse than no preview.
 */
function importPayloadFrom(args: Json): Parameters<typeof me.importResume>[1] {
  const roles = Array.isArray(args.roles) ? (args.roles as Json[]) : [];
  const education = Array.isArray(args.education) ? (args.education as Json[]) : [];
  const projects = Array.isArray(args.projects) ? (args.projects as Json[]) : [];
  const skillGroups = Array.isArray(args.skillGroups) ? (args.skillGroups as Json[]) : [];
  const certifications = Array.isArray(args.certifications) ? (args.certifications as Json[]) : [];
  const profile = (args.profile ?? {}) as Json;

  return {
    profile: defined({
      fullName: s(profile, "fullName"),
      headline: s(profile, "headline"),
      email: s(profile, "email"),
      phone: s(profile, "phone"),
      location: s(profile, "location"),
      website: s(profile, "website"),
      linkedin: s(profile, "linkedin"),
      github: s(profile, "github"),
      summary: s(profile, "summary"),
    }),
    roles: roles.map((role) => ({
      company: required(role, "company"),
      title: required(role, "title"),
      ...defined({
        employmentType: s(role, "employmentType"),
        location: s(role, "location"),
        startDate: s(role, "startDate"),
        endDate: s(role, "endDate"),
        isCurrent: b(role, "isCurrent"),
        summary: s(role, "summary"),
        background: s(role, "background"),
      }),
      bullets: (Array.isArray(role.bullets) ? (role.bullets as Json[]) : []).map((bullet) => ({
        text: required(bullet, "text"),
        ...defined({
          impact: s(bullet, "impact"),
          tags: a(bullet, "tags"),
          strength: n(bullet, "strength"),
        }),
      })),
    })),
    education: education.map((entry) => ({
      school: required(entry, "school"),
      ...defined({
        degree: s(entry, "degree"),
        field: s(entry, "field"),
        location: s(entry, "location"),
        startDate: s(entry, "startDate"),
        endDate: s(entry, "endDate"),
        gpa: s(entry, "gpa"),
        details: s(entry, "details"),
      }),
    })),
    projects: projects.map((entry) => ({
      name: required(entry, "name"),
      ...defined({
        role: s(entry, "role"),
        url: s(entry, "url"),
        description: s(entry, "description"),
        startDate: s(entry, "startDate"),
        endDate: s(entry, "endDate"),
        tags: a(entry, "tags"),
      }),
    })),
    skillGroups: skillGroups.map((group) => ({
      name: required(group, "name"),
      ...defined({ skills: a(group, "skills") }),
    })),
    certifications: certifications.map((entry) => ({
      name: required(entry, "name"),
      ...defined({
        issuer: s(entry, "issuer"),
        date: s(entry, "date"),
        url: s(entry, "url"),
      }),
    })),
  };
}

/** What to do about a role already on file. Shared by both import tools. */
function onExistingFrom(args: Json): { onExisting?: "merge" | "skip" } {
  return s(args, "on_existing") === "skip" ? { onExisting: "skip" } : {};
}

/**
 * A bare `YYYY-MM-DD` parses as midnight, so an inclusive end date would drop
 * everything that actually happened on it. Push it to the last millisecond of
 * that day where the person is — a window given in days is a window of THEIR
 * days, and on a UTC host "up to the 14th" would otherwise stop at 5pm on the
 * 13th in Chicago.
 */
function endOfDay(timeZone: string, value: string) {
  const civil = civilInstant(timeZone, value, 23, 59, 59, 999);
  if (civil) return civil;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`"${value}" is not a date I can read`);
  return date;
}

/** The other end of endOfDay: a date that fails to parse is an error, not 1970. */
function startOfDay(timeZone: string, value: string) {
  const civil = civilInstant(timeZone, value, 0);
  if (civil) return civil;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`"${value}" is not a date I can read`);
  return date;
}

/** Where a published resume lives. Null slug means it isn't published. */
function publicResumeUrl(baseUrl: string, slug: string | null) {
  return slug ? `${baseUrl}/r/${slug}` : null;
}

/** Where a shared pipeline lives. A share row always has a slug. */
function publicPipelineUrl(baseUrl: string, slug: string) {
  return `${baseUrl}/p/${slug}`;
}

/** Note kind, validated against the enum rather than trusted. */
function noteKind(args: Json): NoteKind | undefined {
  const value = s(args, "kind");
  return value === "GUARDRAIL" || value === "NOTE" ? value : undefined;
}

/**
 * An enum argument that fails loudly. The transport does not validate schemas,
 * and a filter the data layer doesn't recognise would otherwise return the
 * UNFILTERED list — an assistant asking for "companies I never applied to"
 * must not be handed all of them as if that were the answer.
 */
function enumArg<T extends string>(args: Json, key: string, allowed: readonly T[]): T | undefined {
  const value = s(args, key);
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Unknown ${key} "${value}". Use one of: ${allowed.join(", ")}.`);
}

/** The same rule for a list: one bad entry fails the call rather than narrowing nothing. */
function enumArrayArg<T extends string>(
  args: Json,
  key: string,
  allowed: readonly T[],
): T[] | undefined {
  const values = a(args, key);
  if (values === undefined) return undefined;
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`Unknown ${key} "${value}". Use one of: ${allowed.join(", ")}.`);
    }
  }
  return values as T[];
}

const TAG_COLORS = ["slate", "blue", "teal", "green", "amber", "red", "violet", "pink"] as const;
const TAG_KINDS = ["APPLICATION", "COMPANY", "CONTACT", "INDUSTRY", "SIZE", "LOCATION", "LOSS"] as const;
const COMPANY_FILTERS = ["active", "applied", "never-applied", "with-contacts"] as const;
const CONTACT_FILTERS = ["ping-due", "with-application", "no-company"] as const;
const ARCHIVE_KIND_VALUES = ["company", "contact", "application"] as const;
const EXPORT_KINDS = ["companies", "contacts", "applications"] as const;
const COMPANY_SORTS = ["name", "applied", "apps", "people"] as const;
const CONTACT_SORTS = ["name", "company", "ping", "touch"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;
const COMPANY_MISSING = ["website", "industry", "location"] as const;
const CONTACT_MISSING = ["email", "tags"] as const;
const PIPELINE_VIEW_VALUES = ["board", "list", "calendar"] as const;
const COLUMN_LIST_VALUES = ["pipeline", "companies", "contacts"] as const;

/**
 * The profile as a tool should see it.
 *
 * `photo` is hundreds of kilobytes of base64. Returning it would flood an
 * assistant's context with a picture it cannot look at, so every tool that
 * hands back a profile reports whether one is set and leaves the bytes here.
 */
function withoutPhotoBytes<T extends { photo: string }>(profile: T) {
  const { photo, ...rest } = profile;
  return { ...rest, hasPhoto: Boolean(photo) };
}


/**
 * list_correspondence takes exactly one of four ids. Two would be a question
 * with two answers, none is not a question.
 */
function correspondenceSubject(args: Json): accountsData.CorrespondenceSubject {
  const given = (
    [
      ["contact", s(args, "contactId")],
      ["company", s(args, "companyId")],
      ["application", s(args, "applicationId")],
      ["resume", s(args, "resumeId")],
    ] as const
  ).filter((entry): entry is readonly [accountsData.CorrespondenceSubject["kind"], string] =>
    Boolean(entry[1]?.trim()),
  );
  if (given.length !== 1) {
    throw new Error("Pass exactly one of contactId, companyId, applicationId or resumeId.");
  }
  return { kind: given[0][0], id: given[0][1] };
}

/** Strip undefined keys so Prisma doesn't try to write them. */
function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

const STAGE_VALUES = pipeline.STAGES;
const ACTIVITY_VALUES: ActivityType[] = [
  "NOTE",
  "STAGE_CHANGE",
  "EMAIL_SENT",
  "EMAIL_RECEIVED",
  "CALL",
  "INTERVIEW",
  "FOLLOW_UP",
  "APPLIED",
  "OFFER",
  "REJECTION",
  "REFERRAL",
  "OUTREACH",
];

export const tools: McpTool[] = [
  // -------------------------------------------------------------------------
  // ME — read
  // -------------------------------------------------------------------------
  {
    name: "search_me",
    title: "Search Me",
    description:
      "Ranked keyword search across everything the user has written about themselves: role backgrounds, achievement highlights, notes, projects and their profile. This is the FIRST tool to call when tailoring a resume or answering a question about their experience. Returns excerpts with the id and kind of each hit so you can fetch the full record.",
    inputSchema: object(
      {
        query: str("Keywords to search for, e.g. 'kubernetes cost savings' or 'led a team'"),
        limit: num("Max results (default 25)"),
      },
      ["query"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => me.searchMe(ctx.userId, required(args, "query"), n(args, "limit") ?? 25),
  },
  {
    name: "get_me_snapshot",
    title: "Get everything in Me",
    description:
      "Returns EVERYTHING in Me at once: profile, all roles with their full background text, all highlights, education, projects, skills, certifications and notes. Use when you need complete context (e.g. writing a resume from scratch). Can be large — prefer search_me for targeted lookups.",
    inputSchema: object({
      include_background: bool(
        "Include the full long-form background text for each role (default true). Set false for a lighter payload.",
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const snapshot = await me.getMeSnapshot(ctx.userId);
      const profile = withoutPhotoBytes(snapshot.profile);
      if (b(args, "include_background") === false) {
        return {
          ...snapshot,
          profile: { ...profile, background: "[omitted]" },
          roles: snapshot.roles.map((r) => ({ ...r, background: "[omitted]" })),
        };
      }
      return { ...snapshot, profile };
    },
  },
  {
    name: "get_profile",
    title: "Get profile",
    description:
      "The user's identity block: name, headline, contact details, links, career summary and their personal background (values, what they want next, comp expectations, non-negotiables). `hasPhoto` says whether a profile photo is set; the picture itself is not returned because it is hundreds of kilobytes of base64 — use set_profile_photo to change it. `timeZone` is the calendar every date in this workspace is read against — an IANA name, or empty meaning the server's own clock.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => withoutPhotoBytes(await me.getProfile(ctx.userId)),
  },
  {
    name: "update_profile",
    title: "Update profile",
    description:
      "Update any subset of the user's profile fields. Only pass the fields you want to change; omitted fields are left untouched.",
    inputSchema: object({
      fullName: str("Full name"),
      headline: str("Professional headline, e.g. 'Senior Platform Engineer'"),
      email: str("Email address"),
      phone: str("Phone number"),
      location: str("City, State/Country"),
      website: str("Personal website URL"),
      linkedin: str("LinkedIn URL"),
      github: str("GitHub URL"),
      twitter: str("X/Twitter URL"),
      summary: str("Career summary used as the default resume summary"),
      background: str(
        "Long-form personal background. REPLACES the existing text — read it first if you intend to add to it.",
      ),
      timeZone: str(
        "IANA time zone the user's dates are computed in, e.g. 'America/Chicago'. Everything dated follows it: what counts as today, when a follow-up is overdue, and the 9am a new follow-up is scheduled for. Pass an empty string to fall back to the server's own clock. Set this when they say where they are or that they have moved; an unrecognised name is refused rather than stored.",
      ),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      // The zone is not a ProfilePatch key: that type is also what
      // import_resume accepts, and reading somebody's CV is no reason to move
      // their clock. Written through its own validating setter instead.
      const timeZone = s(args, "timeZone");
      if (timeZone !== undefined) await me.setTimeZone(ctx.userId, timeZone);
      return withoutPhotoBytes(
        await me.updateProfile(
          ctx.userId,
          defined({
            fullName: s(args, "fullName"),
            headline: s(args, "headline"),
            email: s(args, "email"),
            phone: s(args, "phone"),
            location: s(args, "location"),
            website: s(args, "website"),
            linkedin: s(args, "linkedin"),
            github: s(args, "github"),
            twitter: s(args, "twitter"),
            summary: s(args, "summary"),
            background: s(args, "background"),
          }),
        ),
      );
    },
  },
  {
    name: "set_profile_photo",
    title: "Set the profile photo",
    description:
      "Give the user a headshot, or remove the one they have. One picture serves the whole app: it is their avatar in the interface, and every resume whose design has the photo switched on renders this exact image — so replacing it here updates every document at once, and there is never a second copy to keep in sync. Pass `url` for a picture that already exists on the web (an https link to a JPEG, PNG or WebP — a GitHub avatar, a personal site) and the server fetches it. Pass `data_uri` when you actually hold the bytes, e.g. after reading a local file: 'data:image/jpeg;base64,…'. Pass remove: true to clear it. Anything over 400KB is refused, so downscale first — a resume prints the photo about an inch square and a 512px original is already more than that needs. Turning the photo ON for a given resume is a separate step: update_resume with showPhoto: true. Never invent a picture of somebody: use only a URL or file the user has given you.",
    inputSchema: object({
      url: str("https link to an image to fetch and store"),
      data_uri: str("The image inline, e.g. 'data:image/jpeg;base64,…'"),
      remove: bool("Remove the existing photo"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) => {
      if (b(args, "remove")) {
        await me.setProfilePhoto(ctx.userId, "");
        return { photo: false, message: "Photo removed. Resumes that showed it now render without one." };
      }
      const source = s(args, "data_uri")?.trim() || s(args, "url")?.trim() || "";
      if (!source) throw new Error("Pass a url, a data_uri, or remove: true.");
      const result = await me.setProfilePhoto(ctx.userId, source);
      return {
        ...result,
        message:
          "Saved. It shows in the app straight away; a resume also needs showPhoto: true, and the Harvard template never renders one.",
      };
    },
  },
  {
    name: "list_roles",
    title: "List roles",
    description:
      "List every job/role in the knowledge base with dates and how many highlights each has. Does not include the full background — use get_role for that.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => me.listRoles(ctx.userId),
  },
  {
    name: "get_role",
    title: "Get a role",
    description:
      "Full detail for one role including its complete background text and all of its achievement highlights.",
    inputSchema: object({ id: str("Role id") }, ["id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const role = await me.getRole(ctx.userId, required(args, "id"));
      if (!role) throw new Error(`No role with id ${required(args, "id")}`);
      return role;
    },
  },
  {
    name: "create_role",
    title: "Create a role",
    description:
      "Add a job to the knowledge base. Put every raw detail you were given into background — it is unlimited and is the raw material for future resumes.",
    inputSchema: object(
      {
        company: str("Company name"),
        title: str("Job title"),
        employmentType: str("Full-time, Contract, Internship, Freelance…"),
        location: str("City, State or 'Remote'"),
        startDate: str("Start date as YYYY-MM"),
        endDate: str("End date as YYYY-MM. Leave empty if current."),
        isCurrent: bool("True if this is their current job"),
        summary: str("One or two sentences describing the scope of the role"),
        background: str(
          "THE BACKGROUND. Everything raw: projects, metrics, technologies, stories, praise, failures, org context. Markdown welcome. No length limit.",
        ),
        tags: strArray("Freeform tags, e.g. ['fintech','ic','python']"),
      },
      ["company", "title"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.createRole(ctx.userId, {
        company: required(args, "company"),
        title: required(args, "title"),
        ...defined({
          employmentType: s(args, "employmentType"),
          location: s(args, "location"),
          startDate: s(args, "startDate"),
          endDate: s(args, "endDate"),
          isCurrent: b(args, "isCurrent"),
          summary: s(args, "summary"),
          background: s(args, "background"),
          tags: a(args, "tags"),
        }),
      }),
  },
  {
    name: "update_role",
    title: "Update a role",
    description:
      "Update fields on an existing role. WARNING: passing background REPLACES the whole thing — use append_role_background to add to it safely.",
    inputSchema: object(
      {
        id: str("Role id"),
        company: str("Company name"),
        title: str("Job title"),
        employmentType: str("Employment type"),
        location: str("Location"),
        startDate: str("Start date as YYYY-MM"),
        endDate: str("End date as YYYY-MM"),
        isCurrent: bool("Is this the current job"),
        summary: str("Scope summary"),
        background: str("Replaces the entire background"),
        tags: strArray("Tags"),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.updateRole(ctx.userId, 
        required(args, "id"),
        defined({
          company: s(args, "company"),
          title: s(args, "title"),
          employmentType: s(args, "employmentType"),
          location: s(args, "location"),
          startDate: s(args, "startDate"),
          endDate: s(args, "endDate"),
          isCurrent: b(args, "isCurrent"),
          summary: s(args, "summary"),
          background: s(args, "background"),
          tags: a(args, "tags"),
        }),
      ),
  },
  {
    name: "append_role_background",
    title: "Append to a role's background",
    description:
      "Safely ADD text to the end of a role's background without touching what is already there. This is the right tool when the user tells you something new about a job they already have on file.",
    inputSchema: object(
      {
        id: str("Role id"),
        text: str("The new material to append. Markdown welcome."),
        heading: str("Optional markdown H2 heading to file it under, e.g. 'Q3 platform migration'"),
      },
      ["id", "text"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.appendToRoleBackground(ctx.userId, required(args, "id"), required(args, "text"), s(args, "heading")),
  },
  {
    name: "delete_role",
    title: "Delete a role",
    description: "Permanently delete a role and all of its highlights.",
    inputSchema: object({ id: str("Role id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => me.deleteRole(ctx.userId, required(args, "id")),
  },

  // -------------------------------------------------------------------------
  // ME — highlights
  // -------------------------------------------------------------------------
  {
    name: "list_highlights",
    title: "List highlights",
    description:
      "Reusable, polished achievement bullets, strongest first. These are the distilled lines you pull from when assembling a resume.",
    inputSchema: object({ roleId: str("Only return highlights for this role id") }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => me.listHighlights(ctx.userId, s(args, "roleId")),
  },
  {
    name: "create_highlights",
    title: "Create highlights",
    description:
      "Distil raw background material into one or more reusable achievement bullets. Write them in resume voice: strong verb, specific scope, quantified outcome. Create several at once.",
    inputSchema: object(
      {
        highlights: {
          type: "array",
          description: "The highlights to create",
          items: object(
            {
              roleId: str("Role this belongs to (omit for a standalone highlight)"),
              text: str("The bullet, in resume voice"),
              impact: str("The quantified outcome if it is not already inside `text`"),
              tags: strArray("Tags for retrieval, e.g. ['leadership','cost']"),
              strength: num("1-5 how strong this bullet is. Default 3."),
            },
            ["text"],
          ),
        },
      },
      ["highlights"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const items = Array.isArray(args.highlights) ? (args.highlights as Json[]) : [];
      return me.createHighlights(ctx.userId, 
        items.map((item) => ({
          roleId: s(item, "roleId") ?? null,
          text: required(item, "text"),
          impact: s(item, "impact"),
          tags: a(item, "tags"),
          strength: n(item, "strength"),
        })),
      );
    },
  },
  {
    name: "update_highlight",
    title: "Update a highlight",
    description: "Edit or archive one achievement bullet.",
    inputSchema: object(
      {
        id: str("Highlight id"),
        text: str("New bullet text"),
        impact: str("New impact"),
        tags: strArray("New tags"),
        strength: num("1-5"),
        archived: bool("Archive it instead of deleting"),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.updateHighlight(ctx.userId, 
        required(args, "id"),
        defined({
          text: s(args, "text"),
          impact: s(args, "impact"),
          tags: a(args, "tags"),
          strength: n(args, "strength"),
          archived: b(args, "archived"),
        }),
      ),
  },
  {
    name: "delete_highlight",
    title: "Delete a highlight",
    description: "Permanently delete an achievement bullet.",
    inputSchema: object({ id: str("Highlight id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => me.deleteHighlight(ctx.userId, required(args, "id")),
  },

  // -------------------------------------------------------------------------
  // ME — notes and extras
  // -------------------------------------------------------------------------
  {
    name: "list_notes",
    title: "List notes",
    description:
      "Free-floating notes not tied to any single job: STAR stories, interview prep, references, compensation history, anything.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => me.listNotes(ctx.userId),
  },
  {
    name: "create_note",
    title: "Create a note",
    description:
      "Save a free-floating note. Use this for raw material that does not belong to one specific job. Set kind: GUARDRAIL to make it a standing rule instead — see the kind field.",
    inputSchema: object(
      {
        title: str("Short title"),
        body: str("The note body. Markdown welcome, no length limit."),
        tags: strArray("Tags"),
        pinned: bool("Pin to the top of the notes list"),
        kind: {
          type: "string",
          enum: ["NOTE", "GUARDRAIL"],
          description:
            "GUARDRAIL makes this a standing rule: it is carried in the briefing every AI client receives on connect, so it constrains work before any tool is called. Use it for things that must never be got wrong — how they may and may not be described, numbers that are unsettled and must not be cited, credit that must not be overstated. Everything else is a NOTE (the default), which is only found by searching.",
        },
      },
      ["title"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.createNote(ctx.userId, {
        title: required(args, "title"),
        ...defined({
          body: s(args, "body"),
          tags: a(args, "tags"),
          pinned: b(args, "pinned"),
          kind: noteKind(args),
        }),
      }),
  },
  {
    name: "update_note",
    title: "Update a note",
    description:
      "Edit an existing note. Passing `body` replaces the whole body. Promote a note to a standing rule, or demote one, with `kind`.",
    inputSchema: object(
      {
        id: str("Note id"),
        title: str("New title"),
        body: str("New body (replaces existing)"),
        tags: strArray("New tags"),
        pinned: bool("Pinned state"),
        kind: {
          type: "string",
          enum: ["NOTE", "GUARDRAIL"],
          description:
            "GUARDRAIL makes this a standing rule: it is carried in the briefing every AI client receives on connect, so it constrains work before any tool is called. Use it for things that must never be got wrong — how they may and may not be described, numbers that are unsettled and must not be cited, credit that must not be overstated. Everything else is a NOTE (the default), which is only found by searching.",
        },
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.updateNote(ctx.userId, 
        required(args, "id"),
        defined({
          title: s(args, "title"),
          body: s(args, "body"),
          tags: a(args, "tags"),
          pinned: b(args, "pinned"),
          kind: noteKind(args),
        }),
      ),
  },
  {
    name: "delete_note",
    title: "Delete a note",
    description:
      "Permanently delete a note. This is the only way to remove one — a note has no archived state, unlike a highlight. It matters most for standing rules: a GUARDRAIL is carried in the briefing every AI client receives on connect, so a rule that no longer holds keeps shaping work until it is deleted. Read it back with list_notes and say which one you are about to remove, because the text is not recoverable.",
    inputSchema: object({ id: str("Note id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => me.deleteNote(ctx.userId, required(args, "id")),
  },
  {
    name: "list_extras",
    title: "List education / projects / skills / certifications",
    description:
      "Read one of the supporting knowledge-base collections: education history, side projects, skill groups, or certifications.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: ["education", "projects", "skills", "certifications"],
          description: "Which collection to read",
        },
      },
      ["kind"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      switch (required(args, "kind")) {
        case "education":
          return me.listEducation(ctx.userId);
        case "projects":
          return me.listProjects(ctx.userId);
        case "skills":
          return me.listSkillGroups(ctx.userId);
        case "certifications":
          return me.listCertifications(ctx.userId);
        default:
          throw new Error("kind must be education | projects | skills | certifications");
      }
    },
  },
  {
    name: "create_extra",
    title: "Add education / project / skill group / certification",
    description:
      "Add an item to one of the supporting collections. Only the fields relevant to `kind` are read — see each field's description for which kind it belongs to.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: ["education", "projects", "skills", "certifications"],
          description: "Which collection to add to",
        },
        school: str("[education] School name"),
        degree: str("[education] e.g. 'B.S.'"),
        field: str("[education] e.g. 'Computer Science'"),
        gpa: str("[education] GPA"),
        details: str("[education] Honours, coursework, activities"),
        name: str("[projects] project name · [skills] group name · [certifications] cert name"),
        role: str("[projects] Your role on the project"),
        url: str("[projects | certifications] Link"),
        description: str("[projects] One-line description"),
        background: str("[projects] Long-form raw detail about the project"),
        skills: strArray("[skills] The skills in this group, e.g. ['Python','Go','Rust']"),
        issuer: str("[certifications] Issuing body"),
        date: str("[certifications] Date earned"),
        location: str("[education] Location"),
        startDate: str("[education | projects] YYYY-MM"),
        endDate: str("[education | projects] YYYY-MM"),
        tags: strArray("[projects] Tags"),
      },
      ["kind"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      switch (required(args, "kind")) {
        case "education":
          return me.createEducation(ctx.userId, {
            school: required(args, "school"),
            ...defined({
              degree: s(args, "degree"),
              field: s(args, "field"),
              location: s(args, "location"),
              startDate: s(args, "startDate"),
              endDate: s(args, "endDate"),
              gpa: s(args, "gpa"),
              details: s(args, "details"),
            }),
          });
        case "projects":
          return me.createProject(ctx.userId, {
            name: required(args, "name"),
            ...defined({
              role: s(args, "role"),
              url: s(args, "url"),
              description: s(args, "description"),
              background: s(args, "background"),
              tags: a(args, "tags"),
              startDate: s(args, "startDate"),
              endDate: s(args, "endDate"),
            }),
          });
        case "skills":
          return me.createSkillGroup(ctx.userId, {
            name: required(args, "name"),
            skills: a(args, "skills") ?? [],
          });
        case "certifications":
          return me.createCertification(ctx.userId, {
            name: required(args, "name"),
            ...defined({ issuer: s(args, "issuer"), date: s(args, "date"), url: s(args, "url") }),
          });
        default:
          throw new Error("kind must be education | projects | skills | certifications");
      }
    },
  },
  {
    name: "update_extra",
    title: "Update an education / project / skill group / certification",
    description:
      "Change fields on an item in one of the supporting collections. Reach for this instead of deleting and re-creating — that would hand the item a new id and break anything referring to it. Only the fields you pass are changed; everything you leave out keeps its current value, so you do not need to read the item first. Fields not relevant to `kind` are ignored.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: ["education", "projects", "skills", "certifications"],
          description: "Which collection the item is in",
        },
        id: str("Id of the item to change"),
        school: str("[education] School name"),
        degree: str("[education] e.g. 'B.S.'"),
        field: str("[education] e.g. 'Computer Science'"),
        gpa: str("[education] GPA"),
        details: str("[education] Honours, coursework, activities"),
        name: str("[projects] project name · [skills] group name · [certifications] cert name"),
        role: str("[projects] Your role on the project"),
        url: str("[projects | certifications] Link"),
        description: str("[projects] One-line description"),
        background: str("[projects] Long-form raw detail about the project"),
        skills: strArray("[skills] REPLACES the whole list, e.g. ['Python','Go','Rust']"),
        issuer: str("[certifications] Issuing body"),
        date: str("[certifications] Date earned"),
        location: str("[education] Location"),
        startDate: str("[education | projects] YYYY-MM"),
        endDate: str("[education | projects] YYYY-MM"),
        tags: strArray("[projects] REPLACES the whole list"),
      },
      ["kind", "id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const id = required(args, "id");
      switch (required(args, "kind")) {
        case "education":
          return me.updateEducation(ctx.userId, id, 
            defined({
              school: s(args, "school"),
              degree: s(args, "degree"),
              field: s(args, "field"),
              location: s(args, "location"),
              startDate: s(args, "startDate"),
              endDate: s(args, "endDate"),
              gpa: s(args, "gpa"),
              details: s(args, "details"),
            }),
          );
        case "projects":
          return me.updateProject(ctx.userId, id, 
            defined({
              name: s(args, "name"),
              role: s(args, "role"),
              url: s(args, "url"),
              description: s(args, "description"),
              background: s(args, "background"),
              tags: a(args, "tags"),
              startDate: s(args, "startDate"),
              endDate: s(args, "endDate"),
            }),
          );
        case "skills":
          return me.updateSkillGroup(ctx.userId, id, 
            defined({ name: s(args, "name"), skills: a(args, "skills") }),
          );
        case "certifications":
          return me.updateCertification(ctx.userId, id, 
            defined({
              name: s(args, "name"),
              issuer: s(args, "issuer"),
              date: s(args, "date"),
              url: s(args, "url"),
            }),
          );
        default:
          throw new Error("kind must be education | projects | skills | certifications");
      }
    },
  },
  {
    name: "delete_extra",
    title: "Delete an education / project / skill group / certification",
    description: "Remove an item from one of the supporting collections.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: ["education", "projects", "skills", "certifications"],
          description: "Which collection the item is in",
        },
        id: str("Item id"),
      },
      ["kind", "id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const id = required(args, "id");
      switch (required(args, "kind")) {
        case "education":
          return me.deleteEducation(ctx.userId, id);
        case "projects":
          return me.deleteProject(ctx.userId, id);
        case "skills":
          return me.deleteSkillGroup(ctx.userId, id);
        case "certifications":
          return me.deleteCertification(ctx.userId, id);
        default:
          throw new Error("kind must be education | projects | skills | certifications");
      }
    },
  },
  {
    name: "import_resume",
    title: "Import a resume into Me",
    description:
      "Turn an existing resume, LinkedIn export or any pasted career history into a filled-in Me in ONE call. This is the first tool to reach for when the workspace is empty and the user has a document — it is the difference between starting from their real history and starting from nothing, so offer it before asking them to talk through their life. You do the reading: parse the pasted text yourself into the structured payload — profile facts, one entry per role with its bullets, education, projects, skills, certifications. Copy what the document actually says and NEVER invent, upgrade or round anything: no employers, titles, dates or metrics the text does not state, and a field the document is silent on stays absent. Include startDate on every role — it is part of a role's identity, and two stints at the same company import as two roles only when their dates differ. Everything is additive and re-import is safe: nothing is ever overwritten or removed. Profile fields fill only where currently empty. A role already on file — same company+title, matching start date — is not created twice; instead the bullets it does not already have are added to it and the new wording is appended to its background, so re-importing an updated resume brings in what changed. An education entry with the same school+degree+field, or a project/certification with the same name, is skipped; a skill group with an existing name has its skills unioned in. Each role's bullets are saved as highlights and land in its background for search_me to mine. Returns exactly what was created, what was merged into with how many bullets each gained, and what was skipped — report that to the user. Call preview_resume_import first when the workspace is NOT empty: it returns this same report without writing, so you can tell them what a second import would change before it changes it. Pass create_base_resume: true to also build their first draft from what was imported; it reuses a resume already named 'Base resume' rather than minting another, so repeating the whole call is safe. Offer it — a resume is usually why they pasted one.",
    inputSchema: object(
      {
        profile: {
          type: "object",
          description:
            "Contact and identity facts from the document. Only fills fields that are currently empty.",
          properties: {
            fullName: str("Their name as the document states it"),
            headline: str("Professional headline / current title line"),
            email: str("Email address"),
            phone: str("Phone number"),
            location: str("City / region"),
            website: str("Personal site URL"),
            linkedin: str("LinkedIn URL"),
            github: str("GitHub URL"),
            summary: str("The document's own summary or objective paragraph, verbatim or lightly cleaned"),
          },
          additionalProperties: false,
        },
        roles: {
          type: "array",
          description: "One entry per job in the document, newest first.",
          items: object(
            {
              company: str("Employer name"),
              title: str("Job title"),
              employmentType: str("Full-time (default) | Part-time | Contract | Freelance | Internship"),
              location: str("Where, if stated"),
              startDate: str(
                "YYYY-MM if stated. Part of the role's identity — two stints at the same company+title are told apart by it, so include it whenever the document has it.",
              ),
              endDate: str("YYYY-MM, empty if current"),
              isCurrent: bool("True when the document marks it as current"),
              summary: str("The role's one-line scope, if the document has one"),
              background: str(
                "Raw text about this role beyond the bullets — the section as pasted is fine. Omit to auto-fill from the bullets.",
              ),
              bullets: {
                type: "array",
                description: "The role's bullet points, one per bullet, wording kept.",
                items: object(
                  {
                    text: str("The bullet as the document states it"),
                    impact: str("Its quantified outcome, only if not already inside text"),
                    tags: strArray("Tags for retrieval, e.g. ['leadership','cost']"),
                    strength: num("1-5 how strong the bullet reads. Default 3."),
                  },
                  ["text"],
                ),
              },
            },
            ["company", "title"],
          ),
        },
        education: {
          type: "array",
          description: "Education entries.",
          items: object(
            {
              school: str("Institution"),
              degree: str("Degree, e.g. 'BSc'"),
              field: str("Field of study"),
              location: str("Where, if stated"),
              startDate: str("YYYY-MM if stated"),
              endDate: str("YYYY-MM if stated"),
              gpa: str("GPA / grade, only if stated"),
              details: str("Honours, coursework, anything else the entry lists"),
            },
            ["school"],
          ),
        },
        projects: {
          type: "array",
          description: "Side or portfolio projects the document lists.",
          items: object(
            {
              name: str("Project name"),
              role: str("Their part in it"),
              url: str("Link, if stated"),
              description: str("What it is, from the document"),
              startDate: str("YYYY-MM if stated"),
              endDate: str("YYYY-MM if stated"),
              tags: strArray("Tags for retrieval"),
            },
            ["name"],
          ),
        },
        skillGroups: {
          type: "array",
          description:
            "Skills grouped the way the document groups them, e.g. {name: 'Languages', skills: ['Go','TypeScript']}. Use one group named 'Skills' when it is a flat list.",
          items: object(
            { name: str("Group label"), skills: strArray("The skills in it") },
            ["name"],
          ),
        },
        certifications: {
          type: "array",
          description: "Certifications and licences.",
          items: object(
            {
              name: str("Certification name"),
              issuer: str("Who issued it"),
              date: str("When, as the document states it"),
              url: str("Verification link, if stated"),
            },
            ["name"],
          ),
        },
        on_existing: str(
          "What to do with a role already on file: 'merge' (default) adds the bullets it does not have and appends the new wording to its background; 'skip' leaves it completely untouched, which is what this tool used to do. Merging never edits or removes anything, so prefer it.",
        ),
        create_base_resume: bool(
          "Also build a first draft resume from what was imported, named 'Base resume'. Offer this — it is usually why they pasted a resume.",
        ),
      },
      [],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const result = await me.importResume(
        ctx.userId,
        importPayloadFrom(args),
        onExistingFrom(args),
      );

      if (b(args, "create_base_resume")) {
        // Reuse before create lives in the data layer, because the import
        // dialog does the same thing at the end of the same flow.
        return { ...result, baseResume: await resumes.ensureBaseResume(ctx.userId) };
      }
      return result;
    },
  },

  {
    name: "preview_resume_import",
    title: "Preview what importing a resume would do",
    description:
      "Read an import payload and report exactly what it WOULD change, writing nothing. Build the payload exactly as you would for import_resume — same shape, same fields, call get_me_snapshot or import_resume's schema if you need it — and pass it as `payload`. Send it here first whenever the workspace is NOT already empty: a second resume from someone who has history is where 'what will this do to what I already have?' is a real question, and this answers it before anything happens rather than after. Returns the same report import_resume returns: the roles it would create, the roles already on file it would add bullets to and how many each would gain, what it would skip, and which profile fields would fill. It runs the real import and rolls it back, so its answer cannot drift from what the import actually does. Nothing is written; call import_resume with the same payload to go ahead.",
    inputSchema: object(
      {
        payload: {
          type: "object",
          description:
            "Exactly the arguments you would pass to import_resume — profile, roles with their bullets, education, projects, skillGroups, certifications.",
          additionalProperties: true,
        },
        on_existing: str(
          "'merge' (default) or 'skip', matching import_resume. Preview what you intend to do, not something else.",
        ),
      },
      ["payload"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      me.previewResumeImport(
        ctx.userId,
        importPayloadFrom((args.payload ?? {}) as Json),
        onExistingFrom(args),
      ),
  },

  // -------------------------------------------------------------------------
  // RESUMES
  // -------------------------------------------------------------------------
  {
    name: "get_resume_format",
    title: "Get the resume document format",
    description:
      "Returns the exact JSON shape of a resume document plus the available templates, fonts and writing guidance. Call this once before your first create_resume or update_resume so the document you build validates.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => ({
      documentShape: RESUME_DOC_SHAPE,
      defaultTemplate: "harvard",
      templates: [
        {
          key: "harvard",
          description:
            "DEFAULT. The Harvard OCS format: Times-metric serif, everything one size, name and section headings centred over full-width rules, each entry two justified lines (organisation/location, then role/dates). Dense, black-and-white, maximally ATS-safe. Use this unless asked otherwise.",
        },
        { key: "classic", description: "Serif headings, centred header. Timeless, ATS-safe. Takes a photo, centred above the name." },
        { key: "modern", description: "Sans-serif, accent rules, left-aligned header. Takes a photo, beside the name." },
        { key: "compact", description: "Tight leading, two-column skills. Fits the most content. Takes a photo, beside the name." },
        { key: "editorial", description: "Large display name, generous whitespace, magazine feel. Takes a photo, squared off beside the name." },
      ],
      fonts: ["serif", "inter", "mono"],
      defaults: {
        template: "harvard",
        fontFamily: "serif",
        accent: "#000000",
        fontSize: 10,
        lineHeight: 1.2,
        pageMargin: 48,
        showPhoto: false,
      },
      guidance: [
        "Dates use YYYY-MM. Set isCurrent: true instead of an endDate for the current job.",
        "Bullets: strong verb first, specific scope, quantified outcome. One line each where possible.",
        "Harvard house style: no personal pronouns, each bullet a phrase rather than a full sentence, quantified wherever the background gives you a number.",
        "Harvard renders the organisation on line one and the role on line two, so fill in BOTH `company` and `title` on every experience entry, plus `location`.",
        "Section order: experience-first for anyone with real work history. Education-first is the Harvard student convention — use it only for students and recent graduates.",
        "For a 'Leadership & Activities' section, use an experience-kind section with that heading — organisation, role, location and dates all lay out correctly.",
        "In Harvard, education `details` render as plain lines (thesis, relevant coursework, honours), not bullets.",
        "Set visible: false to keep a section in the document but off the page.",
        "Sections and entries carry an `id`. Never invent one — leave it out and the app assigns it — but when you have read a document with get_resume and are writing it back, keep the ids you were given: they are how the editor tells one entry from another.",
        "Aim for roughly 40-48 rendered lines per page; call preview_resume_text to sanity-check length before saving.",
        "Photos: off unless asked. showPhoto draws the user's profile picture (set_profile_photo), never one you supply per document. Harvard never renders one — it is a US academic format and a face on it is wrong. US and UK applications generally omit photos; much of Europe and Latin America expects one.",
      ],
    }),
  },
  {
    name: "list_resumes",
    title: "List resumes",
    description:
      "All saved resumes with their target role/company, how many applications each is attached to, and publicUrl — the shareable link, or null if that resume isn't published. Each row carries outcomes: how many applications sent with it actually went out, how many reached at least a screen, and how many reached an offer — so this is the tool that answers 'which resume is working?'. Interview and offer counts include applications that got there and later closed, not just where things stand today. Favourites come first, then most recently updated. Pass search to narrow by name, target role or target company when the user names a specific one — 'my Stripe resume' is a search, not a reason to fetch everything.",
    inputSchema: object({
      search: str("Case-insensitive filter on name, target role and target company. Omit for all."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const all = await resumes.listResumes(ctx.userId, defined({ search: s(args, "search") }));
      return all.map((resume) => ({
        ...resume,
        publicUrl: publicResumeUrl(ctx.baseUrl, resume.slug),
      }));
    },
  },
  {
    name: "get_resume",
    title: "Get a resume",
    description:
      "Fetch one resume: its settings, its full document JSON, publicUrl — the shareable link, or null if it isn't published — what it was tailored from, the variants tailored off it, and every application it was sent to with the stage each reached. Read this before update_resume, which replaces the whole document. The applications are what makes 'is this resume working' answerable from one call.",
    inputSchema: object(
      {
        id: str("Resume id"),
        as_text: bool("Also return a flat plain-text rendering, useful for reviewing length and flow"),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const resume = await resumes.getResume(ctx.userId, required(args, "id"));
      if (!resume) throw new Error("Resume not found");
      // `photo` is the resolved image itself; showPhoto already says whether
      // this document uses one, and the base64 helps nobody reading this.
      const { photo, ...row } = resume;
      const withUrl = { ...row, publicUrl: publicResumeUrl(ctx.baseUrl, resume.slug) };
      if (b(args, "as_text")) {
        return {
          ...withUrl,
          text: resumes.resumeToText(resume.doc),
          estimatedLines: resumes.estimateLines(resume.doc),
        };
      }
      return withUrl;
    },
  },
  {
    name: "create_resume",
    title: "Create a resume",
    description:
      "Create a resume. Either pass a complete `data` document you have written (call get_resume_format first), or pass seedFromMe: true to auto-populate a first draft from Me and then refine it with update_resume.",
    inputSchema: object(
      {
        name: str("What to call this resume, e.g. 'Stripe — Staff Engineer'"),
        targetRole: str("The role being targeted"),
        targetCompany: str("The company being targeted"),
        template: str("harvard (default) | classic | modern | compact | editorial"),
        accent: str("Accent colour as a hex string. Defaults to '#000000', which is what Harvard expects."),
        fontFamily: str("serif (default) | inter | mono"),
        fontSize: num("Base font size in points, 9-12. Default 10."),
        lineHeight: num("Line height, 1.15-1.6. Default 1.2."),
        notes: str("Private notes about this version — what you tailored and why"),
        showPhoto: bool(
          "Render the user's profile photo in the header. Needs a photo set (see set_profile_photo) and a template that takes one — harvard never does.",
        ),
        seedFromMe: bool("Auto-build a first draft from the knowledge base"),
        baseResumeId: str(
          "Id of the resume this one was tailored from, if any. Records lineage so compare_resumes can show what changed. duplicate_resume sets this automatically — prefer it when the variant starts from an existing document.",
        ),
        data: {
          type: "object",
          description:
            "The full resume document. See get_resume_format for the exact shape. Omit if using seedFromMe.",
          additionalProperties: true,
        },
      },
      ["name"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      resumes.createResume(ctx.userId, {
        name: required(args, "name"),
        seedFromMe: b(args, "seedFromMe"),
        data: args.data,
        ...defined({
          baseResumeId: s(args, "baseResumeId"),
          targetRole: s(args, "targetRole"),
          targetCompany: s(args, "targetCompany"),
          template: s(args, "template"),
          accent: s(args, "accent"),
          fontFamily: s(args, "fontFamily"),
          fontSize: n(args, "fontSize"),
          lineHeight: n(args, "lineHeight"),
          notes: s(args, "notes"),
          showPhoto: b(args, "showPhoto"),
        }),
      }),
  },
  {
    name: "update_resume",
    title: "Update a resume",
    description:
      "Update a resume's settings and/or replace its document. Passing `data` replaces the ENTIRE document, so call get_resume first, modify the JSON you get back, and send the whole thing.",
    inputSchema: object(
      {
        id: str("Resume id"),
        name: str("New name"),
        targetRole: str("Target role"),
        targetCompany: str("Target company"),
        template: str("harvard | classic | modern | compact | editorial"),
        accent: str("Accent colour hex"),
        fontFamily: str("serif | inter | mono"),
        fontSize: num("Base font size in points"),
        lineHeight: num("Line height"),
        notes: str("Private notes"),
        isFavorite: bool("Pin this resume to the top"),
        showPhoto: bool(
          "Render the user's profile photo in the header. The picture is the one on their profile, so this only switches it on or off for this document. Harvard ignores it by convention.",
        ),
        data: {
          type: "object",
          description: "The complete replacement resume document",
          additionalProperties: true,
        },
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      resumes.updateResume(ctx.userId, required(args, "id"), {
        ...(args.data !== undefined ? { data: args.data } : {}),
        ...defined({
          name: s(args, "name"),
          targetRole: s(args, "targetRole"),
          targetCompany: s(args, "targetCompany"),
          template: s(args, "template"),
          accent: s(args, "accent"),
          fontFamily: s(args, "fontFamily"),
          fontSize: n(args, "fontSize"),
          lineHeight: n(args, "lineHeight"),
          notes: s(args, "notes"),
          isFavorite: b(args, "isFavorite"),
          showPhoto: b(args, "showPhoto"),
        }),
      }),
  },
  {
    name: "export_resume_pdf",
    title: "Export a resume as a PDF",
    description:
      "Render a resume to a real PDF on the server and return a download url, plus how many pages it actually came out to. Reach for this when the user wants a FILE to attach to an email or upload to a form — use publish_resume instead when they want a link. The page count is measured from the rendered document rather than estimated, so it is the reliable way to answer 'does this fit on one page?' before they send it. The url opens in their browser, where they are already signed in; it is not a public link and nobody else can fetch it. If this instance has no headless browser the tool says so and points at the print page, which produces the same document through the browser's own print dialog.",
    inputSchema: object({ id: str("Resume id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const id = required(args, "id");
      const resume = await resumes.getResume(ctx.userId, id);
      if (!resume) throw new Error(`No resume with id ${id}`);

      const downloadUrl = `${ctx.baseUrl}/api/resumes/${id}/pdf`;
      if (!pdfRenderingAvailable()) {
        const printUrl = `${ctx.baseUrl}/print/${id}`;
        return withLinks(
          {
            available: false,
            printUrl,
            message:
              "This instance has no headless browser, so it cannot render PDFs server-side. Open the print url and use the browser's Save as PDF.",
          },
          [
            {
              type: "resource_link",
              uri: printUrl,
              name: `${resume.name} (print page)`,
              description: "Opens the US-Letter page; use the browser's Save as PDF.",
              mimeType: "text/html",
            },
          ],
        );
      }

      // Render once here so the answer is "it worked, and it is N pages",
      // not "here is a url, hope it works".
      const token = await createEphemeralSession(ctx.userId);
      try {
        const { bytes, pages } = await renderPdf({
          url: `${ctx.baseUrl}/print/${id}`,
          sessionCookie: {
            name: SESSION_COOKIE,
            value: token,
            domain: new URL(ctx.baseUrl).hostname,
            secure: ctx.baseUrl.startsWith("https:"),
          },
        });
        return withLinks(
          {
            available: true,
            url: downloadUrl,
            pages,
            sizeKb: Math.round(bytes.length / 1024),
            name: resume.name,
          },
          [
            {
              type: "resource_link",
              uri: downloadUrl,
              name: `${resume.name}.pdf`,
              description: `${pages} page${pages === 1 ? "" : "s"}. Opens in the browser they are already signed in to.`,
              mimeType: "application/pdf",
            },
          ],
        );
      } finally {
        await destroySession(token);
      }
    },
  },
  {
    name: "publish_resume",
    title: "Publish a resume to a public link",
    description:
      "Give a resume a shareable web address. Reach for this whenever the user needs a LINK rather than a file — an application form with a 'portfolio or resume URL' field, a recruiter asking them to send something over, a message where attaching a PDF would be awkward. Returns publicUrl, which is the whole point: hand it straight to the user. Anyone with the link can read the resume without signing in, and the link is the only protection, so it is long and random — it cannot be guessed or found by searching, and the page tells search engines not to index it. The user's private notes on the resume are never shown — but if this resume has showPhoto on, their face is on that page, visible to anyone holding the link. Say so before publishing one, or offer to turn the photo off first. Calling this again while the resume is already published returns the SAME url, so it is safe to repeat. If the resume was previously unpublished, publishing mints a brand new url and the old one stays dead.",
    inputSchema: object({ id: str("Resume id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const resume = await resumes.publishResume(ctx.userId, required(args, "id"));
      const publicUrl = publicResumeUrl(ctx.baseUrl, resume.slug);
      const links: ResourceLink[] = publicUrl
        ? [
            {
              type: "resource_link",
              uri: publicUrl,
              name: resume.name,
              description: "Public resume. Anyone holding this link can read it without signing in.",
              mimeType: "text/html",
            },
          ]
        : [];
      return withLinks({ ...resume, publicUrl }, links);
    },
  },
  {
    name: "unpublish_resume",
    title: "Withdraw a resume's public link",
    description:
      "Turn off a resume's public link. Reach for this when the user is done with a link, or has sent one somewhere they regret. The page starts returning 'not found' immediately for everyone who has the url. This is PERMANENT for that address: the link is not parked or paused, it is destroyed, and publishing the same resume later produces a different url. Say so before doing it if the user might still need the old link working. Does not touch the resume itself — nothing is deleted.",
    inputSchema: object({ id: str("Resume id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => resumes.unpublishResume(ctx.userId, required(args, "id")),
  },
  {
    name: "duplicate_resume",
    title: "Duplicate a resume",
    description:
      "Copy an existing resume so you can tailor a variant without losing the original. The usual flow for a new application. The copy records which resume it came from (baseResumeId), so after tailoring, compare_resumes can show exactly what changed — prefer this over building a tailored document with create_resume from scratch, which loses that trail unless you pass baseResumeId yourself.",
    inputSchema: object({ id: str("Resume id to copy"), name: str("Name for the copy") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => resumes.duplicateResume(ctx.userId, required(args, "id"), s(args, "name")),
  },
  {
    name: "tailor_resume_for_application",
    title: "Start a tailored resume for one job",
    description:
      "Copy the base resume, name it for the job, point it at that company and role, and attach it to the application — the four steps this otherwise takes, in one call. Returns the new resume (with its full document, ready to rewrite with update_resume) and what it was based on. The base is worked out for you: the original document, favourite first, the one that has variants rather than one of the variants. Pass baseId to override that. With nothing on file yet it builds the first draft from what is on file instead of refusing, so a new person asking for a tailored resume gets one. Anything already attached to that application is replaced — the old document is not deleted, it just stops being the one on this job.",
    inputSchema: object(
      {
        applicationId: str("The job this resume is for"),
        baseId: str("Copy this resume instead of the one picked for you"),
        name: str("Name for the copy. Defaults to 'Company — Role'."),
      },
      ["applicationId"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      resumes.createResumeForApplication(ctx.userId, required(args, "applicationId"), {
        ...defined({ baseId: s(args, "baseId"), name: s(args, "name") }),
      }),
  },
  {
    name: "compare_resumes",
    title: "Compare two resumes",
    description:
      "What changed between two resumes — typically a tailored variant against the base it was duplicated from. Pass just id and it compares against the resume's recorded base (duplicate_resume sets that automatically); pass base_id to compare against any other resume. Returns the changed header fields, each section's added and removed bullets and entries, and a one-line summary like '+4 bullets · −2 bullets · summary edited'. A reworded bullet shows as one removed plus one added — old wording beside new, no similarity guessing. Read-only, nothing is written. Reach for this when the user asks what a tailored copy changed, or to review a variant with them before it goes out.",
    inputSchema: object(
      {
        id: str("The tailored resume to inspect"),
        base_id: str(
          "What to compare against. Defaults to the resume's own recorded base; required only when it has none or the user wants a different comparison.",
        ),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const variant = await resumes.getResume(ctx.userId, required(args, "id"));
      if (!variant) throw new Error("Resume not found");
      const baseId = s(args, "base_id") ?? variant.baseResumeId;
      if (!baseId) {
        throw new Error(
          "This resume has no recorded base. Pass base_id to say what to compare it against.",
        );
      }
      const base = await resumes.getResume(ctx.userId, baseId);
      if (!base) throw new Error(`No resume with id ${baseId}`);
      const diff = diffResumeDocs(base.doc, variant.doc);
      return {
        base: { id: base.id, name: base.name },
        variant: { id: variant.id, name: variant.name },
        ...diff,
      };
    },
  },
  {
    name: "set_resume_base",
    title: "Say what a resume was tailored from",
    description:
      "Record that one resume is a tailored copy of another, so compare_resumes can compare them. duplicate_resume sets this for you; this is for documents that already existed, or to re-point one. Pass an empty baseId to unlink. Refuses a loop — two resumes cannot each be the other's base — and refuses to make a resume its own base.",
    inputSchema: object(
      { id: str("The tailored resume"), baseId: str("The resume it came from, or empty to unlink") },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      resumes.setResumeBase(ctx.userId, required(args, "id"), s(args, "baseId") || null),
  },
  {
    name: "trace_resume_evidence",
    title: "Which of your own material backs each bullet",
    description:
      "For every experience bullet in a resume, the highlights from Me that stand behind it, best match first, plus a count of the bullets nothing backs. This is derived by comparing text, not recorded when the document was written — so treat a match as 'this claim is in your notes', not as proof of authorship. The unbacked list is the useful half: those are the lines the person cannot expand on from their own material, which is exactly what to walk through before an interview, and what to ask about before writing anything new. Never invent evidence for a bullet that has none.",
    inputSchema: object({ id: str("Resume id") }, ["id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => resumes.traceResumeEvidence(ctx.userId, required(args, "id")),
  },
  {
    name: "delete_resume",
    title: "Delete a resume",
    description: "Permanently delete a resume.",
    inputSchema: object({ id: str("Resume id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => resumes.deleteResume(ctx.userId, required(args, "id")),
  },
  {
    name: "add_role_to_resume",
    title: "Put a job from Me into a resume",
    description:
      "Add one job you already have in Me to a resume that already exists — its company, title, dates and its strongest bullets, in one call. Reach for this when a resume is missing a job, or when tailoring and the right move is to bring back a role the draft left out. Use it INSTEAD of update_resume for this: update_resume replaces the whole document, so adding one job that way means reproducing every other word of it, and a bullet dropped on the way is a loss nobody notices. Name the role by its id (list_roles gives you them) or by what it is called — the company or the title, however the user said it. It goes into the resume's experience section at the end unless you give `position`, 1-based. `bullets` caps how many of the role's highlights come with it; six by default, which is about what fits under one job. The entry keeps a link back to the role it came from, which is what lets the editor and trace_resume_evidence tell which of the person's own material stands behind each line. A job already in that resume is refused rather than added twice, and the error says where the existing one is. Returns what was added, where, and how many of the role's bullets were used out of how many it has — say so, because the rest are there to draw on.",
    inputSchema: object(
      {
        id: str("Resume id"),
        role: str("The role: its id, or the company or title it goes by"),
        section: str(
          "Which experience section, by id or heading. Defaults to the first one — most resumes have exactly one.",
        ),
        position: num("Where among the jobs it lands, 1-based. Defaults to last."),
        bullets: num("How many of the role's highlights to bring. Default 6."),
      },
      ["id", "role"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      resumes.addRoleToResume(ctx.userId, required(args, "id"), {
        role: required(args, "role"),
        ...defined({
          section: s(args, "section"),
          position: n(args, "position"),
          bullets: n(args, "bullets"),
        }),
      }),
  },
  {
    name: "reorder_resume",
    title: "Move a section, entry or bullet",
    description:
      "Move one piece of a resume to a different position — a section, an entry inside it, or a bullet inside that. Use this instead of update_resume whenever only the ORDER changes: update_resume replaces the whole document, so reordering that way means reproducing every word of it and risks dropping content you did not mean to touch. This moves one thing and leaves the rest untouched. Name the thing that moves by giving `section`, plus `entry` if you are moving an entry, plus `bullet` if you are moving a bullet — the deepest one you name is what moves. Each of them takes an id, the name it goes by (a heading, a company or school, the bullet's own words) or its number in the list, so you can pass what the user said. `position` is 1-based: 1 puts it first, and anything past the end puts it last. Returns what moved, from where to where, and the section order that resulted. If nothing matches, the error lists what is actually there — read it and try again rather than falling back to update_resume.",
    inputSchema: object(
      {
        id: str("Resume id"),
        section: str("The section: its id, its heading, or its 1-based number"),
        entry: str(
          "An entry inside that section: its id, the company/school/project it names, or its 1-based number. Give this to move the entry, or to say where a bullet lives.",
        ),
        bullet: str(
          "A bullet inside that entry: its text (or enough of it to match) or its 1-based number. Give this to move a bullet.",
        ),
        position: num("Where it lands, 1-based. 1 is first; past the end is last."),
      },
      ["id", "section", "position"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      resumes.reorderResume(ctx.userId, required(args, "id"), {
        section: required(args, "section"),
        entry: args.entry === undefined ? undefined : String(args.entry),
        bullet: args.bullet === undefined ? undefined : String(args.bullet),
        position: Number(args.position),
      }),
  },
  {
    name: "check_resume_fit",
    title: "Check what to cut from a resume",
    description:
      "Reach for this when a resume runs long and the question is what to cut. Returns its bullets ranked longest first — each with the entry it sits under and the path to it — and its sections ranked by how much room they take, so the two obvious levers are in front of you: shorten the worst offenders, or hide a whole section. It RANKS; it does not measure. The page count it reports is the same estimate preview_resume_text gives and carries the same limit — it cannot see the type size, leading or margins, and only a browser can. Call export_resume_pdf for the real number, then call this to decide what goes. Nothing is written: read it, propose the cuts to the user, and make them with update_resume once they agree. Cutting a bullet is deleting something true they did, so say which ones you would drop and why rather than dropping them.",
    inputSchema: object({ id: str("Resume id") }, ["id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => resumes.resumeFitReport(ctx.userId, required(args, "id")),
  },
  {
    name: "preview_resume_text",
    title: "Preview a resume document as text",
    description:
      "Render a resume document JSON to plain text WITHOUT saving it, and estimate how many lines it will occupy. Use it to check length and flow before committing with create_resume or update_resume.",
    inputSchema: object(
      {
        data: {
          type: "object",
          description: "A resume document to render",
          additionalProperties: true,
        },
      },
      ["data"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const doc = parseResumeDoc(args.data);
      return {
        text: resumes.resumeToText(doc),
        estimatedLines: resumes.estimateLines(doc),
        approxPages: resumes.estimatePages(doc),
      };
    },
  },

  // -------------------------------------------------------------------------
  // PIPELINE
  // -------------------------------------------------------------------------
  {
    name: "pipeline_stats",
    title: "Pipeline stats",
    description:
      "Counts by stage, applications still in flight, applications sent this week, how many are interviewing and the deepest round anyone has reached, offers, open tasks, follow-ups due and response rate. Start here for any 'how is my search going' question. Two things worth knowing before you quote a number: `active` counts applications actually sent and still alive, so a wishlist row is not in it; and `responseRate` is measured the way the funnel is, by how far each application ever got, so one that got an interview and was then rejected counts as a response. `responseRateBasis` is how many applications that rate is computed from — under about ten it is describing luck rather than a search, and the web app shows a dash instead of a figure. Say so rather than quoting a percentage at somebody who has applied to three things.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => pipeline.pipelineStats(ctx.userId),
  },
  {
    name: "list_applications",
    title: "List applications",
    description:
      "List job applications. By default the closed ones (ACCEPTED and LOST) are excluded. Every row carries two different numbers and they answer different questions: daysInStage is how long it has sat where it is, measured from the last stage change; quietDays is how long since ANYTHING happened to it — a logged call, an email, a stage move. 'What has gone quiet' is quietDays, and lastTouchAt is the date it counts from. Pass quietForDays to return only the ones past that many silent days, which is the fastest way to answer 'what needs chasing'.",
    inputSchema: object({
      stage: { type: "string", enum: STAGE_VALUES, description: "Only this stage" },
      includeClosed: bool("Include accepted / rejected / withdrawn"),
      search: str("Filter by company, role title or notes"),
      quietForDays: num("Only those with no activity for at least this many days"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.listApplications(ctx.userId, {
        stage: s(args, "stage") as Stage | undefined,
        includeClosed: b(args, "includeClosed"),
        search: s(args, "search"),
        quietForDays: n(args, "quietForDays"),
      }),
  },
  {
    name: "get_application",
    title: "Get an application",
    description:
      "Full detail for one application including the job description, the complete activity timeline, contacts and tasks. Also carries quietDays and lastTouchAt — how long since anything happened, and when.",
    inputSchema: object({ id: str("Application id") }, ["id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const application = await pipeline.getApplication(ctx.userId, required(args, "id"));
      if (!application) throw new Error(`No application with id ${required(args, "id")}`);
      return application;
    },
  },
  {
    name: "capture_job_posting",
    title: "Capture a job posting from its URL",
    description:
      "The FIRST tool to call when someone shares a link to a job posting. Fetches the page server-side, reads the structured posting data most job boards publish, and creates the application in one move: company matched or created (with its own website when the posting names one, which puts their logo on the pipeline), role title, full description, location, compensation and source all filled, starting on the wishlist. Returns captured true with the new application and its id. When the page doesn't state the employer or the role readably, returns captured false plus whatever WAS parsed and creates NOTHING — in that case show the person what was found, ask for the missing pieces, and use create_application. Never guess an employer's name from a URL. If they applied already, follow with move_application_stage.",
    inputSchema: object({ url: str("The posting's URL, e.g. a Greenhouse, Lever, Ashby, Workday or LinkedIn job link") }, ["url"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (args, ctx) => pipeline.captureJobPosting(ctx.userId, required(args, "url")),
  },
  {
    name: "list_tags",
    title: "List the tags on file",
    description:
      "Every label this person owns, as records rather than free strings: id, kind, name, colour, and how many applications, companies and contacts wear each. Six kinds, and they are separate lists that never collide — APPLICATION (where a job came from: LinkedIn, a referral, cold outreach), COMPANY, CONTACT (how a person is filed: recruiter, ex-colleague), INDUSTRY, SIZE and LOCATION (the three that used to be free-text fields on a company). Call this before writing tags anywhere: passing an existing id is exact, and passing a name that already exists matches it case-insensitively rather than creating a twin. Read-only.",
    inputSchema: object({
      kind: { type: "string", enum: [...TAG_KINDS], description: "Only this kind. Omit for all of them." },
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => tags.listTags(ctx.userId, enumArg(args, "kind", TAG_KINDS) as TagKind | undefined),
  },
  {
    name: "create_tag",
    title: "Create a tag",
    description:
      "Add a label of one kind. Usually unnecessary — writing a name that does not exist on an application, company or contact creates it — so reach for this when someone is setting up their vocabulary deliberately, or wants a specific colour. Colours are palette names, not hex: slate, blue, teal, green, amber, red, violet or pink. Refuses a name that already exists in that kind, case-insensitively, and says which one it clashed with.",
    inputSchema: object(
      {
        kind: { type: "string", enum: [...TAG_KINDS], description: "What this labels" },
        name: str("What it is called, e.g. 'Fintech', 'Referral', 'Remote'"),
        color: { type: "string", enum: [...TAG_COLORS], description: "Palette name. Default slate." },
      },
      ["kind", "name"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      tags.createTag(ctx.userId, {
        kind: required(args, "kind") as TagKind,
        name: required(args, "name"),
        ...defined({ color: s(args, "color") }),
      }),
  },
  {
    name: "update_tag",
    title: "Rename or recolour a tag",
    description:
      "Change a tag's name or colour in one place, and everything wearing it follows — which is the whole reason these are rows rather than strings. Renaming 'Fintech' to 'Financial services' updates every company at once. The kind cannot be changed: a location is not an industry, and moving one would silently reclassify everything wearing it.",
    inputSchema: object(
      {
        id: str("Tag id from list_tags"),
        name: str("New name"),
        color: { type: "string", enum: [...TAG_COLORS], description: "New palette colour" },
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      tags.updateTag(ctx.userId, required(args, "id"), {
        ...defined({ name: s(args, "name"), color: s(args, "color") }),
      }),
  },
  {
    name: "delete_tag",
    title: "Delete a tag",
    description:
      "Remove a label for good. It comes off everything that wore it and nothing else changes — no application, company or contact is deleted, they simply stop carrying that label. Returns how many things it was taken off, which is worth reporting back before someone assumes it was unused. This is the tool for tidying up a list that has filled with near-duplicates.",
    inputSchema: object({ id: str("Tag id from list_tags") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => tags.deleteTag(ctx.userId, required(args, "id")),
  },
  {
    name: "seed_tags",
    title: "Offer the starter tags for a kind",
    description:
      "Create the handful of obvious labels for one kind, skipping any the person already has: the usual channels for APPLICATION, the usual relationships for CONTACT, and a set of headcount bands for SIZE. Nothing is imposed — these become ordinary rows they can rename, recolour or delete. Returns the whole list for that kind afterwards. There is nothing sensible to seed for COMPANY, INDUSTRY or LOCATION, and asking for those returns what is already there.",
    inputSchema: object(
      { kind: { type: "string", enum: [...TAG_KINDS], description: "Which list to seed" } },
      ["kind"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => tags.seedTags(ctx.userId, required(args, "kind") as TagKind),
  },
  {
    name: "create_application",
    title: "Create an application",
    description:
      "Track a new job. Paste the full posting into jobDescription — it is what you will tailor the resume against later. The company is created automatically if it does not exist. Pass companyWebsite when you know it — it is what makes the company's logo appear in the pipeline, and it costs nothing to include. A job link and description are OPTIONAL: an application that started as a LinkedIn message with no listing is still an application — track it with just company and roleTitle, put 'Cold outreach' in sources, and attach the person messaged with create_contact.",
    inputSchema: object(
      {
        company: str("Company name"),
        companyWebsite: str("The company's own site, e.g. stripe.com. Shows their logo in the pipeline."),
        roleTitle: str("Job title"),
        stage: { type: "string", enum: STAGE_VALUES, description: "Starting stage. Default WISHLIST." },
        interviewRound: num(
          "Which round of interviews it is on, counting from 1. Only meaningful while INTERVIEWING; 0 means nobody has said, which is fine. It is never cleared when an application ends — a rejection after four rounds is a fact about how far it got, and the funnel is built out of exactly this.",
        ),
        roundLabel: str("What that round is called — 'Phone screen', 'Take-home', 'Onsite'. Optional."),
        lossReasons: strArray(
          "Why it ended, by name — 'Rejected', 'Ghosted', 'Withdrew', 'Declined their offer', 'Role closed', or their own words. Only read when the stage is LOST. Matched against the reasons they already use and created when nothing matches.",
        ),
        jobUrl: str("Link to the posting"),
        jobDescription: str("The full job posting text"),
        location: str("Job location. Free text — call list_field_values first and reuse a spelling already in use."),
        workMode: str("Remote, Hybrid, On-site, or however they say it. Free text: list_field_values has the ones already in use."),
        salaryRange: str("Advertised or expected compensation"),
        tagIds: strArray("Tag ids from list_tags, kind APPLICATION. Exact; wins over tags."),
        tags: strArray(
          "How to file it, by NAME, and several at once is normal: ['LinkedIn', 'Referral'] for a posting a friend also flagged. Matched case-insensitively against the tags that exist and created only when nothing matches, so call list_tags first.",
        ),
        sources: strArray("What tags used to be called. Still works; tags wins."),
        source: str("The old single-value spelling. Ignored when tags or sources is passed."),
        notes: str("Any notes"),
        appliedAt: str("ISO date they applied"),
        nextFollowUpAt: str("ISO date to follow up. Auto-set from the stage if omitted."),
        resumeId: str("Id of the resume used"),
      },
      ["company", "roleTitle"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.createApplication(ctx.userId, {
        company: required(args, "company"),
        roleTitle: required(args, "roleTitle"),
        ...defined({
          companyWebsite: s(args, "companyWebsite"),
          stage: s(args, "stage") as Stage | undefined,
          interviewRound: n(args, "interviewRound"),
          roundLabel: s(args, "roundLabel"),
          lossReasons: a(args, "lossReasons"),
          jobUrl: s(args, "jobUrl"),
          jobDescription: s(args, "jobDescription"),
          location: s(args, "location"),
          workMode: s(args, "workMode"),
          salaryRange: s(args, "salaryRange"),
          tagIds: a(args, "tagIds"),
          tags: a(args, "tags"),
          sources: a(args, "sources"),
          source: s(args, "source"),
          notes: s(args, "notes"),
          appliedAt: s(args, "appliedAt"),
          nextFollowUpAt: s(args, "nextFollowUpAt"),
          resumeId: s(args, "resumeId"),
        }),
      }),
  },
  {
    name: "update_application",
    title: "Update an application",
    description:
      "Update fields on an application. Changing `stage` here also writes a timeline entry and resets the follow-up date. `sources` and `lossReasons` each REPLACE the whole list — read the current one from get_application, add or remove, and pass the full list back. The two are separate sets on the same application: writing one never disturbs the other.",
    inputSchema: object(
      {
        id: str("Application id"),
        company: str("Company name"),
        companyWebsite: str("The company's own site, e.g. stripe.com. Shows their logo in the pipeline."),
        roleTitle: str("Job title"),
        stage: { type: "string", enum: STAGE_VALUES, description: "New stage" },
        interviewRound: num(
          "Which round of interviews it is on, counting from 1. Only meaningful while INTERVIEWING; 0 means nobody has said, which is fine. It is never cleared when an application ends — a rejection after four rounds is a fact about how far it got, and the funnel is built out of exactly this.",
        ),
        roundLabel: str("What that round is called — 'Phone screen', 'Take-home', 'Onsite'. Optional."),
        lossReasons: strArray(
          "Why it ended, by name. REPLACES the whole set — read the current one from get_application first. Only read when the stage is LOST.",
        ),
        lossTagIds: strArray("The same by id, from list_tags kind LOSS. Exact; wins over lossReasons."),
        jobUrl: str("Posting link"),
        jobDescription: str("Job posting text"),
        location: str("Location. Free text — list_field_values first, and an empty string clears it."),
        workMode: str("Work mode. Free text — list_field_values first, and an empty string clears it."),
        salaryRange: str("Compensation"),
        tagIds: strArray("Tag ids. Exact; wins over tags. REPLACES the whole set."),
        tags: strArray("Tag names — REPLACES the whole set, matched or created as above"),
        sources: strArray("What tags used to be called. REPLACES the whole set; tags wins."),
        source: str(
          "The old single-value spelling. WARNING: this also REPLACES the entire set with just this one value — read the current list from get_application first, or use tags to write the full list. Ignored when tags or sources is passed.",
        ),
        notes: str("Notes"),
        appliedAt: str("ISO date applied"),
        nextFollowUpAt: str("ISO date of next follow-up, or empty string to clear"),
        resumeId: str("Attach this resume id, or empty string to detach"),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.updateApplication(ctx.userId, required(args, "id"), {
        ...defined({
          company: s(args, "company"),
          companyWebsite: s(args, "companyWebsite"),
          roleTitle: s(args, "roleTitle"),
          stage: s(args, "stage") as Stage | undefined,
          interviewRound: n(args, "interviewRound"),
          roundLabel: s(args, "roundLabel"),
          lossTagIds: a(args, "lossTagIds"),
          lossReasons: a(args, "lossReasons"),
          jobUrl: s(args, "jobUrl"),
          jobDescription: s(args, "jobDescription"),
          location: s(args, "location"),
          workMode: s(args, "workMode"),
          salaryRange: s(args, "salaryRange"),
          tagIds: a(args, "tagIds"),
          tags: a(args, "tags"),
          sources: a(args, "sources"),
          source: s(args, "source"),
          notes: s(args, "notes"),
          appliedAt: s(args, "appliedAt"),
          nextFollowUpAt: s(args, "nextFollowUpAt"),
          resumeId: s(args, "resumeId"),
        }),
      }),
  },
  {
    name: "move_applications_stage",
    title: "Move several applications to one stage",
    description:
      "Move a batch of applications to the same stage — the tool for 'close out everything I never heard back from' or 'mark these four as applied'. Each one gets its own timeline entry and follow-up date, exactly as if it had been moved on its own, so the funnel history stays intact. Ids that no longer exist are skipped rather than failing the batch; the result lists what moved and what was skipped. Read the ids from list_applications first, and when closing them out pass `lossReasons` saying why — 'Ghosted' for silence, 'Rejected' for a no. The stage is the same either way; the reason is what makes the funnel worth reading.",
    inputSchema: object(
      {
        ids: strArray("The application ids to move"),
        stage: { type: "string", enum: STAGE_VALUES, description: "The stage they all move to" },
      },
      ["ids", "stage"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const ids = a(args, "ids");
      if (!ids?.length) throw new Error("ids is required: pass at least one application id");
      return pipeline.moveApplicationsStage(ctx.userId, ids, required(args, "stage") as Stage);
    },
  },
  {
    name: "move_application_stage",
    title: "Move an application to a new stage",
    description:
      "Advance or close an application. Automatically logs the change to the timeline and schedules the next follow-up. Six stages: WISHLIST for something not applied to yet, APPLIED, INTERVIEWING for every conversation from a recruiter screen to a final round, OFFER, ACCEPTED for a signed offer, and LOST for every other ending. Moving to INTERVIEWING sets round 1 unless you pass a round — pass `interviewRound` when they say which one it is (\"second interview\" is 2), and `roundLabel` for what it was called. Moving to LOST, pass `lossReasons` with WHY: \"Rejected\" when they said no, \"Ghosted\" for the far more common ending where nobody ever replied, \"Withdrew\", \"Declined their offer\", \"Role closed\", or anything else that fits — names are matched against what they already use and created when nothing does. The reason is what the funnel reads to tell a decision against them apart from silence, and the advice that falls out of those is different, so it is worth asking rather than guessing.",
    inputSchema: object(
      {
        id: str("Application id"),
        stage: { type: "string", enum: STAGE_VALUES, description: "The new stage" },
        note: str("Optional note for the timeline entry"),
        interviewRound: num("Which round this puts it in, counting from 1. Only read when moving to INTERVIEWING."),
        roundLabel: str("What that round is called — 'Phone screen', 'Take-home', 'Onsite'. Optional."),
        lossReasons: {
          type: "array",
          items: { type: "string" },
          description:
            "Why it ended, by name. REPLACES any reasons already on it. Only read when moving to LOST.",
        },
      },
      ["id", "stage"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.moveApplicationStage(
        ctx.userId,
        required(args, "id"),
        required(args, "stage") as Stage,
        s(args, "note"),
        defined({
          interviewRound: n(args, "interviewRound"),
          roundLabel: s(args, "roundLabel"),
          lossReasons: a(args, "lossReasons"),
        }),
      ),
  },
  {
    name: "delete_application",
    title: "Archive an application",
    description:
      "Put an application in the archive. It leaves the board, the list, the calendar and the funnel, taking its timeline and its tasks with it, and restore_records brings the lot back for a set number of days — 30 by default — before it is deleted for good. Nothing is destroyed here. Still reach for move_application_stage with LOST, and a reason, whenever the thread actually ended: the funnel and diagnose_search are built from applications that ended, and archiving one takes it out of that record entirely. Archive is for something that should never have been tracked; a stage is for something that ended.",
    inputSchema: object({ id: str("Application id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.deleteApplication(ctx.userId, required(args, "id")),
  },
  {
    name: "log_activity",
    title: "Log activity on an application or a contact",
    description:
      "Append to a timeline. Pass applicationId for things that happened on an application — a recruiter call about the role, an interview, a note to self. Pass contactId for things that happened with a PERSON — a coffee, a call, a reply — and it becomes their history: the contact's page shows it and their 'last touched' date moves. Exactly one of the two, never both. When someone mentions talking to a person they know, this with contactId is how it gets remembered. Type OUTREACH is for messages the user sent first — a LinkedIn DM to a hiring manager, a cold email — which is how many applications actually start.",
    inputSchema: object(
      {
        applicationId: str("Application id — for events on an application"),
        contactId: str("Contact id — for events with a person"),
        type: { type: "string", enum: ACTIVITY_VALUES, description: "Kind of activity. Default NOTE." },
        body: str("What happened"),
        occurredAt: str("ISO datetime it happened. Defaults to now."),
      },
      ["body"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.addActivity(ctx.userId, {
        applicationId: s(args, "applicationId"),
        contactId: s(args, "contactId"),
        body: required(args, "body"),
        type: s(args, "type") as ActivityType | undefined,
        occurredAt: s(args, "occurredAt"),
      }),
  },
  {
    name: "list_activities",
    title: "List recent activity",
    description:
      "Recent timeline entries across the whole search, or for one application. Good for 'what happened this week'.",
    inputSchema: object({
      applicationId: str("Limit to one application"),
      limit: num("Max entries, default 40"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.listActivities(ctx.userId, s(args, "applicationId"), n(args, "limit") ?? 40),
  },
  {
    name: "list_follow_ups",
    title: "List follow-ups that are due",
    description:
      "The 'what has come round' tool, and the same thing the bell in the app counts. Returns three lists: applications whose follow-up date has arrived or passed, contacts whose ping date has — the people you meant to get back in touch with — and tasks that are due or already late. All three are debts with a date on them; plan a day from the set. Each task carries `overdue`, which separates late from due today. Reach for list_tasks when the date does not matter and list_schedule when the question is about a window of time rather than about what is owed now.",
    inputSchema: object({
      withinDays: num("Look ahead this many days. 0 = due now, 7 = due within a week."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const withinDays = n(args, "withinDays") ?? 0;
      // The rich rows for the two the caller usually acts on, and dueNow for
      // the tasks — which is the same function the bell counts from, so the
      // app and an assistant can never disagree about what is owed.
      const [applications, contacts, due] = await Promise.all([
        pipeline.followUpsDue(ctx.userId, withinDays),
        pipeline.contactFollowUpsDue(ctx.userId, withinDays),
        pipeline.dueNow(ctx.userId, withinDays),
      ]);
      return { applications, contacts, tasks: due.tasks, total: due.total };
    },
  },
  {
    name: "snooze_follow_up",
    title: "Push a follow-up out",
    description:
      "Move a follow-up date further out without recording anything — for a thread you have decided to leave alone a while longer. Pass an applicationId or a contactId, and days from today; the date lands at 9am so it reads as due the morning you meant to do it. This is deferral, not progress: nothing is logged and the stage does not move, so use log_follow_up instead when you actually chased it.",
    inputSchema: object({
      applicationId: str("The application whose follow-up moves"),
      contactId: str("Or the person whose ping moves"),
      days: num("How many days from today. 3 = the day after tomorrow but one."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const applicationId = s(args, "applicationId");
      const contactId = s(args, "contactId");
      if (Boolean(applicationId) === Boolean(contactId)) {
        throw new Error("Snooze exactly one thing: an application or a contact.");
      }
      const days = n(args, "days") ?? 3;
      return applicationId
        ? pipeline.snoozeFollowUp(ctx.userId, applicationId, days)
        : pipeline.snoozeContactFollowUp(ctx.userId, contactId as string, days);
    },
  },
  {
    name: "log_follow_up",
    title: "Record that you chased it",
    description:
      "You actually followed up: writes the touch on the timeline and moves the follow-up date out in one call. Use this rather than snooze_follow_up whenever something was said — a chase list emptied by snoozing looks exactly like one that was worked, and the timeline that answers 'when did I last talk to them' stays empty. Pass an applicationId or a contactId, what you said in body, and days for when to come back (a week if you leave it). Logging resets the quiet clock that list_applications reports as quietDays; it deliberately does NOT move the stage, because following up is not progress — use move_application_stage when something actually changed.",
    inputSchema: object({
      applicationId: str("The application you chased"),
      contactId: str("Or the person you pinged"),
      body: str("What you said or heard. Defaults to a plain 'Followed up.'"),
      type: { type: "string", enum: ACTIVITY_VALUES, description: "Kind of touch. Defaults to FOLLOW_UP." },
      days: num("When to come back to it, in days from today. Default 7."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.logFollowUp(ctx.userId, {
        ...defined({
          applicationId: s(args, "applicationId"),
          contactId: s(args, "contactId"),
          body: s(args, "body"),
          type: s(args, "type") as ActivityType | undefined,
          days: n(args, "days"),
        }),
      }),
  },
  {
    name: "diagnose_search",
    title: "Diagnose the job search",
    description:
      "Works out what is actually going wrong with the search, rather than reporting counts. Returns a one-sentence verdict naming which step of the funnel is losing people — no responses at all is a resume or targeting problem, interviews that do not convert is something else again — plus per-step conversion, median days spent in each stage, weekly volume for the last six weeks, applications that have gone quiet, and the response rate of each resume so you can see which one is working. Progress is measured by the furthest an application ever got — its `interviewRound` where it has one — so a rejection after a fourth round counts as having got that far. Reach for this before giving advice about a search: it is the difference between 'send more applications' and 'stop sending, the resume is the problem'. Says so plainly when there is not enough data yet. Read-only.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.diagnoseSearch(ctx.userId),
  },
  {
    name: "get_funnel",
    title: "Get the funnel, rung by rung",
    description:
      "The numbers behind the flow chart on the analytics page. The ladder is built from the rounds this person actually records: with none it is applied → interviewing → offer, and with rounds logged it is applied → round 1 → round 2 → … → offer, which is the whole reason to number them. For each rung: how many ever got that far, how many went on, how many are still sitting there, and how many left at that exact point and why — `ended` carries their own LOSS tag names, plus 'Offer accepted' for a signed one and 'Lost' for an ending nobody gave a reason for. Progress is measured by the furthest an application actually got, so a rejection after two rounds leaks out of round two rather than out of applied. Each rung carries its own `label` and a `tone` token, so do not translate the keys yourself. Wishlist rows are counted separately and are not in the funnel at all, because nothing was ever sent. Archived applications are excluded. Use export_funnel_image for the picture. Read-only. Says nothing is there yet rather than dividing by zero.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => pipeline.funnelFlows(ctx.userId),
  },
  {
    name: "export_funnel_image",
    title: "Export the funnel as an image",
    description:
      "Render the funnel — the Sankey flow chart of where every application ended up — as an image file and return a download url. This is the thing people post: it shows the shape of a search without naming a single company, role or person, so it is safe to share in a way almost nothing else here is. Ask for png when it is going into a message, a slide or a post; svg when it wants to stay sharp at any size, or when this instance has no headless browser to make a png with — the tool says which formats it can actually produce and picks svg when png is not on offer. The url opens in the browser they are already signed in to; it is not a public link and nobody else can fetch it. Nothing is saved: the image is drawn fresh from the pipeline each time it is fetched. Refuses when nothing has been applied to yet.",
    inputSchema: object({
      format: str("png or svg. Defaults to png where the host can render one, svg otherwise."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const png = pdfRenderingAvailable();
      const asked = (s(args, "format") ?? "").toLowerCase();
      if (asked && asked !== "png" && asked !== "svg") {
        throw new Error(`Cannot render "${asked}". Ask for png or svg.`);
      }
      if (asked === "png" && !png) {
        throw new Error(
          "This instance has no headless browser, so it cannot render a PNG. Ask for svg — it opens anywhere an image does.",
        );
      }

      const { applied, rungs, wishlist } = await pipeline.funnelFlows(ctx.userId);
      if (applied === 0) {
        throw new Error(
          "Nothing to chart yet — no applications have been sent, so the funnel is empty.",
        );
      }

      const format = asked || (png ? "png" : "svg");
      const url = `${ctx.baseUrl}/api/funnel/${format}`;
      const stages = rungs.filter((rung) => rung.visited > 0).length;
      return withLinks(
        {
          url,
          format,
          applied,
          wishlist,
          stages,
          pngAvailable: png,
          formats: png ? ["png", "svg"] : ["svg"],
        },
        [
          {
            type: "resource_link",
            uri: url,
            name: `Job search funnel (${format.toUpperCase()})`,
            description: `${applied} application${applied === 1 ? "" : "s"} across ${stages} stage${stages === 1 ? "" : "s"}. No company or role names on it.`,
            mimeType: format === "png" ? "image/png" : "image/svg+xml",
          },
        ],
      );
    },
  },
  {
    name: "share_pipeline",
    title: "Get a read-only link to the pipeline",
    description:
      "Mint a link that shows this person's pipeline to anyone holding it, without a login — for a friend, a coach or a former manager who is helping review the search. Returns publicUrl, which is the whole point: hand it straight to the user. Calling it twice returns the same link rather than a second one. What a viewer sees is deliberately narrow: company, role, stage, location, how long each has been sitting and when a follow-up is due. They do NOT see notes, job descriptions, salary, contacts or the activity timeline — say so if someone asks what will be visible, because a share link is consent to show a search, not to publish the people in it. Set include_closed to show finished applications too.",
    inputSchema: object({
      include_closed: bool("Show accepted / rejected / withdrawn / ghosted applications too. Default false."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const share = await pipelineShare.sharePipeline(ctx.userId, {
        includeClosed: b(args, "include_closed"),
      });
      const publicUrl = publicPipelineUrl(ctx.baseUrl, share.slug);
      return withLinks({ ...share, publicUrl }, [
        {
          type: "resource_link",
          uri: publicUrl,
          name: "Shared pipeline",
          description:
            "Read-only pipeline. Shows company, role, stage and follow-up dates — never notes, salary or contacts.",
          mimeType: "text/html",
        },
      ]);
    },
  },
  {
    name: "unshare_pipeline",
    title: "Revoke the pipeline link",
    description:
      "Stop sharing the pipeline. This DESTROYS the address rather than pausing it — anyone holding the old link gets nothing, and sharing again later mints a completely different URL. That is deliberate: the reason to revoke is usually that a link reached someone it should not have, and a pause that can be undone does not fix that.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => pipelineShare.unsharePipeline(ctx.userId),
  },
  {
    name: "get_pipeline_share",
    title: "Check whether the pipeline is shared",
    description:
      "Whether a read-only pipeline link currently exists, what it shows, and when it was last opened. Returns null when nothing is shared, and publicUrl when something is. Use it before minting a link so you can tell someone they already have one, and to answer 'has anyone actually looked at it'.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => {
      const share = await pipelineShare.getPipelineShare(ctx.userId);
      if (!share) return null;
      const publicUrl = publicPipelineUrl(ctx.baseUrl, share.slug);
      return withLinks({ ...share, publicUrl }, [
        {
          type: "resource_link",
          uri: publicUrl,
          name: "Shared pipeline",
          mimeType: "text/html",
        },
      ]);
    },
  },
  {
    name: "list_saved_views",
    title: "List saved pipeline views",
    description:
      "The cuts of the pipeline this person has named and kept — 'Chasing', 'Dream jobs', 'Gone quiet'. Each one returns a name and a query string like \"view=list&f=INTERVIEWING&sort=waiting\". Call this when someone refers to a view by name, then read the query to work out what they mean — save_view documents every parameter it can hold. Reading a view tells you what they consider one job; it is a good place to look before asking what they want reviewed.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => views.listSavedViews(ctx.userId),
  },
  {
    name: "save_view",
    title: "Save a pipeline view under a name",
    description:
      "Name a cut of the pipeline so it can be reopened in one click. The query is the pipeline URL's own parameters without the leading '?', and every filter combines with every other: view (board | list | calendar); f (comma-separated stages, plus 'overdue' as a flag that ANDs rather than replacing the stages, and 'closed' which expands to both endings; the six retired stage names — SCREEN, INTERVIEW, FINAL, REJECTED, WITHDRAWN, GHOSTED — are still understood and map to the stages that replaced them, so views saved before the change keep working); src (comma-separated tag ids from list_tags); co (company ids); cv (resume ids, or 'none' for applications with no resume attached); w (minimum days sitting in the current stage); qd (minimum days since anything at all was logged — the chasing question, which is not the same as w); sort (followUp | company | stage | updated | salary | waiting | quiet) and dir; q (search across company, role, notes, location, work mode, the posting text and tag names); month (YYYY-MM, calendar only). Example: name 'Referrals gone quiet', query 'view=list&f=APPLIED,INTERVIEWING&qd=14&sort=quiet&dir=desc'. Saving under a name that already exists REPLACES that view rather than creating a second one, which is how you edit one. Anything outside those parameters is dropped. co and cv hold ids, so a view naming a company later folded away by merge_companies simply stops matching it.",
    inputSchema: object(
      {
        name: str("What to call it, e.g. 'Chasing'"),
        query: str("The pipeline query string, without the leading '?'"),
      },
      ["name", "query"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      views.saveView(ctx.userId, required(args, "name"), s(args, "query") ?? ""),
  },
  {
    name: "delete_saved_view",
    title: "Delete a saved view",
    description:
      "Remove a saved pipeline view. Only the view goes — nothing about the applications it was showing is touched. Get the id from list_saved_views.",
    inputSchema: object({ id: str("Saved view id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => views.deleteSavedView(ctx.userId, required(args, "id")),
  },
  {
    name: "list_schedule",
    title: "List everything dated in a window",
    description:
      "Everything with a date attached between two dates, merged into one list sorted earliest first: follow-ups that come due, tasks with a due date, activity already logged (calls, interviews, emails, stage changes) and — when Google Calendar is connected — meetings on the person's own calendar that involve someone on the pipeline, matched by attendee. This is the tool for 'what does my week look like', 'what happened last month' or 'what is coming up' — anything where the question is about a period of time rather than about one application. Each entry says its kind (FOLLOW_UP, TASK, ACTIVITY or MEETING), the date, a title, the company and the applicationId, so you can call get_application for the full picture; a MEETING also carries its `url` in Google Calendar. Reach for list_follow_ups instead when you only want what is already overdue, and list_tasks when the date does not matter. Read-only; it saves nothing.",
    inputSchema: object(
      {
        from: str("Start of the window, ISO date (YYYY-MM-DD). Inclusive."),
        to: str("End of the window, ISO date (YYYY-MM-DD). Inclusive."),
      },
      ["from", "to"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      // Both edges go through as written: listSchedule owns what a bare date
      // means, so the tool and the calendar screen cannot disagree about it.
      schedule.listSchedule(ctx.userId, required(args, "from"), required(args, "to")),
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description:
      "To-dos, each with a due date and — at most — one thing it is about: an application, a company, a person, a resume, a role in Me, or a note, whichever is set. Open ones first, soonest due first. This is what someone means by 'what do I need to do' — pair it with list_follow_ups, which covers the chasing this list deliberately does not: an application's follow-up date and a person's ping are not tasks and never appear here.",
    inputSchema: object({
      done: bool("Filter by completion state. Omit for all."),
      limit: num("How many at most. Default 100."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.listTasks(ctx.userId, { done: b(args, "done"), limit: n(args, "limit") }),
  },
  {
    name: "create_task",
    title: "Create a task",
    description:
      "Add a to-do, with a due date and — at most — one thing it is about. A task can hang off an application, a company, a person, a resume, a role in Me, or a note; pass the id of whichever ONE it concerns, and none of them for a task that is about nothing in particular. Passing two is refused rather than guessed at. Attaching it matters: the task shows on that record's own screen, and it goes with it if the record is ever deleted. `detail` is the room for what the task actually involves, which the title should not have to carry. Ids that are not this person's, or are in the archive, are refused.",
    inputSchema: object(
      {
        title: str("What needs doing"),
        detail: str("The longer version — what it involves, who said it, what to reference"),
        dueAt: str("ISO date it is due"),
        applicationId: str("Attach to this application"),
        companyId: str("Or to a company"),
        contactId: str("Or to a person"),
        resumeId: str("Or to a resume"),
        roleId: str("Or to a role in Me"),
        noteId: str("Or to a note"),
      },
      ["title"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.createTask(ctx.userId, {
        title: required(args, "title"),
        ...defined({
          detail: s(args, "detail"),
          dueAt: s(args, "dueAt"),
          applicationId: s(args, "applicationId"),
          companyId: s(args, "companyId"),
          contactId: s(args, "contactId"),
          resumeId: s(args, "resumeId"),
          roleId: s(args, "roleId"),
          noteId: s(args, "noteId"),
        }),
      }),
  },
  {
    name: "complete_task",
    title: "Complete or reopen a task",
    description: "Mark a task done, or reopen it with done: false.",
    inputSchema: object({ id: str("Task id"), done: bool("Default true") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.setTaskDone(ctx.userId, required(args, "id"), b(args, "done") ?? true),
  },
  {
    name: "update_task",
    title: "Update a task",
    description:
      "Reword a task, move its due date, or hook it to something different. Only the fields you pass change; each REPLACES what was there. Pass an empty string for dueAt to clear the date, or for any of the subject ids to unhook it. Setting one subject CLEARS the others, because a task is about at most one thing — so moving a task from an application to a person is one call with contactId, not two. Use complete_task to tick it off; done is not settable here.",
    inputSchema: object(
      {
        id: str("Task id"),
        title: str("What needs doing"),
        detail: str("The longer version — replaces what is there"),
        dueAt: str("ISO date it is due, or empty string to clear it"),
        applicationId: str("Attach to this application, or empty string to unhook"),
        companyId: str("Or to a company"),
        contactId: str("Or to a person"),
        resumeId: str("Or to a resume"),
        roleId: str("Or to a role in Me"),
        noteId: str("Or to a note"),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.updateTask(
        ctx.userId,
        required(args, "id"),
        defined({
          title: s(args, "title"),
          detail: s(args, "detail"),
          dueAt: s(args, "dueAt"),
          applicationId: s(args, "applicationId"),
          companyId: s(args, "companyId"),
          contactId: s(args, "contactId"),
          resumeId: s(args, "resumeId"),
          roleId: s(args, "roleId"),
          noteId: s(args, "noteId"),
        }),
      ),
  },
  {
    name: "delete_task",
    title: "Delete a task",
    description:
      "Remove a task outright. Use complete_task instead when it actually got done — a finished task is worth keeping, and this is not undoable.",
    inputSchema: object({ id: str("Task id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.deleteTask(ctx.userId, required(args, "id")),
  },
  {
    name: "export_csv",
    title: "Export a list as CSV",
    description:
      "One of the three lists as a spreadsheet file, returned as CSV text you can hand straight to somebody. 'companies' and 'contacts' take the same cuts list_companies and list_contacts take, so 'export every fintech company I have never applied to' is one call: narrow it with list_companies first, then pass the same arguments here. 'applications' takes the pipeline's own filters through `query`, the same string the app puts in its URL. Every export ALWAYS includes closed applications — somebody exporting before a clear-out wants the rejections, and a file that quietly dropped them would look complete and be wrong at the only moment it mattered. `ids` narrows to particular rows, so you can export exactly what you just listed — it INTERSECTS with the other arguments rather than replacing them, so send it on its own unless you mean 'these rows, and only the ones that also match'. Archived records are never included; use list_archive for those. Read-only: it writes nothing and changes nothing.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: [...EXPORT_KINDS],
          description: "companies | contacts | applications",
        },
        ids: strArray("Only these rows, by id. Narrows whatever the other arguments left, so on its own it is exactly this set."),
        search: str("For companies and contacts: the same search the list tools take"),
        filter: str("For companies and contacts: the same one-word cut the list tools take"),
        tagIds: strArray("For companies and contacts: tag ids, as list_companies takes them"),
        industryIds: strArray("For companies: tag ids of kind INDUSTRY"),
        sizeIds: strArray("For companies: tag ids of kind SIZE"),
        locationIds: strArray("For companies: tag ids of kind LOCATION"),
        companyIds: strArray("For contacts: only people linked to these companies"),
        quietDays: num("For contacts: nothing logged for at least this many days"),
        missing: strArray("The same blank-field cuts the list tools take. These AND."),
        sort: str("The same sort key the matching list tool takes"),
        dir: { type: "string", enum: [...SORT_DIRECTIONS], description: "asc | desc" },
        query: str(
          "For applications: a pipeline query string, e.g. \"f=INTERVIEWING&src=<tagId>\" — the same one the app puts in its URL",
        ),
      },
      ["kind"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const kind = enumArg(args, "kind", EXPORT_KINDS) ?? "companies";
      const ids = a(args, "ids");
      const dir = enumArg(args, "dir", SORT_DIRECTIONS);
      if (kind === "companies") {
        return {
          filename: exportFilename("companies", await me.timeZoneOf(ctx.userId)),
          csv: await exportCompaniesCsv(
            ctx.userId,
            defined({
              search: s(args, "search"),
              filter: enumArg(args, "filter", COMPANY_FILTERS),
              tagIds: a(args, "tagIds"),
              industryIds: a(args, "industryIds"),
              sizeIds: a(args, "sizeIds"),
              locationIds: a(args, "locationIds"),
              missing: enumArrayArg(args, "missing", COMPANY_MISSING),
              sort: enumArg(args, "sort", COMPANY_SORTS),
              dir,
              ids,
            }),
          ),
        };
      }
      if (kind === "contacts") {
        return {
          filename: exportFilename("contacts", await me.timeZoneOf(ctx.userId)),
          csv: await exportContactsCsv(
            ctx.userId,
            defined({
              search: s(args, "search"),
              filter: enumArg(args, "filter", CONTACT_FILTERS),
              tagIds: a(args, "tagIds"),
              companyIds: a(args, "companyIds"),
              quietDays: n(args, "quietDays"),
              missing: enumArrayArg(args, "missing", CONTACT_MISSING),
              sort: enumArg(args, "sort", CONTACT_SORTS),
              dir,
              ids,
            }),
          ),
        };
      }
      const query = s(args, "query");
      return {
        filename: exportFilename("applications", await me.timeZoneOf(ctx.userId)),
        csv: await exportApplicationsCsv(
          ctx.userId,
          defined({
            filters: query
              ? parsePipelineFilters(
                  (key) => new URLSearchParams(query).get(key) ?? undefined,
                  pipeline.STAGES,
                )
              : undefined,
            ids,
          }),
        ),
      };
    },
  },
  {
    name: "get_pipeline_fields",
    title: "What each pipeline view shows",
    description:
      "Which optional fields the board, the table and the calendar draw before you open anything, and everything each one COULD draw. Reach for it when somebody asks what their board shows, says it is too busy or too bare, or wants to know why a field is not on a card. Returns one entry per view: the catalogue of fields with a label each, and which are on. On the board and the table, three things are never in a catalogue and are always drawn — the company, the role title and the stage — because a card without them is not shorter, it is unreadable, and on the table the stage cell is the editor the table exists for. The calendar is the exception and only for stage: a chip is one line of its own title, so stage is genuinely extra there and is off by default. A view whose list comes back empty is on its defaults, which is not the same as showing nothing. Read-only.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => {
      const profile = await me.getProfile(ctx.userId);
      const stored = {
        board: profile.boardFields,
        list: profile.listFields,
        calendar: profile.calendarFields,
      };
      return PIPELINE_VIEWS.map((view) => ({
        view,
        showing: [...visibleFields(view, stored[view])],
        onDefaults: stored[view].length === 0,
        available: FIELDS[view].map((field) => ({
          key: field.key,
          label: field.label,
          inDefaults: field.standard,
        })),
      }));
    },
  },
  {
    name: "set_pipeline_fields",
    title: "Choose what a pipeline view shows",
    description:
      "Set which optional fields one pipeline view draws. REPLACES that view's whole list, so call get_pipeline_fields first, decide the full set, and send it — sending one key turns off everything else on that view. One view per call: the board, the table and the calendar have different catalogues and there is no field they all share. Pass an empty list to put that view back on its defaults, which also means it picks up any field added to the catalogue later; pass ['none'] to mean genuinely nothing, which is a different thing and is why the empty list cannot mean it. A key that is not in that view's catalogue is refused rather than ignored. This is a display preference and changes no data — nothing here archives, deletes or edits an application.",
    inputSchema: object(
      {
        view: {
          type: "string",
          enum: [...PIPELINE_VIEW_VALUES],
          description: "board | list | calendar",
        },
        fields: strArray(
          "The whole set for that view, from get_pipeline_fields. Empty for the defaults, ['none'] for nothing.",
        ),
      },
      ["view", "fields"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      // enumArg, not a computed key: a mistyped view would otherwise be dropped
      // by `pick` and reported back as a success over a board that never moved.
      const view = enumArg(args, "view", PIPELINE_VIEW_VALUES);
      if (!view) throw new Error('Missing required string argument "view"');
      const fields = requiredArrayAllowingEmpty(args, "fields");
      const known = new Set(FIELDS[view].map((field) => field.key));
      for (const key of fields) {
        if (key !== NO_FIELDS && !known.has(key)) {
          throw new Error(
            `"${key}" is not a field the ${view} draws. Use one of: ${[...known].join(", ")}, or "none".`,
          );
        }
      }
      const stored = await me.setPipelineFields(ctx.userId, view, fields);
      return {
        view,
        showing: [...visibleFields(view, fields)],
        onDefaults: fields.length === 0,
        stored,
      };
    },
  },
  {
    name: "list_field_values",
    title: "Locations and work modes already in use",
    description:
      "Every location and every work mode already on one of this person's live applications, most-used first with a count each. Call it BEFORE writing either field on create_application or update_application: both are free text and always will be — 'Remote (US, PST overlap)' is a real answer no list survives — but writing 'remote' next to an existing 'Remote' leaves two values that never group together, and this is the cheap way not to. Match case-insensitively against what comes back and reuse that spelling; a genuinely new value is still just a string, so send it. Archived applications do not contribute. Read-only.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => pipeline.applicationFieldValues(ctx.userId),
  },
  {
    name: "get_column_widths",
    title: "How wide each list's columns are",
    description:
      "The column widths on the three tables you can resize — the pipeline's table view, the companies list and the contacts list — with each column's default, its minimum and its maximum beside the width it is actually drawing at. Reach for it when somebody says a column is too narrow to read, wants their layout described, or before set_column_widths, which needs the keys. Each list also has a name column that flexes to fill whatever the others leave; it is not in the catalogue and has no width, because widening a fixed column is what makes the name narrower. `onDefaults` is true for a list nothing has been stored for. Read-only.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => {
      const profile = await me.getProfile(ctx.userId);
      const stored = parseWidths(profile.columnWidths);
      return COLUMN_LISTS.map((list) => ({
        list,
        label: LIST_LABEL[list],
        onDefaults: stored[list] === undefined,
        columns: COLUMNS[list].map((column) => ({
          key: column.key,
          label: column.label,
          width: widthsFor(list, stored)[column.key],
          default: column.width,
          min: column.min,
          max: column.max,
        })),
      }));
    },
  },
  {
    name: "set_column_widths",
    title: "Resize a list's columns",
    description:
      "Set how wide one or more columns are on one list, in pixels. MERGES rather than replaces: a column you leave out keeps the width it had, which is the opposite of set_pipeline_fields and is deliberate — 'make Salary wider' should not reset every other column on the way past. Pass reset: true with no widths to put the whole list back on its defaults, which also means it picks up the catalogue's width for any column added later. A width outside a column's min and max is clamped to the nearest end rather than refused, because the useful reading of 'make it as wide as it goes' is the maximum, not an error; a key that is not a column on that list IS refused, because that one is a typo. Call get_column_widths first for the keys and the limits. This is a display preference and changes no data.",
    inputSchema: object(
      {
        list: {
          type: "string",
          enum: [...COLUMN_LIST_VALUES],
          description: "pipeline | companies | contacts",
        },
        widths: {
          type: "object",
          description:
            "Column key to width in pixels, e.g. { \"salary\": 180 }. Omit with reset: true.",
          additionalProperties: { type: "number" },
        },
        reset: bool("Put the whole list back on its default widths"),
      },
      ["list"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const list = enumArg(args, "list", COLUMN_LIST_VALUES);
      if (!list) throw new Error('Missing required string argument "list"');
      const reset = b(args, "reset") ?? false;
      const raw = args.widths;
      const widths: Record<string, number> = {};
      if (raw !== undefined) {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          throw new Error('"widths" must be an object of column key to pixel width.');
        }
        const known = new Set(columnKeys(list));
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          // A typo is refused; an out-of-range number is clamped downstream.
          // Those are different mistakes and deserve different answers.
          if (!known.has(key)) {
            throw new Error(
              `"${key}" is not a column on the ${list} list. Use one of: ${columnKeys(list).join(", ")}.`,
            );
          }
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`Width for "${key}" must be a number of pixels.`);
          }
          widths[key] = value;
        }
      }
      if (!reset && Object.keys(widths).length === 0) {
        throw new Error("Pass widths to set, or reset: true to go back to the defaults.");
      }
      const stored = await me.setColumnWidths(ctx.userId, list, widths, { reset });
      const drawn = widthsFor(list, stored);
      return {
        list,
        onDefaults: stored[list] === undefined,
        // What it actually drew at, not what was asked for: the difference is
        // the clamp, and reporting the request back would hide it.
        columns: COLUMNS[list].map((column) => ({ key: column.key, width: drawn[column.key] })),
      };
    },
  },
  // --- CRM: companies and the people at them -------------------------------
  {
    name: "list_companies",
    title: "List companies",
    description:
      "Every company on file, with how many applications and contacts each one has, plus lastAppliedAt (when you last applied there) and openApplications (how many are still live). Reach for this to answer 'who have I applied to', to find a companyId before get_company, or to cut the list down to something specific before working through it. Every row carries its tags: industry, size, location and free tags, all as labels rather than the single strings they used to be. Everything below ANDs, so one call asks for 'fintech, remote, never applied'. search matches the name, the website, your notes and any tag name. filter is one cut and only one. industryIds, sizeIds and locationIds each take tag ids of that kind from list_tags and match a company wearing ANY id in the group — so a group ORs inside itself and ANDs with the others. tagIds is the loose one: it matches a tag of any kind, which is what to use when you have an id and do not care which list it came from. missing finds the gaps worth fixing in one sitting, and those AND with each other. sort is name, applied, apps or people; every sort but name defaults to most-first, and companies you have never applied to sort last whichever way 'applied' points, because that is a question about the others. Ids only — call list_tags first to turn 'fintech' into an id; a name here would narrow nothing and hand you every company as if that were the answer. Archived companies are never returned; list_archive is where those are. Read-only: it saves nothing and creates no tags.",
    inputSchema: object({
      search: str("Match name, website, notes or any tag — industry and location included"),
      tagIds: strArray("Only companies wearing one of these tags, of any kind. Ids from list_tags."),
      industryIds: strArray("Tag ids of kind INDUSTRY. Matches a company wearing any of them."),
      sizeIds: strArray("Tag ids of kind SIZE."),
      locationIds: strArray("Tag ids of kind LOCATION."),
      missing: {
        type: "array",
        items: { type: "string", enum: [...COMPANY_MISSING] },
        description: "Fields that are blank: website | industry | location. These AND with each other.",
      },
      filter: {
        type: "string",
        enum: [...COMPANY_FILTERS],
        description: "Cut the list: active | applied | never-applied | with-contacts",
      },
      sort: {
        type: "string",
        enum: [...COMPANY_SORTS],
        description: "name | applied | apps | people. Default name.",
      },
      dir: { type: "string", enum: [...SORT_DIRECTIONS], description: "asc | desc" },
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.listCompanies(
        ctx.userId,
        defined({
          search: s(args, "search"),
          tagIds: a(args, "tagIds"),
          industryIds: a(args, "industryIds"),
          sizeIds: a(args, "sizeIds"),
          locationIds: a(args, "locationIds"),
          missing: enumArrayArg(args, "missing", COMPANY_MISSING),
          filter: enumArg(args, "filter", COMPANY_FILTERS),
          sort: enumArg(args, "sort", COMPANY_SORTS),
          dir: enumArg(args, "dir", SORT_DIRECTIONS),
        }),
      ),
  },
  {
    name: "get_company",
    title: "Get a company",
    description:
      "Everything on file for one company: website, industry, size, location, your research notes, every application you have with them, and every person on file who represents it — someone can represent more than one company, so a name here is not necessarily their day job. This is the tool to call before writing anything about a company, so you add to what is known rather than replacing it.",
    inputSchema: object({ id: str("Company id") }, ["id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      // Every other get_* raises here rather than returning null, and it has to:
      // a null serialises as {"ok": true}, which reads like a hit.
      const company = await pipeline.getCompany(ctx.userId, required(args, "id"));
      if (!company) throw new Error(`No company with id ${required(args, "id")}`);
      return company;
    },
  },
  {
    name: "create_company",
    title: "Create a company",
    description:
      "Add a company before you have applied to them — somewhere to keep research while you decide. Applications create their company automatically, so reach for this only when there is no application yet. Names are unique per person; creating one that already exists is an error rather than a silent merge.",
    inputSchema: object(
      {
        name: str("Company name"),
        website: str("Their own site, e.g. stripe.com. This is what the logo comes from."),
        industry: strArray("What they do, one or more: 'Fintech', 'Developer tools'. Tags — REPLACES the set."),
        industryIds: strArray("Industry tag ids from list_tags. Exact; wins over industry."),
        size: strArray("Headcount or stage: '200-500', 'Series B'. Tags — REPLACES the set."),
        sizeIds: strArray("Size tag ids. Exact; wins over size."),
        location: strArray("Where they are, one or more. Tags — REPLACES the set."),
        locationIds: strArray("Location tag ids. Exact; wins over location."),
        tags: strArray("Anything else worth filing them under. REPLACES the set."),
        tagIds: strArray("Company tag ids. Exact; wins over tags."),
        notes: str("Anything you have learned about them"),
      },
      ["name"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.createCompany(ctx.userId, {
        name: required(args, "name"),
        ...defined({
          website: s(args, "website"),
          industry: a(args, "industry"),
          industryIds: a(args, "industryIds"),
          size: a(args, "size"),
          sizeIds: a(args, "sizeIds"),
          location: a(args, "location"),
          locationIds: a(args, "locationIds"),
          tags: a(args, "tags"),
          tagIds: a(args, "tagIds"),
          notes: s(args, "notes"),
        }),
      }),
  },
  {
    name: "update_company",
    title: "Update a company",
    description:
      "Change what you know about a company. Only the fields you pass are touched, but each one REPLACES what was there — notes especially, so call get_company first and write back the whole thing if you are adding to research rather than replacing it. Industry, size, location and tags are lists of labels now rather than single strings: a company can be fintech AND developer tools, and in three offices. Each list replaces its own set and leaves the other three alone. Setting website is the single thing that makes their logo show in the pipeline; a job board URL is not their website.",
    inputSchema: object(
      {
        id: str("Company id"),
        name: str("Company name"),
        website: str("Their own site, e.g. stripe.com"),
        industry: strArray("What they do, one or more. REPLACES the set; an empty list clears it."),
        industryIds: strArray("Industry tag ids from list_tags. Exact; wins over industry."),
        size: strArray("Headcount or stage. REPLACES the set."),
        sizeIds: strArray("Size tag ids. Exact; wins over size."),
        location: strArray("Where they are, one or more. REPLACES the set."),
        locationIds: strArray("Location tag ids. Exact; wins over location."),
        tags: strArray("Anything else worth filing them under. REPLACES the set."),
        tagIds: strArray("Company tag ids. Exact; wins over tags."),
        notes: str("Research notes — replaces what is there"),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.updateCompany(
        ctx.userId,
        required(args, "id"),
        defined({
          name: s(args, "name"),
          website: s(args, "website"),
          industry: a(args, "industry"),
          industryIds: a(args, "industryIds"),
          size: a(args, "size"),
          sizeIds: a(args, "sizeIds"),
          location: a(args, "location"),
          locationIds: a(args, "locationIds"),
          tags: a(args, "tags"),
          tagIds: a(args, "tagIds"),
          notes: s(args, "notes"),
        }),
      ),
  },
  {
    name: "delete_company",
    title: "Archive a company",
    description:
      "Put a company in the archive. It leaves the CRM, every picker, every filter and the pipeline, and restore_records brings it back for a set number of days — 30 by default — before it is deleted for good. Nothing is destroyed here. Every application still pointing at it goes into the archive with it and comes back with it; this used to refuse while those existed and no longer needs to. The people who represent it are NOT archived: somebody is a founder at one company and an advisor at another, so they keep every other company and simply lose this one. Returns how many applications went with it. To fold a duplicate employer into the one you are keeping without archiving anything, use merge_companies.",
    inputSchema: object({ id: str("Company id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.deleteCompany(ctx.userId, required(args, "id")),
  },
  {
    name: "preview_company_merge",
    title: "Preview merging two companies",
    description:
      "What merging one company into another WOULD do, without doing any of it. Call this first, every time — merge_companies is irreversible and takes an argument order that is easy to get backwards. Returns how many applications and contacts would move, which of them by role title, which blank fields on the survivor would be filled from the duplicate, and whether the duplicate's notes would be appended. Show that to the person before you merge. Read-only.",
    inputSchema: object(
      {
        keep_id: str("Company id that SURVIVES the merge, with its name"),
        merge_id: str("Company id that is folded in and then DELETED"),
      },
      ["keep_id", "merge_id"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.previewCompanyMerge(ctx.userId, required(args, "keep_id"), required(args, "merge_id")),
  },
  {
    name: "merge_companies",
    title: "Merge one company into another",
    description:
      "Fix the same employer being on file twice — 'Stripe', 'Stripe, Inc.' and 'stripe' each holding a slice of the pipeline. Every application and contact on merge_id moves to keep_id, blank fields on keep_id are filled from the duplicate, the duplicate's notes are APPENDED to the survivor's under a line saying where they came from, and then the duplicate row is deleted. DESTRUCTIVE and IRREVERSIBLE: the company at merge_id ceases to exist, its page stops resolving, and nothing records afterwards which applications came from which side. Call preview_company_merge first and let the person confirm. The direction matters and is not guessable — keep_id is the name that lives on. Nothing is de-duplicated: two identical role titles on the survivor is the correct result, not a bug. Note that a later create_application naming the old spelling will simply create it again as an empty company.",
    inputSchema: object(
      {
        keep_id: str("Company id that SURVIVES, keeping its name"),
        merge_id: str("Company id that is folded in and then DELETED"),
      },
      ["keep_id", "merge_id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.mergeCompanies(ctx.userId, required(args, "keep_id"), required(args, "merge_id")),
  },
  {
    name: "list_contacts",
    title: "List contacts",
    description:
      "Recruiters, hiring managers, referrals and the friend who might put in a word. Reach for this to find a contactId before get_contact or update_contact, to see who you already know somewhere before an interview, or to build the list you are about to work through. Returns each person with `companies` — a list, because someone can be a founder at one place and an advisor at another — their `tags`, their next ping date, the application they are attached to, and their most recent logged activity. Everything below ANDs. search matches name, title, relationship, email, notes, employer names and tag names. filter is one cut and only one. companyIds matches anyone linked to ANY of those companies — linked, not employed by, so an advisor at one of them counts; companyId is the single-company shorthand for the same thing. tagIds takes CONTACT tag ids from list_tags. quietDays is the networking question: everyone you have logged nothing against for at least that many days, counting from the day you added somebody you have never logged anything against at all, so people you filed and forgot come back rather than hiding behind a blank. missing finds the gaps: 'email' means nobody you can write to, 'tags' means filed under nothing so no tag filter will ever find them. sort is name, company (people with nobody on file last), ping (soonest first, no date last) or touch (longest since you logged anything, first). log_activity with a contactId is what moves the last-touch date; update_contact's nextFollowUpAt is what schedules the next ping. Archived people are never returned; list_archive is where those are. Read-only; it saves nothing.",
    inputSchema: object({
      applicationId: str("Limit to one application"),
      companyId: str("Limit to people linked to one company"),
      companyIds: strArray("Limit to people linked to any of these companies"),
      search: str("Match name, title, relationship, email, notes, company or tag"),
      tagIds: strArray("Only people wearing one of these tags. Ids from list_tags, kind CONTACT."),
      quietDays: num("Only people with nothing logged for at least this many days"),
      missing: {
        type: "array",
        items: { type: "string", enum: [...CONTACT_MISSING] },
        description: "Fields that are blank: email | tags. These AND with each other.",
      },
      filter: {
        type: "string",
        enum: [...CONTACT_FILTERS],
        description: "Cut the list: ping-due | with-application | no-company",
      },
      sort: {
        type: "string",
        enum: [...CONTACT_SORTS],
        description: "name | company | ping | touch. Default name.",
      },
      dir: { type: "string", enum: [...SORT_DIRECTIONS], description: "asc | desc" },
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.listContacts(
        ctx.userId,
        defined({
          applicationId: s(args, "applicationId"),
          companyId: s(args, "companyId"),
          companyIds: a(args, "companyIds"),
          search: s(args, "search"),
          tagIds: a(args, "tagIds"),
          quietDays: n(args, "quietDays"),
          missing: enumArrayArg(args, "missing", CONTACT_MISSING),
          filter: enumArg(args, "filter", CONTACT_FILTERS),
          sort: enumArg(args, "sort", CONTACT_SORTS),
          dir: enumArg(args, "dir", SORT_DIRECTIONS),
        }),
      ),
  },
  {
    name: "get_contact",
    title: "Get a contact",
    description:
      "One person in full, with every company they represent (`companies`) and the application they belong to. Call this before update_contact so you know what you are about to overwrite. Also returns their timeline — every call, coffee and reply logged with log_activity, newest first — so 'when did I last talk to them' is answered from here.",
    inputSchema: object({ id: str("Contact id") }, ["id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const contact = await pipeline.getContact(ctx.userId, required(args, "id"));
      if (!contact) throw new Error(`No contact with id ${required(args, "id")}`);
      return contact;
    },
  },
  {
    name: "update_contact",
    title: "Update a contact",
    description:
      "Change a person's details. Only the fields you pass are touched, and each REPLACES what was there — read first with get_contact if you are adding to notes, otherLinks, companies or tags rather than replacing them. A person can represent several companies at once, so `companies` is a list and REPLACES the whole set: to add one, read the current list, append, and pass it all back. An empty list detaches them from every company. `tags` behaves the same way. applicationId works the same way too, with an empty string to detach.",
    inputSchema: object(
      {
        id: str("Contact id"),
        name: str("Their name"),
        title: str("Their job title"),
        email: str("Email"),
        phone: str("Phone"),
        linkedin: str("LinkedIn URL"),
        twitter: str("X / Twitter — a URL or an @handle"),
        instagram: str("Instagram — a URL or an @handle"),
        github: str("GitHub profile URL"),
        website: str("Their own site, blog or portfolio"),
        otherLinks: strArray(
          "Anywhere else they are reachable that has no field of its own — Bluesky, Mastodon, a Substack. REPLACES the whole list, so read the current one from get_contact first.",
        ),
        relationship: str("e.g. 'recruiter', 'hiring manager', 'referral'"),
        notes: str("Notes — replaces what is there"),
        companyIds: strArray("Company ids. Exact; wins over companies. REPLACES the whole set."),
        companies: strArray(
          "Company names — everywhere this person represents. REPLACES the whole set; a name nothing matches is created.",
        ),
        company: str(
          "Legacy single-company spelling. WARNING: this also REPLACES the whole set with just this one — read the current list from get_contact first, or use companies. Empty string detaches every company. Ignored when companies is passed.",
        ),
        tagIds: strArray("Tag ids, kind CONTACT. Exact; wins over tags. REPLACES the whole set."),
        tags: strArray(
          "Tag names — how they are filed. REPLACES the whole set; a name nothing matches is created. Empty list clears them.",
        ),
        applicationId: str("Application to attach to, or empty string to detach"),
        nextFollowUpAt: str("ISO date to next get in touch — 'ping Sarah in two weeks' lives here. Empty string clears it. Due pings surface in list_follow_ups and on the dashboard."),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.updateContact(
        ctx.userId,
        required(args, "id"),
        defined({
          name: s(args, "name"),
          title: s(args, "title"),
          email: s(args, "email"),
          phone: s(args, "phone"),
          linkedin: s(args, "linkedin"),
          twitter: s(args, "twitter"),
          instagram: s(args, "instagram"),
          github: s(args, "github"),
          website: s(args, "website"),
          otherLinks: a(args, "otherLinks"),
          relationship: s(args, "relationship"),
          notes: s(args, "notes"),
          companyIds: a(args, "companyIds"),
          companies: a(args, "companies"),
          company: s(args, "company"),
          tagIds: a(args, "tagIds"),
          tags: a(args, "tags"),
          applicationId: s(args, "applicationId"),
          nextFollowUpAt: s(args, "nextFollowUpAt"),
        }),
      ),
  },
  {
    name: "delete_contact",
    title: "Archive a contact",
    description:
      "Put a person in the archive with their whole timeline — every call, coffee and reply logged against them. Nothing is destroyed, and restore_records brings all of it back for a set number of days, 30 by default. The companies they represent and the application they were attached to are untouched; they simply stop appearing on either. To take somebody off one application without archiving them, use update_contact with an empty applicationId.",
    inputSchema: object({ id: str("Contact id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => pipeline.deleteContact(ctx.userId, required(args, "id")),
  },
  {
    name: "create_contact",
    title: "Create a contact",
    description:
      "Save a person: recruiter, hiring manager, referral, friend at the company. Record every way you can reach them — linkedin, twitter, instagram, github, website, and otherLinks for anything else — because the one that matters is whichever they actually answer on, and a name with no way to contact it is a dead row. Pass `companies` for everywhere they represent, not just their day job: an angel who also advises two of your targets is three links, and each one is created if it does not exist yet. `tags` files them alongside everyone else you have labelled the same way.",
    inputSchema: object(
      {
        name: str("Their name"),
        title: str("Their job title"),
        email: str("Email"),
        phone: str("Phone"),
        linkedin: str("LinkedIn URL"),
        twitter: str("X / Twitter — a URL or an @handle"),
        instagram: str("Instagram — a URL or an @handle"),
        github: str("GitHub profile URL"),
        website: str("Their own site, blog or portfolio"),
        otherLinks: strArray(
          "Anywhere else they are reachable that has no field of its own — Bluesky, Mastodon, a Substack. REPLACES the whole list, so read the current one from get_contact first.",
        ),
        relationship: str("e.g. 'recruiter', 'hiring manager', 'referral'"),
        notes: str("Notes"),
        companyIds: strArray("Company ids, when you already have them. Wins over companies."),
        companies: strArray(
          "Every company they represent, by name. Any that do not exist yet are created.",
        ),
        company: str("Legacy single-company spelling. Ignored when companies is passed."),
        tagIds: strArray("Tag ids from list_tags, kind CONTACT. Exact; wins over tags."),
        tags: strArray(
          "How they are filed — 'referral', 'warm intro', 'ex-colleague'. Names; any that do not exist yet are created.",
        ),
        applicationId: str("Attach to this application"),
      },
      ["name"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.createContact(ctx.userId, {
        name: required(args, "name"),
        ...defined({
          title: s(args, "title"),
          email: s(args, "email"),
          phone: s(args, "phone"),
          linkedin: s(args, "linkedin"),
          twitter: s(args, "twitter"),
          instagram: s(args, "instagram"),
          github: s(args, "github"),
          website: s(args, "website"),
          otherLinks: a(args, "otherLinks"),
          relationship: s(args, "relationship"),
          notes: s(args, "notes"),
          companyIds: a(args, "companyIds"),
          companies: a(args, "companies"),
          company: s(args, "company"),
          tagIds: a(args, "tagIds"),
          tags: a(args, "tags"),
          applicationId: s(args, "applicationId"),
        }),
      }),
  },
  {
    name: "tag_companies",
    title: "Tag companies in bulk",
    description:
      "Add or remove tags across a set of companies in one act — 'these nine are all fintech', 'take Dream list off these four'. ADD and REMOVE, never replace: a bulk write that replaced the set would mean tagging nine companies as fintech quietly stripping the size, location and everything else off every one of them. Ids only, from list_tags, and each must be a tag of kind INDUSTRY, SIZE, LOCATION or COMPANY — a tag of any other kind is refused rather than attached, because nothing in the app renders an application tag on a company and no picker could ever take it back off. Ids that are not this person's, or are in the archive, are skipped rather than failing the call. Returns which companies changed and which were skipped. Use update_company when you are setting one company's lists deliberately; this is for a selection.",
    inputSchema: object(
      {
        ids: strArray("Company ids to change"),
        add: strArray("Tag ids to attach. Kind INDUSTRY, SIZE, LOCATION or COMPANY."),
        remove: strArray("Tag ids to take off"),
      },
      ["ids"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.tagCompanies(ctx.userId, requiredArray(args, "ids"), {
        add: a(args, "add"),
        remove: a(args, "remove"),
      }),
  },
  {
    name: "tag_contacts",
    title: "Tag people in bulk",
    description:
      "Add or remove CONTACT tags across a set of people in one act — 'these six are all referrals'. ADD and REMOVE, never replace, for the same reason tag_companies does not replace: a bulk overwrite loses every other label somebody already carries. Ids only, from list_tags with kind CONTACT; a tag of any other kind is refused. Ids that are not this person's, or are in the archive, are skipped rather than failing the call. Use update_contact when you are setting one person's tags deliberately.",
    inputSchema: object(
      {
        ids: strArray("Contact ids to change"),
        add: strArray("Tag ids to attach. Kind CONTACT."),
        remove: strArray("Tag ids to take off"),
      },
      ["ids"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      pipeline.tagContacts(ctx.userId, requiredArray(args, "ids"), {
        add: a(args, "add"),
        remove: a(args, "remove"),
      }),
  },
  {
    name: "schedule_contact_pings",
    title: "Put people on the chase list",
    description:
      "Set one next-ping date across a set of people — 'chase everyone I met at the conference in two weeks'. Takes an ISO date; an empty string clears the date instead, taking all of them off the chase list. A date it cannot read is REFUSED rather than treated as empty, so a vague 'next Tuesday' fails loudly instead of silently unscheduling everybody in the batch. Due pings surface in list_follow_ups and list_schedule alongside due applications. Ids that are not this person's, or are in the archive, are skipped. Use update_contact's nextFollowUpAt for one person.",
    inputSchema: object(
      {
        ids: strArray("Contact ids"),
        date: str("ISO date to ping them, or an empty string to clear it"),
      },
      ["ids", "date"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      // Not `required`, which refuses an empty string — and an empty string is
      // the documented way to take everyone off the chase list.
      const date = args["date"];
      if (typeof date !== "string") {
        throw new Error('Missing required string argument "date"');
      }
      return pipeline.scheduleContactPings(ctx.userId, requiredArray(args, "ids"), date);
    },
  },

  // --- ARCHIVE: what has been deleted -------------------------------------
  {
    name: "list_archive",
    title: "What is in the archive",
    description:
      "Everything this person has deleted and can still get back. Deleting a company, a person or an application in Hired does not destroy it: it lands in the archive and is deleted for good a set number of days later — 30 unless this instance changed it, and this tool reports the figure in force. Reach for it when they ask where something went, say they deleted something by mistake, or want to know what is about to disappear. Returns one row per item with its kind, id, what it was called, a one-line subtitle, when it was archived, and purgeAt — the moment it goes for good, or null when this instance keeps things forever. Each row also says what would come back with it, so you can say 'restoring Stripe brings 3 applications back' before doing it, and flags a company whose name a live company has since taken, which is the one thing that can make a restore fail. Pass the kind and ids to restore_records, or to delete_archived to finish the job now. Read-only: it saves nothing and it purges nothing.",
    inputSchema: object({
      kind: {
        type: "string",
        enum: [...ARCHIVE_KIND_VALUES],
        description: "Only this kind: company | contact | application",
      },
      search: str("Match the name, or a role title and its company"),
      limit: num("How many of each kind at most. Default 200."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      archive.listArchive(
        ctx.userId,
        defined({
          kind: enumArg(args, "kind", ARCHIVE_KIND_VALUES),
          search: s(args, "search"),
          limit: n(args, "limit"),
        }),
      ),
  },
  {
    name: "archive_records",
    title: "Delete, reversibly",
    description:
      "Delete records the reversible way: they leave every list, board, picker, filter and count in the app and land in the archive, where restore_records brings them back for a set number of days — 30 by default — before they are deleted for good. This is what to use whenever somebody says to delete or remove a company, a person or an application; delete_company, delete_contact and delete_application do exactly this for one at a time. Takes ONE kind and the ids of that kind. Archiving a company takes every application still pointing at it, with their timelines and their tasks, and brings them all back together on restore — it no longer refuses while applications exist, because nothing is destroyed here. The people who represent a company are NOT archived with it: somebody is a founder at one place and an advisor at another, so they keep every other company and simply lose this one. Ids that are not this person's, or are already in the archive, are skipped rather than failing the call. Nothing here is permanent — delete_archived is.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: [...ARCHIVE_KIND_VALUES],
          description: "company | contact | application",
        },
        ids: strArray("Ids of that kind"),
      },
      ["kind", "ids"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      archive.archiveRecords(
        ctx.userId,
        enumArg(args, "kind", ARCHIVE_KIND_VALUES) ?? "company",
        requiredArray(args, "ids"),
      ),
  },
  {
    name: "restore_records",
    title: "Bring archived records back",
    description:
      "Take records out of the archive and put them back in the app. Call list_archive first for the kind and the ids. Restoring a company also restores every application that went into the archive WITH it — but not one the person had binned separately beforehand, which stays where they put it. Restoring an application whose company is still archived brings the company back too, because an application with no company is a row nothing can draw. Ids that are not in the archive are skipped rather than failing, so restoring a list twice is harmless. The one thing that can genuinely fail is a name: company names are unique per person, so restoring 'Stripe' while a live 'Stripe' exists is refused for that company alone and reported in skipped with the reason — everything else in the same call still comes back, and preview_company_merge and merge_companies are how to fold the two together afterwards. Returns what was restored, what came back alongside it, and what was skipped and why.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: [...ARCHIVE_KIND_VALUES],
          description: "company | contact | application",
        },
        ids: strArray("Ids of that kind, from list_archive"),
      },
      ["kind", "ids"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      archive.restoreRecords(
        ctx.userId,
        enumArg(args, "kind", ARCHIVE_KIND_VALUES) ?? "company",
        requiredArray(args, "ids"),
      ),
  },
  {
    name: "delete_archived",
    title: "Destroy archived records now",
    description:
      "Destroy archived records immediately, without waiting for the retention window. IRREVERSIBLE, with nothing behind it: no second bin, no undo, no copy anywhere. It only reaches records that are ALREADY in the archive, which is what makes it impossible to destroy anything in this app in a single step and means this can never surprise somebody who has not already deleted the thing once. Destroying a company also destroys every application archived with it, timelines and tasks included; a company that still has a LIVE application is refused outright rather than taking it down too. Call list_archive first, tell the person exactly what will go and in what numbers, and get a plain yes before calling this. Most of the time there is nothing to do here: the archive clears itself when the window runs out, so the only reason to reach for this is something somebody wants gone now.",
    inputSchema: object(
      {
        kind: {
          type: "string",
          enum: [...ARCHIVE_KIND_VALUES],
          description: "company | contact | application",
        },
        ids: strArray("Ids of that kind, from list_archive"),
      },
      ["kind", "ids"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) =>
      archive.deleteArchived(
        ctx.userId,
        enumArg(args, "kind", ARCHIVE_KIND_VALUES) ?? "company",
        requiredArray(args, "ids"),
      ),
  },
  {
    name: "empty_archive",
    title: "Empty the archive",
    description:
      "Empty the archive completely, or one kind of it. Everything in it is destroyed immediately and none of it comes back. This is the most destructive tool on this server — it can take years of applications, interview timelines and the people behind them in one call — so never reach for it because somebody said 'clean up', 'tidy my pipeline' or 'get rid of the old stuff'. It REFUSES unless expectCount matches the number of items in the archive right now: call list_archive, tell the person how many things are about to go and what they are, and pass back the count it reported. If anything changed in between, the call fails rather than deleting more than you told them about. Use delete_archived when they mean specific things rather than all of it. Returns how many of each kind were destroyed — destroying a company takes the applications archived with it, so the number can be larger than the count of rows they saw.",
    inputSchema: object(
      {
        expectCount: num("How many items list_archive just reported. The call fails if it moved."),
        kind: {
          type: "string",
          enum: [...ARCHIVE_KIND_VALUES],
          description: "Only this kind. Omit to empty the whole archive.",
        },
      },
      ["expectCount"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const kind = enumArg(args, "kind", ARCHIVE_KIND_VALUES);
      const expected = n(args, "expectCount");
      if (expected === undefined) throw new Error('Missing required number argument "expectCount"');
      const { total, counts } = await archive.listArchive(ctx.userId, defined({ kind }));
      const actual = kind ? counts[kind] : total;
      if (actual !== expected) {
        throw new Error(
          `The archive holds ${actual} ${kind ? `${kind} ` : ""}item(s), not ${expected}. Read it back with list_archive and confirm what is about to go.`,
        );
      }
      return archive.emptyArchive(ctx.userId, defined({ kind }));
    },
  },

  // -------------------------------------------------------------------------
  // MAIL AND CALENDAR
  //
  // Read live from the person's own accounts — Google, Microsoft 365, or any
  // IMAP and CalDAV provider — never copied here. Every tool in this section
  // reaches outside the instance, so openWorldHint is true throughout.
  // -------------------------------------------------------------------------
  {
    name: "list_linked_accounts",
    title: "Which mail and calendar accounts are connected",
    description:
      "Every mailbox and calendar this person has connected for the app to read — Google, Microsoft 365, or an IMAP and CalDAV provider such as Fastmail or iCloud — with which of mail and calendar each provides, its address, when it was last read, and whether it has broken and needs reconnecting (`lastError`). Call this first when a mail or calendar tool fails, or before promising to look something up in their inbox. Google and Microsoft connect through a consent screen in a browser, so they cannot be connected from here: when nothing is listed, tell them to open Settings → Connections in the app and add an account. An IMAP account can be connected with connect_imap_account. Nothing from any inbox is stored on this instance: every read is live, and disconnecting deletes the only thing held, the credential.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => {
      const accounts = await accountsData.listLinkedAccounts(ctx.userId);
      return {
        accounts,
        connectUrl: `${ctx.baseUrl}/settings?tab=connections`,
        ...(accounts.length === 0
          ? {
              howToConnect: `Open ${ctx.baseUrl}/settings?tab=connections and add an account. Google and Microsoft 365 ask for read-only access to mail and calendar on a consent screen; any other provider takes an IMAP server and a CalDAV URL with an app password, which connect_imap_account can also do from here.`,
            }
          : {}),
      };
    },
  },
  {
    name: "connect_imap_account",
    title: "Connect a mailbox by IMAP and a calendar by CalDAV",
    description:
      "Connect any mail provider that is not Google or Microsoft — Fastmail, iCloud, Yahoo, a university account, a self-hosted server — by its IMAP server and, optionally, its CalDAV URL. Either half may be left out. Both are logged in to before anything is saved, so a wrong password is an error now rather than a broken tile later. The password must be an APP PASSWORD generated in the provider's security settings, never the account password; say so before asking for one, and never repeat it back or write it anywhere. Connecting an address that is already connected replaces its stored details. Presets worth knowing: Fastmail is imap.fastmail.com with CalDAV at https://caldav.fastmail.com/; iCloud is imap.mail.me.com with CalDAV at https://caldav.icloud.com/; Yahoo is imap.mail.yahoo.com. Read-only: the app can never send, move or delete anything with what it stores.",
    inputSchema: object(
      {
        email: str("The address of the mailbox."),
        label: str("What to call it on the tile, e.g. 'Work' or 'Old university address'. Optional."),
        imapHost: str("IMAP server, e.g. imap.fastmail.com. Leave out for a calendar-only account."),
        imapPort: num("IMAP port. Default 993 (TLS)."),
        imapUsername: str("IMAP username. Defaults to the address."),
        imapPassword: str("An app password for IMAP. Never the account password."),
        caldavUrl: str("CalDAV server or calendar-home URL, e.g. https://caldav.fastmail.com/. Leave out for a mail-only account."),
        caldavUsername: str("CalDAV username. Defaults to the IMAP username, then the address."),
        caldavPassword: str("An app password for CalDAV. Defaults to the IMAP password — many providers use one for both."),
      },
      ["email"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) =>
      accountsData.connectImapAccount(ctx.userId, {
        email: required(args, "email"),
        ...defined({
          label: s(args, "label"),
          imapHost: s(args, "imapHost"),
          imapPort: n(args, "imapPort"),
          imapUsername: s(args, "imapUsername"),
          imapPassword: s(args, "imapPassword"),
          caldavUrl: s(args, "caldavUrl"),
          caldavUsername: s(args, "caldavUsername"),
          caldavPassword: s(args, "caldavPassword"),
        }),
      }),
  },
  {
    name: "test_linked_account",
    title: "Test a connected account",
    description:
      "Read one thing from each half of a connected account — the most recent mail, the events around today — and report whether it answered, with the provider's own words when it did not. The way to find out whether 'no threads' means an empty result or a dead connection. Get the id from list_linked_accounts. Records the outcome on the account (`lastError`), which is why it is not marked read-only.",
    inputSchema: object({ accountId: str("The account id from list_linked_accounts.") }, ["accountId"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) => accountsData.testAccount(ctx.userId, required(args, "accountId")),
  },
  {
    name: "disconnect_account",
    title: "Disconnect a mail or calendar account",
    description:
      "Forget one connected account: revoke this instance's access where the provider allows it (Google) and delete the credential. Every read from that account stops immediately; nothing else — no contact, application or logged activity — is touched, because nothing from it was ever stored. Other accounts stay connected. Confirm before calling it. Get the id from list_linked_accounts; reconnecting is the same consent screen or form as the first time, under Settings → Connections.",
    inputSchema: object({ accountId: str("The account id from list_linked_accounts.") }, ["accountId"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) => accountsData.disconnectAccount(ctx.userId, required(args, "accountId")),
  },
  {
    name: "list_correspondence",
    title: "Mail and meetings about one record",
    description:
      "Every email thread and calendar event, across all of the person's connected accounts, that involves one thing on the pipeline: a contact (matched on their email address), a company (its website's domain plus everyone on file there), an application (its company's domain plus the people attached to it) or a resume (every application it was sent with). This is the tool for 'what's the latest with Stripe', 'have I heard back from Jane', 'when is my interview' and 'what did the recruiter actually say' — call it before summarising where an application stands, because the pipeline's timeline only knows what was logged by hand. Pass exactly one id. Returns `mail` (threads, newest first, with subject, snippet, participants, which `account` it came from and a link where the provider has one) and `calendar` (past and upcoming events, with attendees, a meeting link and a link) — either is null when no account provides that half or every account refused, with the reason in `warnings`. `notes` explains a thin result, usually a contact with no email or a company with no website; fix those with update_contact and update_company and call again. Nothing is saved. To read a thread in full, pass its id to get_email_thread; to remember what you learned, log_activity on the application or contact.",
    inputSchema: object({
      contactId: str("A contact id. Matches their email address."),
      companyId: str("A company id. Matches its website's domain and the addresses of its people."),
      applicationId: str("An application id. Matches the company's domain and the people attached to this application."),
      resumeId: str("A resume id. Matches every application the resume is attached to."),
      limit: num("How many threads to return at most. Default 20, maximum 50."),
      days: num("How far back to look, in days. Default 365. Calendar events up to 120 days ahead are always included."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) => {
      const subject = correspondenceSubject(args);
      return accountsData.listCorrespondence(ctx.userId, subject, {
        ...defined({ limit: n(args, "limit"), days: n(args, "days") }),
      });
    },
  },
  {
    name: "search_email",
    title: "Search mail",
    description:
      "Search every connected mailbox, or one of them, for free text — 'take-home', 'phone screen', a recruiter's name. On a Gmail account, Gmail's own operators work too: `from:jane@acme.com`, `subject:offer newer_than:7d`, `has:attachment`. Reach for this when the question is about mail that does not map to one record: 'did any rejections come in this week', 'find the email with the take-home', 'who have I emailed about referrals'. For mail about a specific contact, company or application, list_correspondence already builds the right query. Returns threads newest first, merged across accounts, each with its subject, a snippet of the latest message (empty on IMAP), everyone on the thread, when it last moved, which `account` it is in, and a link that opens it in the provider's client where there is one. Subjects and snippets only — pass a thread id to get_email_thread for the messages themselves. `warnings` names any account that did not answer. Read-only; nothing is saved, and this tool cannot send, archive or delete anything.",
    inputSchema: object(
      {
        query: str("Words to search for. Gmail operators pass through on a Gmail account."),
        limit: num("How many threads at most. Default 20, maximum 50."),
        accountId: str("Search one account only. Omit for all of them."),
      },
      ["query"],
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) =>
      accountsData.searchEmail(ctx.userId, {
        query: required(args, "query"),
        ...defined({ limit: n(args, "limit"), accountId: s(args, "accountId") }),
      }),
  },
  {
    name: "get_email_thread",
    title: "Read an email thread",
    description:
      "One thread in full, oldest message first: who sent each message, to whom, when, and the body as plain text (HTML mail is stripped to text; attachments are never fetched; very long messages are cut). The id comes from list_correspondence or search_email and already says which account it lives in. This is how you find out what a recruiter actually wrote — the dates they proposed, the salary they named, the next step they described — before logging it with log_activity or moving the application with move_application_stage. Quote the mail when you report it; do not paraphrase a number. Read-only, and nothing about the thread changes: it is not marked read.",
    inputSchema: object({ threadId: str("The thread id from list_correspondence or search_email.") }, ["threadId"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) => accountsData.getEmailThread(ctx.userId, required(args, "threadId")),
  },
  {
    name: "search_calendar",
    title: "Search calendars",
    description:
      "Events across every connected calendar, or one of them, in a window, optionally filtered by words matched against title, description, location and attendee names and addresses. Use it for 'what interviews do I have this week', 'when did I last meet anyone from Acme' or 'am I free Thursday afternoon' — for a whole week of the pipeline's own dates alongside these meetings, list_schedule merges both. Defaults to thirty days back and sixty ahead. Each event has its title, start and end, whether it is all-day, the attendees with their RSVP, the organizer, a meeting link when there is one, which `account` it is on, and a link to the event where the provider has one. `warnings` names any account that did not answer. Read-only; nothing here creates, accepts or declines anything.",
    inputSchema: object({
      query: str("Words to match against title, description, location and attendees. Omit for every event in the window."),
      from: str("Start of the window, ISO date (YYYY-MM-DD). Default: 30 days ago."),
      to: str("End of the window, ISO date (YYYY-MM-DD), inclusive. Default: 60 days ahead."),
      limit: num("How many events at most. Default 100."),
      accountId: str("Search one account only. Omit for all of them."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (args, ctx) => {
      const zone = await me.timeZoneOf(ctx.userId);
      return accountsData.searchCalendar(ctx.userId, {
        ...defined({
          query: s(args, "query"),
          from: s(args, "from") ? startOfDay(zone, required(args, "from")) : undefined,
          to: s(args, "to") ? endOfDay(zone, required(args, "to")) : undefined,
          limit: n(args, "limit"),
          accountId: s(args, "accountId"),
        }),
      });
    },
  },

  // -------------------------------------------------------------------------
  // ACCOUNT
  // -------------------------------------------------------------------------
  {
    name: "whoami",
    title: "Who am I connected as",
    description:
      "The account this connection belongs to: name, email, role, and whether it can administer the instance. Every other tool acts as this person and can only see their data.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => ({
      id: ctx.user.id,
      name: ctx.user.name,
      email: ctx.user.email,
      role: ctx.user.role,
      isAdmin: isAdmin(ctx.user),
      memberSince: ctx.user.createdAt,
    }),
  },
  {
    name: "get_setup_status",
    title: "How far into setup this workspace is",
    description:
      "Three things a workspace needs before it does anything: one job on the board, some career material in Me, and something connected over MCP. Returns which are done and what each is waiting for, plus `tourSeenAt` — when the person last went through the welcome tour in the web app, or null if they never have. Worth calling when someone new asks what to do first, or when a read comes back empty and you are deciding whether that is an empty account or a wrong query — an empty Me with nothing tracked is a workspace nobody has filled yet, not a failure. A null tourSeenAt is a strong hint you are talking to somebody who has not been shown around: explain things rather than assuming they know what a pipeline stage is.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => onboarding.setupStatus(ctx.userId),
  },
  {
    name: "restart_tour",
    title: "Show the welcome tour again",
    description:
      "Queue the web app's welcome tour to run again the next time this person opens it — the short walk through what the board, Me and the assistant connection are for. Reach for it when somebody says they are lost, that they never saw an introduction, or that they want the tutorial back; also worth offering to someone whose `get_setup_status` shows tourSeenAt null who is clearly struggling. It does not open anything on its own — nothing here can reach into their browser — so say plainly that it will appear next time they load the app. Setting it back to seen is the tour\'s own job, not a tool: they put it away by finishing or closing it.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => {
      await onboarding.setTourSeen(ctx.userId, false);
      return {
        queued: true,
        message: "The welcome tour will run the next time they open the web app.",
      };
    },
  },
  {
    name: "list_connections",
    title: "List AI connections",
    description:
      "Every assistant wired to this workspace: what it is called, which client it was set up for, when it last called in and from what. Reach for it to answer 'which of these am I still using?' or before rotating something — the ids come back here. Tokens deliberately do not: they are credentials, they would sit in this transcript forever, and the only place a person needs to see one is the client they are pasting it into. `isThisOne` marks the connection you are calling through right now.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (_args, ctx) => {
      const rows = await connections.listConnections(ctx.userId);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        client: row.client,
        clientName: clientName(row.client),
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        lastUsedFrom: guessClient(row.lastUsedFrom) || null,
        isThisOne: row.id === ctx.connectionId,
      }));
    },
  },
  {
    name: "create_connection",
    title: "Connect another assistant",
    description:
      "Mint a new connection URL so a second client — the laptop's editor, a phone app, a terminal — can reach this workspace too. Returns the URL and the exact steps for that client, so you can hand somebody a copy-paste answer to 'how do I add this to Cursor?'. Give every client its own rather than sharing one: that is what lets a single laptop be disconnected later without breaking everything else. The URL is a credential with full read and write over this person's career history, resumes and pipeline — say so when you hand it over, and never post it anywhere it will be stored.",
    inputSchema: object({
      client: str(
        "Which client it is for: claude | claude-code | chatgpt | cursor | vscode | windsurf | generic-http | stdio-bridge | raw. Sets the setup steps returned.",
      ),
      name: str("What to call it in the list, e.g. 'Cursor — work laptop'. Defaults to the client's name."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const client = s(args, "client") ?? "generic-http";
      const row = await connections.createConnection(ctx.userId, {
        client,
        ...defined({ name: s(args, "name") }),
      });
      const url = `${ctx.baseUrl}/api/mcp/${row.token}`;
      const recipe = clientsById.get(row.client);
      return {
        id: row.id,
        name: row.name,
        client: row.client,
        url,
        setup: recipe?.steps(url) ?? [],
        docs: recipe?.docs ?? null,
        warning: "This URL is a password. Anyone holding it can read and write this workspace.",
      };
    },
  },
  {
    name: "rename_connection",
    title: "Rename a connection",
    description:
      "Change what a connection is called in the list. Names are for the person, not the machine — 'Cursor — old laptop' is what makes it obvious later which one to revoke. Get the id from list_connections.",
    inputSchema: object({ id: str("Connection id"), name: str("The new name") }, ["id", "name"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      await connections.renameConnection(ctx.userId, required(args, "id"), required(args, "name"));
      return { id: required(args, "id"), renamed: true };
    },
  },
  {
    name: "rotate_connection",
    title: "Issue a new token for a connection",
    description:
      "Kill a connection's URL and issue a fresh one on the same row, keeping its name and place in the list. This is the answer to 'I sold that laptop' or 'I pasted the URL in a chat by mistake' — the old address stops working the moment this returns, and nothing else is affected. It also means the client that was using it goes dark until somebody pastes the new URL in, so say that before doing it. Returns the new URL; treat it like the password it is.",
    inputSchema: object({ id: str("Connection id, from list_connections") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const id = required(args, "id");
      const token = await connections.rotateConnection(ctx.userId, id);
      return {
        id,
        url: `${ctx.baseUrl}/api/mcp/${token}`,
        warning:
          "The old URL is dead. Paste this one into that client or it stays disconnected. It is a password.",
      };
    },
  },
  {
    name: "delete_connection",
    title: "Disconnect an assistant",
    description:
      "Remove a connection for good. Its URL stops working immediately and cannot be brought back — a replacement is a new connection with a new URL. Prefer rotate_connection when the client is still in use and only the URL has leaked. Check list_connections first: deleting the one you are calling through ends this session mid-conversation.",
    inputSchema: object({ id: str("Connection id, from list_connections") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (args, ctx) => {
      const id = required(args, "id");
      if (id === ctx.connectionId) {
        throw new Error(
          "That is the connection you are talking through. Delete it from Settings, or delete a different one.",
        );
      }
      await connections.deleteConnection(ctx.userId, id);
      return { id, deleted: true };
    },
  },

  // -------------------------------------------------------------------------
  // ADMIN — hidden entirely from members
  // -------------------------------------------------------------------------
  {
    name: "admin_instance_stats",
    title: "Instance overview",
    description:
      "How many people are on this instance, how many are active, how many invites are outstanding, and how much material exists across all accounts. Aggregate counts only — never another person's content.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async () => {
      const [stats, settings] = await Promise.all([users.instanceStats(), getSettings()]);
      return { ...stats, instanceName: settings.instanceName, companyLogos: settings.companyLogos };
    },
  },
  {
    name: "admin_set_company_logos",
    title: "Turn company logos on or off",
    description:
      "Controls whether the pipeline shows a company's favicon next to its name. When on, each person's browser asks twenty-icons.com for the logo, which means that service can see which companies are in their pipeline — turn it off for an instance where that matters and everyone gets initials on a coloured tile instead. Nothing else changes; no data is stored or deleted either way. Call admin_instance_stats to read the current state.",
    inputSchema: object({ enabled: bool("On shows logos, off shows initials only") }, ["enabled"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const enabled = b(args, "enabled");
      if (enabled === undefined) throw new Error('Missing required boolean argument "enabled"');
      await updateSettings(ctx.user, { companyLogos: enabled });
      return { companyLogos: enabled };
    },
  },
  {
    name: "admin_list_users",
    title: "List members",
    description:
      "Everyone on the instance with their role, whether they are active, when they last signed in, and how much they have built. Does not expose anyone's career history, resumes or applications.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async () => users.listUsers(),
  },
  {
    name: "admin_user_detail",
    title: "Look up one account",
    description:
      "Everything known about a single account, for when someone asks for help: when they joined, who invited them, whether that invitation email actually went out, when they last signed in, which assistants they have connected and when each last called, whether they are being billed, how much they have built, every administrative change made to their account, and anything the instance recorded against their address — a bounced invite, a tool call that threw. Start here before admin_reset_user_password or admin_set_user_active, because it tells you whether the problem is the account or the email. Takes a user id from admin_list_users. Returns counts of what is in their workspace, never its contents: no career history, no resumes, no applications, and never a connection token. `manageable` says whether you are allowed to act on this account at all — it is false for the instance owner, for yourself, and for another admin when you are not the owner.",
    inputSchema: object({ user_id: str("The user's id, from admin_list_users") }, ["user_id"]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const id = required(args, "user_id");
      const detail = await users.getUserDetail(ctx.user, id);
      if (!detail) throw new Error("No such user.");
      const [history, events] = await Promise.all([
        audit.listAudit({ targetId: id, limit: 50 }),
        system.listSystemEvents({ limit: 25, userEmail: detail.email }),
      ]);
      return { ...detail, history, events };
    },
  },
  {
    name: "admin_invite_user",
    title: "Invite someone",
    description:
      "Create an invitation and email it through Resend. If email is not configured yet, the invite is still created and the reply includes a link you can send by hand — so this works before Resend is set up. Normally the invitee picks their own password on the accept page and you never see it. Pass `password` instead to choose it for them: the accept page then asks only for their name, and you have to tell them the password some other way, because it is deliberately never put in the invitation email — a message carrying both the link and the password it opens IS the account, sent to an address nobody has proven yet. Pass `must_change_password` alongside it when you would rather not keep a way in: they replace your password the moment they are through the door. The password is hashed immediately and never comes back out of any tool.",
    inputSchema: object(
      {
        email: str("Who to invite"),
        role: {
          type: "string",
          enum: ["MEMBER", "ADMIN"],
          description: "MEMBER by default. Only the super admin may create ADMINs.",
        },
        password: str(
          "Set their password yourself instead of letting them pick one. At least 10 characters. Omit for the normal flow, where the accept page asks them for one.",
        ),
        must_change_password: bool(
          "Whether they must replace your password with their own before the app opens to them. Off unless you ask for it, and ignored without a password.",
        ),
      },
      ["email"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const result = await users.createInvite({
        actor: ctx.user,
        email: required(args, "email"),
        role: (s(args, "role") as UserRole | undefined) ?? "MEMBER",
        baseUrl: ctx.baseUrl,
        // Not run through defined(): createInvite reads undefined as "not
        // asked for" already, and defined() would make every key optional and
        // take `actor` with it.
        password: s(args, "password"),
        mustChangePassword: b(args, "must_change_password"),
      });
      return {
        email: result.invite.email,
        expiresAt: result.invite.expiresAt,
        emailSent: result.emailSent,
        emailError: result.emailError,
        acceptUrl: result.acceptUrl,
        passwordSet: result.passwordSet,
        mustChangePassword: result.mustChangePassword,
        note: [
          result.emailSent
            ? "Invitation emailed."
            : "Invitation created but NOT emailed — send them the acceptUrl yourself, or configure Resend with admin_set_email_config.",
          result.passwordSet
            ? "The password is not in that email. Tell them separately, or they cannot sign in."
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      };
    },
  },
  {
    name: "admin_list_invites",
    title: "List outstanding invites",
    description:
      "Invitations that have not been accepted yet, with their links, expiry, and whether a password was set on each. Never returns the password itself — `passwordSet` is a boolean, and the stored hash does not leave the server.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async () => users.listInvites(),
  },
  {
    name: "admin_set_invite_password",
    title: "Set the password on an invitation",
    description:
      "Put a password on an invitation that has already gone out, or take one off, without changing its link. Reach for this when you invited somebody the normal way and then decided to hand them a password — re-inviting the same address would work too, but it mints a fresh token and the link you already sent stops working, which is the opposite of what you want here. Pass `password` to set one, at which point the accept page asks only for their name; pass an empty string to clear it and put them back to choosing their own. `must_change_password` makes them replace your password before the app opens to them, and is off unless you ask for it. The password never reaches the invitation email that already went out, so tell them yourself. Only works while the invitation is outstanding: once it has been accepted, use admin_reset_user_password on their account instead, which also ends their sessions. Takes an invite id from admin_list_invites.",
    inputSchema: object(
      {
        id: str("Invite id, from admin_list_invites"),
        password: str(
          "The password to set, at least 10 characters. An empty string removes the one that is there and lets them pick their own again.",
        ),
        must_change_password: bool(
          "Whether they must replace your password with their own before the app opens to them. Off unless you ask for it, and ignored when clearing.",
        ),
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) =>
      users.setInvitePassword(
        ctx.user,
        required(args, "id"),
        // Not defined(): an empty password is a real instruction here — it
        // clears the one on the invitation — so it must survive as "".
        { password: s(args, "password"), mustChange: b(args, "must_change_password") },
      ),
  },
  {
    name: "admin_revoke_invite",
    title: "Revoke an invite",
    description: "Cancel an outstanding invitation so its link stops working.",
    inputSchema: object({ id: str("Invite id") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => users.revokeInvite(ctx.user, required(args, "id")),
  },
  {
    name: "admin_reset_user_password",
    title: "Reset a member's password",
    description:
      "Give a locked-out member a working password again, and return it once so it can be passed on. With no `password` it generates a passphrase, which is the safe default; pass one to set a password you chose. Either way every session they had is ended, so an old browser stays logged out. Either way you now know a password that opens their workspace, so `must_change_password` is there to close the app to them until they set their own. It is off unless you ask for it. Cannot be used on the instance owner, and an admin cannot reset another admin's password: that restriction is what stops this being a way to take over an instance. The reset is written to the audit log; the password itself never is.",
    inputSchema: object(
      {
        user_id: str("The user's id, from admin_list_users"),
        password: str(
          "Set this exact password instead of generating one. At least 10 characters. Omit to generate a passphrase.",
        ),
        must_change_password: bool(
          "Whether they must set their own password before the app opens to them again. Off unless you ask for it.",
        ),
      },
      ["user_id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) =>
      users.adminResetPassword(
        ctx.user,
        required(args, "user_id"),
        defined({ password: s(args, "password"), mustChange: b(args, "must_change_password") }),
      ),
  },
  {
    name: "admin_audit_log",
    title: "Read the admin audit log",
    description:
      "What admins have done on this instance, newest first: invitations, role changes, suspensions, deletions, password resets, billing links and changes to the instance's own configuration, each with who did it, to whom, and when. Rows survive the deletion of the account they describe. Use it to answer 'who suspended this person', 'who changed the Resend key', or to review what happened while you were away. Narrow with group (accounts, invites, passwords, billing, settings) and search, which matches either side of a row — the admin who acted or the account acted on — and page with offset. Nothing here touches anyone's career history, resumes or applications, and a secret is recorded as having been set, never as its value.",
    inputSchema: object({
      limit: num("How many entries, newest first. Default 100, max 500."),
      offset: num("Skip this many before returning, for paging through a long log."),
      group: {
        type: "string",
        enum: ["accounts", "invites", "passwords", "billing", "settings"],
        description: "Only one kind of change. Omit for everything.",
      },
      search: str("An email address, whole or partial. Matches the admin who acted or the account acted on."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args) =>
      audit.listAudit(
        defined({
          limit: n(args, "limit") ?? 100,
          offset: n(args, "offset"),
          group: s(args, "group"),
          search: s(args, "search"),
        }),
      ),
  },
  {
    name: "admin_health",
    title: "Check whether the instance is working",
    description:
      "This is the FIRST tool to call when something is reported broken, and the one to call on a schedule if you check on this instance at all. Returns a short list of checks — database reachability and response time, whether every migration finished, whether email is configured and whether the last send actually succeeded, whether Stripe is still calling the webhook, when an assistant last made a tool call, and how many errors were recorded in the last 24 hours. Each check has a status of ok, warn or down plus a plain-language summary you can read out as-is. Nothing here touches anyone's career history, resumes or applications. A 'down' on billing usually means the signing secret in Admin → Configuration → Billing is wrong; a billing check that says Stripe has never called means the webhook endpoint was never added on Stripe's side. Follow up with admin_recent_errors for the specifics behind an error count.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async () => system.instanceHealth(),
  },
  {
    name: "admin_recent_errors",
    title: "Read what has failed recently",
    description:
      "The instance's own event stream, newest first: failed emails, Stripe webhooks that did not verify or did not sync, tool calls that threw, and pages that errored. Use it after admin_health reports errors, or to answer 'did that invite actually send'. Each entry has a level (INFO, WARN or ERROR), a source, a one-line message, and the address of whoever's request hit it. Pass level ERROR for failures only — the default includes INFO entries such as successful webhook deliveries, which are what prove Stripe is still reaching this instance at all. Entries older than 30 days are removed automatically. This never contains anyone's content: the arguments that caused a failure are deliberately not recorded, only the failure.",
    inputSchema: object({
      limit: num("How many entries, newest first. Default 50, max 200."),
      level: {
        type: "string",
        enum: ["INFO", "WARN", "ERROR"],
        description: "Only entries at this level. Omit for everything.",
      },
      source: {
        type: "string",
        enum: ["stripe.webhook", "billing.sync", "email.send", "mcp.tool", "app"],
        description: "Only entries from this part of the app. Omit for everything.",
      },
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args) =>
      system.listSystemEvents(
        defined({
          limit: n(args, "limit") ?? 50,
          level: s(args, "level") as "INFO" | "WARN" | "ERROR" | undefined,
          source: s(args, "source") as system.SystemEventSource | undefined,
        }),
      ),
  },
  {
    name: "admin_list_waitlist",
    title: "See who asked for access",
    description:
      "People who requested access from the marketing site and have not been invited yet. Start here when you're deciding who to let in next: each entry has the address, what they said they're looking for, which site they came from, and when they asked. Entries already turned into invites are included with an invitedAt date, so you can see the whole history — pass pendingOnly true for just the queue. Reading this does not tell anyone anything; use admin_invite_waitlist_signup to actually let someone in.",
    inputSchema: object({
      pendingOnly: bool("Only the people still waiting. Defaults to false, which returns everyone who ever asked."),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args) => {
      const [entries, stats] = await Promise.all([
        waitlist.listWaitlist({ pendingOnly: b(args, "pendingOnly") ?? false }),
        waitlist.waitlistStats(),
      ]);
      return { ...stats, entries };
    },
  },
  {
    name: "admin_invite_waitlist_signup",
    title: "Invite someone off the waitlist",
    description:
      "Turn a waitlist request into a real invitation: creates the invite, emails it through Resend, and marks the request as invited so it leaves the queue. Takes the signup id from admin_list_waitlist, not an email address. If email is not configured the invite is still created and the reply carries a link you can send by hand. The request stays on the list afterwards, stamped with the date, so the list remains a record of who asked and when.",
    inputSchema: object(
      {
        id: str("The signup id from admin_list_waitlist"),
        role: {
          type: "string",
          enum: ["MEMBER", "ADMIN"],
          description: "MEMBER by default. Only the super admin may create ADMINs.",
        },
      },
      ["id"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const result = await waitlist.inviteFromWaitlist({
        actor: ctx.user,
        id: required(args, "id"),
        role: (s(args, "role") as UserRole | undefined) ?? "MEMBER",
        baseUrl: ctx.baseUrl,
      });
      return {
        email: result.invite.email,
        expiresAt: result.invite.expiresAt,
        emailSent: result.emailSent,
        emailError: result.emailError,
        acceptUrl: result.acceptUrl,
        note: result.emailSent
          ? "Invitation emailed and the request marked as invited."
          : "Invitation created but NOT emailed — send them the acceptUrl yourself, or configure Resend with admin_set_email_config.",
      };
    },
  },
  {
    name: "admin_remove_waitlist_signup",
    title: "Remove a waitlist request",
    description:
      "Delete a request from the waitlist for good — spam, a duplicate, or someone who asked to be taken off. This does not revoke an invitation that was already sent; use admin_revoke_invite for that. Irreversible, so read admin_list_waitlist first and remove by id.",
    inputSchema: object({ id: str("The signup id from admin_list_waitlist") }, ["id"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args) => {
      await waitlist.removeWaitlistSignup(required(args, "id"));
      return { removed: true };
    },
  },
  {
    name: "admin_set_user_role",
    title: "Change someone's role",
    description:
      "Promote a member to admin or demote an admin to member. The super admin cannot be changed, and admins can only act on members.",
    inputSchema: object(
      {
        userId: str("User id"),
        role: { type: "string", enum: ["MEMBER", "ADMIN"], description: "The new role" },
      },
      ["userId", "role"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) =>
      users.setUserRole(ctx.user, required(args, "userId"), required(args, "role") as UserRole),
  },
  {
    name: "admin_set_user_active",
    title: "Activate or suspend someone",
    description:
      "Suspending signs the person out everywhere and blocks their login and their MCP connection. Their data is kept.",
    inputSchema: object(
      { userId: str("User id"), isActive: bool("true to reactivate, false to suspend") },
      ["userId", "isActive"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) =>
      users.setUserActive(ctx.user, required(args, "userId"), b(args, "isActive") ?? true),
  },
  {
    name: "admin_delete_user",
    title: "Delete someone",
    description:
      "PERMANENT. Removes the account and everything it owns: career history, resumes, applications. Confirm with the person you are talking to before calling this.",
    inputSchema: object({ userId: str("User id") }, ["userId"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => users.deleteUser(ctx.user, required(args, "userId")),
  },
  {
    name: "admin_get_email_config",
    title: "Check email configuration",
    description:
      "Whether Resend is wired up, and the from address invitations will come from. The API key is returned masked.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async () => {
      const settings = await getSettings();
      return {
        configured: emailIsConfigured(settings),
        instanceName: settings.instanceName,
        resendApiKey: maskSecret(settings.resendApiKey),
        resendFromEmail: settings.resendFromEmail,
        resendFromName: settings.resendFromName,
        publicUrl: settings.publicUrl,
        help: "The from address must be on a domain you have verified in Resend, otherwise sends are rejected.",
      };
    },
  },
  {
    name: "admin_set_email_config",
    title: "Configure email",
    description:
      "Set the Resend API key and the address invitations are sent from. Only the fields you pass are changed. Follow with admin_send_test_email to prove it works. instanceName and publicUrl are instance-wide rather than email-only — they are what the sign-in page, invitation links and the Stripe webhook URL are built from — and they can also be set on their own with admin_set_variable.",
    inputSchema: object({
      resendApiKey: str("Resend API key, starts with re_"),
      resendFromEmail: str("From address on a domain verified in Resend, e.g. hello@yourdomain.com"),
      resendFromName: str("Display name on outgoing mail"),
      instanceName: str("What this instance is called, used in invitation emails"),
      publicUrl: str("Public base URL, used to build invite links, e.g. https://you.up.railway.app"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      await updateSettings(
        ctx.user,
        defined({
          resendApiKey: s(args, "resendApiKey"),
          resendFromEmail: s(args, "resendFromEmail"),
          resendFromName: s(args, "resendFromName"),
          instanceName: s(args, "instanceName"),
          publicUrl: s(args, "publicUrl"),
        }),
      );
      const settings = await getSettings();
      return { configured: emailIsConfigured(settings), resendFromEmail: settings.resendFromEmail };
    },
  },
  {
    name: "admin_send_test_email",
    title: "Send a test email",
    description:
      "Proves the Resend configuration actually delivers, and doubles as the way to look at what this instance's mail actually looks like. Returns the exact error if it does not send. `template` picks which of the three designs to send: `test` (the default, a short confirmation), `invite` (the real invitation email filled with placeholder material) or `waitlist` (the notice the owner gets when a stranger asks for access). The samples are marked [Sample] in the subject and their links go nowhere, so proofreading an invitation costs nobody a real invitation token.",
    inputSchema: object({
      to: str("Where to send it. Defaults to your own address."),
      template: str("Which email to send: test, invite or waitlist. Defaults to test."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const settings = await getSettings();
      const to = s(args, "to") || ctx.user.email;
      const template = s(args, "template") || "test";
      const result = await sendEmail({ to, ...renderEmailTemplate(template, settings), settings });
      return result.ok
        ? { ok: true, to, template, id: result.id }
        : { ok: false, to, template, error: result.error };
    },
  },
  {
    name: "admin_get_microsoft_config",
    title: "Check the Microsoft 365 app registration",
    description:
      "Whether members can connect their Microsoft 365 or Outlook.com mail and calendar, and the exact redirect URI to register on the app registration in Microsoft Entra — the value behind AADSTS50011 when it does not match. The client secret comes back masked. This is separate from Google sign-in and from the Google client: it is never used to sign in, only for members who choose to connect an Outlook mailbox under Settings → Connections.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (_args, ctx) => {
      const settings = await getSettings();
      return {
        configured: microsoftIsConfigured(settings),
        clientId: settings.microsoftClientId,
        clientSecret: maskSecret(settings.microsoftClientSecret),
        redirectUri: `${ctx.baseUrl}/api/auth/microsoft/callback`,
        help: "In Microsoft Entra admin center: App registrations → New registration. Supported account types: 'Accounts in any organizational directory and personal Microsoft accounts', so both work and personal mailboxes can connect. Platform: Web, with redirectUri as the redirect URI. Under API permissions add Microsoft Graph delegated permissions Mail.Read, Calendars.Read, User.Read and offline_access. Under Certificates & secrets create a client secret and paste its VALUE here with admin_set_microsoft_config — the value is shown once.",
      };
    },
  },
  {
    name: "admin_set_microsoft_config",
    title: "Configure the Microsoft 365 app registration",
    description:
      "Set or clear the Microsoft Entra app registration members use to connect Outlook mail and calendar. Pass the Application (client) ID and a client secret VALUE. Clearing the client id takes the Microsoft option off the account picker; accounts already connected keep working until their token needs refreshing, then show as needing reconnecting. Recorded in the admin audit log; the secret is recorded as having changed, never as its value.",
    inputSchema: object({
      clientId: str("The Application (client) ID. Empty string to turn the option off."),
      clientSecret: str("A client secret value from Certificates & secrets. Omit to keep the current one."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      await updateSettings(
        ctx.user,
        defined({
          microsoftClientId: s(args, "clientId")?.trim(),
          microsoftClientSecret: s(args, "clientSecret"),
        }),
      );
      const settings = await getSettings();
      return { configured: microsoftIsConfigured(settings), clientId: settings.microsoftClientId };
    },
  },
  {
    name: "admin_get_google_config",
    title: "Check Google sign-in",
    description:
      "Whether people can sign in with Google, who is allowed to, and the exact redirect URI to register in the Google Cloud console — the value that causes redirect_uri_mismatch when it does not match exactly. The client secret comes back masked. `allowSignup` false means Google only signs in people who already have an account or an outstanding invitation, which is the default and keeps the instance invite-only.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (_args, ctx) => {
      const settings = await getSettings();
      return {
        configured: googleIsConfigured(settings),
        clientId: settings.googleClientId,
        clientSecret: maskSecret(settings.googleClientSecret),
        allowSignup: settings.googleAllowSignup,
        allowedDomains: settings.googleAllowedDomains,
        redirectUri: `${ctx.baseUrl}/api/auth/google/callback`,
        help: "In the Google Cloud console: APIs & Services → Credentials → Create credentials → OAuth client ID → Web application. Add redirectUri under Authorised redirect URIs exactly as given, then paste the client ID and secret here with admin_set_google_config. An existing member or an invited person can sign in with Google as soon as it is configured; allowSignup only governs people nobody invited.",
      };
    },
  },
  {
    name: "admin_set_google_config",
    title: "Configure Google sign-in",
    description:
      "Set the Google OAuth client id and secret, and decide who may sign up. Only the fields you pass are changed. Setting a client id and secret puts a Continue with Google button on the sign-in page; clearing the client id takes it away and changes nothing else, so it is a safe thing to undo. `allowSignup` is the one with consequences: true lets ANYONE with a Google account create an account on this instance, so pair it with allowedDomains unless you really mean the whole internet. False — the default — still lets existing members and anyone holding an unexpired invitation sign in with Google; it only turns away strangers. Follow with admin_get_google_config for the redirect URI to register.",
    inputSchema: object({
      clientId: str("OAuth client ID, ends in .apps.googleusercontent.com"),
      clientSecret: str("OAuth client secret, usually starts GOCSPX-"),
      allowSignup: bool("True lets a Google account nobody invited create an account here"),
      allowedDomains: str("Comma-separated email domains new sign-ups must be on, e.g. 'acme.com'. Empty means any domain. Only consulted when allowSignup is true."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      await updateSettings(
        ctx.user,
        defined({
          googleClientId: s(args, "clientId"),
          googleClientSecret: s(args, "clientSecret"),
          googleAllowSignup: b(args, "allowSignup"),
          googleAllowedDomains: s(args, "allowedDomains"),
        }),
      );
      const settings = await getSettings();
      return {
        configured: googleIsConfigured(settings),
        allowSignup: settings.googleAllowSignup,
        allowedDomains: settings.googleAllowedDomains,
        redirectUri: `${ctx.baseUrl}/api/auth/google/callback`,
      };
    },
  },
  {
    name: "admin_get_billing_config",
    title: "Check billing configuration",
    description:
      "Whether Stripe billing is wired up for hosting other people on this instance for a fee, how many users currently pay, and the exact webhook URL to paste into the Stripe Dashboard. Keys come back masked. Billing only governs users who arrived through a Stripe checkout — the owner and free invitees are never touched by it.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (_args, ctx) => {
      const settings = await getSettings();
      return {
        configured: billingIsConfigured(settings),
        stripeSecretKey: maskSecret(settings.stripeSecretKey),
        stripeWebhookSecret: maskSecret(settings.stripeWebhookSecret),
        paymentLink: settings.stripePaymentLink,
        billedUsers: await billedUserCount(),
        webhookUrl: `${ctx.baseUrl}/api/stripe/webhook`,
        help: "In Stripe: create a Product with a recurring Price and a Payment Link for it, then a webhook pointed at webhookUrl with the events checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted and invoice.payment_failed. Someone who pays through the link is invited automatically; a lapsed subscription suspends them, and paying again reactivates the same workspace.",
      };
    },
  },
  {
    name: "admin_set_billing_config",
    title: "Configure billing",
    description:
      "Set the Stripe API key, the webhook signing secret, and the public Payment Link for this instance. Only the fields you pass are changed. Prefer a RESTRICTED key (rk_...) with read-only Customers and Subscriptions over the full secret key — reading those two things is all this app ever does with Stripe, and a restricted key that leaks cannot move money or alter the Stripe account. Follow with admin_get_billing_config to see the webhook URL to register in Stripe.",
    inputSchema: object({
      stripeSecretKey: str("Stripe API key — a restricted rk_ key with read-only Customers and Subscriptions is enough and safer than the full sk_ key"),
      stripeWebhookSecret: str("Webhook signing secret, starts with whsec_"),
      stripePaymentLink: str("The Stripe Payment Link people pay through, e.g. https://buy.stripe.com/..."),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      await updateSettings(
        ctx.user,
        defined({
          stripeSecretKey: s(args, "stripeSecretKey"),
          stripeWebhookSecret: s(args, "stripeWebhookSecret"),
          stripePaymentLink: s(args, "stripePaymentLink"),
        }),
      );
      const settings = await getSettings();
      return { configured: billingIsConfigured(settings), paymentLink: settings.stripePaymentLink };
    },
  },
  {
    name: "admin_sync_billing",
    title: "Resync billing from Stripe",
    description:
      "Asks Stripe for the current subscription state and reconciles this instance against it — the recovery path for a missed webhook. Pass an email to sync one billed user, or nothing to sync everyone with a Stripe customer attached. Reports what changed per person: activated, suspended, or unchanged. Safe to run any time.",
    inputSchema: object({ email: str("One billed user's email. Omit to sync all billed users.") }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const results = await syncAllBilling(ctx.baseUrl, s(args, "email") || undefined);
      return { synced: results.length, results };
    },
  },
  {
    name: "admin_link_billing",
    title: "Link or unlink a member and their Stripe customer",
    description:
      "Attaches an EXISTING member to their Stripe customer so billing starts governing their access. This never happens automatically: a checkout email is whatever the payer typed, so the unattended webhook only ever invites strangers — connecting a current member to a subscription is a deliberate admin act, and this tool is that act. Pass their email; their Stripe customer is found by the same email in Stripe's records, or pass customerId when Stripe holds several. Pass unlink true to detach someone from billing entirely — the recovery hatch if a link was wrong; it also ends billing's authority over their account. The owner can never be linked.",
    inputSchema: object(
      {
        email: str("The member's email on this instance"),
        customerId: str("A specific Stripe customer id (cus_...), when email alone is ambiguous"),
        unlink: bool("True to detach this member from billing instead of linking"),
      },
      ["email"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    adminOnly: true,
    handler: async (args, ctx) =>
      linkBillingCustomer({
        email: required(args, "email"),
        customerId: s(args, "customerId") || undefined,
        unlink: b(args, "unlink") ?? false,
        baseUrl: ctx.baseUrl,
      }),
  },
  {
    name: "admin_list_variables",
    title: "List instance variables",
    description:
      "Every configurable value on this instance in one list: its key, what it does, what it is set to now, and whether it is still on the built-in default. This is the whole of what a self-hosted instance stores as configuration, so start here when someone asks where a setting lives or why the app is behaving a certain way. Secrets come back masked — no tool ever returns a raw key. Variables an admin added by hand are marked known:false; they have no form in the app and are read by whatever feature asked for them.",
    inputSchema: object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async () => ({ variables: await listVariables() }),
  },
  {
    name: "admin_set_variable",
    title: "Set an instance variable",
    description:
      "Changes one instance setting by key — the general way in, for anything without a tool of its own. Take the key from admin_list_variables and send the new value as a string; an on-off variable takes \"1\" or \"0\". Prefer admin_set_email_config or admin_set_billing_config where they apply, because they also report whether that area now works. Sending an empty value for a secret leaves it alone rather than clearing it — admin_delete_variable is how you clear one. A key nothing recognises creates a new variable, which is how a setting exists before it has a screen: lowercase letters, numbers and underscores. Every change is written to the audit log against your name, values included, so never put a secret in a key that is not declared as one.",
    inputSchema: object(
      {
        key: str("The variable's key, e.g. instance_name — from admin_list_variables"),
        value: str('The new value as a string. "1" or "0" for an on-off variable.'),
      },
      ["key", "value"],
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => {
      const key = required(args, "key");
      const value = s(args, "value");
      if (value === undefined) throw new Error('Missing required string argument "value"');
      const changed = await setVariables(ctx.user, { [key]: value });
      const after = (await listVariables()).find((variable) => variable.key === key);
      return { key, changed: changed.length > 0, value: after?.value ?? value, variable: after };
    },
  },
  {
    name: "admin_delete_variable",
    title: "Clear an instance variable",
    description:
      "Removes a variable's stored value. A setting the app declares falls back to its built-in default — clearing the Resend key stops every invitation email, clearing company_logos turns logos back on — and a variable an admin added disappears entirely. Call admin_list_variables first to see what the default would be, because this is the one settings call with no undo. Recorded in the audit log.",
    inputSchema: object({ key: str("The variable's key, from admin_list_variables") }, ["key"]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: true,
    handler: async (args, ctx) => deleteVariable(ctx.user, required(args, "key")),
  },
];

/** Members never even see the admin tools in tools/list. */

// ---------------------------------------------------------------------------
// Prompts — these surface in Claude as ready-made workflows
// ---------------------------------------------------------------------------

export type McpPrompt = {
  name: string;
  title: string;
  description: string;
  adminOnly?: boolean;
  arguments: { name: string; description: string; required?: boolean }[];
  build: (args: Record<string, string>) => string;
};

export const prompts: McpPrompt[] = [
  {
    name: "tailor_resume",
    title: "Tailor a resume to a job",
    description:
      "Read a job description, mine the knowledge base for the most relevant evidence, and produce a tailored resume.",
    arguments: [
      { name: "job_description", description: "The full job posting", required: true },
      { name: "company", description: "Company name" },
    ],
    build: (args) => `Tailor a resume for this job.

<job_posting company="${args.company ?? ""}">
${args.job_description ?? ""}
</job_posting>

Work in this order:
1. Call get_resume_format so you know the document shape.
2. Pull out the 8-12 requirements the posting actually cares about, in priority order.
3. For each one, call search_me to find real evidence. Do not invent anything — if there is no evidence, say so and leave it out.
4. Call get_me_snapshot for the profile, dates and education you need.
5. Draft the document, then call preview_resume_text to check it lands near one page.
6. Save it. If a base resume already exists (list_resumes shows one), duplicate_resume it and
   update_resume the copy — that records the lineage, so compare_resumes can show what this
   tailoring changed. Otherwise create_resume. Either way name it "<Company> — <Role>" and set
   targetRole/targetCompany.
7. Tell me what you emphasised, what you cut, and which requirements you could not evidence.

Bullets must lead with a strong verb, name the specific scope, and end in a measurable outcome pulled from the background.

Finish with a gap report: which of the posting's requirements the resume evidences, which it half-covers, and which have nothing behind them. Never paper over the third list — it is what the person needs to see.`,
  },
  {
    name: "gap_report",
    title: "Gap report: a posting against Me",
    description:
      "Before tailoring — or before deciding whether to apply at all — check a job posting against the evidence that actually exists in Me. Returns three lists: requirements with real evidence behind them, requirements with only thin or indirect signal, and requirements with nothing. Nothing is written or saved; this is the reading that decides what happens next.",
    arguments: [
      { name: "job_description", description: "The full job posting, or an application id whose stored posting to use" },
    ],
    build: (args) => `Check this posting against what I can actually evidence.

<job_posting>
${args.job_description ?? "No posting pasted — if this looks like an application id, call get_application and use its jobDescription; otherwise ask for the posting."}
</job_posting>

The rule that governs everything here: nothing goes on a resume that the evidence in Me cannot back.
The quiet upgrade — "helped with" becoming "led", a credit becoming a hire — is the way
resumes actually go wrong, and this report exists to make that impossible to do by accident.

1. Pull out the 8-12 requirements the posting actually rewards, in priority order. Read
   past the boilerplate: "5+ years of X" and "strong communication" matter less than the
   two or three lines that describe the actual job.
2. For each requirement, call search_me with the terms a person would have used when
   dumping — the tool searches raw notes, not polished bullets, so search for the work,
   not the buzzword.
3. Sort every requirement into exactly one of three lists:
   BACKED — direct evidence exists. Quote the strongest piece and name the role it came from.
   THIN — something adjacent exists but it would be a stretch to claim the requirement
   outright. Say precisely what exists and what the gap is.
   MISSING — there is nothing on file. Say so plainly.
4. Report the three lists in that order, then say what the report means: roughly how much
   of the posting's core is covered, and whether tailoring is worth it or the fit isn't there.
5. For each MISSING and THIN item, ask one concrete question that would surface the
   evidence if it exists — people forget their own work constantly. Anything they answer
   goes into Me with append_role_background, and then it is BACKED for every future
   application, not just this one.

Never move an item to BACKED to be encouraging. A gap named now costs a rewrite; a gap
discovered in an interview costs the interview.`,
  },
  {
    name: "mine_role_background",
    title: "Mine a role's background into highlights",
    description:
      "Read a role's raw background and distil it into polished, reusable achievement bullets.",
    arguments: [{ name: "role_id", description: "The role id to mine (omit to be asked)" }],
    build: (args) => `Turn a role's raw background into reusable resume bullets.

${args.role_id ? `Use role id ${args.role_id}.` : "Call list_roles first and ask me which role to mine."}

1. Call get_role to read the full background.
2. Call list_highlights for that role so you do not duplicate what already exists.
3. Extract every distinct accomplishment. For each, write one bullet: strong verb, specific scope, quantified outcome. Keep the real numbers from the dump.
4. Rate each 1-5 on strength and tag it for retrieval.
5. Save them in one create_highlights call.
6. Show me the list and flag anything where the dump hints at impact but does not give a number, so I can fill it in.`,
  },
  {
    name: "pipeline_review",
    title: "Weekly pipeline review",
    description: "Review the job search: what is stalled, who needs chasing, what to do next.",
    arguments: [],
    build: () => `Run my weekly job search review.

1. Call diagnose_search FIRST. It tells you which step of the funnel is losing people, and the
   whole review should be built around that answer rather than around the counts.
2. Call pipeline_stats for the shape of the search, and list_follow_ups with withinDays: 7.
3. Call list_applications and list_activities to see what has actually moved.
4. Call list_tasks with done: false.
5. Call list_companies to see who I am talking to, and note any without a website on file.

Then give me:
- A two-line summary of where the search stands.
- Anything stalled: applied over 10 days ago with no movement, or a follow-up date that has passed.
- A prioritised list of what to do this week, most important first, each tied to a specific company.
- Draft the follow-up messages for anything overdue. Use the timeline so each one refers to what
  was actually said — a follow-up that mentions the thing the recruiter told me gets answered.
- Create tasks for the actions I should take, with due dates.

Lead with what diagnose_search found. If it says the problem is the resume or the targeting, do not
give me a list of follow-ups as though volume were the answer — tell me the thing that is broken and
what to do about it this week. Be direct about the bad news; I would rather hear it than have it
phrased kindly. If it says there is not enough data yet, say that and keep the review short.`,
  },
  {
    name: "research_company",
    title: "Research a company into the CRM",
    description:
      "Gather what is known about a company, work out what is missing, and write it back to their record without losing what was already there.",
    arguments: [
      { name: "company", description: "Company name", required: true },
      { name: "focus", description: "Anything specific to dig into, e.g. 'the interview loop'" },
    ],
    build: (args) => `Research ${args.company ?? "this company"} and put what you find on their record.

1. Call list_companies with search: "${args.company ?? ""}" to find their id, then get_company for
   everything already on file — including every application and contact I have there.
2. Tell me what is already known and what is missing.${
      args.focus ? `
3. Focus especially on: ${args.focus}` : ""
    }

Then write it back with update_company. This is the part to get right:

- update_company REPLACES the notes field. Take what get_company returned, combine it with what is
  new, and write the whole thing back. Do not send only the new part.
- Set website to their OWN domain if it is missing — not a Greenhouse, Lever or Ashby link, which
  is the job board rather than the employer. It is what puts their logo on my pipeline.
- Fill industry, size and location if you can.

Worth recording, because it is what I will want the night before an interview: what they actually
do and how they make money, the interview loop if it is known, who I know there, and the honest
version of why I do or do not want this.

Do not invent facts about the company. If you are working from what I have told you, say so; if you
are unsure, mark it as unconfirmed in the notes rather than stating it flatly.`,
  },
  {
    name: "prep_for_interview",
    title: "Prepare for an interview",
    description:
      "Pull the application, the company research, the people involved and my own evidence into one prep sheet.",
    arguments: [
      { name: "company", description: "Company name", required: true },
      { name: "round", description: "Which round, e.g. 'system design', 'final'" },
    ],
    build: (args) => `Get me ready for my${args.round ? ` ${args.round}` : ""} interview at ${args.company ?? "this company"}.

Gather first:
1. list_applications with search: "${args.company ?? ""}", then get_application for the full posting
   and the whole timeline — what has already been said matters more than the posting does.
2. list_companies then get_company for the research on file.
3. list_contacts for that company, so I know who I am meeting and what I know about them.
4. search_me for the two or three themes the posting leans on hardest, so my answers come from
   real work rather than from memory under pressure.

Then give me:
- The three things they most obviously care about, from the posting and the timeline together.
- For each one, the strongest true story I have, with the specific numbers from my background. Do not
  invent a metric — if the number is not on file, say the story without one and tell me to check.
- The questions I am most likely to be asked, and the weak spots in my own history for this role.
- Five questions worth asking them, drawn from the company research rather than generic ones.
- Anything in the timeline I should follow up on or refer back to.

If the research on file is thin, say so and offer to run research_company first.`,
  },
  {
    name: "inbox_review",
    title: "Inbox review: what moved in Gmail and Calendar",
    description:
      "Go through the person's own Gmail and Google Calendar for every open application and every contact with a ping due, find what has happened that the pipeline does not know yet — a reply, a scheduled interview, a rejection, an offer — and propose the logging and stage changes that would bring the pipeline up to date. Nothing is written until they say so. Needs Gmail and Calendar connected under Settings → Connections.",
    arguments: [
      { name: "days", description: "How far back to look. Default 7." },
    ],
    build: (args) => `Bring my pipeline up to date from my inbox and calendar, looking back ${args.days ?? "7"} days.

Work in this order:
1. Call get_google_connection. If nothing is connected, stop and tell me how to connect; do not guess at my mail.
2. Call list_applications (open ones) and list_follow_ups.
3. For each open application, call list_correspondence with its applicationId and days=${args.days ?? "7"}. Where a thread looks like it changed something — a reply from the company, an interview invitation, a rejection, an offer, a take-home — call get_email_thread and read it rather than trusting the snippet.
4. Call search_calendar for the same window forward ${args.days ?? "7"} days too, and note interviews or calls that are on the calendar but not on the pipeline.
5. Tell me, application by application, what moved and quote the line that says so. Be specific about dates and numbers; never round a salary or a deadline.
6. Then propose, as a list I can approve in one word each: the log_activity calls (type INTERVIEW, EMAIL_RECEIVED, REJECTION, OFFER as fits, with the date it happened), the move_application_stage calls, and any nextFollowUpAt that should change. Do NOT call any of them until I say yes.

Skip newsletters, job-board digests and anything automated that does not concern a specific application. If a thread involves a person who is not a contact yet, suggest create_contact with their name and address.`,
  },
  {
    name: "onboard_teammate",
    title: "Invite and onboard someone",
    description: "Invite a person to this instance and walk them through their first steps.",
    adminOnly: true,
    arguments: [
      { name: "email", description: "Who to invite", required: true },
      { name: "role", description: "MEMBER or ADMIN" },
    ],
    build: (args) => `Invite ${args.email ?? "someone"} to this Hired instance.

1. Call admin_get_email_config. If email is not configured, tell me plainly and carry on —
   the invite still works, I will just send the link myself.
2. Call admin_invite_user with email "${args.email ?? ""}"${args.role ? ` and role ${args.role}` : ""}.
3. If emailSent is false, give me the acceptUrl in full and tell me to send it to them.
4. Then write me a short message I can paste to them explaining what this is: a place to
   dump everything about their career, build tailored resumes from it, and track applications
   — and that they connect their own Claude to it from the Settings page once they are in.`,
  },
  {
    name: "log_my_week",
    title: "Log what happened this week",
    description: "Turn a rambling update into structured background entries and pipeline updates.",
    arguments: [{ name: "update", description: "What happened — write it however you like", required: true }],
    build: (args) => `Here is what happened this week. File it properly.

<update>
${args.update ?? ""}
</update>

1. Anything about my current job or a past job → append_role_background on the right role (call list_roles first to find ids). Keep my numbers and specifics.
2. Anything that is a clean accomplishment → also create_highlights so it is resume-ready.
3. Anything about a company I am talking to → log_activity on the application, and move_application_stage if it moved.
4. Anything I said I would do → create_task with a due date.
5. Anything that does not fit a role or a company → create_note.

Then confirm what you filed and where, and ask me about anything that was ambiguous.`,
  },
];

export const promptsByName = new Map(prompts.map((prompt) => [prompt.name, prompt]));

/** Same rule as tools: members never see the admin workflows. */
export function promptsFor(user: { role: UserRole }): McpPrompt[] {
  return isAdmin(user) ? prompts : prompts.filter((prompt) => !prompt.adminOnly);
}

// ---------------------------------------------------------------------------
// The workflows, again, as tools
// ---------------------------------------------------------------------------

/**
 * MCP prompts are a client-optional surface. Tools are not.
 *
 * The workflows above are the most considered design in this file —
 * tailor_resume alone encodes the whole seven-step loop including "do not
 * invent anything" — and in a client that doesn't render prompts they are
 * simply unreachable. That fails this project's own rule: a feature isn't done
 * until it's callable from a conversation.
 *
 * So every prompt is also published as a tool. Calling one returns the same
 * instruction text `prompts/get` would have returned, which the model then
 * follows. This is a wrapper, not a copy — the text lives in exactly one place,
 * so the two surfaces cannot drift.
 */
function promptAsTool(prompt: McpPrompt): McpTool {
  const properties: Json = {};
  for (const argument of prompt.arguments) {
    properties[argument.name] = str(argument.description);
  }
  const requiredArgs = prompt.arguments.filter((a) => a.required).map((a) => a.name);

  return {
    name: prompt.name,
    title: prompt.title,
    description:
      `${prompt.description} Returns a step-by-step plan for this job — follow the steps it gives you, ` +
      `calling the tools it names. This is a workflow, not a data lookup: nothing is read or written until you act on it.`,
    inputSchema: object(properties, requiredArgs),
    // A workflow tool hands back the plan it was always going to hand back.
    // It reads nothing and writes nothing; the tools it names do that.
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    adminOnly: prompt.adminOnly,
    handler: async (args) => {
      const stringArgs: Record<string, string> = {};
      for (const argument of prompt.arguments) {
        const value = s(args, argument.name);
        if (value !== undefined) stringArgs[argument.name] = value;
        else if (argument.required) throw new Error(`Missing required string argument "${argument.name}"`);
      }
      return prompt.build(stringArgs);
    },
  };
}

/** The data tools plus the workflow tools. Order matters only for display. */
export const allTools: McpTool[] = [...tools, ...prompts.map(promptAsTool)];

export function toolsFor(user: { role: UserRole }): McpTool[] {
  return isAdmin(user) ? allTools : allTools.filter((tool) => !tool.adminOnly);
}

export const toolsByName = new Map(allTools.map((tool) => [tool.name, tool]));
