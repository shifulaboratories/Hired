/**
 * What kind of role this is, read from its free-text employment type.
 *
 * The Roles tab groups by it, because three advisory seats listed between two
 * full-time jobs read as job-hopping, and under their own heading they read as
 * what they are. Anything unrecognised is a job — the default a person would
 * expect, and the one that keeps a typo from quietly moving a job out of its
 * group.
 *
 * Pure. No data behind it beyond the string already on the role.
 */

export type RoleGroup = "employment" | "contract" | "advisory" | "internship";

export const GROUP_LABEL: Record<RoleGroup, string> = {
  employment: "Jobs",
  contract: "Contract and freelance",
  advisory: "Advisory and board",
  internship: "Internships",
};

export const GROUP_ORDER: RoleGroup[] = ["employment", "contract", "advisory", "internship"];

export function roleGroup(employmentType: string): RoleGroup {
  const type = employmentType.toLowerCase();
  if (/advis|board|mentor|volunteer|trustee/.test(type)) return "advisory";
  if (/intern|apprentice/.test(type)) return "internship";
  if (/contract|freelance|consult|fractional|self-employed/.test(type)) return "contract";
  return "employment";
}
