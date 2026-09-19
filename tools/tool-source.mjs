/**
 * Reading the tool array out of tools.ts, without importing it.
 *
 * `src/lib/mcp/tools.ts` cannot be imported by a script: every handler pulls in
 * the data layer, which pulls in Prisma, which needs a database. So the two
 * things that need to know what tools exist — the manual generator and the
 * tool-choice eval — read the source as text and evaluate only the
 * `inputSchema` expressions, in a scope holding re-implementations of the
 * helpers those expressions call.
 *
 * That re-implementation is a duplicate, and duplicates drift. So every
 * constant mirrored here is checked against its real declaration at import
 * time, and a value added there and not here throws rather than quietly
 * producing a shorter table. Those checks used to live in the generator; they
 * are here now because the eval needs exactly the same reading and two copies
 * of this parser is precisely the failure the checks exist to catch.
 *
 * Keep the helpers in step with the definitions at the top of tools.ts.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src", "lib", "mcp", "tools.ts");

export const src = readFileSync(SOURCE, "utf8");

function slice(from, to) {
  const start = src.indexOf(from);
  const end = src.indexOf(to);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`tools.ts no longer contains "${from}" … "${to}", which this reader depends on`);
  }
  return src.slice(start, end);
}

const body = slice("export const tools: McpTool[] = [", "export const prompts: McpPrompt[] = [");
export const promptBody = src.slice(src.indexOf("export const prompts: McpPrompt[] = ["));


/** Every top-level entry of the array, as its raw source, minus the handler. */
function entries(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== "  {") continue;
    const block = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== "  }," && lines[j] !== "  }") {
      block.push(lines[j]);
      j += 1;
    }
    i = j;
    if (block.some((line) => /^ {4}name: "/.test(line))) out.push(block);
  }
  return out;
}

// The helpers an inputSchema expression calls, reimplemented to return the same
// shapes tools.ts builds. Keep in step with the definitions at the top of it.
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });
const bool = (description) => ({ type: "boolean", description });
const strArray = (description) => ({ type: "array", items: { type: "string" }, description });
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

// Mirrors the list cap in src/lib/mcp/tools.ts. Checked below, like STAGE_VALUES
// and TAG_KINDS, so a change there fails the build of these pages rather than
// quietly documenting the wrong ceiling.
const LIST_CEILING = 500;
const limitArg = (fallback) =>
  num(`Max rows to return. Default ${fallback}, hard ceiling ${LIST_CEILING}. Prefer narrowing the filters.`);

