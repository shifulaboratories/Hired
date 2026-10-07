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
const interviews = await load("data/interviews.ts");

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

  // --- What writers are handed -----------------------------------------------
  await check("search_me says which hits are caveats, and never searches the private profile", async () => {
    const r = await me.createRole(a.id, {
      company: "Vandelay",
      title: "Importer",
      background: "- Grew latex imports by forty percent\n\n## Caveats\n- Tenure was short, have the zeppelin answer ready\n",
    });
    await me.updateProfile(a.id, { background: "POSITIONING: never mention zeppelin anywhere" });
    const hits = await me.searchMe(a.id, "zeppelin");
    const roleHit = hits.find((hit) => hit.id === r.id);
    ok(roleHit?.use === "caveats", `the caveat came back as ${roleHit?.use}`);
    ok(!hits.some((hit) => hit.kind === "profile"), "the profile background was searched");
    const evidence = (await me.searchMe(a.id, "latex imports")).find((hit) => hit.id === r.id);
    ok(evidence?.use === "evidence", `evidence came back as ${evidence?.use}`);
  });

  await check("constraints come from the profile, every role and every project", async () => {
    await me.createProject(a.id, { name: "Side thing", background: "## Rules\n- Never name the client\n" });
    await me.updateProfile(a.id, { background: "## Caveats\n- Do not lead with the gap year\n" });
    const snapshot = await me.getMeSnapshot(a.id);
    ok(snapshot.writingRules.some((row) => row.rule.includes("Never name the client")), "project rule missing");
    ok(snapshot.neverOnADocument.some((row) => row.caveat.includes("gap year")), "profile caveat missing");
    const letter = await letters.letterContext(a.id, { kind: "COVER_LETTER", topic: "zeppelin tenure latex" });
    ok(letter.writingRules.some((row) => row.rule.includes("Never name the client")), "prep_letter has no rules");
    ok(letter.evidence.every((hit) => hit.use === "evidence"), "prep_letter handed over a caveat as evidence");
  });

  await check("a bullet written from a role's evidence traces back to it", async () => {
    const r = await me.createRole(a.id, {
      company: "Kramerica",
      title: "Founder",
      background: "- Shipped the oil bladder prototype to three retail partners in six weeks\n",
    });
    const doc = await resumes.createResume(a.id, {
      name: "Trace",
      data: { sections: [{ kind: "experience", experience: [{ roleId: r.id, company: "Kramerica", title: "Founder",
        bullets: ["Shipped the oil bladder prototype to three retail partners in six weeks", "Raised forty million dollars"] }] }] },
    });
    const trace = await resumes.traceResumeEvidence(a.id, doc.id);
    ok(trace.bullets[0].evidence[0]?.source === "background", "the evidence line was not found");
    ok(trace.unbacked === 1, `unbacked is ${trace.unbacked}`);
  });

  await check("a tailored copy names the base's lines nothing in Me backs", async () => {
    await db.resume.updateMany({ where: { userId: a.id }, data: { isFavorite: false } });
    const base = await resumes.createResume(a.id, {
      name: "Master",
      data: { sections: [{ kind: "experience", experience: [{ company: "Acme", title: "Lead", bullets: ["Delivered $500K for the founder in year one"] }] }] },
    });
    await db.resume.update({ where: { id: base.id }, data: { isFavorite: true } });
    const job = await pipeline.createApplicationIfNew(a.id, { company: "Pendant", roleTitle: "Editor", stage: "WISHLIST" });
    const made = await resumes.createResumeForApplication(a.id, job.application.id, { baseId: base.id });
    ok(made.unbacked.some((row) => row.bullet.includes("$500K")), "the retired claim was not named");
  });

  // --- The pipeline's numbers -------------------------------------------------
  const c = await person("c");
  const old = new Date(Date.now() - 60 * 86_400_000);
  const quietWish = await pipeline.createApplicationIfNew(c.id, { company: "Wishco", roleTitle: "PM", stage: "WISHLIST" });
  const quietApplied = await pipeline.createApplicationIfNew(c.id, { company: "Sentco", roleTitle: "PM", stage: "APPLIED" });
  await db.application.updateMany({ where: { userId: c.id }, data: { createdAt: old, appliedAt: null } });
  await db.application.update({ where: { id: quietApplied.application.id }, data: { appliedAt: old } });
  await db.activity.updateMany({ where: { userId: c.id }, data: { occurredAt: old } });

  await check("an unsent wishlist row is never 'gone quiet' in the brief", async () => {
    const brief = await analytics.morningBrief(c.id, { quietAfterDays: 14 });
    ok(!brief.quiet.some((row) => row.id === quietWish.application.id), "a wishlist row is in quiet");
    ok(brief.quiet.some((row) => row.id === quietApplied.application.id), "a silent applied row is missing");
    ok(!("jobDescription" in (brief.quiet[0] ?? {})), "quiet carries whole rows");
  });

  await check("in flight means sent and open, the same as pipeline_stats", async () => {
    const diagnosis = await pipeline.diagnoseSearch(c.id);
    ok(diagnosis.inFlight === 1, `inFlight is ${diagnosis.inFlight}`);
    ok(diagnosis.bySource.every((row) => row.rate === null || row.sent >= 5), "a rate from fewer than five");
    ok(!("byResume" in diagnosis), "per-resume rates are back in the diagnosis");
  });

  await check("moving back to the wishlist clears the applied date", async () => {
    const moved = await pipeline.moveApplicationStage(c.id, quietApplied.application.id, "WISHLIST");
    ok(moved.appliedAt === null, "appliedAt survived");
    await pipeline.moveApplicationStage(c.id, quietApplied.application.id, "APPLIED");
  });

  await check("closing as ghosted is not an employer's rejection; closing as rejected is", async () => {
    const ghost = await pipeline.createApplicationIfNew(c.id, { company: "Ghostco", roleTitle: "PM", stage: "APPLIED" });
    await pipeline.moveApplicationStage(c.id, ghost.application.id, "LOST", undefined, { lossReasons: ["Ghosted"] });
    const no = await pipeline.createApplicationIfNew(c.id, { company: "Noco", roleTitle: "PM", stage: "APPLIED" });
    await pipeline.moveApplicationStage(c.id, no.application.id, "LOST", undefined, { lossReasons: ["Rejected"] });
    const last = async (id) =>
      (await db.activity.findFirst({ where: { applicationId: id, toStage: "LOST" }, orderBy: { occurredAt: "desc" } }))?.type;
    ok((await last(ghost.application.id)) === "STAGE_CHANGE", "ghosted logged as a rejection");
    ok((await last(no.application.id)) === "REJECTION", "rejected not logged as a rejection");
  });

  await check("being attached to an unsent application earns nobody a place on the warm list", async () => {
    await pipeline.createContact(c.id, { name: "Cold Target", applicationId: quietWish.application.id });
    const contacts = await db.contact.findMany({ where: { userId: c.id } });
    await db.contact.updateMany({ where: { userId: c.id }, data: { createdAt: old } });
    const rel = await pipeline.listRelationships(c.id);
    ok(!rel.worthKeepingWarm.some((row) => row.id === contacts[0].id), "a cold target is worth keeping warm");
  });

  await check("editing an interview's outcome rewrites its timeline line", async () => {
    const booked = await interviews.scheduleInterview(c.id, quietApplied.application.id, { format: "VIDEO" });
    const held = await interviews.recordInterviewOutcome(c.id, booked.interview.id, { outcome: "HELD", debrief: "Went fine" });
    await interviews.updateInterview(c.id, booked.interview.id, { outcome: "PASSED", debrief: "They moved me on" });
    const line = await db.activity.findUnique({ where: { id: held.activityId } });
    ok(line.body.includes("They moved me on"), `the timeline still says: ${line.body}`);
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
