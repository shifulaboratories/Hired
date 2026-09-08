import { z } from "zod";

/**
 * The resume document. This is the contract between the UI, the database
 * (Resume.data) and the MCP tools Claude calls. Keep it boring and flat —
 * every field is optional-with-default so a partially generated document
 * still renders.
 */

export const linkSchema = z.object({
  label: z.string().default(""),
  url: z.string().default(""),
});

export const headerSchema = z.object({
  name: z.string().default(""),
  title: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
  location: z.string().default(""),
  links: z.array(linkSchema).default([]),
});

export const experienceItemSchema = z.object({
  id: z.string().default(""),
  company: z.string().default(""),
  title: z.string().default(""),
  location: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  isCurrent: z.boolean().default(false),
  summary: z.string().default(""),
  bullets: z.array(z.string()).default([]),
  /// Optional back-reference to the Role this was tailored from.
  roleId: z.string().optional(),
});

export const educationItemSchema = z.object({
  id: z.string().default(""),
  school: z.string().default(""),
  degree: z.string().default(""),
  field: z.string().default(""),
  location: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  details: z.array(z.string()).default([]),
});

export const projectItemSchema = z.object({
  id: z.string().default(""),
  name: z.string().default(""),
  role: z.string().default(""),
  url: z.string().default(""),
  startDate: z.string().default(""),
  endDate: z.string().default(""),
  description: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});

export const skillGroupSchema = z.object({
  name: z.string().default(""),
  skills: z.array(z.string()).default([]),
});

export const certItemSchema = z.object({
  name: z.string().default(""),
  issuer: z.string().default(""),
  date: z.string().default(""),
});

export const customItemSchema = z.object({
  title: z.string().default(""),
  subtitle: z.string().default(""),
  meta: z.string().default(""),
  bullets: z.array(z.string()).default([]),
});

export const SECTION_KINDS = [
  "summary",
  "experience",
  "education",
  "projects",
  "skills",
  "certifications",
  "custom",
] as const;

export const sectionSchema = z.object({
  id: z.string().default(""),
  kind: z.enum(SECTION_KINDS),
  /// Display heading, e.g. "Experience" or "Selected Work"
  heading: z.string().default(""),
  visible: z.boolean().default(true),
  /// Only one of these is used, depending on `kind`.
  text: z.string().default(""),
  experience: z.array(experienceItemSchema).default([]),
  education: z.array(educationItemSchema).default([]),
  projects: z.array(projectItemSchema).default([]),
  skills: z.array(skillGroupSchema).default([]),
  certifications: z.array(certItemSchema).default([]),
  items: z.array(customItemSchema).default([]),
});

export const resumeDocSchema = z.object({
  header: headerSchema.default({}),
  sections: z.array(sectionSchema).default([]),
});

export type ResumeLink = z.infer<typeof linkSchema>;
export type ResumeHeader = z.infer<typeof headerSchema>;
export type ExperienceItem = z.infer<typeof experienceItemSchema>;
export type EducationItem = z.infer<typeof educationItemSchema>;
export type ProjectItem = z.infer<typeof projectItemSchema>;
export type SkillGroupItem = z.infer<typeof skillGroupSchema>;
export type CertItem = z.infer<typeof certItemSchema>;
export type CustomItem = z.infer<typeof customItemSchema>;
export type ResumeSection = z.infer<typeof sectionSchema>;
export type ResumeDoc = z.infer<typeof resumeDocSchema>;
export type SectionKind = (typeof SECTION_KINDS)[number];

