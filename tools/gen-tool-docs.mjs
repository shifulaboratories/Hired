#!/usr/bin/env node
/**
 * Regenerates the tool tables in docs/tools/*.mdx from src/lib/mcp/tools.ts.
 *
 * The manual documents every argument of every tool. A hundred tools written
 * out by hand is a hundred things to forget when an argument changes, and the
 * README has now had its tool counts wrong twice for exactly that reason — so
 * this reads the array instead.
 *
 * It does not parse TypeScript. Each tool's `inputSchema:` expression is a call
 * to the local `object`/`str`/`num`/`bool`/`strArray` helpers, so this file
 * defines the same helpers and evaluates the expression: what comes out is the
 * real JSON Schema the server sends, not an approximation of it. The enum
 * constants those expressions close over are duplicated below and checked
 * against the source, so a stage added to the Prisma enum and forgotten here
 * fails the run rather than silently shortening a table.
 *
 * Each page keeps its hand-written introduction: everything above the first
 * `### \`` heading is left alone, everything below it is replaced. Write prose
 * in the MDX, arguments in tools.ts, and never the other way round.
 *
 * Like tools/build-site.mjs, this imports nothing. `node tools/gen-tool-docs.mjs`
 * is the whole thing, and `--check` exits non-zero when a page is out of date.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src", "lib", "mcp", "tools.ts");
const DOCS = join(ROOT, "docs", "tools");
const CHECK = process.argv.includes("--check");

/**
 * The seven pages, in the order tools are declared in the array.
 *
 * Ranges rather than name lists: the array is grouped by area already, and a
 * new tool added to a group should land on that group's page without anyone
 * having to come here. `first` is the tool that opens each section — asserted
 * below, so reordering the array is caught rather than silently reshuffling
 * the manual.
 */
const SECTIONS = [
  { file: "me.mdx", first: "search_me", last: "preview_resume_import",
    title: "Me", icon: "user",
    blurb: "roles, backgrounds, highlights, notes, standing rules, the four supporting collections, and importing an existing resume." },
  { file: "resumes.mdx", first: "get_resume_format", last: "preview_resume_text",
    title: "Resumes", icon: "file-lines",
    blurb: "writing documents, previewing them, publishing, exporting." },
  { file: "letters.mdx", first: "prep_letter", last: "delete_letter",
    title: "Letters", icon: "envelope-open-text",
    blurb: "everything you write that is not a resume: cover letters, cold outreach, referral asks, thank-yous, replies." },
  { file: "pipeline.mdx", first: "pipeline_stats", last: "set_column_widths",
    title: "Pipeline", icon: "list-check",
    blurb: "applications, stages, timeline, tasks, follow-ups, views, sharing, diagnosis." },
  { file: "crm.mdx", first: "list_companies", last: "schedule_contact_pings",
    title: "CRM", icon: "building",
    blurb: "companies and the people at them, one at a time or a selection at once." },
  { file: "archive.mdx", first: "list_archive", last: "empty_archive",
    title: "Archive", icon: "trash-can",
    blurb: "what has been deleted, putting it back, and getting rid of it for good." },
  { file: "accounts.mdx", first: "list_linked_accounts", last: "search_calendar",
    title: "Mail & Calendar", icon: "envelope",
    blurb: "the threads and meetings behind any record, read live from your own Google, Microsoft 365 or IMAP and CalDAV accounts." },
  { file: "connections.mdx", first: "whoami", last: "delete_connection",
    title: "Your account", icon: "plug",
    blurb: "who you are, and the wiring itself." },
  { file: "admin.mdx", first: "admin_instance_stats", last: "admin_delete_variable",
    title: "Admin", icon: "shield-halved",
    blurb: "accounts, invitations, the waitlist, sign-in, email, billing, health, configuration." },
];