// The constants those expressions close over. Duplicated, then verified against
// the source below — a value added there and not here is an error, not a
// quietly shorter table.
const STAGE_VALUES = ["WISHLIST", "APPLIED", "INTERVIEWING", "OFFER", "ACCEPTED", "LOST"];
const ACTIVITY_VALUES = [
  "NOTE", "STAGE_CHANGE", "EMAIL_SENT", "EMAIL_RECEIVED", "CALL", "INTERVIEW",
  "FOLLOW_UP", "APPLIED", "OFFER", "REJECTION", "REFERRAL", "OUTREACH",
];
const COMPANY_FILTERS = ["active", "applied", "never-applied", "with-contacts"];
const CONTACT_FILTERS = ["ping-due", "with-application", "no-company"];
const TAG_COLORS = ["slate", "blue", "teal", "green", "amber", "red", "violet", "pink"];
const TAG_KINDS = ["APPLICATION", "COMPANY", "CONTACT", "INDUSTRY", "SIZE", "LOCATION", "LOSS"];
const ARCHIVE_KIND_VALUES = ["company", "contact", "application"];
const EXPORT_KINDS = ["companies", "contacts", "applications"];
const COMPANY_SORTS = ["name", "applied", "apps", "people"];
const CONTACT_SORTS = ["name", "company", "ping", "touch"];
const SORT_DIRECTIONS = ["asc", "desc"];
const COMPANY_MISSING = ["website", "industry", "location"];
const CONTACT_MISSING = ["email", "tags"];
const PIPELINE_VIEW_VALUES = ["board", "list", "calendar"];
const COLUMN_LIST_VALUES = ["pipeline", "companies", "contacts"];
// Mirrors PROPOSAL_KINDS in src/lib/data/proposals.ts and PROPOSAL_STATUSES in
// src/lib/mcp/tools.ts. Both checked below.
const PROPOSAL_KINDS = ["LOG_ACTIVITY", "MOVE_STAGE", "CREATE_TASK", "SET_FOLLOW_UP", "CREATE_CONTACT", "CREATE_APPLICATION"];
const PROPOSAL_STATUSES = ["PENDING", "ACCEPTED", "DISMISSED"];
// Mirrors SCOPE_VALUES in src/lib/mcp/scopes.ts, checked below.
const SCOPE_VALUES = ["FULL", "WRITING", "PIPELINE", "READONLY"];
const DIGEST_KINDS = ["weekly", "nudge", "wins"];
// Mirrors LETTER_KINDS in src/lib/data/letters.ts, checked below.
const LETTER_KINDS = ["COVER_LETTER", "OUTREACH", "REFERRAL_ASK", "THANK_YOU", "REPLY", "OTHER"];
// Mirrors the three in src/lib/data/interviews.ts, all checked below.
const INTERVIEW_FORMATS = ["PHONE", "VIDEO", "ONSITE", "TAKE_HOME", "PAIRING", "PANEL", "OTHER"];
const INTERVIEW_OUTCOMES = ["SCHEDULED", "HELD", "PASSED", "REJECTED", "CANCELLED", "NO_SHOW"];
const QUESTION_KINDS = [
  "BEHAVIOURAL", "TECHNICAL", "SYSTEM_DESIGN", "ROLE", "CULTURE", "COMPENSATION", "MINE", "OTHER",
];
// Mirrors REFERRAL_STATUSES in src/lib/data/referrals.ts, checked below.
const REFERRAL_STATUSES = ["ASKED", "AGREED", "SUBMITTED", "DECLINED", "NO_ANSWER"];
// Mirrors SYSTEM_EVENT_SOURCES in src/lib/data/system.ts, checked below.
const SYSTEM_EVENT_SOURCES = [
  "stripe.webhook", "billing.sync", "email.send", "google.signin", "google.data",
  "microsoft.data", "mcp.tool", "mcp.origin", "app",
];

