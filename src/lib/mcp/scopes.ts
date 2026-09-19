import type { McpScope } from "@prisma/client";

/**
 * The manual's sections, and the four jobs built out of them.
 *
 * Two things need these boundaries now — the manual's pages and a connection's
 * scope — and two copies of a range table is a drift waiting for a new tool to
 * land in the wrong one. `tools/gen-tool-docs.mjs` keeps only what is about
 * pages (file, title, icon, blurb) and asserts its keys against this list.
 *
 * Boundaries are first/last tool NAMES rather than indexes, so reordering the
 * array is caught rather than silently reshuffling both the manual and every
 * scope.
 *
 * Both literals below are PLAIN DATA — no function calls, no template strings,
 * no spreads — because tools/tool-source.mjs evaluates them as text. Keep them
 * that way.
 *
 * This file is not in src/lib/data/: it touches no database and takes no
 * userId, the same way src/lib/pipeline-fields.ts and src/lib/column-widths.ts
 * do not. It must stay importable by tools.ts with NO import back the other
 * way, or the module graph cycles.
 */
export const SECTIONS = [
  { key: "me", first: "search_me", last: "preview_resume_import" },
  { key: "resumes", first: "get_resume_format", last: "preview_resume_text" },
  { key: "letters", first: "prep_letter", last: "delete_letter" },
  { key: "pipeline", first: "pipeline_stats", last: "set_column_widths" },
  { key: "crm", first: "list_companies", last: "schedule_contact_pings" },
  { key: "archive", first: "list_archive", last: "empty_archive" },
  { key: "accounts", first: "list_linked_accounts", last: "search_calendar" },
  { key: "connections", first: "get_digest_settings", last: "delete_connection" },
  { key: "admin", first: "admin_instance_stats", last: "admin_delete_variable" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * The four tools every scope carries, whatever else it does not.
 *
 * Small on purpose, and read-only to a tool. The briefing names `search_me` as
 * the way in and would be lying in three scopes out of four without it;
 * `whoami` and `list_connections` are how a narrowed client explains ITSELF,
 * which is the difference between "I can't do that" and "that tool isn't served
 * here, and here is how your person widens it"; `get_setup_status` is what a
 * first conversation opens with. Nothing that writes is ever core — which is
 * what makes READONLY's core fall out for free rather than needing an
 * exception.
 */
export const CORE_TOOLS = ["search_me", "whoami", "get_setup_status", "list_connections"] as const;

export const SCOPES = [
  {
    key: "FULL",
    label: "Everything",
    /** Empty sections means "no filter at all", not "no sections". */
    sections: [],
    extras: [],
    readOnly: false,
    blurb:
      "Every tool this account can reach. The default, and what every connection had before scopes existed.",
  },
  {
    key: "WRITING",
    label: "Me, resumes and letters",
    sections: ["me", "resumes", "letters"],
    /**
     * A document is aimed at a job at a company, and tailor_resume_for_application,
     * prep_letter and create_letter all take an applicationId somebody has to
     * look up first. get_company is already in ALWAYS_LOAD for the same reason.
     */
    extras: [
      "list_applications",
      "get_application",
      "list_companies",
      "get_company",
      // The undo path. These are filed under connections because that is where
      // the change log lives, but they are about WRITES — and a scope whose
      // whole job is writing roles and resumes, with no way back from an
      // update_role that ate somebody's background, is the exact footgun they
      // were built for. `--scope-audit` in tools/eval-tool-choice.mjs is what
      // found them sitting in FULL alone.
      "list_changes",
      "list_revisions",
      "restore_revision",
      "undo_change",
    ],
    readOnly: false,
    blurb:
      "Writes documents and the material behind them. Cannot move the pipeline, tag anybody or delete a company.",
  },
  {
    key: "PIPELINE",
    label: "The search",
    sections: ["pipeline", "crm", "archive", "accounts"],
    /**
     * list_resumes answers "which one did I send them" without opening the
     * resume tools; preview_digest is a pipeline read that happens to be filed
     * on the account page. The change log and undo_change are here for the
     * same reason they are in WRITING: this scope writes, so it needs the way
     * back. restore_revision is NOT — it puts a version of a resume or a role
     * back, and neither is this scope's to touch.
     */
    extras: ["list_resumes", "preview_digest", "list_changes", "list_revisions", "undo_change"],
    readOnly: false,
    blurb:
      "Runs the search: applications, offers, interviews, people, tasks, the archive, mail and calendar.",
  },
  {
    key: "READONLY",
    /**
     * Every section, filtered to what writes nothing. Admin is excluded like
     * every other non-FULL scope.
     */
    label: "Read-only",
    sections: ["me", "resumes", "letters", "pipeline", "crm", "archive", "accounts", "connections"],
    extras: [],
    readOnly: true,
    blurb: "Reads anything, writes nothing. For a client you want looking but not touching.",
  },
] as const;

export const SCOPE_VALUES = ["FULL", "WRITING", "PIPELINE", "READONLY"] as const;

export const scopeByKey = new Map(SCOPES.map((scope) => [scope.key, scope]));

export function scopeLabel(scope: McpScope): string {
  return scopeByKey.get(scope)?.label ?? "Everything";
}

export function scopeBlurb(scope: McpScope): string {
  return scopeByKey.get(scope)?.blurb ?? "";
}
