/**
 * The rules that decide what reaches a document, pinned.
 *
 *   npm run check
 *
 * Plain node:test over the modules that have no imports worth mocking — Node
 * strips their types itself, so there is no build, no runner and no
 * dependency here. Needs Node 22.18 or later for that (package.json engines
 * says so).
 *
 * Every case is a bug that was real once, or the rule that stops one. When a
 * rule here changes on purpose, change the case in the same commit; when a
 * case fails and the rule was not meant to change, the change is the bug.
 *
 * What this cannot see: a CALLER that skips a correct rule. That needs a
 * database, and lives in tools/probe.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appendToBackground,
  parseBackground,
  resumeEvidence,
  sectionKind,
} from "../src/lib/background.ts";
import { POLICY_FLOOR, KEYWORD_POLICIES, policyInstruction, readPolicy } from "../src/lib/keyword-policy.ts";
import { STALE_AFTER, hasGoneQuiet } from "../src/lib/quiet.ts";
import { parseAmount } from "../src/lib/money.ts";
import { assertPublicUrl, blockedAddress } from "../src/lib/safe-fetch.ts";
import { parseResumeDocStrict, parseResumeDoc } from "../src/lib/resume-schema.ts";

// --- Background sections ---------------------------------------------------

test("an indented marker under a bullet ends at the next bullet", () => {
  const text = [
    "- Ran distribution for the label",
    "  FRAMING RULE: say engineered, never got him hired",
    "- Shipped the release calendar",
    "- Grew the list to 4,000",
  ].join("\n");
  const evidence = resumeEvidence(text);
  assert.match(evidence, /release calendar/);
  assert.match(evidence, /4,000/);
  assert.doesNotMatch(evidence, /FRAMING RULE/);
});

test("OPEN SOURCE is a phrase, not an open question", () => {
  const evidence = resumeEvidence("- Maintained an OPEN SOURCE plugin with 300 stars");
  assert.match(evidence, /300 stars/);
});

test("a reserved heading is matched by kind, whatever it is called", () => {
  assert.equal(sectionKind("Naming rule (resolved 2026-08-17)"), "rules");
  assert.equal(sectionKind("Caveats"), "caveats");
  assert.equal(sectionKind("Open questions"), "open");
  assert.equal(sectionKind("What I did"), "evidence");
});

test("appending under Rules joins the rules section that is already there", () => {
  const doc = "- Did a thing\n\n## Naming rule (resolved 2026-08-17)\n- Say label, not company\n";
  const next = appendToBackground(doc, "- Never say intern", "Rules");
  assert.equal((next.match(/^## /gm) ?? []).length, 1, "no second rules heading");
  assert.match(next, /Never say intern/);
});

test("appending with no heading is evidence, never inside a trailing reserved section", () => {
  const doc = "- Did a thing\n\n## Caveats\n- Tenure is short\n";
  const next = appendToBackground(doc, "- Led the migration");
  const caveats = parseBackground(next).filter((section) => section.kind === "caveats");
  assert.ok(caveats.every((section) => !section.body.includes("Led the migration")));
  assert.match(resumeEvidence(next), /Led the migration/);
});

test("appending splices; it does not rewrite what was there", () => {
  const doc = "Intro line   with  odd   spacing\n\n- First\n";
  const next = appendToBackground(doc, "- Second");
  assert.ok(next.startsWith(doc.trimEnd()), "the original text survives byte for byte");
});

// --- Keyword policy --------------------------------------------------------

test("every keyword policy carries the no-fabrication floor", () => {
  for (const policy of KEYWORD_POLICIES) assert.ok(policyInstruction(policy).includes(POLICY_FLOOR), policy);
});

test("an unknown keyword policy reads as the default", () => {
  assert.equal(readPolicy("nonsense"), "MATCH");
  assert.equal(readPolicy(null), "MATCH");
});

// --- Quiet -----------------------------------------------------------------

test("a wishlist row and a closed row are never quiet", () => {
  const terminal = ["ACCEPTED", "LOST"];
  assert.equal(hasGoneQuiet("WISHLIST", 400, terminal), false);
  assert.equal(hasGoneQuiet("LOST", 400, terminal), false);
  assert.equal(hasGoneQuiet("APPLIED", STALE_AFTER.APPLIED ?? 21, terminal), true);
});

// --- Money -----------------------------------------------------------------

test("offer amounts: the shapes people send, and the two that are refused", () => {
  assert.equal(parseAmount("215k", "Base"), 215000);
  assert.equal(parseAmount("$215,000", "Base"), 215000);
  assert.equal(parseAmount(215000, "Base"), 215000);
  assert.equal(parseAmount("", "Base"), undefined);
  assert.throws(() => parseAmount("€215.000", "Base"), /ambiguous/);
  assert.throws(() => parseAmount("$", "Base"), /not a number/);
});

// --- Outbound fetch guard --------------------------------------------------

test("addresses inside a network are blocked, public ones are not", () => {
  for (const inside of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(blockedAddress(inside), true, inside);
  }
  for (const outside of ["8.8.8.8", "140.82.112.3", "2606:4700::1111"]) assert.equal(blockedAddress(outside), false, outside);
});

test("names that only resolve inside a network are refused before any lookup", () => {
  for (const url of ["http://localhost/x", "http://db:5432/", "https://169.254.169.254/", "https://[::1]/", "https://svc.internal/", "https://printer.local/"]) {
    assert.throws(() => assertPublicUrl(url), /inside a network/, url);
  }
  assert.throws(() => assertPublicUrl("http://example.com/cv.pdf", { httpsOnly: true }), /https/);
  assert.equal(assertPublicUrl("boards.greenhouse.io/acme").hostname, "boards.greenhouse.io");
});

// --- The resume document ---------------------------------------------------

test("a malformed resume is refused with the field, never saved as a blank one", () => {
  const bad = { sections: [{ kind: "experience", experience: [{ company: "Acme", isCurrent: "true" }] }] };
  assert.throws(() => parseResumeDocStrict(bad), /sections\[0\]\.experience\[0\]\.isCurrent/);
  assert.throws(() => parseResumeDocStrict({ sections: [{ kind: "nonsense" }] }), /sections\[0\]\.kind/);
});

test("a null in a resume means empty, not an error", () => {
  const doc = parseResumeDocStrict({
    header: { name: "Sam", phone: null },
    sections: [{ kind: "experience", experience: [{ company: "Acme", endDate: null, bullets: ["Led it", null] }] }],
  });
  assert.equal(doc.header.phone, "");
  assert.equal(doc.sections[0].experience[0].endDate, "");
  assert.deepEqual(doc.sections[0].experience[0].bullets, ["Led it"]);
});

test("reading a damaged stored row still opens, as an empty document", () => {
  assert.equal(parseResumeDoc({ sections: "nope" }).sections.length > 0, true);
});
