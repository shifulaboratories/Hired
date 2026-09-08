import { Prisma, TagKind } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Labels the person owns, whatever they are labelling.
 *
 * This started as Source: the channel an application came from, as a row you
 * could rename, recolour and delete rather than a free string that filled the
 * picker with every spelling anyone ever typed. Everything else that wanted to
 * behave that way — a company's industry, its size, where it is, how a person
 * is filed — was a String column, which meant one value each and a typo you
 * fixed record by record.
 *
 * One table with a kind, rather than six near-copies of one idea: renaming,
 * recolouring, deleting and merging are the same code for all of them, and a
 * person who learns the picker once has learned all of them.
 *
 * userId is first and positional here like everywhere else in this directory.
 * The join tables carry no userId of their own, so every id that arrives from
 * a caller is re-checked against the owner before it is linked to anything.
 */

export { TagKind };

/** The swatches a tag can wear. Token names, resolved through TAG_TONE. */
export const TAG_COLORS = [
  "slate",
  "blue",
  "teal",
  "green",
  "amber",
  "red",
  "violet",
  "pink",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/**
 * Same argument as STAGE_TONE: a CSS variable follows the theme and a stored
 * hex is right in exactly one of them. See --tag-* in globals.css for why a
 * tag wears its colour as a dot rather than as ink and wash.
 */
export const TAG_TONE: Record<TagColor, string> = {
  slate: "var(--tag-slate)",
  blue: "var(--tag-blue)",
  teal: "var(--tag-teal)",
  green: "var(--tag-green)",
  amber: "var(--tag-amber)",
  red: "var(--tag-red)",
  violet: "var(--tag-violet)",
  pink: "var(--tag-pink)",
};

/** Anything unrecognised renders slate rather than throwing at paint time. */
export function tagTone(color: string): string {
  return TAG_TONE[color as TagColor] ?? TAG_TONE.slate;
}

export const TAG_KINDS = [
  "APPLICATION",
  "COMPANY",
  "CONTACT",
  "INDUSTRY",
  "SIZE",
  "LOCATION",
] as const;

/** What each kind is called on screen, singular and plural. */
export const TAG_KIND_LABEL: Record<TagKind, { one: string; many: string }> = {
  APPLICATION: { one: "Tag", many: "Tags" },
  COMPANY: { one: "Tag", many: "Tags" },
  CONTACT: { one: "Tag", many: "Tags" },
  INDUSTRY: { one: "Industry", many: "Industries" },
  SIZE: { one: "Size", many: "Size" },
  LOCATION: { one: "Location", many: "Locations" },
};

/**
 * The starter sets, offered rather than imposed.
 *
 * These used to be appended to the picker in code, which made them permanent
 * and un-deletable. Accepting them creates real rows the person owns, and
 * seeding skips anything they already have so pressing it twice is harmless.
 */
export const TAG_SUGGESTIONS: Partial<Record<TagKind, readonly string[]>> = {
  APPLICATION: [
    "LinkedIn",
    "Indeed",
    "Company site",
    "Referral",
    "Recruiter reached out",
    "Cold outreach",
  ],
  CONTACT: ["Recruiter", "Hiring manager", "Referral", "Ex-colleague", "Friend"],
  SIZE: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"],
};

export function tagKey(name: string): string {
  return name.trim().toLowerCase();
}

function assertColor(color: string): TagColor {
  if (!(TAG_COLORS as readonly string[]).includes(color)) {
    throw new Error(`Unknown colour "${color}". Use one of: ${TAG_COLORS.join(", ")}.`);
  }
  return color as TagColor;
}

/**
 * How many things wear this tag, across all three kinds of thing.
 *
 * Archived rows are not counted. This number is read in two places that both
 * describe what is on screen — the count beside a tag in the picker, and the
 * "comes off N things" a person agrees to before deleting one — so counting
 * something in the bin makes both of them lie. All three are join tables, so
 * each predicate has to reach through the link to the record itself.
 */
const tagCounts = {
  _count: {
    select: {
      applications: { where: { application: { archivedAt: null } } },
      companies: { where: { company: { archivedAt: null } } },
      contacts: { where: { contact: { archivedAt: null } } },
    },
  },
} as const;

export type TagWithCounts = Prisma.TagGetPayload<{ include: typeof tagCounts }>;

export async function listTags(userId: string, kind?: TagKind) {
  return db.tag.findMany({
    where: { userId, ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: tagCounts,
  });
}

export async function seedTags(userId: string, kind: TagKind) {
  const wanted = TAG_SUGGESTIONS[kind] ?? [];
  if (wanted.length === 0) return listTags(userId, kind);
  const existing = await db.tag.findMany({ where: { userId, kind }, select: { key: true } });
  const have = new Set(existing.map((row) => row.key));
  const fresh = wanted.filter((name) => !have.has(tagKey(name)));
  await db.tag.createMany({
    data: fresh.map((name, index) => ({
      userId,
      kind,
      name,
      key: tagKey(name),
      color: TAG_COLORS[index % TAG_COLORS.length],
    })),
  });
  return listTags(userId, kind);
}

export async function createTag(
  userId: string,
  input: { kind: TagKind; name: string; color?: string },
) {
  const name = input.name.trim();
  if (!name) throw new Error("A tag needs a name");
  const key = tagKey(name);
  const existing = await db.tag.findFirst({ where: { userId, kind: input.kind, key } });
  if (existing) throw new Error(`You already have "${existing.name}" on file`);
  return db.tag.create({
    data: {
      userId,
      kind: input.kind,
      name,
      key,
      color: input.color ? assertColor(input.color) : "slate",
    },
    include: tagCounts,
  });
}

export async function updateTag(
  userId: string,
  id: string,
  patch: { name?: string; color?: string },
) {
  const current = await db.tag.findFirst({ where: { id, userId } });
  if (!current) throw new Error(`No tag with id ${id}`);

  const data: Prisma.TagUpdateManyMutationInput = {};
  if (patch.color !== undefined) data.color = assertColor(patch.color);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("A tag needs a name");
    // `key` is derived, so it is assigned here rather than picked off the
    // patch — otherwise a rename leaves the old key and the case-insensitive
    // uniqueness quietly stops meaning anything.
    const key = tagKey(name);
    const clash = await db.tag.findFirst({
      where: { userId, kind: current.kind, key, id: { not: id } },
    });
    if (clash) throw new Error(`You already have "${clash.name}" on file`);
    data.name = name;
    data.key = key;
  }
  await db.tag.updateMany({ where: { id, userId }, data });
  return db.tag.findFirstOrThrow({ where: { id, userId }, include: tagCounts });
}

/**
 * Deleting a tag takes it off everything it labelled and succeeds.
 *
 * Deliberately unlike deleteCompany, which refuses while applications point at
 * it. A company is a record with its own history and losing it loses work; a
 * tag is a label, and what wore it is untouched apart from no longer wearing
 * it. A label you cannot remove IS the bug this replaced.
 */
export async function deleteTag(userId: string, id: string) {
  const tag = await db.tag.findFirst({ where: { id, userId }, include: tagCounts });
  if (!tag) throw new Error(`No tag with id ${id}`);
  await db.tag.delete({ where: { id } });
  return {
    id,
    name: tag.name,
    kind: tag.kind,
    detachedFrom:
      tag._count.applications + tag._count.companies + tag._count.contacts,
  };
}

/** A tag as every caller wants it: the row, not the link to it. */
export type TagRef = { id: string; name: string; color: string; kind: TagKind };

/**
 * The join rows a caller never wants to see, flattened to what they meant.
 *
 * The return type is spelled out with Omit rather than left to inference: a
 * spread over a generic keeps the original `tags` in the resulting type, so
 * without this every caller still sees join rows through the compiler even
 * though the value is right.
 */
export function flattenTags<T extends { tags: { tag: TagRef }[] }>(
  row: T,
): Omit<T, "tags"> & { tags: TagRef[] } {
  return { ...row, tags: row.tags.map((link) => link.tag) };
}

/**
 * Every one of these ids must be this person's, and of one of these kinds.
 *
 * The guard exists for the bulk paths. All four of a company's lists share one
 * join table, so nothing at the database level stops an APPLICATION tag being
 * attached to a company — and once it is, no screen renders it and no picker
 * can take it back off. One click across a selection of forty would write
 * forty rows nobody can ever see or remove.
 */
export async function assertOwnedTagIds(
  userId: string,
  ids: string[],
  kinds: TagKind[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const owned = await db.tag.findMany({
    where: { id: { in: unique }, userId, kind: { in: kinds } },
    select: { id: true },
  });
  const found = new Set(owned.map((row) => row.id));
  const missing = unique.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `No ${kinds.map((kind) => kind.toLowerCase()).join(" or ")} tag with id ${missing[0]}`,
    );
  }
  return unique;
}

