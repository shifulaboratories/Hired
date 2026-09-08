/**
 * How wide each column is, on the three lists you can resize.
 *
 * Pure, so the table, the drag handle, the server action and the tool that
 * reads them all agree on one catalogue — the same arrangement as
 * `pipeline-fields.ts`, and for the same reason: a width the UI clamps one way
 * and a tool clamps another is two rules about one number.
 *
 * **The first column is not in here.** Every one of these tables has a name
 * cell that flexes to fill whatever the fixed columns leave, so the row always
 * spans the card and never scrolls sideways. Widening a fixed column therefore
 * narrows the name; there is no separate handle for the name itself, because a
 * table where every column has a width is a table that needs a horizontal
 * scrollbar, and that is a different design.
 *
 * A stored width is a hint, not an instruction. It is clamped on the way in
 * AND on the way out, because the value in the database was written by a client
 * that may predate a narrower max, and a row that renders should never trust a
 * number from months ago. An absent list, or an absent column inside one, is
 * that column's default — so a column added to a catalogue later is sized by
 * the catalogue rather than collapsing to zero behind a stored map that has
 * never heard of it.
 */

export const COLUMN_LISTS = ["pipeline", "companies", "contacts"] as const;
export type ColumnList = (typeof COLUMN_LISTS)[number];

export type ColumnDef = {
  key: string;
  label: string;
  /** Width in pixels when nothing is stored. */
  width: number;
  min: number;
  max: number;
};

/** Wide enough to read a truncated word; wide enough to be worth dragging to. */
const MIN = 56;
const MAX = 420;

export const PIPELINE_COLUMNS: ColumnDef[] = [
  { key: "stage", label: "Stage", width: 128, min: 104, max: 200 },
  { key: "followUp", label: "Follow-up", width: 112, min: 96, max: MAX },
  { key: "waiting", label: "Waiting", width: 80, min: MIN, max: 160 },
  { key: "quiet", label: "Quiet", width: 80, min: MIN, max: 160 },
  { key: "salary", label: "Salary", width: 128, min: 80, max: MAX },
  { key: "location", label: "Location", width: 128, min: 80, max: MAX },
  { key: "activity", label: "Log", width: 40, min: 36, max: 96 },
  { key: "updated", label: "Touched", width: 80, min: MIN, max: 160 },
];

export const COMPANY_COLUMNS: ColumnDef[] = [
  { key: "industry", label: "Industry", width: 144, min: 80, max: MAX },
  { key: "location", label: "Location", width: 144, min: 80, max: MAX },
  { key: "lastApplied", label: "Last applied", width: 96, min: MIN, max: 200 },
  { key: "applications", label: "Applications", width: 96, min: MIN, max: 200 },
  { key: "contacts", label: "People", width: 64, min: MIN, max: 160 },
];

export const CONTACT_COLUMNS: ColumnDef[] = [
  { key: "company", label: "Company", width: 176, min: 96, max: MAX },
  { key: "relationship", label: "Relationship", width: 128, min: 80, max: MAX },
  { key: "ping", label: "Next ping", width: 96, min: MIN, max: 200 },
  { key: "touch", label: "Last touch", width: 96, min: MIN, max: 200 },
  { key: "links", label: "Links", width: 60, min: 44, max: 120 },
];

export const COLUMNS: Record<ColumnList, ColumnDef[]> = {
  pipeline: PIPELINE_COLUMNS,
  companies: COMPANY_COLUMNS,
  contacts: CONTACT_COLUMNS,
};

export const LIST_LABEL: Record<ColumnList, string> = {
  pipeline: "The pipeline table",
  companies: "The companies list",
  contacts: "The contacts list",
};

export function isColumnList(value: string): value is ColumnList {
  return (COLUMN_LISTS as readonly string[]).includes(value);
}

/** What is actually stored: one map of pixel widths per list. */
export type StoredWidths = Partial<Record<ColumnList, Record<string, number>>>;

const clamp = (value: number, column: ColumnDef) =>
  Math.round(Math.min(column.max, Math.max(column.min, value)));

/**
 * Read the Json column into something the compiler and the renderer trust.
 *
 * Everything unrecognised is dropped rather than repaired: an unknown list, an
 * unknown column, a width that is not a finite number. The column is `Json`, so
 * its type is whatever was last written to it — including `null`, a string, or
 * an array, none of which this ever produced but all of which it must survive.
 */
export function parseWidths(raw: unknown): StoredWidths {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: StoredWidths = {};
  for (const list of COLUMN_LISTS) {
    const stored = (raw as Record<string, unknown>)[list];
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) continue;
    const widths: Record<string, number> = {};
    for (const column of COLUMNS[list]) {
      const value = (stored as Record<string, unknown>)[column.key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      widths[column.key] = clamp(value, column);
    }
    if (Object.keys(widths).length > 0) out[list] = widths;
  }
  return out;
}

/** Every column of one list at the width it should draw at, defaults filled in. */
export function widthsFor(list: ColumnList, stored: StoredWidths): Record<string, number> {
  const saved = stored[list] ?? {};
  const out: Record<string, number> = {};
  for (const column of COLUMNS[list]) {
    out[column.key] = saved[column.key] ?? column.width;
  }
  return out;
}

/**
 * Fold a set of widths for one list into the whole stored map.
 *
 * Merges rather than replaces the named list's own columns, so setting one
 * column does not silently reset the others — and an empty patch is how a list
 * goes back to its defaults, since a column with nothing stored draws at the
 * catalogue's width.
 */
export function withWidths(
  stored: StoredWidths,
  list: ColumnList,
  patch: Record<string, number>,
  options?: { reset?: boolean },
): StoredWidths {
  const known = new Map(COLUMNS[list].map((column) => [column.key, column]));
  const next: Record<string, number> = options?.reset ? {} : { ...(stored[list] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    const column = known.get(key);
    if (!column || typeof value !== "number" || !Number.isFinite(value)) continue;
    next[key] = clamp(value, column);
  }
  const out: StoredWidths = { ...stored };
  if (Object.keys(next).length === 0) delete out[list];
  else out[list] = next;
  return out;
}

/** The keys a caller may set on one list, for an error message worth reading. */
export const columnKeys = (list: ColumnList) => COLUMNS[list].map((column) => column.key);
