/**
 * Does an assistant reach for the right tool?
 *
 * The whole product rests on an answer nobody has ever measured. A person says
 * "I also ran the on-call rotation at Acme" and a connected assistant either
 * calls `append_role_background`, which adds a line, or `update_role`, which
 * replaces the background and deletes three years of notes. The difference is
 * one paragraph of English in a description. There is no type system for that
 * and no build step catches it.
 *
 * So this script sends the real tool array — the same names, descriptions and
 * schemas a client is served — with each prompt in eval-cases.mjs, and records
 * which tool comes back. Nothing is executed: `tool_choice` is left on `auto`
 * and the loop stops at the first `tool_use` block. It reads no database and
 * writes nothing.
 *
 * It is NOT in the build, and must never be. It costs real money, it needs a
 * network, and it is non-deterministic in the small — two runs of the same
 * suite will not agree on every case, which is a property of what is being
 * measured rather than a bug. Run it after changing a description, and compare
 * the score against the run before.
 *
 *   node tools/eval-tool-choice.mjs                 # everything
 *   node tools/eval-tool-choice.mjs --only=append   # cases whose prompt matches
 *   node tools/eval-tool-choice.mjs --admin         # as an admin (all 190 tools)
 *   node tools/eval-tool-choice.mjs --model=claude-sonnet-5
 *   node tools/eval-tool-choice.mjs --runs=3        # each case N times, majority
 *   node tools/eval-tool-choice.mjs --json=out.json
 *
 * With no credentials it prints what it would have done and exits 0 — loudly,
 * so a CI that ever does run it cannot read silence as a pass.
 */

import { writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { tools as allTools, prompts as promptNames } from "./tool-source.mjs";
import { CASES, NO_TOOL_CASES } from "./eval-cases.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const MODEL = flag("model", "claude-opus-5");
const RUNS = Math.max(1, Number(flag("runs", "1")) || 1);
const ONLY = flag("only");
const AS_ADMIN = has("admin");
const JSON_OUT = flag("json");

/**
 * The briefing every client gets on connect, trimmed to what routing depends on.
 *
 * Kept SHORT and kept here rather than imported from handler.ts, which is
 * TypeScript and drags in the data layer. That is a duplicate and it will
 * drift — deliberately tolerated, because the alternative is either compiling
 * the app to run an eval or measuring routing without the context a real client
 * has, and the second is worse. If a routing rule in handler.ts starts carrying
 * real weight, copy the sentence down here and note it in the commit.
 */
const SYSTEM = `You are connected to Hired, one person's career knowledge base, resume builder and
job-search CRM. You are connected as them; every tool reads and writes only their data.

Rules that are never optional:
- Never invent experience, employers, dates or metrics.
- update_resume and update_role REPLACE what you send. Read first, modify, then write back whole.
  append_role_background adds instead of overwriting.
- Deleting a company, contact or application archives it; everything else is gone for good.

Call a tool when the request is about this person's material, their documents or their search.
Answer directly, with no tool call, when it is small talk, a general-knowledge question, or a
question about how this product works.`;

/** The tool array as the API wants it — the same shape tools/list serves. */
function toolsForApi() {
  const usable = AS_ADMIN ? allTools : allTools.filter((tool) => !tool.adminOnly);
  return usable.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.schema,
  }));
}

/**
 * A workflow is published as a tool as well as a prompt, so a client sees both.
 * The cases name several of them (`tailor_resume`, `pipeline_review`), and
 * scoring a case as wrong because the eval did not offer the tool it asked for
 * would be measuring this script rather than the descriptions.
 */
function workflowTools() {
  return promptNames.map((name) => ({
    name,
    description: `Workflow: ${name.replace(/_/g, " ")}. Returns a step-by-step plan that you then follow.`,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  }));
}

const API_TOOLS = [...toolsForApi(), ...workflowTools()];

/** Which tool a response reached for, or null when it answered in words. */
function firstToolUse(message) {
  for (const block of message.content ?? []) {
    if (block.type === "tool_use") return block.name;
  }
  return null;
}

function verdictFor(picked, testCase) {
  if (testCase.noTool) return picked === null ? "pass" : "fail";
  if (picked === null) return "fail";
  if (testCase.avoid?.includes(picked)) return "trap";
  return testCase.expect.includes(picked) ? "pass" : "fail";
}

/** The majority answer across N runs, and how often it was reached. */
function majority(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  let most = 0;
  for (const [value, n] of counts) {
    if (n > most) {
      best = value;
      most = n;
    }
  }
  return { value: best, agreement: most / values.length };
}

