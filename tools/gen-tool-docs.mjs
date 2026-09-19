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
  { file: "connections.mdx", first: "get_digest_settings", last: "delete_connection",
    title: "Your account", icon: "plug",
    blurb: "who you are, the two emails this app can send you, the wiring itself, and getting all of it back out again." },
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
//
// Lives in tool-source.mjs, beside this file, because the tool-choice eval has
// to read tools.ts exactly the way these pages do. Two parsers would drift, and
// the drift checks in there exist because the mirrored constants already did.

import { tools, prompts, promptAdmin, promptBody } from "./tool-source.mjs";


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

{
  /**
   * The manual's section boundaries live in src/lib/mcp/scopes.ts now, because
   * the scopes are built from the same ranges. gen-tool-docs.mjs keeps only
   * what is about pages — file, title, icon, blurb — and this checks that its
   * first/last pairs still agree with the ones the app actually serves. Two
   * copies of a range table is a drift waiting for a new tool to land in the
   * wrong section AND the wrong scope at once.
   */
  const file = readFileSync(join(ROOT, "src", "lib", "mcp", "scopes.ts"), "utf8");
  const block = /export const SECTIONS = \[([\s\S]*?)\] as const;/.exec(file);
  const found = block
    ? [...block[1].matchAll(/key: "(\w+)", first: "(\w+)", last: "(\w+)"/g)].map((m) => `${m[1]}:${m[2]}..${m[3]}`)
    : [];
  if (found.length === 0) throw new Error("Could not read SECTIONS out of src/lib/mcp/scopes.ts");
  const mine = SECTIONS.map((section) => `${section.file.replace(".mdx", "")}:${section.first}..${section.last}`);
  if (found.join("|") !== mine.join("|")) {
    throw new Error(
      `SECTIONS in scopes.ts and gen-tool-docs.mjs disagree.\n  scopes.ts:      ${found.join(", ")}\n  gen-tool-docs: ${mine.join(", ")}`,
    );
  }
}

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
