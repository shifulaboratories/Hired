import { db } from "@/lib/db";
import * as pipeline from "@/lib/data/pipeline";
import * as offers from "@/lib/data/offers";
import * as letters from "@/lib/data/letters";
import * as resumes from "@/lib/data/resumes";
import * as tags from "@/lib/data/tags";
import { SAMPLE_FIXTURE, SAMPLE_VERSION } from "@/lib/sample-fixture";

/**
 * The sample search: real rows, and a wipe that is exact.
 *
 * The empty screens are the worst ten minutes in this product, and the fix is
 * not an illustration — it is a pipeline written by the ordinary data functions,
 * which therefore behaves exactly like the person's own.
 *
 * WHICH MAKES REMOVING IT THE HARD HALF, and the reason this file exists. It is
 * tracked as a recorded manifest of ids in one row rather than an `isSample`
 * column on nine models: the column would be nine migrations and nine things
 * every future read has to remember to ignore, and it would still be wrong the
 * moment somebody duplicates a sample resume.
 *
 * And the wipe KEEPS ANYTHING THE PERSON HAS TOUCHED. "Remove exactly what it
 * added and nothing they have written" is not achievable by id alone, because
 * editing a sample row IS writing — so each recorded row carries the
 * `updatedAt` it had when it was made, and one whose stamp has moved is kept,
 * named in the report and left alone. A sample that quietly deleted the note
 * somebody wrote on it would be worse than no sample at all.
 */

type ManifestRow = { model: string; id: string; stamp: string };

export type SampleStatus = {
  loaded: boolean;
  loadedAt: Date | null;
  fixture: string;
  /** How many rows the manifest records, by model. */
  counts: Record<string, number>;
  /** True when the loaded fixture is older than SAMPLE_VERSION. */
  stale: boolean;
};

export type SampleReport = {
  created: Record<string, number>;
  /** What is now on the board, so the answer says where to look. */
  highlights: string[];
};

export type WipeReport = {
  deleted: Record<string, number>;
  /** Rows kept because the person had changed them, with what each is. */
  kept: { model: string; id: string; label: string; why: string }[];
  /** True when the manifest row itself was removed. False if anything is held. */
  complete: boolean;
};

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

function tally(rows: ManifestRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.model] = (counts[row.model] ?? 0) + 1;
  return counts;
}

export async function sampleStatus(userId: string): Promise<SampleStatus> {
  const load = await db.sampleLoad.findUnique({ where: { userId } });
  if (!load) {
    return { loaded: false, loadedAt: null, fixture: "", counts: {}, stale: false };
  }
  const rows = (load.rows ?? []) as ManifestRow[];
  return {
    loaded: true,
    loadedAt: load.loadedAt,
    fixture: load.fixture,
    counts: tally(rows),
    stale: load.fixture !== SAMPLE_VERSION,
  };
}

