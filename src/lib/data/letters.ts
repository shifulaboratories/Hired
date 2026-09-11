import { LetterKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pick } from "@/lib/data/patch";
import { toDate } from "@/lib/data/pipeline";
import { searchMe, timeZoneOf } from "@/lib/data/me";

/**
 * Everything you write that is not a resume.
 *
 * A resume is a structured document: sections, a schema the renderer depends
 * on, a page count that matters. A cover letter is prose you send to a person.
 * Making one a `kind` of the other would have meant either prose stuffed into a
 * document schema or a schema loosened until it stopped being a contract, and
 * `src/lib/resume-schema.ts` being a contract is invariant four.
 *
 * So: a kind, a title, a recipient, a body, and optional links to the
 * application, the person and the resume it goes with. The links are SET NULL
 * in the database — destroying an application must not destroy what you wrote
 * to them.
 *
 * The point of the model is `letterContext` at the bottom. Drafting a good
 * cover letter needs five things that live five places apart, and gathering
 * them is most of the work.
 */

export const LETTER_KINDS = [
  "COVER_LETTER",
  "OUTREACH",
  "REFERRAL_ASK",
  "THANK_YOU",
  "REPLY",
  "OTHER",
] as const satisfies readonly LetterKind[];

export const LETTER_LABEL: Record<LetterKind, string> = {
  COVER_LETTER: "Cover letter",
  OUTREACH: "Cold outreach",
  REFERRAL_ASK: "Referral ask",
  THANK_YOU: "Thank-you",
  REPLY: "Reply",
  OTHER: "Other",
};

/** What each kind is trying to do, for a drafter that has never met one. */
export const LETTER_INTENT: Record<LetterKind, string> = {
  COVER_LETTER:
    "Three or four short paragraphs sent with an application. Says why this employer, what you have done that bears on this job, and nothing the resume already says twice.",
  OUTREACH:
    "A first message to somebody who has never heard of you — a hiring manager, an engineer on the team. Short enough to read on a phone, specific about why them, and asks for one small thing.",
  REFERRAL_ASK:
    "A message to somebody you already know, asking them to put you forward. Makes it easy to say yes: names the role, links the posting, and gives them two lines they can forward without editing.",
  THANK_YOU:
    "Sent within a day of an interview. Short. Names one thing from the conversation, closes one gap you noticed at the time, and asks nothing.",
  REPLY:
    "An answer to something they sent — a recruiter's first email, a rejection, a scheduling request. Matches their register and answers the actual question.",
  OTHER: "Whatever it is. Keep it in their own voice.",
};

export type LetterInput = {
  kind?: LetterKind;
  title?: string;
  body?: string;
  recipient?: string;
  applicationId?: string | null;
  contactId?: string | null;
  resumeId?: string | null;
  sentAt?: Date | string | null;
};

const EDITABLE = [
  "kind",
  "title",
  "body",
  "recipient",
  "applicationId",
  "contactId",
  "resumeId",
] as const;

/**
 * A letter's three links, checked against the caller before they are written.
 *
 * The ids arrive from an assistant or a form, and Prisma would happily attach
 * a letter to another account's application — the foreign key does not know
 * about tenancy. Each is verified with its own userId-filtered read, and null
 * is a legitimate value meaning "detach".
 */
async function checkLinks(userId: string, input: LetterInput) {
  const checks: Promise<void>[] = [];
  if (input.applicationId) {
    checks.push(
      db.application
        .findFirst({
          where: { id: input.applicationId, userId, archivedAt: null },
          select: { id: true },
        })
        .then((row) => {
          if (!row) throw new Error("No such application");
        }),
    );
  }
  if (input.contactId) {
    checks.push(
      db.contact
        .findFirst({ where: { id: input.contactId, userId, archivedAt: null }, select: { id: true } })
        .then((row) => {
          if (!row) throw new Error("No such contact");
        }),
    );
  }
  if (input.resumeId) {
    checks.push(
      db.resume.findFirst({ where: { id: input.resumeId, userId }, select: { id: true } }).then((row) => {
        if (!row) throw new Error("No such resume");
      }),
    );
  }
  await Promise.all(checks);
}

