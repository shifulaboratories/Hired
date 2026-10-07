/**
 * The guarantees only a real database can show, run against one.
 *
 *   DATABASE_URL=postgresql://…/hired_probe npm run probe
 *
 * tools/rules.test.mjs pins the pure rules. This pins what their CALLERS do
 * with them: that every read of an archived application leaves it out, that
 * one person's queued proposal cannot write another person's row, that a save
 * from a stale editor is refused, that parallel appends all land. Each of
 * those has broken once with every pure rule still correct.
 *
 * It REFUSES any database whose name does not contain "probe", because it
 * creates and deletes accounts. Run `npx prisma migrate deploy` against that
 * database first. Every account it makes is @probe.invalid and is deleted in
 * `finally`, cascading everything it owned.
 *
 * Run it when src/lib/data/, src/lib/mcp/ or prisma/ changes. It is part of the
 * gate in CLAUDE.md.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!dbName.includes("probe")) {
  console.error(`Refusing to run against "${dbName}": the probe only touches a database whose name contains "probe".`);
  process.exit(2);
}

const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const load = (file) => jiti.import(path.join(root, "src/lib", file));

const { db } = await load("db.ts");
const me = await load("data/me.ts");
const resumes = await load("data/resumes.ts");
const pipeline = await load("data/pipeline.ts");
const archive = await load("data/archive.ts");
const offers = await load("data/offers.ts");
const letters = await load("data/letters.ts");
const proposals = await load("data/proposals.ts");
const share = await load("data/pipeline-share.ts");
const views = await load("data/views.ts");
const analytics = await load("data/analytics.ts");
const revisions = await load("data/revisions.ts");
const store = await load("data/revision-store.ts");
const waitlist = await load("data/waitlist.ts");

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function ok(condition, message) {
  if (!condition) throw new Error(message);
}
async function refuses(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    if (pattern && !pattern.test(String(error?.message ?? error))) throw new Error(`refused, but with: ${error?.message}`);
    return;
  }
  throw new Error("did not refuse");
}

const stamp = Date.now().toString(36);
const made = [];
async function person(label) {
  const user = await db.user.create({
    data: { email: `${label}-${stamp}@probe.invalid`, name: `Probe ${label}`, passwordHash: "x", isActive: true },
  });
  made.push(user.id);
  return user;
}
const MCP = { writtenBy: "mcp", connectionId: "probe", connectionName: "Probe", tool: "probe" };

try {
  const a = await person("a");
  const b = await person("b");

  // --- Writes that used to lose a document --------------------------------
  const resume = await resumes.createResume(a.id, {
    name: "Acme — Product Lead",
    data: { header: { name: "Sam Probe" }, sections: [{ kind: "summary", text: "Original" }] },
  });

  await check("a malformed resume write is refused and the document survives", async () => {
    await refuses(resumes.updateResume(a.id, resume.id, { data: { sections: [{ kind: "nope" }] } }), /sections\[0\]\.kind/);
    const after = await resumes.getResume(a.id, resume.id);
    ok(after.doc.sections[0]?.text === "Original", "the document changed");
  });

  await check("a stale editor save is refused once an assistant has written", async () => {
    const loaded = (await db.resume.findUnique({ where: { id: resume.id } })).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await resumes.updateResume(a.id, resume.id, { data: { sections: [{ kind: "summary", text: "From the assistant" }] } }, MCP);
    await refuses(
      resumes.updateResume(a.id, resume.id, { data: { sections: [{ kind: "summary", text: "Stale tab" }] } }, undefined, { expectedUpdatedAt: loaded }),
      /changed since it was opened/,
    );
    const after = await resumes.getResume(a.id, resume.id);
    ok(after.doc.sections[0].text === "From the assistant", "the stale save landed");
  });

  await check("publishing keeps the version, so the editor's next save is not refused", async () => {
    const before = (await db.resume.findUnique({ where: { id: resume.id } })).updatedAt;
    const published = await resumes.publishResume(a.id, resume.id);
    ok(published.updatedAt.getTime() === before.getTime(), "publish bumped updatedAt");
    ok(!published.slug.includes("acme"), "the slug carries the private document name");
  });

  await check("a suspended owner's published resume stops serving, and comes back", async () => {
    const slug = (await db.resume.findUnique({ where: { id: resume.id } })).slug;
    ok(await resumes.getResumeBySlug(slug), "not served while active");
    await db.user.update({ where: { id: a.id }, data: { isActive: false } });
    ok((await resumes.getResumeBySlug(slug)) === null, "served while suspended");
    await db.user.update({ where: { id: a.id }, data: { isActive: true } });
    ok(await resumes.getResumeBySlug(slug), "not served after reactivation");
  });

  const role = await me.createRole(a.id, { company: "Acme", title: "Lead", background: "- Started here\n" });

  await check("three appends at once all land", async () => {
    await Promise.all(["- One", "- Two", "- Three"].map((text) => me.appendToRoleBackground(a.id, role.id, text, undefined, MCP)));
    const after = await me.getRole(a.id, role.id);
    for (const text of ["One", "Two", "Three"]) ok(after.background.includes(text), `lost "${text}"`);
  });

  await check("a heading written only if it is not already the last one, under the lock", async () => {
    await Promise.all(["- Win A", "- Win B"].map((text) =>
      me.appendToRoleBackground(a.id, role.id, text, "October 2026", MCP, { headingIfNew: true })));
    const after = await me.getRole(a.id, role.id);
    ok((after.background.match(/^## October 2026$/gm) ?? []).length === 1, "two headings for one month");
  });

  await check("an assistant's write gets its own version beside the editor's", async () => {
    await me.updateRole(a.id, role.id, { summary: "typed in the app" });
    await me.updateRole(a.id, role.id, { summary: "written by an assistant" }, MCP);
    const rows = await db.revision.findMany({ where: { recordId: role.id }, orderBy: { createdAt: "desc" } });
    ok(rows.some((row) => row.writtenBy === "mcp"), "no assistant version");
    ok(rows.some((row) => row.writtenBy === "app"), "no app version");
  });

  await check("the change log offers undo only for versioned writes to records that exist", async () => {
    await store.recordWrite({ userId: a.id, connectionId: "probe", connectionName: "Probe", tool: "update_role", summary: "x", recordId: role.id, versioned: true });
    await store.recordWrite({ userId: a.id, connectionId: "probe", connectionName: "Probe", tool: "export_resume_pdf", summary: "x", recordId: resume.id, versioned: false });
    const changes = await revisions.listChanges(a.id);
    ok(changes.find((row) => row.tool === "update_role")?.undoable === true, "versioned role write not undoable");
    ok(changes.find((row) => row.tool === "export_resume_pdf")?.undoable === false, "an export is offered as undoable");
    const doomed = await me.createRole(a.id, { company: "Gone", title: "Temp", background: "" });
    await me.updateRole(a.id, doomed.id, { summary: "x" }, MCP);
    await store.recordWrite({ userId: a.id, connectionId: "probe", connectionName: "Probe", tool: "update_role", summary: "x", recordId: doomed.id, versioned: true });
    await me.deleteRole(a.id, doomed.id);
    const later = await revisions.listChanges(a.id);
    ok(later.filter((row) => row.recordId === doomed.id).every((row) => row.undoable === false), "a deleted role is offered as undoable");
  });

  // --- Capture and companies ------------------------------------------------
  await check("the same job is not put on the board twice", async () => {
    const first = await pipeline.createApplicationIfNew(a.id, { company: "Globex", roleTitle: "Staff PM", stage: "WISHLIST" });
    const second = await pipeline.createApplicationIfNew(a.id, { company: "globex", roleTitle: "staff pm", stage: "WISHLIST" });
    ok(first.created && !second.created && second.existingId === first.application.id, "a duplicate was created");
  });

  await check("a guessed website never replaces one on file", async () => {
    await pipeline.upsertCompanyByName(a.id, "Initech", { website: "initech.com" });
    const again = await pipeline.upsertCompanyByName(a.id, "Initech", { website: "greenhouse.io" });
    ok(again.website === "initech.com", `website became ${again.website}`);
  });

  // --- Tenancy ----------------------------------------------------------------
  const apps = await pipeline.createApplicationIfNew(a.id, { company: "Hooli", roleTitle: "Director", stage: "APPLIED" });
  const appId = apps.application.id;

  await check("one person's proposal cannot move another person's application", async () => {
    const queued = await proposals.proposeChanges(b.id, [
      { kind: "MOVE_STAGE", summary: "move it", payload: { applicationId: appId, stage: "LOST" } },
    ]);
    const id = queued.queued[0]?.id;
    if (id) await refuses(proposals.acceptProposal(b.id, id));
    const row = await db.application.findUnique({ where: { id: appId } });
    ok(row.stage === "APPLIED", "another account moved this application");
  });

  // --- Archive ----------------------------------------------------------------
  await check("an archived application leaves every read", async () => {
    await offers.recordOffer(a.id, appId, { currency: "USD", baseAmount: "200k", respondBy: "2099-01-01" });
    await letters.createLetter(a.id, { kind: "COVER_LETTER", title: "Cover", body: "Hi", applicationId: appId });
    await pipeline.createTask(a.id, { title: "Chase", applicationId: appId, dueAt: "2099-01-01" });
    await share.sharePipeline(a.id, { includeClosed: true });
    const slug = (await share.getPipelineShare(a.id))?.slug;
    await archive.archiveRecords(a.id, "application", [appId]);

    ok(!(await pipeline.listApplications(a.id, { includeClosed: true })).some((row) => row.id === appId), "listApplications");
    ok((await pipeline.getApplication(a.id, appId)) === null, "getApplication");
    ok((await offers.listOffers(a.id)).length === 0, "listOffers");
    ok((await offers.offersDueBy(a.id, new Date("2100-01-01"))).length === 0, "offersDueBy");
    ok((await offers.offersDueBetween(a.id, new Date(), new Date("2100-01-01"))).length === 0, "offersDueBetween");
    ok(!(await letters.listLetters(a.id)).some((row) => row.applicationId === appId), "listLetters");
    const brief = await analytics.morningBrief(a.id, { aheadDays: 365 * 80 });
    ok(!JSON.stringify(brief).includes(appId), "morningBrief");
    if (slug) ok(!JSON.stringify(await share.getSharedPipeline(slug)).includes(appId), "getSharedPipeline");
  });

  await check("deleting a shared saved view takes its link down rather than widening it", async () => {
    const view = await views.saveView(a.id, "Probe view", "stage=APPLIED");
    const shared = await share.sharePipeline(a.id, { savedViewId: view.id });
    await views.deleteSavedView(a.id, view.id);
    ok((await share.getSharedPipeline(shared.slug)) === null, "the link still serves");
  });

  // --- Instance surface -------------------------------------------------------
  await check("the waitlist is closed on an instance with no site and no signups", async () => {
    const signups = await db.waitlistSignup.count();
    const landing = await db.setting.findUnique({ where: { key: "landing_url" } });
    if (signups === 0 && !landing?.value) ok((await waitlist.waitlistIsOpen()) === false, "open with nothing in front of it");
  });
} finally {
  await db.user.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
}

for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
