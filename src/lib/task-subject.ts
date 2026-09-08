/**
 * What a task is about, as one shape the whole app renders.
 *
 * A task carries six nullable foreign keys and at most one of them is set. Left
 * to each screen, "which one is it and what do I call it" would be written
 * three times and drift twice — the dashboard would say the company, the tasks
 * page the role, and neither would link anywhere useful. So the reading happens
 * once, here, and every screen takes the answer.
 *
 * Pure and dependency-free: no Prisma types, so the server can shape a row and
 * a client component can hold the result without dragging the schema across the
 * boundary.
 */

export type TaskSubjectKind =
  | "application"
  | "company"
  | "contact"
  | "resume"
  | "role"
  | "note";

export type TaskSubjectView = {
  kind: TaskSubjectKind;
  id: string;
  /** What to print. Two lines' worth for an application, one for everything else. */
  label: string;
  /** Where clicking it goes. */
  href: string;
};

/** The word for each kind, for a picker and for a screen reader. */
export const SUBJECT_LABEL: Record<TaskSubjectKind, string> = {
  application: "Application",
  company: "Company",
  contact: "Person",
  resume: "Resume",
  role: "Role in Me",
  note: "Note",
};

/** The row shape this reads. Satisfied by listTasks. */
export type TaskWithSubject = {
  application?: { id: string; roleTitle: string; company: { name: string } } | null;
  company?: { id: string; name: string } | null;
  contact?: { id: string; name: string } | null;
  resume?: { id: string; name: string } | null;
  role?: { id: string; title: string; company: string } | null;
  note?: { id: string; title: string } | null;
};

/**
 * The first subject a task actually has.
 *
 * Ordered, and the order is load-bearing: nothing in Postgres stops a
 * hand-written row from setting two, and a screen that rendered both would be
 * showing a task in two places. First one wins, deterministically.
 */
export function taskSubjectOf(task: TaskWithSubject): TaskSubjectView | null {
  if (task.application) {
    return {
      kind: "application",
      id: task.application.id,
      label: `${task.application.roleTitle} · ${task.application.company.name}`,
      href: `/applications/${task.application.id}`,
    };
  }
  if (task.company) {
    return {
      kind: "company",
      id: task.company.id,
      label: task.company.name,
      href: `/crm/companies/${task.company.id}`,
    };
  }
  if (task.contact) {
    return {
      kind: "contact",
      id: task.contact.id,
      label: task.contact.name,
      href: `/crm/contacts/${task.contact.id}`,
    };
  }
  if (task.resume) {
    return {
      kind: "resume",
      id: task.resume.id,
      label: task.resume.name,
      href: `/resumes/${task.resume.id}`,
    };
  }
  if (task.role) {
    return {
      kind: "role",
      id: task.role.id,
      // A role is "Staff Engineer at Vertex" to a person, and the two halves
      // live in two columns.
      label: [task.role.title, task.role.company].filter(Boolean).join(" · "),
      href: `/me/${task.role.id}`,
    };
  }
  if (task.note) {
    return {
      kind: "note",
      id: task.note.id,
      label: task.note.title || "Untitled note",
      href: "/me?tab=notes",
    };
  }
  return null;
}