for (const [name, values] of [
  ["ACTIVITY_VALUES", ACTIVITY_VALUES],
  ["COMPANY_FILTERS", COMPANY_FILTERS],
  ["CONTACT_FILTERS", CONTACT_FILTERS],
  ["TAG_COLORS", TAG_COLORS],
  ["TAG_KINDS", TAG_KINDS],
  ["ARCHIVE_KIND_VALUES", ARCHIVE_KIND_VALUES],
  ["EXPORT_KINDS", EXPORT_KINDS],
  ["COMPANY_SORTS", COMPANY_SORTS],
  ["CONTACT_SORTS", CONTACT_SORTS],
  ["SORT_DIRECTIONS", SORT_DIRECTIONS],
  ["COMPANY_MISSING", COMPANY_MISSING],
  ["CONTACT_MISSING", CONTACT_MISSING],
  ["PIPELINE_VIEW_VALUES", PIPELINE_VIEW_VALUES],
  ["COLUMN_LIST_VALUES", COLUMN_LIST_VALUES],
  ["PROPOSAL_STATUSES", PROPOSAL_STATUSES],
  ["DIGEST_KINDS", DIGEST_KINDS],
]) {
  const declared = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(src);
  if (!declared) throw new Error(`tools.ts no longer declares ${name}`);
  const found = [...declared[1].matchAll(/"([A-Za-z_-]+)"/g)].map((m) => m[1]);
  if (found.join(",") !== values.join(",")) {
    throw new Error(`${name} changed in tools.ts (${found.join(", ")}) — update tools/tool-source.mjs`);
  }
}
{
  // The event sources live in the data layer; tools.ts publishes them as an
  // enum. They drifted four behind once, which is what the runtime list and
  // this check are for.
  const system = readFileSync(join(ROOT, "src", "lib", "data", "system.ts"), "utf8");
  const declared = /export const SYSTEM_EVENT_SOURCES = \[([\s\S]*?)\]/.exec(system);
  const found = declared ? [...declared[1].matchAll(/"([a-z.]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== SYSTEM_EVENT_SOURCES.join(",")) {
    throw new Error(
      `SYSTEM_EVENT_SOURCES changed in system.ts (${found.join(", ")}) — update tools/tool-source.mjs`,
    );
  }
}
{
  // The proposal kinds live in the data layer; tools.ts imports them.
  const file = readFileSync(join(ROOT, "src", "lib", "data", "proposals.ts"), "utf8");
  const declared = /export const PROPOSAL_KINDS = \[([\s\S]*?)\]/.exec(file);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== PROPOSAL_KINDS.join(",")) {
    throw new Error(`PROPOSAL_KINDS changed in proposals.ts (${found.join(", ")}) — update tools/tool-source.mjs`);
  }
}
{
  // The four scopes live in src/lib/mcp/scopes.ts, which tools.ts imports.
  const file = readFileSync(join(ROOT, "src", "lib", "mcp", "scopes.ts"), "utf8");
  const declared = /export const SCOPE_VALUES = \[([\s\S]*?)\]/.exec(file);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== SCOPE_VALUES.join(",")) {
    throw new Error(`SCOPE_VALUES changed in scopes.ts (${found.join(", ")}) — update tools/tool-source.mjs`);
  }
}
{
  // The letter kinds live in the data layer; tools.ts imports them.
  const file = readFileSync(join(ROOT, "src", "lib", "data", "letters.ts"), "utf8");
  const declared = /export const LETTER_KINDS = \[([\s\S]*?)\]/.exec(file);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== LETTER_KINDS.join(",")) {
    throw new Error(`LETTER_KINDS changed in letters.ts (${found.join(", ")}) — update tools/tool-source.mjs`);
  }
}
{
  // The three interview enums live in the data layer; tools.ts imports them.
  const referralFile = readFileSync(join(ROOT, "src", "lib", "data", "referrals.ts"), "utf8");
  const declaredReferrals = /export const REFERRAL_STATUSES = \[([\s\S]*?)\]/.exec(referralFile);
  const foundReferrals = declaredReferrals
    ? [...declaredReferrals[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1])
    : [];
  if (foundReferrals.join(",") !== REFERRAL_STATUSES.join(",")) {
    throw new Error(
      `REFERRAL_STATUSES changed in referrals.ts (${foundReferrals.join(", ")}) — update tools/tool-source.mjs`,
    );
  }

  const file = readFileSync(join(ROOT, "src", "lib", "data", "interviews.ts"), "utf8");
  for (const [name, values] of [
    ["INTERVIEW_FORMATS", INTERVIEW_FORMATS],
    ["INTERVIEW_OUTCOMES", INTERVIEW_OUTCOMES],
    ["QUESTION_KINDS", QUESTION_KINDS],
  ]) {
    const declared = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(file);
    const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
    if (found.join(",") !== values.join(",")) {
      throw new Error(
        `${name} changed in interviews.ts (${found.join(", ")}) — update tools/tool-source.mjs`,
      );
    }
  }
}
{
  // The list cap. Mirrored above so the argument tables can be generated without
  // importing TypeScript; checked here so raising it in tools.ts fails this run
  // instead of leaving every "hard ceiling 500" in the manual wrong.
  const declared = /const LIST_CEILING = (\d+);/.exec(src);
  if (!declared) throw new Error("tools.ts no longer declares LIST_CEILING");
  if (Number(declared[1]) !== LIST_CEILING) {
    throw new Error(`LIST_CEILING is ${declared[1]} in tools.ts — update tools/tool-source.mjs`);
  }
}
{
  // STAGES lives in the data layer; tools.ts aliases it as STAGE_VALUES.
  const pipeline = readFileSync(join(ROOT, "src", "lib", "data", "pipeline.ts"), "utf8");
  const declared = /export const STAGES: Stage\[\] = \[([\s\S]*?)\]/.exec(pipeline);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== STAGE_VALUES.join(",")) {
    throw new Error(`STAGES changed in pipeline.ts (${found.join(", ")}) — update tools/tool-source.mjs`);
  }
}

