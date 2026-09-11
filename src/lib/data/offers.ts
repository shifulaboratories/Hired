import type { Offer, Stage } from "@prisma/client";
import { db } from "@/lib/db";
import { pick } from "@/lib/data/patch";
import { toDate } from "@/lib/data/pipeline";
import { searchMe, timeZoneOf, type SearchHit } from "@/lib/data/me";

/**
 * What someone actually offered.
 *
 * Two facts that look alike and are not: `Application.salaryRange` is what the
 * POSTING advertised, in the posting's own words, and an `Offer` row is what a
 * named human put on the table. Keeping them apart is the whole reason this
 * file exists — a range scraped off a job ad is not a number you negotiate
 * against, and merging the two would let one be mistaken for the other on the
 * screen where a person decides.
 *
 * Every offer is a VERSION. Recording a revision does not edit the first
 * number, it writes a second row: the distance between the opening offer and
 * the closing one is the negotiation record, and it is the only place that
 * history exists. `updateOffer` is for fixing a typo in a row, not for logging
 * that they came back with more.
 *
 * Amounts are whole units of the currency — 215000 is $215,000, not $2,150.00.
 * Storing cents would buy nothing (nobody negotiates a base to the penny) and
 * would halve the Int ceiling.
 *
 * An offer has no `archivedAt` of its own: it belongs to its application and
 * disappears when that is archived. That is a convenience with a sharp edge —
 * EVERY read here that does not start from an already-filtered application has
 * to spell `application: { archivedAt: null }` itself, because nothing in the
 * toolchain catches a miss. There are three, and each says so at the line.
 */

/** Postgres INTEGER, and the reason amounts are whole units rather than cents. */
const MAX_AMOUNT = 2_147_483_647;

/**
 * Amounts take a string as well as a number on purpose: a form field sends
 * "215,000", an assistant repeating what a recruiter said sends "215k", and
 * both mean the same thing. `money` below is the one place that reading lives.
 */
export type OfferInput = {
  currency?: string;
  baseAmount?: number | string;
  bonusAmount?: number | string;
  equityAmount?: number | string;
  signOnAmount?: number | string;
  terms?: string;
  vesting?: string;
  receivedAt?: Date | string | null;
  respondBy?: Date | string | null;
  startsOn?: Date | string | null;
};

/**
 * An amount, in whole units.
 *
 * Assistants send "215k", "$215,000" and 215000 for the same figure, and a
 * person typing into the form sends "". All three of the first shapes mean the
 * same thing and are accepted; anything left that is not a number is rejected
 * rather than silently stored as zero, because zero here reads as "they
 * offered nothing" on a comparison table.
 */