async function main() {
  const cases = [
    ...CASES.map((c) => ({ ...c, noTool: false })),
    ...NO_TOOL_CASES.map((c) => ({ ...c, expect: [], noTool: true })),
  ].filter((c) => {
    if (c.adminOnly && !AS_ADMIN) return false;
    if (!ONLY) return true;
    const needle = ONLY.toLowerCase();
    return (
      c.prompt.toLowerCase().includes(needle) ||
      (c.expect ?? []).some((n) => n.includes(needle)) ||
      (c.avoid ?? []).some((n) => n.includes(needle))
    );
  });

  const calls = cases.length * RUNS;
  console.log(`${API_TOOLS.length} tools, ${cases.length} cases, ${RUNS} run(s) — ${calls} API calls to ${MODEL}.`);
  console.log("This spends real money. Roughly one cheap request per call, and the tool array is large.\n");

  // Credentials are not checked by looking for an env var: the SDK also reads a
  // profile written by `ant auth login`, and a script that skipped whenever
  // ANTHROPIC_API_KEY happened to be unset would skip on a perfectly working
  // machine. So it tries, and treats only a real authentication failure as
  // "there are no credentials here".
  const client = new Anthropic();
  try {
    await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.log("SKIPPED: no usable credentials — set ANTHROPIC_API_KEY or run `ant auth login`.");
      console.log("Nothing was measured. This is NOT a pass.");
      return;
    }
    if (error instanceof Anthropic.APIConnectionError) {
      console.log("SKIPPED: could not reach the API. Nothing was measured. This is NOT a pass.");
      return;
    }
    // With nothing at all configured the SDK refuses before it sends anything,
    // and that refusal is a plain Error rather than one of the typed classes —
    // so this is matched on its message. The alternative is re-implementing the
    // SDK's whole credential-resolution order here, which would be a copy that
    // goes stale the next time it gains a source.
    if (error instanceof Error && /Could not resolve authentication method/.test(error.message)) {
      console.log("SKIPPED: no credentials configured — set ANTHROPIC_API_KEY or run `ant auth login`.");
      console.log("Nothing was measured. This is NOT a pass.");
      return;
    }
    // Anything else — a bad model id, a 400 — is a real problem worth seeing.
    throw error;
  }

  const results = [];

  for (const testCase of cases) {
    const picks = [];
    for (let run = 0; run < RUNS; run += 1) {
      let picked;
      try {
        const message = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          system: SYSTEM,
          tools: API_TOOLS,
          messages: [{ role: "user", content: testCase.prompt }],
        });
        picked = firstToolUse(message);
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError) {
          console.error("  rate limited — waiting 20s");
          await new Promise((resolve) => setTimeout(resolve, 20_000));
          run -= 1;
          continue;
        }
        if (error instanceof Anthropic.APIError) {
          console.error(`  API error ${error.status}: ${error.message}`);
          picked = null;
        } else {
          throw error;
        }
      }
      picks.push(picked);
    }

    const { value: picked, agreement } = majority(picks);
    const verdict = verdictFor(picked, testCase);
    results.push({ ...testCase, picked, agreement, verdict, picks });

    const mark = { pass: "ok  ", fail: "MISS", trap: "TRAP" }[verdict];
    const shown = picked ?? "(no tool)";
    const wanted = testCase.noTool ? "(no tool)" : testCase.expect.join(" | ");
    const stability = RUNS > 1 && agreement < 1 ? `  [${Math.round(agreement * 100)}% agreement]` : "";
    console.log(`${mark}  ${shown.padEnd(26)} want ${wanted}${stability}`);
    if (verdict !== "pass") console.log(`      "${testCase.prompt}"\n      ${testCase.why}`);
  }

  const passed = results.filter((r) => r.verdict === "pass").length;
  const trapped = results.filter((r) => r.verdict === "trap");

  console.log(`\n${passed}/${results.length} correct.`);
  if (trapped.length) {
    console.log(`\n${trapped.length} landed on the tool the case was written to catch:`);
    for (const r of trapped) console.log(`  ${r.picked} — ${r.why}`);
  }

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ model: MODEL, runs: RUNS, results }, null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }

  // A trap is worse than a miss: it means a description actively points the
  // wrong way. Both fail the run, so a wrapper can gate on the exit code.
  if (passed !== results.length) process.exitCode = 1;
}

await main();
