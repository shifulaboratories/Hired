/**
 * The six templates, in one place.
 *
 * They were written out by hand in four places that had no reason to agree:
 * `get_resume_format`'s handler, the Design popover's select, the new-resume
 * dialog's cards, and `PHOTO_TEMPLATES` in resume-paper.tsx. Four lists, one
 * subject — the same shape LINES_PER_PAGE and LETTER_LABEL each cost this
 * codebase once.
 *
 * PURE and client-safe, beside resume-text.ts and for the same reason: the
 * editor and the paper are client components, and the tool handler is not.
 *
 * `template` is a plain String column on Resume with a default of "harvard",
 * NOT part of the resume document contract in resume-schema.ts. Adding a value
 * here touches no zod schema and no saved `Resume.data`.
 */

export type ResumeTemplate = {
  key: string;
  /** What the picker calls it. */
  name: string;
  /** One clause, for the card in the new-resume dialog. */
  hint: string;
  /** The paragraph get_resume_format hands an assistant choosing one. */
  description: string;
  /** False where the format's own convention forbids one: harvard, ats. */
  takesPhoto: boolean;
  /** False where the template ignores `accent` and prints black: ats. */
  takesAccent: boolean;
};

export const DEFAULT_TEMPLATE = "harvard";

export const RESUME_TEMPLATES: readonly ResumeTemplate[] = [
  {
    key: "harvard",
    name: "Harvard",
    hint: "Dense, black and white, the academic standard",
    description:
      "DEFAULT. The Harvard OCS format: Times-metric serif, everything one size, name and section headings centred over full-width rules, each entry two justified lines (organisation/location, then role/dates). Dense, black-and-white, maximally ATS-safe. Use this unless asked otherwise.",
    // The format's own convention has no photograph on it.
    takesPhoto: false,
    takesAccent: true,
  },
  {
    key: "classic",
    name: "Classic",
    hint: "Serif headings, centred",
    description:
      "Serif headings, centred header. Timeless, ATS-safe. Takes a photo, centred above the name.",
    takesPhoto: true,
    takesAccent: true,
  },
  {
    key: "modern",
    name: "Modern",
    hint: "Sans-serif, accent rules",
    description:
      "Sans-serif, accent rules, left-aligned header. Takes a photo, beside the name.",
    takesPhoto: true,
    takesAccent: true,
  },
  {
    key: "compact",
    name: "Compact",
    hint: "Tight leading, fits the most",
    description:
      "Tight leading, two-column skills. Fits the most content. Takes a photo, beside the name.",
    takesPhoto: true,
    takesAccent: true,
  },
  {
    key: "editorial",
    name: "Editorial",
    hint: "Large display name, generous space",
    description:
      "Large display name, generous whitespace, magazine feel. Takes a photo, squared off beside the name.",
    takesPhoto: true,
    takesAccent: true,
  },
  {
    key: "ats",
    name: "Plain (ATS)",
    hint: "One column, black, every link printed as its URL",
    description:
      "Plain, single column, black on white, no accent colour and no photo. Conventional headings, dates as ordinary text, real list markers, and every link printed as its URL rather than as a label with the address hidden in the markup. Reach for it when a portal is going to parse the file rather than a person read it, or when somebody asks for something 'ATS-friendly' — and say plainly that harvard is already safe, that this is a smaller difference than the internet claims, and that preview_ats_text will show them exactly what changes.",
    takesPhoto: false,
    takesAccent: false,
  },
];

const byKey = new Map(RESUME_TEMPLATES.map((template) => [template.key, template]));

export const TEMPLATE_KEYS: string[] = RESUME_TEMPLATES.map((template) => template.key);

/** Unknown keys fall through to the default's answer, which is the safe one. */
export function templateTakesPhoto(key: string): boolean {
  return byKey.get(key)?.takesPhoto ?? byKey.get(DEFAULT_TEMPLATE)!.takesPhoto;
}

export function templateTakesAccent(key: string): boolean {
  return byKey.get(key)?.takesAccent ?? true;
}