async function toRow(userId: string, input: LetterInput) {
  await checkLinks(userId, input);
  const fields = pick(input, EDITABLE);
  if (input.sentAt === undefined) return fields;
  return { ...fields, sentAt: toDate(await timeZoneOf(userId), input.sentAt) ?? null };
}

const letterInclude = {
  application: {
    select: { id: true, roleTitle: true, stage: true, company: { select: { id: true, name: true } } },
  },
  contact: { select: { id: true, name: true, email: true } },
  resume: { select: { id: true, name: true } },
} satisfies Prisma.LetterInclude;

export async function createLetter(userId: string, input: LetterInput) {
  return db.letter.create({
    data: { userId, ...(await toRow(userId, input)) },
    include: letterInclude,
  });
}

/**
 * Letters, newest first.
 *
 * The archive filter here is the fourth in the codebase that has to be spelled
 * out by hand, and the only one on a model that is not itself archivable: a
 * letter attached to a binned application leaves the lists with it, the same way
 * that application's tasks and timeline do. Unattached letters are always
 * listed — there is nothing for them to be archived with.
 */
export async function listLetters(
  userId: string,
  options?: {
    kind?: LetterKind;
    applicationId?: string;
    contactId?: string;
    draftsOnly?: boolean;
    search?: string;
    limit?: number;
  },
) {
  const where: Prisma.LetterWhereInput = {
    userId,
    ...(options?.kind ? { kind: options.kind } : {}),
    ...(options?.applicationId ? { applicationId: options.applicationId } : {}),
    ...(options?.contactId ? { contactId: options.contactId } : {}),
    ...(options?.draftsOnly ? { sentAt: null } : {}),
    OR: [{ applicationId: null }, { application: { archivedAt: null } }],
  };
  if (options?.search) {
    where.AND = [
      {
        OR: [
          { title: { contains: options.search, mode: "insensitive" } },
          { body: { contains: options.search, mode: "insensitive" } },
          { recipient: { contains: options.search, mode: "insensitive" } },
        ],
      },
    ];
  }
  return db.letter.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: options?.limit,
    include: letterInclude,
  });
}

export async function getLetter(userId: string, id: string) {
  return db.letter.findFirst({ where: { id, userId }, include: letterInclude });
}

/**
 * Patch a letter. Only the fields you send change.
 *
 * Unlike update_resume and update_role this is genuinely additive-safe: a
 * caller fixing a title cannot lose the body. Sending `body` DOES replace the
 * whole body, which is what editing prose means.
 */
export async function updateLetter(userId: string, id: string, patch: LetterInput) {
  const existing = await db.letter.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) throw new Error("No such letter");
  return db.letter.update({
    where: { id },
    data: await toRow(userId, patch),
    include: letterInclude,
  });
}

export async function deleteLetter(userId: string, id: string) {
  const { count } = await db.letter.deleteMany({ where: { id, userId } });
  if (count === 0) throw new Error("No such letter");
  return { deleted: count };
}

export type LetterContext = {
  kind: LetterKind;
  /** What this kind of letter is trying to do. Written for whoever drafts it. */
  intent: string;
  application: {
    id: string;
    company: string;
    roleTitle: string;
    stage: string;
    jobUrl: string;
    jobDescription: string;
    location: string;
    /** The company's own notes — research somebody did on purpose. */
    companyNotes: string;
    /** What they have already been told, newest first. */
    recentActivity: { type: string; body: string; occurredAt: Date }[];
  } | null;
  contact: { id: string; name: string; title: string; relationship: string; email: string } | null;
  resume: { id: string; name: string } | null;
  /** Material from Me that bears on this posting, ranked. */
  evidence: Awaited<ReturnType<typeof searchMe>>;
  /** Letters of the same kind already written, newest first. Their own voice. */
  priorLetters: { id: string; title: string; body: string; kind: LetterKind }[];
  /** What is not on file that would make the draft better. */
  missing: string[];
};