/** The one list a row wears, cut down to a single kind. */
export function tagsOfKind<T extends { kind: TagKind }>(tags: T[], kind: TagKind): T[] {
  return tags.filter((tag) => tag.kind === kind);
}

/**
 * What every tagged read includes, and the order it comes back in.
 *
 * Not `as const`: a deeply readonly object spread into a Prisma include makes
 * its payload inference give up, and every field of the row disappears from
 * the result type while the value stays right.
 */
export const tagInclude = {
  // `true as const` rather than `true`: a plain boolean here makes Prisma's
  // payload inference give up, and every field of the row disappears from the
  // result type while the value stays right. `as const` on the whole object
  // fails the same way through its readonly properties.
  tags: { include: { tag: true as const }, orderBy: { tag: { name: "asc" as const } } },
};

/** Small stable hash, only ever used to pick a default swatch. */
function hashKey(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash;
}

/**
 * Names and ids in, ids out — creating a tag only for a name nothing matches.
 *
 * Matching is on the case-folded key within the kind, so "linkedin" lands on
 * the existing "LinkedIn" rather than minting a twin, and a location called
 * "Remote" never collides with a tag called "Remote". Ids are re-checked
 * against this user because the join tables carry no userId of their own.
 *
 * Returns undefined when the caller said nothing about tags, which is how an
 * update tells "leave them alone" from "take them all off".
 */