function money(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") {
    const clean = value.trim().toLowerCase().replace(/[$£€,\s]/g, "");
    const k = clean.endsWith("k");
    const parsed = Number(k ? clean.slice(0, -1) : clean);
    if (!Number.isFinite(parsed)) throw new Error(`${field} is not a number: "${value}"`);
    n = k ? parsed * 1000 : parsed;
  } else throw new Error(`${field} is not a number`);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be zero or more`);
  if (n > MAX_AMOUNT) throw new Error(`${field} is larger than this column can hold`);
  return Math.round(n);
}

/** ISO 4217, uppercased. Refused rather than guessed — see compareOffers. */
function currencyOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const code = value.trim().toUpperCase();
  if (code === "") return undefined;
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`currency must be a three-letter code like "USD", not "${value}"`);
  }
  return code;
}

type OfferFields = Partial<
  Pick<
    Offer,
    | "currency"
    | "baseAmount"
    | "bonusAmount"
    | "equityAmount"
    | "signOnAmount"
    | "terms"
    | "vesting"
    | "receivedAt"
    | "respondBy"
    | "startsOn"
  >
>;

async function toRow(userId: string, input: OfferInput): Promise<OfferFields> {
  const zone = await timeZoneOf(userId);
  return {
    ...pick(
      {
        currency: currencyOf(input.currency),
        baseAmount: money(input.baseAmount, "base_amount"),
        bonusAmount: money(input.bonusAmount, "bonus_amount"),
        equityAmount: money(input.equityAmount, "equity_amount"),
        signOnAmount: money(input.signOnAmount, "sign_on_amount"),
        terms: input.terms?.trim(),
        vesting: input.vesting?.trim(),
      },
      [
        "currency",
        "baseAmount",
        "bonusAmount",
        "equityAmount",
        "signOnAmount",
        "terms",
        "vesting",
      ],
    ),
    ...(input.receivedAt === undefined
      ? {}
      : { receivedAt: toDate(zone, input.receivedAt) ?? new Date() }),
    ...(input.respondBy === undefined ? {} : { respondBy: toDate(zone, input.respondBy) ?? null }),
    ...(input.startsOn === undefined ? {} : { startsOn: toDate(zone, input.startsOn) ?? null }),
  };
}

/**
 * The application an offer is about, checked for ownership before anything is
 * written. Archived reads as gone: you cannot put an offer on a deleted row.
 */
async function liveApplication(userId: string, applicationId: string) {
  const application = await db.application.findFirst({
    where: { id: applicationId, userId, archivedAt: null },
    select: {
      id: true,
      stage: true,
      roleTitle: true,
      salaryRange: true,
      company: { select: { id: true, name: true } },
    },
  });
  if (!application) throw new Error("No such application");
  return application;
}

/**
 * Record what they offered. Always a new row — see the file comment.
 *
 * Returns the offer with the application it belongs to, so a caller can see at
 * once whether the board still says INTERVIEWING and move it.
 */
export async function recordOffer(userId: string, applicationId: string, input: OfferInput) {
  const application = await liveApplication(userId, applicationId);
  const offer = await db.offer.create({
    data: {
      userId,
      applicationId: application.id,
      ...(await toRow(userId, input)),
    },
  });
  const revisions = await db.offer.count({ where: { userId, applicationId: application.id } });
  return { offer, application, revisions };
}

export type OfferRow = Offer & {
  application: {
    id: string;
    stage: Stage;
    roleTitle: string;
    company: { id: string; name: string };
  };
};

/**
 * Offers, newest first.
 *
 * `liveOnly` drops the ones whose application was lost — turned down,
 * rescinded, withdrawn — leaving what is still on the table. An accepted one
 * stays: it is the offer you took, and a comparison that hides it cannot
 * explain the decision.
 */
export async function listOffers(
  userId: string,
  options?: { applicationId?: string; liveOnly?: boolean; limit?: number },
): Promise<OfferRow[]> {
  const rows = await db.offer.findMany({
    where: {
      userId,
      ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
      // Archive filter #1 of 3. An offer has no archivedAt of its own, so this
      // read has to exclude the ones whose application is in the bin.
      application: {
        archivedAt: null,
        ...(options?.liveOnly ? { stage: { not: "LOST" as Stage } } : {}),
      },
    },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    take: options?.limit,
    include: {
      application: {
        select: {
          id: true,
          stage: true,
          roleTitle: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });
  return rows;
}

export async function getOffer(userId: string, id: string): Promise<OfferRow | null> {
  return db.offer.findFirst({
    where: { id, userId, application: { archivedAt: null } },
    include: {
      application: {
        select: {
          id: true,
          stage: true,
          roleTitle: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Fix a row. This is for a typo — a base typed with a digit missing, a
 * respond-by that moved. When they come back with a better number, call
 * recordOffer again instead: overwriting loses the negotiation.
 */
export async function updateOffer(userId: string, id: string, patch: OfferInput) {
  const existing = await db.offer.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new Error("No such offer");
  return db.offer.update({ where: { id }, data: await toRow(userId, patch) });
}

export async function deleteOffer(userId: string, id: string) {
  const { count } = await db.offer.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such offer");
  return { deleted: count };
}

export type OfferColumn = {
  offerId: string;
  applicationId: string;
  company: string;
  roleTitle: string;
  stage: Stage;
  currency: string;
  baseAmount: number;
  bonusAmount: number;
  equityAmount: number;
  signOnAmount: number;
  /** base + bonus + equity. Sign-on is excluded — it lands once. */
  yearlyTotal: number;
  /** The same plus the sign-on: what year one actually pays. */
  firstYearTotal: number;
  terms: string;
  vesting: string;
  receivedAt: Date;
  respondBy: Date | null;
  /** Whole days from now, negative when the deadline has passed. */
  daysToRespond: number | null;
  /** How many times this one has been revised, counting the first. */
  revisions: number;
  /** The lines this offer leads on: "base", "yearly", "first year", "equity". */
  leads: string[];
};

export type OfferComparison = {
  comparable: boolean;
  currency: string | null;
  incomparableReason: string | null;
  columns: OfferColumn[];
};

/**
 * Every live offer side by side, newest version of each.
 *
 * One column per application, not per row: a revision supersedes, so comparing
 * an opening offer against a closing one would be comparing the wrong numbers.
 *
 * It will not convert currencies. An exchange rate needs a live feed, a date,
 * and a decision about which of the two you are actually paid in — and getting
 * it wrong here means picking the wrong job. When the offers are in different
 * currencies the columns still come back, each honest in its own currency,
 * `comparable` is false and nothing is marked as leading.
 */
export async function compareOffers(
  userId: string,
  options?: { applicationIds?: string[]; includeLost?: boolean },
): Promise<OfferComparison> {
  const rows = await db.offer.findMany({
    where: {
      userId,
      ...(options?.applicationIds?.length
        ? { applicationId: { in: options.applicationIds } }
        : {}),
      // Archive filter #2 of 3.
      application: {
        archivedAt: null,
        ...(options?.includeLost ? {} : { stage: { not: "LOST" as Stage } }),
      },
    },
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    include: {
      application: {
        select: {
          id: true,
          stage: true,
          roleTitle: true,
          company: { select: { name: true } },
        },
      },
    },
  });

  const now = Date.now();
  const newest = new Map<string, (typeof rows)[number]>();
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.applicationId, (counts.get(row.applicationId) ?? 0) + 1);
    if (!newest.has(row.applicationId)) newest.set(row.applicationId, row);
  }

  const columns: OfferColumn[] = [...newest.values()].map((row) => {
    const yearlyTotal = row.baseAmount + row.bonusAmount + row.equityAmount;
    return {
      offerId: row.id,
      applicationId: row.applicationId,
      company: row.application.company.name,
      roleTitle: row.application.roleTitle,
      stage: row.application.stage,
      currency: row.currency,
      baseAmount: row.baseAmount,
      bonusAmount: row.bonusAmount,
      equityAmount: row.equityAmount,
      signOnAmount: row.signOnAmount,
      yearlyTotal,
      firstYearTotal: yearlyTotal + row.signOnAmount,
      terms: row.terms,
      vesting: row.vesting,
      receivedAt: row.receivedAt,
      respondBy: row.respondBy,
      daysToRespond:
        row.respondBy === null
          ? null
          : Math.ceil((row.respondBy.getTime() - now) / 86_400_000),
      revisions: counts.get(row.applicationId) ?? 1,
      leads: [],
    };
  });

  columns.sort((a, b) => b.firstYearTotal - a.firstYearTotal);

  const currencies = new Set(columns.map((column) => column.currency));
  if (currencies.size > 1) {
    return {
      comparable: false,
      currency: null,
      incomparableReason: `These offers are in ${[...currencies].sort().join(", ")}. This tool will not convert between currencies — pick the rate yourself and say which one you want the comparison in.`,
      columns,
    };
  }

  // Marked only when there is something to beat, and only on a strict win: two
  // identical bases are not a lead, and saying so would invent a winner.
  if (columns.length > 1) {
    const lead = (key: "baseAmount" | "yearlyTotal" | "firstYearTotal" | "equityAmount", label: string) => {
      const best = Math.max(...columns.map((column) => column[key]));
      const holders = columns.filter((column) => column[key] === best);
      if (best > 0 && holders.length === 1) holders[0].leads.push(label);
    };
    lead("baseAmount", "base");
    lead("yearlyTotal", "yearly");
    lead("firstYearTotal", "first year");
    lead("equityAmount", "equity");
  }

  return {
    comparable: true,
    currency: columns[0]?.currency ?? null,
    incomparableReason: null,
    columns,
  };
}

/** A figure or a pay word somewhere in the timeline of this application. */
export type MoneyQuote = {
  activityId: string;
  occurredAt: Date;
  type: string;
  quote: string;
};

const MONEY_PATTERN =
  /(?:[$£€]\s?\d[\d,.]*\s?[kKmM]?)|(?:\b\d{2,3}\s?[kK]\b)|(?:\b(?:salary|compensation|comp|base|equity|bonus|sign[- ]?on|rsu|options?|vest(?:ing|s)?|band|range|budget|package|offer)\b)/i;

/**
 * The sentences in an application's timeline where money came up.
 *
 * A recruiter says a band on the first call and nobody writes it down anywhere
 * but the note they typed that afternoon. This finds it again, with the
 * activity id so the full note is one call away, rather than asking a person to
 * reread nine months of their own timeline at the worst possible moment.
 */
function moneyQuotes(
  activities: { id: string; type: string; body: string; occurredAt: Date }[],
): MoneyQuote[] {
  const out: MoneyQuote[] = [];
  for (const activity of activities) {
    for (const sentence of activity.body.split(/(?<=[.!?\n])\s+/)) {
      const clean = sentence.trim();
      if (clean.length < 3 || !MONEY_PATTERN.test(clean)) continue;
      out.push({
        activityId: activity.id,
        occurredAt: activity.occurredAt,
        type: activity.type,
        quote: clean.length > 300 ? `${clean.slice(0, 297)}…` : clean,
      });
      break; // One line per activity: this is a briefing, not a transcript.
    }
  }
  return out;
}

export type OfferBriefing = {
  application: { id: string; stage: Stage; roleTitle: string; company: string };
  offers: Offer[];
  /** What the posting advertised, verbatim. Not what anybody offered. */
  advertised: string;
  saidDuringProcess: MoneyQuote[];
  pastPay: SearchHit[];
  competing: OfferColumn[];
  /** What is not on file that you would want before answering. */
  missing: string[];
};

/**
 * Everything on file that bears on one negotiation, in one call.
 *
 * Read-only, and it saves nothing. The point is that the four places this
 * material lives — the offer rows, the posting's advertised range, what was
 * said in the timeline, and what the person has written about their own pay —
 * are four separate reads a person will not do at 9pm with a deadline on
 * Friday.
 */
export async function offerBriefing(userId: string, applicationId: string): Promise<OfferBriefing> {
  const application = await liveApplication(userId, applicationId);

  const [offers, activities, pastPay, comparison] = await Promise.all([
    db.offer.findMany({
      where: { userId, applicationId },
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    }),
    db.activity.findMany({
      where: { userId, applicationId },
      orderBy: { occurredAt: "desc" },
      select: { id: true, type: true, body: true, occurredAt: true },
    }),
    searchMe(userId, "salary compensation base bonus equity offer raise promotion", 6),
    compareOffers(userId),
  ]);

  const latest = offers[0];
  const competing = comparison.columns.filter((column) => column.applicationId !== applicationId);

  const missing: string[] = [];
  if (!latest) missing.push("No offer recorded yet — record_offer saves what they put on the table.");
  else {
    if (latest.baseAmount === 0) missing.push("No base salary recorded.");
    if (latest.equityAmount > 0 && !latest.vesting.trim()) {
      missing.push("Equity is recorded but the vesting schedule is not.");
    }
    if (!latest.respondBy) missing.push("No deadline recorded, so nothing will remind you.");
  }
  if (!application.salaryRange.trim()) missing.push("The posting's advertised range is not on file.");
  if (competing.length === 0) missing.push("No other live offer to weigh this against.");
  if (pastPay.length === 0) {
    missing.push("Nothing in Me about what you have been paid before — append_role_background can fix that.");
  }

  return {
    application: {
      id: application.id,
      stage: application.stage,
      roleTitle: application.roleTitle,
      company: application.company.name,
    },
    offers,
    advertised: application.salaryRange,
    saidDuringProcess: moneyQuotes(activities),
    pastPay,
    competing,
    missing,
  };
}

/**
 * Offer deadlines coming due, for the bell and the calendar.
 *
 * Archive filter #3 of 3, and the one most easily forgotten — this read starts
 * from Offer rather than from an application, so the filter has to be spelled
 * out here or a deleted application would keep nagging.
 */
export async function offersDueBy(userId: string, cutoff: Date) {
  return db.offer.findMany({
    where: {
      userId,
      respondBy: { lte: cutoff },
      application: { archivedAt: null, stage: { not: "LOST" as Stage } },
    },
    orderBy: { respondBy: "asc" },
    include: {
      application: {
        select: { id: true, roleTitle: true, company: { select: { name: true } } },
      },
    },
  });
}

/** The same rows in a window, for the calendar. */
export async function offersDueBetween(userId: string, start: Date, end: Date) {
  return db.offer.findMany({
    where: {
      userId,
      respondBy: { gte: start, lte: end },
      application: { archivedAt: null, stage: { not: "LOST" as Stage } },
    },
    orderBy: { respondBy: "asc" },
    include: {
      application: {
        select: { id: true, stage: true, roleTitle: true, company: { select: { name: true } } },
      },
    },
  });
}

/**
 * One offer as the browser needs it: dates flattened to ISO strings.
 *
 * Here rather than in each of the two call sites that build the detail props,
 * because a card that renders a Date on the server and a string in the client
 * is a hydration mismatch waiting for the first person west of Greenwich.
 */
export function offerForUi(offer: Offer) {
  return {
    id: offer.id,
    currency: offer.currency,
    baseAmount: offer.baseAmount,
    bonusAmount: offer.bonusAmount,
    equityAmount: offer.equityAmount,
    signOnAmount: offer.signOnAmount,
    terms: offer.terms,
    vesting: offer.vesting,
    receivedAt: offer.receivedAt.toISOString(),
    respondBy: offer.respondBy?.toISOString() ?? null,
    startsOn: offer.startsOn?.toISOString() ?? null,
  };
}

export type OfferForUi = ReturnType<typeof offerForUi>;