export async function loadSampleWorkspace(
  userId: string,
  options?: { allowAnyway?: boolean },
): Promise<SampleReport> {
  const existing = await db.sampleLoad.findUnique({ where: { userId }, select: { id: true } });
  if (existing) {
    throw new Error("There is already a sample in this workspace. Wipe it first, or keep it.");
  }

  if (options?.allowAnyway !== true) {
    // The same three things setupStatus asks about. A sample mixed into a real
    // search is noise nobody can separate afterwards.
    const [application, role, highlight] = await Promise.all([
      db.application.findFirst({ where: { userId, archivedAt: null }, select: { id: true } }),
      db.role.findFirst({ where: { userId }, select: { id: true } }),
      db.highlight.findFirst({ where: { userId }, select: { id: true } }),
    ]);
    if (application || role || highlight) {
      throw new Error(
        "This workspace already has real material in it, so the sample would be noise mixed into a search. If they want it anyway, say what it will add and pass allow_anyway.",
      );
    }
  }

  const rows: ManifestRow[] = [];
  const record = (model: string, row: { id: string; updatedAt?: Date }) => {
    rows.push({ model, id: row.id, stamp: row.updatedAt?.toISOString() ?? "" });
  };

  const fixture = SAMPLE_FIXTURE;
  const created: Record<string, number> = {};
  const bump = (model: string) => {
    created[model] = (created[model] ?? 0) + 1;
  };

  for (const tag of fixture.tags) {
    const made = await tags.createTag(userId, { kind: tag.kind, name: tag.name, color: tag.color });
    record("tag", made);
    bump("tag");
  }

  const companyIds = new Map<string, string>();
  for (const company of fixture.companies) {
    const made = await pipeline.createCompany(userId, {
      name: company.name,
      website: company.website,
      notes: company.notes,
      industry: company.industry,
      size: company.size,
      location: company.location,
      tags: company.tags,
    });
    companyIds.set(company.key, made.id);
    record("company", made);
    bump("company");
  }

  const applicationIds = new Map<string, string>();
  for (const application of fixture.applications) {
    // The stage is set AT CREATION and never moved. moveApplicationStage would
    // fire the person's stage checklists and make tasks the manifest does not
    // know about, which would make the wipe a guess — and the wipe being exact
    // is the whole reason this file exists.
    const made = await pipeline.createApplication(userId, {
      company: application.company,
      roleTitle: application.roleTitle,
      stage: application.stage,
      interviewRound: application.interviewRound,
      roundLabel: application.roundLabel,
      location: application.location,
      workMode: application.workMode,
      salaryRange: application.salaryRange,
      jobUrl: application.jobUrl,
      notes: application.notes,
      appliedAt: application.appliedDaysAgo === null ? undefined : daysFromNow(-application.appliedDaysAgo),
      nextFollowUpAt: application.followUpInDays === null ? null : daysFromNow(application.followUpInDays),
      tags: application.tags,
      lossReasons: application.lossReasons,
    });
    applicationIds.set(application.key, made.id);
    record("application", made);
    bump("application");
  }

  const contactIds = new Map<string, string>();
  for (const contact of fixture.contacts) {
    const made = await pipeline.createContact(userId, {
      name: contact.name,
      title: contact.title,
      email: contact.email,
      relationship: contact.relationship,
      companyIds: contact.companies
        .map((name) => fixture.companies.find((company) => company.name === name)?.key)
        .map((key) => (key ? companyIds.get(key) : undefined))
        .filter((id): id is string => Boolean(id)),
      applicationId: contact.application ? applicationIds.get(contact.application) : undefined,
      tags: contact.tags,
    });
    contactIds.set(contact.key, made.id);
    record("contact", made);
    bump("contact");
  }

  for (const activity of fixture.activities) {
    const made = await pipeline.addActivity(userId, {
      applicationId: activity.application ? applicationIds.get(activity.application) : undefined,
      contactId: activity.contact ? contactIds.get(activity.contact) : undefined,
      type: activity.type,
      body: activity.body,
      occurredAt: daysFromNow(-activity.daysAgo),
    });
    // Activity carries no updatedAt, so its stamp is "" and the wipe judges it
    // by its parent instead.
    record("activity", made);
    bump("activity");
  }

  for (const offer of fixture.offers) {
    const applicationId = applicationIds.get(offer.application);
    if (!applicationId) continue;
    const made = await offers.recordOffer(userId, applicationId, {
      currency: offer.currency,
      baseAmount: offer.base,
      bonusAmount: offer.bonus,
      equityAmount: offer.equity,
      signOnAmount: offer.signOn,
      terms: offer.terms,
      receivedAt: daysFromNow(-offer.receivedDaysAgo),
      respondBy: daysFromNow(offer.respondInDays),
    });
    record("offer", made.offer);
    bump("offer");
  }

  for (const task of fixture.tasks) {
    const made = await pipeline.createTask(userId, {
      title: task.title,
      detail: task.detail,
      applicationId: task.application ? applicationIds.get(task.application) : undefined,
      dueAt: daysFromNow(task.dueInDays),
    });
    record("task", made);
    bump("task");
  }

  for (const letter of fixture.letters) {
    const made = await letters.createLetter(userId, {
      kind: letter.kind,
      title: letter.title,
      recipient: letter.recipient,
      body: letter.body,
      applicationId: letter.application ? applicationIds.get(letter.application) : undefined,
    });
    record("letter", made);
    bump("letter");
  }

  const resume = await resumes.createResume(userId, {
    name: fixture.resume.name,
    data: fixture.resume.doc,
  });
  record("resume", resume);
  bump("resume");

  await db.sampleLoad.create({
    data: { userId, rows: rows as unknown as object, fixture: SAMPLE_VERSION },
  });

  return {
    created,
    highlights: [
      "Six jobs on the board, one in each of wishlist, interviewing, offer and lost, and two applied.",
      "Meridian Health's group PM role carries TWO offers a week apart — the second is eighteen thousand higher. That is why offers are rows here and not columns.",
      "Priya Raman is filed against two companies at once, which is what the contacts model actually allows.",
      "One task is already overdue, so Today has something in it.",
      "wipe_sample_workspace removes all of it, and keeps anything you have edited.",
    ],
  };
}