export async function resolveTagIds(
  userId: string,
  kind: TagKind,
  input: { tagIds?: string[]; tags?: string[]; tag?: string },
): Promise<string[] | undefined> {
  if (input.tagIds !== undefined) {
    if (input.tagIds.length === 0) return [];
    const owned = await db.tag.findMany({
      where: { id: { in: input.tagIds }, userId, kind },
      select: { id: true },
    });
    const found = new Set(owned.map((row) => row.id));
    const missing = input.tagIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(`No ${kind.toLowerCase()} tag with id ${missing[0]}`);
    }
    return [...new Set(input.tagIds)];
  }

  const names =
    input.tags !== undefined ? input.tags : input.tag !== undefined ? [input.tag] : undefined;
  if (names === undefined) return undefined;

  const wanted = new Map<string, string>();
  for (const raw of names) {
    const name = raw.trim();
    if (name) wanted.set(tagKey(name), name);
  }
  if (wanted.size === 0) return [];

  const existing = await db.tag.findMany({ where: { userId, kind, key: { in: [...wanted.keys()] } } });
  const ids = existing.map((row) => row.id);
  const have = new Set(existing.map((row) => row.key));
  for (const [key, name] of wanted) {
    if (have.has(key)) continue;
    const created = await db.tag.create({
      data: {
        userId,
        kind,
        name,
        key,
        // Spread the palette rather than making every new tag slate.
        color: TAG_COLORS[Math.abs(hashKey(key)) % TAG_COLORS.length],
      },
    });
    ids.push(created.id);
  }
  return ids;
}