const scope = {
  str, num, bool, strArray, object, limitArg, SYSTEM_EVENT_SOURCES, LETTER_KINDS,
  INTERVIEW_FORMATS, INTERVIEW_OUTCOMES, QUESTION_KINDS, REFERRAL_STATUSES,
  PROPOSAL_KINDS, PROPOSAL_STATUSES, DIGEST_KINDS, SCOPE_VALUES,
  STAGE_VALUES, ACTIVITY_VALUES, COMPANY_FILTERS, CONTACT_FILTERS, TAG_COLORS, TAG_KINDS,
  ARCHIVE_KIND_VALUES, EXPORT_KINDS, COMPANY_SORTS, CONTACT_SORTS, SORT_DIRECTIONS,
  COMPANY_MISSING, CONTACT_MISSING, PIPELINE_VIEW_VALUES, COLUMN_LIST_VALUES,
};
const scopeKeys = Object.keys(scope);
const scopeValues = Object.values(scope);

export const tools = entries(body).map((block) => {
  const text = block.join("\n");
  const name = /^ {4}name: "([a-z_]+)",$/m.exec(text)?.[1];
  const title = /^ {4}title: "(.*?)",$/m.exec(text)?.[1] ?? "";
  // Descriptions are string literals, sometimes concatenated across lines.
  const description = /^ {4}description:\s*\n?\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),\n/m.exec(text)?.[1];
  const schemaSource = text
    .slice(text.indexOf("    inputSchema:"), text.indexOf("    annotations:"))
    .split("inputSchema:")[1]
    .trim()
    .replace(/,$/, "");

  if (!name || !description) throw new Error(`Could not read a name and description out of:\n${text.slice(0, 200)}`);

  return {
    name,
    title,
    description: new Function(`return (${description});`)(),
    schema: new Function(...scopeKeys, `return (${schemaSource});`)(...scopeValues),
    adminOnly: /^ {4}adminOnly: true,$/m.test(text),
    destructive: /destructiveHint: true/.test(text),
    openWorld: /openWorldHint: true/.test(text),
  };
});

export const prompts = [...promptBody.matchAll(/^ {4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
export const promptAdmin = (promptBody.match(/^ {4}adminOnly: true,$/gm) ?? []).length;
if (prompts.length === 0) throw new Error("No prompts found in tools.ts — the workflow counts would be wrong");

{
  // A workflow is a script an assistant follows literally, so a step naming a
  // tool that does not exist is a broken feature rather than a typo — and it
  // shipped that way once: inbox_review opened with "Call get_google_connection",
  // which has never been a tool on this server.
  //
  // Only "Call <name>" is checked, which is the shape every step uses and the
  // one that cannot be confused with an argument name.
  const toolNames = new Set(tools.map((tool) => tool.name));
  const bad = [];
  for (const match of promptBody.matchAll(/\bCall ([a-z][a-z0-9_]+)\b/g)) {
    if (!toolNames.has(match[1])) bad.push(match[1]);
  }
  if (bad.length > 0) {
    throw new Error(
      `A workflow in tools.ts tells the assistant to call ${[...new Set(bad)].join(", ")}, which is not a tool. ` +
        "Fix the prompt body, not this check.",
    );
  }
}