/**
 * The overview page states the numbers, and it is the only page that does.
 *
 * They have now gone stale four separate times — in the README, twice, and in
 * these pages — because a count written by hand is a count nobody remembers to
 * bump. So the blocks between these markers are generated too, and everywhere
 * else points here rather than repeating a figure.
 */
const OVERVIEW = "overview.mdx";
const MARK = (name) => [`{/* generated:${name} */}`, `{/* /generated:${name} */}`];

// ---------------------------------------------------------------------------
// Reading the array
// ---------------------------------------------------------------------------

const src = readFileSync(SOURCE, "utf8");

function slice(from, to) {
  const start = src.indexOf(from);
  const end = src.indexOf(to);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`tools.ts no longer contains "${from}" … "${to}", which this generator reads`);
  }
  return src.slice(start, end);
}

const body = slice("export const tools: McpTool[] = [", "export const prompts: McpPrompt[] = [");
const promptBody = src.slice(src.indexOf("export const prompts: McpPrompt[] = ["));

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
const PROPOSAL_KINDS = ["LOG_ACTIVITY", "MOVE_STAGE", "CREATE_TASK", "SET_FOLLOW_UP", "CREATE_CONTACT"];
const PROPOSAL_STATUSES = ["PENDING", "ACCEPTED", "DISMISSED"];
// Mirrors LETTER_KINDS in src/lib/data/letters.ts, checked below.
const LETTER_KINDS = ["COVER_LETTER", "OUTREACH", "REFERRAL_ASK", "THANK_YOU", "REPLY", "OTHER"];
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
]) {
  const declared = new RegExp(`${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`).exec(src);
  if (!declared) throw new Error(`tools.ts no longer declares ${name}`);
  const found = [...declared[1].matchAll(/"([A-Za-z_-]+)"/g)].map((m) => m[1]);
  if (found.join(",") !== values.join(",")) {
    throw new Error(`${name} changed in tools.ts (${found.join(", ")}) — update tools/gen-tool-docs.mjs`);
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
      `SYSTEM_EVENT_SOURCES changed in system.ts (${found.join(", ")}) — update tools/gen-tool-docs.mjs`,
    );
  }
}
{
  // The proposal kinds live in the data layer; tools.ts imports them.
  const file = readFileSync(join(ROOT, "src", "lib", "data", "proposals.ts"), "utf8");
  const declared = /export const PROPOSAL_KINDS = \[([\s\S]*?)\]/.exec(file);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== PROPOSAL_KINDS.join(",")) {
    throw new Error(`PROPOSAL_KINDS changed in proposals.ts (${found.join(", ")}) — update tools/gen-tool-docs.mjs`);
  }
}
{
  // The letter kinds live in the data layer; tools.ts imports them.
  const file = readFileSync(join(ROOT, "src", "lib", "data", "letters.ts"), "utf8");
  const declared = /export const LETTER_KINDS = \[([\s\S]*?)\]/.exec(file);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== LETTER_KINDS.join(",")) {
    throw new Error(`LETTER_KINDS changed in letters.ts (${found.join(", ")}) — update tools/gen-tool-docs.mjs`);
  }
}
{
  // The list cap. Mirrored above so the argument tables can be generated without
  // importing TypeScript; checked here so raising it in tools.ts fails this run
  // instead of leaving every "hard ceiling 500" in the manual wrong.
  const declared = /const LIST_CEILING = (\d+);/.exec(src);
  if (!declared) throw new Error("tools.ts no longer declares LIST_CEILING");
  if (Number(declared[1]) !== LIST_CEILING) {
    throw new Error(`LIST_CEILING is ${declared[1]} in tools.ts — update tools/gen-tool-docs.mjs`);
  }
}
{
  // STAGES lives in the data layer; tools.ts aliases it as STAGE_VALUES.
  const pipeline = readFileSync(join(ROOT, "src", "lib", "data", "pipeline.ts"), "utf8");
  const declared = /export const STAGES: Stage\[\] = \[([\s\S]*?)\]/.exec(pipeline);
  const found = declared ? [...declared[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]) : [];
  if (found.join(",") !== STAGE_VALUES.join(",")) {
    throw new Error(`STAGES changed in pipeline.ts (${found.join(", ")}) — update tools/gen-tool-docs.mjs`);
  }
}