/**
 * Everything a good draft needs, in one call.
 *
 * Call this BEFORE writing. The five things a letter is built from live five
 * places apart — the posting, what the person has already been told, what they
 * have actually done, who they are writing to, and how they write — and an
 * assistant that skips the gather writes the generic letter everybody sends.
 *
 * `priorLetters` is the one that surprises people: two letters they wrote
 * themselves are worth more than any instruction about tone.
 */
export async function letterContext(
  userId: string,
  options: { kind?: LetterKind; applicationId?: string; contactId?: string },
): Promise<LetterContext> {
  const kind = options.kind ?? "COVER_LETTER";

  const application = options.applicationId
    ? await db.application.findFirst({
        where: { id: options.applicationId, userId, archivedAt: null },
        include: {
          company: { select: { id: true, name: true, notes: true } },
          resume: { select: { id: true, name: true } },
          activities: { orderBy: { occurredAt: "desc" }, take: 5 },
        },
      })
    : null;
  if (options.applicationId && !application) throw new Error("No such application");

  const contact = options.contactId
    ? await db.contact.findFirst({
        where: { id: options.contactId, userId, archivedAt: null },
        select: { id: true, name: true, title: true, relationship: true, email: true },
      })
    : null;
  if (options.contactId && !contact) throw new Error("No such contact");

  // The posting is the best query there is for "what of mine matters here".
  // Falling back to the role title alone still beats nothing.
  const query = application
    ? `${application.roleTitle} ${application.jobDescription}`.slice(0, 600)
    : contact
      ? `${contact.title} ${contact.relationship}`
      : "";

  const [evidence, priorLetters] = await Promise.all([
    query.trim() ? searchMe(userId, query, 12) : Promise.resolve([]),
    db.letter.findMany({
      where: { userId, kind, body: { not: "" } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, title: true, body: true, kind: true },
    }),
  ]);

  const missing: string[] = [];
  if (application && !application.jobDescription.trim()) {
    missing.push(
      "The posting itself is not on file — without it the letter can only answer the role title.",
    );
  }
  if (application && !application.company.notes.trim()) {
    missing.push("No research on the company, so nothing to say about why them specifically.");
  }
  if (!contact) missing.push("No named recipient, so this will have to open generically.");
  if (evidence.length === 0) {
    missing.push("Nothing in Me matched this posting. Ask before writing anything about their experience.");
  }
  if (priorLetters.length === 0) {
    missing.push("No earlier letter of this kind to take their voice from — ask how they want it to sound.");
  }

  return {
    kind,
    intent: LETTER_INTENT[kind],
    application: application && {
      id: application.id,
      company: application.company.name,
      roleTitle: application.roleTitle,
      stage: application.stage,
      jobUrl: application.jobUrl,
      jobDescription: application.jobDescription,
      location: application.location,
      companyNotes: application.company.notes,
      recentActivity: application.activities.map((activity) => ({
        type: activity.type,
        body: activity.body,
        occurredAt: activity.occurredAt,
      })),
    },
    contact,
    resume: application?.resume ?? null,
    evidence,
    priorLetters,
    missing,
  };
}

/** One letter as the browser needs it: dates flattened, links narrowed. */
export function letterForUi(letter: Awaited<ReturnType<typeof getLetter>> & object) {
  return {
    id: letter.id,
    kind: letter.kind,
    title: letter.title,
    body: letter.body,
    recipient: letter.recipient,
    sentAt: letter.sentAt?.toISOString() ?? null,
    updatedAt: letter.updatedAt.toISOString(),
    application: letter.application
      ? {
          id: letter.application.id,
          company: letter.application.company.name,
          roleTitle: letter.application.roleTitle,
        }
      : null,
    contact: letter.contact ? { id: letter.contact.id, name: letter.contact.name } : null,
  };
}
