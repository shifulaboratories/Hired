import type { ActivityType, LetterKind, Stage, TagKind } from "@prisma/client";

/**
 * A small, plausible job search, as data rather than as an illustration.
 *
 * The empty screens are the worst ten minutes in this product, and the fix is
 * not a picture of a pipeline — it is a pipeline, written through the ordinary
 * data functions, that moves, sorts, filters, exports and archives exactly like
 * the person's own will.
 *
 * PURE: no database, no dates. EVERY date here is an offset in days from load
 * time, never a literal, because a fixture with 2026 in it reads as stale the
 * moment the calendar moves past it — and a sample whose dates are in the past
 * teaches the funnel and the follow-up list nothing.
 *
 * The employers are invented and were checked against nothing real.
 */

export const SAMPLE_VERSION = "2026-09-19";

/** The line every sample company's notes opens with, so it is findable by eye. */
export const SAMPLE_MARK = "Part of the sample search. wipe_sample_workspace removes it.";

export type SampleFixture = {
  tags: { kind: TagKind; name: string; color: string }[];
  companies: { key: string; name: string; website: string; notes: string; industry: string[]; size: string[]; location: string[]; tags: string[] }[];
  applications: {
    key: string;
    company: string;
    roleTitle: string;
    stage: Stage;
    interviewRound: number;
    roundLabel: string;
    location: string;
    workMode: string;
    salaryRange: string;
    jobUrl: string;
    notes: string;
    appliedDaysAgo: number | null;
    followUpInDays: number | null;
    tags: string[];
    lossReasons: string[];
  }[];
  contacts: {
    key: string;
    name: string;
    title: string;
    email: string;
    relationship: string;
    companies: string[];
    application?: string;
    tags: string[];
  }[];
  activities: { application?: string; contact?: string; type: ActivityType; body: string; daysAgo: number }[];
  offers: {
    application: string;
    currency: string;
    base: number;
    bonus: number;
    equity: number;
    signOn: number;
    terms: string;
    receivedDaysAgo: number;
    respondInDays: number;
  }[];
  tasks: { title: string; detail: string; application?: string; dueInDays: number }[];
  letters: { kind: LetterKind; title: string; recipient: string; body: string; application?: string }[];
  resume: { name: string; doc: unknown };
};

const notes = (rest: string) => `${SAMPLE_MARK}\n\n${rest}`;