export async function wipeSampleWorkspace(userId: string): Promise<WipeReport> {
  const load = await db.sampleLoad.findUnique({ where: { userId } });
  if (!load) throw new Error("There is no sample in this workspace.");

  const rows = (load.rows ?? []) as ManifestRow[];
  const deleted: Record<string, number> = {};
  const kept: WipeReport["kept"] = [];
  const count = (model: string) => {
    deleted[model] = (deleted[model] ?? 0) + 1;
  };

  const idsOf = (model: string) => rows.filter((row) => row.model === model);
  const sampleApplicationIds = new Set(idsOf("application").map((row) => row.id));
  const sampleContactIds = new Set(idsOf("contact").map((row) => row.id));
  const sampleCompanyIds = new Set(idsOf("company").map((row) => row.id));

  /** Has the person touched this row since it was made? */
  const moved = (row: ManifestRow, updatedAt: Date | null | undefined) =>
    row.stamp !== "" && updatedAt instanceof Date && updatedAt.toISOString() !== row.stamp;

  // --- Children first -------------------------------------------------------
  // Activities and offers carry no independent meaning: they follow their
  // parent. Anything the person ADDED to a sample parent after the load is what
  // makes the parent worth keeping, and that is counted below.
  for (const model of ["activity", "offer", "letter", "task"] as const) {
    for (const row of idsOf(model)) {
      // Only a letter is judged on its own stamp. A Task carries no updatedAt
      // (it has createdAt and doneAt and nothing between), so a sample task is
      // judged by its application the way an activity and an offer are.
      if (model === "letter") {
        const current = await db.letter.findFirst({
          where: { id: row.id, userId },
          select: { updatedAt: true, title: true },
        });
        if (!current) {
          count(model);
          continue;
        }
        if (moved(row, current.updatedAt)) {
          kept.push({ model, id: row.id, label: current.title, why: "you edited it" });
          continue;
        }
      }
      // Scoped { id, userId } on every delete: the manifest is STORED data, and
      // stored data is not trusted to name a row. proposals.ts makes the same
      // argument about its payloads.
      const { count: gone } =
        model === "activity"
          ? await db.activity.deleteMany({ where: { id: row.id, userId } })
          : model === "offer"
            ? await db.offer.deleteMany({ where: { id: row.id, userId } })
            : model === "letter"
              ? await db.letter.deleteMany({ where: { id: row.id, userId } })
              : await db.task.deleteMany({ where: { id: row.id, userId } });
      if (gone > 0) count(model);
    }
  }

  // --- What the person added to a sample parent AFTER the load --------------
  // One groupBy per child table, not one query per row. This is what stops the
  // wipe cascading away a note somebody wrote on the sample job.
  const [addedActivities, addedTasks, addedOffers, addedLetters] = await Promise.all([
    db.activity.groupBy({
      by: ["applicationId"],
      where: { userId, createdAt: { gt: load.loadedAt }, applicationId: { in: [...sampleApplicationIds] } },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["applicationId"],
      where: { userId, createdAt: { gt: load.loadedAt }, applicationId: { in: [...sampleApplicationIds] } },
      _count: { _all: true },
    }),
    db.offer.groupBy({
      by: ["applicationId"],
      where: { userId, createdAt: { gt: load.loadedAt }, applicationId: { in: [...sampleApplicationIds] } },
      _count: { _all: true },
    }),
    db.letter.groupBy({
      by: ["applicationId"],
      where: { userId, createdAt: { gt: load.loadedAt }, applicationId: { in: [...sampleApplicationIds] } },
      _count: { _all: true },
    }),
  ]);
  const touchedApplications = new Set(
    [...addedActivities, ...addedTasks, ...addedOffers, ...addedLetters]
      .map((group) => group.applicationId)
      .filter((id): id is string => Boolean(id)),
  );

  // --- Applications ---------------------------------------------------------
  const survivingApplications = new Set<string>();
  for (const row of idsOf("application")) {
    const current = await db.application.findFirst({
      where: { id: row.id, userId },
      select: { updatedAt: true, roleTitle: true, company: { select: { name: true } } },
    });
    if (!current) {
      count("application");
      continue;
    }
    const label = `${current.roleTitle} at ${current.company.name}`;
    if (moved(row, current.updatedAt)) {
      kept.push({ model: "application", id: row.id, label, why: "you edited it" });
      survivingApplications.add(row.id);
      continue;
    }
    if (touchedApplications.has(row.id)) {
      kept.push({ model: "application", id: row.id, label, why: "you added something to it" });
      survivingApplications.add(row.id);
      continue;
    }
    await db.application.deleteMany({ where: { id: row.id, userId } });
    count("application");
  }

  // --- Contacts -------------------------------------------------------------
  const survivingContacts = new Set<string>();
  for (const row of idsOf("contact")) {
    const current = await db.contact.findFirst({
      where: { id: row.id, userId },
      select: { updatedAt: true, name: true },
    });
    if (!current) {
      count("contact");
      continue;
    }
    if (moved(row, current.updatedAt)) {
      kept.push({ model: "contact", id: row.id, label: current.name, why: "you edited it" });
      survivingContacts.add(row.id);
      continue;
    }
    const added = await db.activity.count({
      where: { userId, contactId: row.id, createdAt: { gt: load.loadedAt } },
    });
    if (added > 0) {
      kept.push({ model: "contact", id: row.id, label: current.name, why: "you added something to it" });
      survivingContacts.add(row.id);
      continue;
    }
    await db.contact.deleteMany({ where: { id: row.id, userId } });
    count("contact");
  }

  // --- Companies last: a company cascades its applications and contacts -----
  for (const row of idsOf("company")) {
    const current = await db.company.findFirst({
      where: { id: row.id, userId },
      select: { updatedAt: true, name: true },
    });
    if (!current) {
      count("company");
      continue;
    }
    if (moved(row, current.updatedAt)) {
      kept.push({ model: "company", id: row.id, label: current.name, why: "you edited it" });
      continue;
    }
    const holding = await db.application.count({
      where: { userId, companyId: row.id },
    });
    const people = await db.contactCompany.count({ where: { companyId: row.id } });
    if (holding > 0 || people > 0) {
      kept.push({
        model: "company",
        id: row.id,
        label: current.name,
        why: "something you kept still belongs to it",
      });
      continue;
    }
    await db.company.deleteMany({ where: { id: row.id, userId } });
    count("company");
  }

  // --- Resumes --------------------------------------------------------------
  for (const row of idsOf("resume")) {
    const current = await db.resume.findFirst({
      where: { id: row.id, userId },
      select: { updatedAt: true, name: true },
    });
    if (!current) {
      count("resume");
      continue;
    }
    if (moved(row, current.updatedAt)) {
      kept.push({ model: "resume", id: row.id, label: current.name, why: "you edited it" });
      continue;
    }
    await db.resume.deleteMany({ where: { id: row.id, userId } });
    count("resume");
  }

  // --- Tags: only where nothing outside the sample wears one ----------------
  for (const row of idsOf("tag")) {
    const current = await db.tag.findFirst({
      where: { id: row.id, userId },
      select: {
        name: true,
        _count: { select: { applications: true, companies: true, contacts: true } },
      },
    });
    if (!current) {
      count("tag");
      continue;
    }
    const worn =
      current._count.applications + current._count.companies + current._count.contacts;
    if (worn > 0) {
      kept.push({ model: "tag", id: row.id, label: current.name, why: "you used it elsewhere" });
      continue;
    }
    await db.tag.deleteMany({ where: { id: row.id, userId } });
    count("tag");
  }

  // The manifest row goes only when NOTHING was kept. Something kept means it
  // still describes live rows, and a second wipe later should still know about
  // them.
  const complete = kept.length === 0;
  if (complete) await db.sampleLoad.deleteMany({ where: { userId } });

  return { deleted, kept, complete };
}