const scope = {
  str, num, bool, strArray, object, limitArg, SYSTEM_EVENT_SOURCES, LETTER_KINDS,
  PROPOSAL_KINDS, PROPOSAL_STATUSES,
  STAGE_VALUES, ACTIVITY_VALUES, COMPANY_FILTERS, CONTACT_FILTERS, TAG_COLORS, TAG_KINDS,
  ARCHIVE_KIND_VALUES, EXPORT_KINDS, COMPANY_SORTS, CONTACT_SORTS, SORT_DIRECTIONS,
  COMPANY_MISSING, CONTACT_MISSING, PIPELINE_VIEW_VALUES, COLUMN_LIST_VALUES,
};
const scopeKeys = Object.keys(scope);
const scopeValues = Object.values(scope);

const tools = entries(body).map((block) => {
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

// ---------------------------------------------------------------------------
// Writing the pages
// ---------------------------------------------------------------------------

const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();

function typeName(property) {
  if (property.type === "array") {
    const item = property.items ?? {};
    return item.type === "object" ? "object[]" : `${item.type ?? "string"}[]`;
  }
  if (property.enum) return "enum";
  return property.type ?? "object";
}

function render(tool) {
  const properties = tool.schema.properties ?? {};
  const required = new Set(tool.schema.required ?? []);
  const flags = [
    tool.adminOnly && "**Admin only.**",
    tool.destructive && "**Overwrites or deletes.**",
    tool.openWorld && "**Reaches outside this instance.**",
  ].filter(Boolean);

  const lines = [`### \`${tool.name}\``, "", `_${tool.title}_`, "", tool.description, ""];
  if (flags.length) lines.push(flags.join(" "), "");

  const names = Object.keys(properties);
  if (!names.length) return [...lines, "No arguments.", ""].join("\n");

  lines.push("| Argument | Type | |", "| --- | --- | --- |");
  for (const key of names) {
    const property = properties[key];
    let note = cell(property.description);
    if (property.enum) note = `${note ? `${note}  ` : ""}\`${property.enum.join("` · `")}\``;
    if (required.has(key)) note = note ? `**required** — ${note}` : "**required**";
    lines.push(`| \`${key}\` | ${typeName(property)} | ${note} |`);
  }
  return [...lines, ""].join("\n");
}

/**
 * The count each page's frontmatter opens with — "Twelve tools over…".
 *
 * Written as a word because that is how the prose reads, and taken back by the
 * generator because all six of them had drifted: the frontmatter sits above
 * the first "### `" heading, so it was the one number on these pages nothing
 * owned. Only the leading word moves. The rest of the sentence stays yours.
 */
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function spell(n) {
  if (n < 0 || n > 99) throw new Error(`No spelling for ${n} — this generator counts tools, not stars`);
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = n % 10;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}

const COUNT_WORD = /^(description: ")[A-Za-z-]+( tools?\b)/m;

let stale = 0;
let cursor = 0;

for (const section of SECTIONS) {
  if (tools[cursor]?.name !== section.first) {
    throw new Error(`Expected ${section.file} to start at ${section.first}, found ${tools[cursor]?.name}`);
  }
  const end = tools.findIndex((tool, i) => i >= cursor && tool.name === section.last);
  if (end < 0) throw new Error(`${section.last} is no longer in tools.ts, so ${section.file} has no end`);

  const owned = tools.slice(cursor, end + 1);
  section.count = owned.length;
  cursor = end + 1;

  const path = join(DOCS, section.file);
  const page = readFileSync(path, "utf8");
  const marker = page.indexOf("### `");
  if (marker < 0) throw new Error(`${section.file} has no generated section to replace`);

  if (!COUNT_WORD.test(page)) {
    throw new Error(`${section.file}'s frontmatter no longer opens with a spelled-out tool count`);
  }
  const head = page
    .slice(0, marker)
    .replace(COUNT_WORD, (_, before, after) => {
      const word = spell(owned.length);
      return `${before}${word[0].toUpperCase()}${word.slice(1)}${after}`;
    });
  const next = head + owned.map(render).join("\n");
  if (next === page) {
    console.log(`  ${relative(ROOT, path)}  ${owned.length} tools, unchanged`);
    continue;
  }
  stale += 1;
  if (CHECK) {
    console.error(`  ${relative(ROOT, path)}  OUT OF DATE`);
    continue;
  }
  writeFileSync(path, next);
  console.log(`  ${relative(ROOT, path)}  ${owned.length} tools, rewritten`);
}

if (cursor !== tools.length) {
  throw new Error(`${tools.length - cursor} tools after ${SECTIONS.at(-1).last} have no page: ${tools.slice(cursor).map((t) => t.name).join(", ")}`);
}

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

const prompts = [...promptBody.matchAll(/^ {4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
const promptAdmin = (promptBody.match(/^ {4}adminOnly: true,$/gm) ?? []).length;
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

const counts = {
  dataMember: tools.filter((tool) => !tool.adminOnly).length,
  dataAdmin: tools.length,
  flowMember: prompts.length - promptAdmin,
  flowAdmin: prompts.length,
};
counts.listMember = counts.dataMember + counts.flowMember;
counts.listAdmin = counts.dataAdmin + counts.flowAdmin;

const blocks = {
  counts: [
    "| | Member | Admin |",
    "| --- | --- | --- |",
    `| Data tools | ${counts.dataMember} | ${counts.dataAdmin} |`,
    `| Workflows, also published as tools | ${counts.flowMember} | ${counts.flowAdmin} |`,
    `| **What \`tools/list\` returns** | **${counts.listMember}** | **${counts.listAdmin}** |`,
  ].join("\n"),

  areas: [
    "<CardGroup cols={3}>",
    ...SECTIONS.map((section) => [
      `  <Card title="${section.title}" icon="${section.icon}" href="/tools/${section.file.replace(/\.mdx$/, "")}">`,
      `    ${section.count} tools · ${section.blurb}`,
      "  </Card>",
    ].join("\n")),
    "</CardGroup>",
    "",
    `That is ${counts.dataAdmin}. The remaining ${counts.flowAdmin} are the [workflows](/workflows), which are`,
    "published as tools as well as prompts — so they appear in `tools/list` alongside everything",
    "above, and are documented on their own page rather than here.",
  ].join("\n"),
};

{
  const path = join(DOCS, OVERVIEW);
  let page = readFileSync(path, "utf8");
  for (const [name, body] of Object.entries(blocks)) {
    const [open, close] = MARK(name);
    const from = page.indexOf(open);
    const to = page.indexOf(close);
    if (from < 0 || to < 0) throw new Error(`${OVERVIEW} has no ${open} … ${close} block to fill`);
    page = page.slice(0, from + open.length) + "\n" + body + "\n" + page.slice(to);
  }
  const current = readFileSync(path, "utf8");
  if (page !== current) {
    stale += 1;
    if (CHECK) console.error(`  ${relative(ROOT, path)}  COUNTS OUT OF DATE`);
    else {
      writeFileSync(path, page);
      console.log(`  ${relative(ROOT, path)}  counts rewritten`);
    }
  }
}

console.log(
  `\n${counts.dataAdmin} tools and ${counts.flowAdmin} workflows — tools/list returns ` +
    `${counts.listMember} for a member, ${counts.listAdmin} for an admin.`,
);

if (CHECK && stale) {
  console.error("\nRun `node tools/gen-tool-docs.mjs` and commit the result.");
  process.exit(1);
}
