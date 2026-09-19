import type { LetterKind } from "@prisma/client";

/**
 * The ten words that describe a kind of document, and what each one is for.
 *
 * A PURE module, beside resume-text.ts and for the reason its header gives:
 * `src/lib/data/letters.ts` imports `@/lib/db`, and `letters-panel.tsx` is a
 * client component, so a client importing these maps from the data layer would
 * drag Prisma into the browser bundle. They were duplicated instead — the same
 * shape this codebase already paid for once with LINES_PER_PAGE — and this is
 * the same answer: one module neither side has a reason to avoid.
 *
 * It touches no user data and takes no userId, so the userId-first rule does
 * not apply to it and it is not an exception to it.
 *
 * THE KEY ORDER OF `LETTER_LABEL` IS LOAD-BEARING. It is the order every picker
 * and every tool enum shows, because LETTER_KINDS is derived from it. Object
 * key order is stable for string keys, so this is safe — but reordering is now
 * something done on purpose rather than by accident.
 */

/** Display name. The one copy; letters-panel.tsx used to keep a second. */
export const LETTER_LABEL: Record<LetterKind, string> = {
  COVER_LETTER: "Cover letter",
  OUTREACH: "Cold outreach",
  REFERRAL_ASK: "Referral ask",
  THANK_YOU: "Thank-you",
  REPLY: "Reply",
  LINKEDIN_ABOUT: "LinkedIn About",
  HEADLINE: "Headline",
  SELF_REVIEW: "Self-review",
  BRAG_DOC: "Brag doc",
  // Last, where a picker wants it.
  OTHER: "Other",
};

/**
 * Every kind, in the order the pickers show them.
 *
 * DERIVED from LETTER_LABEL, which is a Record<LetterKind, string> and
 * therefore exhaustive — a value added to the Prisma enum and forgotten here
 * now fails to compile, instead of being accepted by the database and quietly
 * refused by five tool schemas. The old hand-kept array was
 * `as const satisfies readonly LetterKind[]`, which is a SUBSET assertion and
 * caught nothing.
 */
export const LETTER_KINDS: LetterKind[] = Object.keys(LETTER_LABEL) as LetterKind[];

/**
 * Which kinds are correspondence: they have a recipient, a date and a
 * letterhead. The rest are documents about the person, and LetterPaper prints
 * them without any of that — a brag doc addressed to somebody, dated like a
 * letter, is a brag doc that looks like a mistake.
 */
export const IS_CORRESPONDENCE: Record<LetterKind, boolean> = {
  COVER_LETTER: true,
  OUTREACH: true,
  REFERRAL_ASK: true,
  THANK_YOU: true,
  REPLY: true,
  OTHER: true,
  LINKEDIN_ABOUT: false,
  HEADLINE: false,
  SELF_REVIEW: false,
  BRAG_DOC: false,
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
  LINKEDIN_ABOUT:
    'The first-person paragraph at the top of a LinkedIn profile. Written for somebody deciding whether to open a conversation, not for a hiring system. Three or four short paragraphs, specific about what they actually do, and the first two lines carry it — the rest sits behind "see more" and most people never open it.',
  HEADLINE:
    "The line under a name on LinkedIn, or across the top of a resume. Around 200 characters at most, and it says what they do rather than what they are called. No stack of five nouns separated by pipes.",
  SELF_REVIEW:
    "What they write about themselves at a performance review, for the job they already have. Organised by what shipped and what it was worth, not by what they were busy with. The reader was there, so nothing gets explained twice and nothing gets inflated — every claim has to be something they can point at.",
  BRAG_DOC:
    "A running private list of what they have done, kept so the next review, the next resume and the next interview are not written from memory. Dated entries, plain language, numbers where there are numbers. It goes to nobody, which is the point: it is the raw material for everything that does.",
  OTHER: "Whatever it is. Keep it in their own voice.",
};

/** What each kind is for, as a textarea placeholder. Shown empty, never saved. */
export const LETTER_PLACEHOLDER: Record<LetterKind, string> = {
  COVER_LETTER:
    "Why this employer, what you have done that bears on this job, and nothing the resume already says.",
  OUTREACH: "Short enough to read on a phone. Why them specifically, and one small ask.",
  REFERRAL_ASK:
    "Name the role, link the posting, and give them two lines they can forward without editing.",
  THANK_YOU: "One thing from the conversation, one gap you noticed, and no ask.",
  REPLY: "Answer the actual question they asked.",
  LINKEDIN_ABOUT:
    "First person, three or four short paragraphs. The first two lines are the ones people read.",
  HEADLINE: "One line. What you do, not what you are called.",
  SELF_REVIEW: "What shipped and what it was worth. The reader was there.",
  BRAG_DOC: "Dated entries. Plain language. Numbers where there are numbers.",
  OTHER: "",
};