export const SAMPLE_FIXTURE: SampleFixture = {
  // A second, human-visible handle. Somebody who loses the manifest can still
  // find the whole sample with one filter.
  tags: [
    { kind: "APPLICATION", name: "Sample", color: "slate" },
    { kind: "COMPANY", name: "Sample", color: "slate" },
    { kind: "CONTACT", name: "Sample", color: "slate" },
    { kind: "APPLICATION", name: "Referral", color: "green" },
    { kind: "APPLICATION", name: "LinkedIn", color: "blue" },
    { kind: "LOSS", name: "Role cancelled", color: "amber" },
  ],

  companies: [
    {
      key: "northwind",
      name: "Northwind Trading",
      website: "northwindtrading.example",
      notes: notes(
        "Logistics software, about 400 people, Series C last spring. The team I would join owns the carrier integrations — Priya said they have been trying to hire this role since February.",
      ),
      industry: ["Logistics"],
      size: ["200–500"],
      location: ["Remote — US"],
      tags: ["Sample"],
    },
    {
      key: "meridian",
      name: "Meridian Health",
      website: "meridianhealth.example",
      notes: notes(
        "Patient scheduling for mid-size clinics. Slower, older, pays well. Their engineering blog is thin, so most of what I know came from the screen.",
      ),
      industry: ["Healthcare"],
      size: ["500–1000"],
      location: ["Chicago"],
      tags: ["Sample"],
    },
    {
      key: "harbor",
      name: "Harbor & Vale",
      website: "harborandvale.example",
      notes: notes("Design studio moving into product. Twelve people. The role was cancelled a week after the first call."),
      industry: ["Design"],
      size: ["1–50"],
      location: ["New York"],
      tags: ["Sample"],
    },
    {
      key: "tessellate",
      name: "Tessellate Labs",
      website: "tessellatelabs.example",
      notes: notes("Developer tools, seed stage, eight people. Interesting, underpaid, and the one I keep coming back to."),
      industry: ["Developer tools"],
      size: ["1–50"],
      location: ["Remote — worldwide"],
      tags: ["Sample"],
    },
  ],

  applications: [
    {
      key: "tessellate-pm",
      company: "Tessellate Labs",
      roleTitle: "Founding Product Manager",
      stage: "WISHLIST",
      interviewRound: 0,
      roundLabel: "",
      location: "Remote — worldwide",
      workMode: "Remote",
      salaryRange: "$150k – $180k + 1.5%",
      jobUrl: "",
      notes: "Have not applied. Want to talk to somebody there first.",
      appliedDaysAgo: null,
      followUpInDays: 4,
      tags: ["Sample"],
      lossReasons: [],
    },
    {
      key: "meridian-pm",
      company: "Meridian Health",
      roleTitle: "Senior Product Manager",
      stage: "APPLIED",
      interviewRound: 0,
      roundLabel: "",
      location: "Chicago",
      workMode: "Hybrid",
      salaryRange: "$165k – $190k",
      jobUrl: "",
      notes: "Applied through their own site. No acknowledgement yet.",
      appliedDaysAgo: 19,
      followUpInDays: 1,
      tags: ["Sample", "LinkedIn"],
      lossReasons: [],
    },
    {
      key: "northwind-pm",
      company: "Northwind Trading",
      roleTitle: "Product Manager, Integrations",
      stage: "INTERVIEWING",
      interviewRound: 2,
      roundLabel: "Take-home",
      location: "Remote — US",
      workMode: "Remote",
      salaryRange: "$170k – $200k",
      jobUrl: "",
      notes: "Priya put me forward. Take-home is a two-page integration plan, due Friday.",
      appliedDaysAgo: 26,
      followUpInDays: 3,
      tags: ["Sample", "Referral"],
      lossReasons: [],
    },
    {
      key: "northwind-ops",
      company: "Northwind Trading",
      roleTitle: "Operations Lead",
      stage: "APPLIED",
      interviewRound: 0,
      roundLabel: "",
      location: "Remote — US",
      workMode: "Remote",
      salaryRange: "",
      jobUrl: "",
      notes: "Second role at the same employer — this is what two live applications at one company looks like.",
      appliedDaysAgo: 8,
      followUpInDays: 6,
      tags: ["Sample"],
      lossReasons: [],
    },
    {
      key: "meridian-lead",
      company: "Meridian Health",
      roleTitle: "Group Product Manager",
      stage: "OFFER",
      interviewRound: 4,
      roundLabel: "Final",
      location: "Chicago",
      workMode: "Hybrid",
      salaryRange: "$180k – $210k",
      jobUrl: "",
      notes: "They came back with a better number a week after the first. Both are on file — that is the point.",
      appliedDaysAgo: 48,
      followUpInDays: 2,
      tags: ["Sample"],
      lossReasons: [],
    },
    {
      key: "harbor-pm",
      company: "Harbor & Vale",
      roleTitle: "Product Lead",
      stage: "LOST",
      interviewRound: 1,
      roundLabel: "Intro call",
      location: "New York",
      workMode: "Onsite",
      salaryRange: "$160k",
      jobUrl: "",
      notes: "Cancelled the role. Nothing to do with the conversation, which went well.",
      appliedDaysAgo: 40,
      followUpInDays: null,
      tags: ["Sample"],
      lossReasons: ["Role cancelled"],
    },
  ],

  contacts: [
    {
      key: "priya",
      name: "Priya Raman",
      title: "Engineering Manager",
      email: "priya@northwindtrading.example",
      relationship: "Ex-colleague",
      // TWO companies on one person, because ContactCompany being many-to-many
      // is a thing nobody discovers on their own.
      companies: ["Northwind Trading", "Tessellate Labs"],
      application: "northwind-pm",
      tags: ["Sample"],
    },
    {
      key: "dana",
      name: "Dana Okafor",
      title: "Technical Recruiter",
      email: "dana@meridianhealth.example",
      relationship: "Recruiter",
      companies: ["Meridian Health"],
      application: "meridian-lead",
      tags: ["Sample"],
    },
    {
      key: "sam",
      name: "Sam Whitfield",
      title: "Head of Product",
      email: "sam@meridianhealth.example",
      relationship: "Hiring manager",
      companies: ["Meridian Health"],
      application: "meridian-lead",
      tags: ["Sample"],
    },
    {
      key: "nadia",
      name: "Nadia Brandt",
      title: "Founder",
      email: "nadia@tessellatelabs.example",
      relationship: "Warm intro",
      companies: ["Tessellate Labs"],
      tags: ["Sample"],
    },
    {
      key: "tomas",
      name: "Tomas Lindqvist",
      title: "Studio Director",
      email: "tomas@harborandvale.example",
      relationship: "Hiring manager",
      companies: ["Harbor & Vale"],
      application: "harbor-pm",
      tags: ["Sample"],
    },
  ],

  activities: [
    { application: "northwind-pm", type: "APPLIED", body: "Applied through Priya rather than the careers page.", daysAgo: 26 },
    { application: "northwind-pm", type: "EMAIL_RECEIVED", body: "Recruiter screen booked for the 3rd.", daysAgo: 22 },
    { application: "northwind-pm", type: "INTERVIEW", body: "Screen with the hiring manager. Spent most of it on the carrier integration backlog — they are two quarters behind on it.", daysAgo: 14 },
    { application: "northwind-pm", type: "EMAIL_RECEIVED", body: "Take-home sent: a two-page integration plan, due Friday.", daysAgo: 4 },
    { application: "northwind-ops", type: "APPLIED", body: "Applied to the second role at Northwind on the same day I heard about it.", daysAgo: 8 },
    { application: "meridian-pm", type: "APPLIED", body: "Applied through their own site. No acknowledgement.", daysAgo: 19 },
    { application: "meridian-lead", type: "APPLIED", body: "Applied after Dana got in touch.", daysAgo: 48 },
    { application: "meridian-lead", type: "INTERVIEW", body: "Panel with the two staff PMs. Asked how I would sequence the scheduling rewrite.", daysAgo: 24 },
    { application: "meridian-lead", type: "INTERVIEW", body: "Final with Sam. Mostly about how the team is run.", daysAgo: 12 },
    { application: "meridian-lead", type: "OFFER", body: "Verbal offer on the call: 185 base, 10% bonus.", daysAgo: 10 },
    { application: "meridian-lead", type: "OFFER", body: "Revised offer after I said the base was short: 203 base, same bonus, 15k sign-on.", daysAgo: 3 },
    { application: "harbor-pm", type: "INTERVIEW", body: "Intro call with Tomas. Good conversation about what a product function would even do there.", daysAgo: 42 },
    { application: "harbor-pm", type: "REJECTION", body: "Role cancelled. Tomas wrote to say the budget went.", daysAgo: 40 },
    { contact: "priya", type: "CALL", body: "Coffee. She mentioned Northwind had been trying to fill this since February.", daysAgo: 30 },
    { contact: "nadia", type: "OUTREACH", body: "Messaged about the founding PM role before applying. She suggested a call.", daysAgo: 6 },
  ],

  offers: [
    // TWO offers on one application, a week apart and eighteen thousand higher.
    // This is the single most important thing the sample teaches: offers are
    // rows here, not columns, because the movement between them IS the
    // negotiation record.
    {
      application: "meridian-lead",
      currency: "USD",
      base: 185000,
      bonus: 18500,
      equity: 0,
      signOn: 0,
      terms: "First number, on the call. 10% target bonus, four weeks' holiday.",
      receivedDaysAgo: 10,
      respondInDays: -3,
    },
    {
      application: "meridian-lead",
      currency: "USD",
      base: 203000,
      bonus: 20300,
      equity: 0,
      signOn: 15000,
      terms: "Revised after I said the base was short. Same bonus percentage, sign-on added.",
      receivedDaysAgo: 3,
      respondInDays: 4,
    },
  ],

  tasks: [
    { title: "Finish the Northwind take-home", detail: "Two pages on how I would sequence the carrier integrations.", application: "northwind-pm", dueInDays: 2 },
    // Overdue on purpose: an empty Today screen teaches nothing about what
    // overdue looks like.
    { title: "Chase Meridian about the senior PM role", detail: "Nineteen days, no acknowledgement.", application: "meridian-pm", dueInDays: -2 },
    { title: "Decide on the Meridian offer", detail: "They want an answer by the end of the week.", application: "meridian-lead", dueInDays: 4 },
  ],

  letters: [
    {
      kind: "COVER_LETTER",
      title: "Northwind Trading — cover letter",
      recipient: "Priya",
      application: "northwind-pm",
      body: "Priya mentioned you have been trying to fill this since February, and the part of the job she described — untangling the carrier integrations without stopping the roadmap — is the thing I have actually done.\n\nAt my last place the equivalent was three payment providers behind one interface, shipped over two quarters with nothing taken offline. What made it work was agreeing up front which of the three we would stop supporting, which is the conversation nobody wants to have first.\n\nI would rather show you the plan than describe it. Happy to walk through how I would sequence yours.",
    },
    {
      kind: "THANK_YOU",
      title: "Meridian — after the final",
      recipient: "Sam",
      application: "meridian-lead",
      body: "Thank you for the time yesterday — the part about how you run planning was the most useful half hour I have had in this search.\n\nOne thing I did not answer well: you asked how I would handle the clinics still on the old scheduler. I would keep them on it and make the new one opt-in per clinic rather than per feature, which is slower and much easier to reverse.\n\nWhatever you decide, it was a good conversation.",
    },
  ],

  resume: {
    name: "Sample — Product Manager",
    doc: {
      header: {
        name: "Sample Person",
        title: "Product Manager",
        email: "sample@example.com",
        phone: "",
        location: "Remote",
        links: [{ label: "", url: "https://example.com/sample" }],
      },
      sections: [
        {
          kind: "summary",
          heading: "Summary",
          visible: true,
          text: "Product manager for platform and integration work. Happiest where the roadmap meets somebody else's API.",
        },
        {
          kind: "experience",
          heading: "Experience",
          visible: true,
          experience: [
            {
              title: "Product Manager",
              company: "Example Corp",
              location: "Remote",
              startDate: "2022-01",
              endDate: "",
              isCurrent: true,
              summary: "",
              bullets: [
                "Put three payment providers behind one interface over two quarters with no downtime.",
                "Cut integration support tickets by 60% by agreeing which provider to drop before writing anything.",
              ],
            },
          ],
        },
      ],
    },
  },
};