let idCounter = 0;
export function rid(prefix = "s") {
  idCounter += 1;
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${idCounter}`;
}

/**
 * Give every section and entry an id of its own.
 *
 * Every id defaults to "" and RESUME_DOC_SHAPE never mentions ids, so a
 * document written through create_resume — the product's main path — arrives
 * with "" on every section. The editor addressed sections by id, so such a
 * document had one identity for all of them: hiding one section hid the lot,
 * and deleting one deleted the document. Healed here rather than at the write,
 * because the first edit happens before the first save.
 *
 * Deterministic on purpose. rid() is random, and a random id minted on every
 * read would churn between one get_resume and the next, and would make two
 * parses of the same stored document unequal. Positional names are stable, so
 * a document parsed twice is the same document.
 */
export function ensureIds(doc: ResumeDoc): ResumeDoc {
  const used = new Set<string>();
  // Keep an id the document already carries, unless it is blank or a
  // duplicate; otherwise take the positional name, and walk it until it is
  // free. Total: it always returns something no other entry holds.
  const claim = (id: string, positional: string) => {
    let next = id && !used.has(id) ? id : positional;
    let n = 2;
    while (used.has(next)) next = `${positional}_${n++}`;
    used.add(next);
    return next;
  };
  return {
    ...doc,
    sections: doc.sections.map((section, s) => ({
      ...section,
      id: claim(section.id, `sec_${s}`),
      experience: section.experience.map((item, i) => ({
        ...item,
        id: claim(item.id, `exp_${s}_${i}`),
      })),
      education: section.education.map((item, i) => ({
        ...item,
        id: claim(item.id, `edu_${s}_${i}`),
      })),
      projects: section.projects.map((item, i) => ({
        ...item,
        id: claim(item.id, `prj_${s}_${i}`),
      })),
    })),
  };
}

export function parseResumeDoc(value: unknown): ResumeDoc {
  const parsed = resumeDocSchema.safeParse(value);
  if (parsed.success) return ensureIds(parsed.data);
  return emptyResumeDoc();
}

export function emptyResumeDoc(): ResumeDoc {
  return {
    header: { name: "", title: "", email: "", phone: "", location: "", links: [] },
    sections: [
      { ...blankSection("summary"), heading: "Summary" },
      { ...blankSection("experience"), heading: "Experience" },
      { ...blankSection("education"), heading: "Education" },
      { ...blankSection("skills"), heading: "Skills" },
    ],
  };
}

export function blankSection(kind: SectionKind): ResumeSection {
  return {
    id: rid("sec"),
    kind,
    heading: defaultHeading(kind),
    visible: true,
    text: "",
    experience: [],
    education: [],
    projects: [],
    skills: [],
    certifications: [],
    items: [],
  };
}

export function defaultHeading(kind: SectionKind) {
  switch (kind) {
    case "summary":
      return "Summary";
    case "experience":
      return "Experience";
    case "education":
      return "Education";
    case "projects":
      return "Projects";
    case "skills":
      return "Skills";
    case "certifications":
      return "Certifications";
    default:
      return "Additional";
  }
}

export function blankExperience(): ExperienceItem {
  return {
    id: rid("exp"),
    company: "",
    title: "",
    location: "",
    startDate: "",
    endDate: "",
    isCurrent: false,
    summary: "",
    bullets: [""],
  };
}

export function blankEducation(): EducationItem {
  return {
    id: rid("edu"),
    school: "",
    degree: "",
    field: "",
    location: "",
    startDate: "",
    endDate: "",
    details: [],
  };
}

export function blankProject(): ProjectItem {
  return {
    id: rid("prj"),
    name: "",
    role: "",
    url: "",
    startDate: "",
    endDate: "",
    description: "",
    bullets: [""],
  };
}

/** A compact, human-readable description of the doc shape for the MCP tool docs. */
export const RESUME_DOC_SHAPE = `{
  "header": {
    "name": string, "title": string, "email": string, "phone": string,
    "location": string, "links": [{ "label": string, "url": string }]
  },
  "sections": [
    { "kind": "summary", "heading": "Summary", "visible": true, "text": string },
    { "kind": "experience", "heading": "Experience", "visible": true,
      "experience": [{ "company": string, "title": string, "location": string,
                       "startDate": "YYYY-MM", "endDate": "YYYY-MM", "isCurrent": boolean,
                       "summary": string, "bullets": [string] }] },
    { "kind": "education", "heading": "Education", "visible": true,
      "education": [{ "school": string, "degree": string, "field": string,
                      "location": string, "startDate": "YYYY-MM", "endDate": "YYYY-MM",
                      "details": [string] }] },
    { "kind": "projects", "heading": "Projects", "visible": true,
      "projects": [{ "name": string, "role": string, "url": string,
                     "startDate": "YYYY-MM", "endDate": "YYYY-MM",
                     "description": string, "bullets": [string] }] },
    { "kind": "skills", "heading": "Skills", "visible": true,
      "skills": [{ "name": string, "skills": [string] }] },
    { "kind": "certifications", "heading": "Certifications", "visible": true,
      "certifications": [{ "name": string, "issuer": string, "date": string }] },
    { "kind": "custom", "heading": string, "visible": true,
      "items": [{ "title": string, "subtitle": string, "meta": string, "bullets": [string] }] }
  ]
}`;
