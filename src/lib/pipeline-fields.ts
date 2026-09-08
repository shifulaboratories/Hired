/**
 * Which optional fields each pipeline view draws.
 *
 * Pure, so the board, the table, the calendar, the menu that toggles them and
 * the tool that reads them all agree on one catalogue.
 *
 * On the board and the table, three things are never in a catalogue: the
 * company, the role title and the stage. Those are what a card IS — a card
 * with no company is not a shorter card, it is an unreadable one — and on the
 * table the stage cell is the inline editor the table exists for. A setting
 * that can make a screen useless is not a setting.
 *
 * The calendar is the exception, and only for stage: a chip is one line of an
 * entry's own title, so the stage is genuinely extra there rather than
 * identity, and it is off by default.
 *
 * An empty stored list means "the default set", not "draw nothing". That way an
 * account that has never touched this looks exactly as it always did, and a
 * field added here later appears for everybody rather than hiding behind a
 * stored list that predates it. Turning everything off is expressed as the
 * sentinel below, because an empty array already means something else.
 */

export const PIPELINE_VIEWS = ["board", "list", "calendar"] as const;
export type PipelineView = (typeof PIPELINE_VIEWS)[number];

/** "I mean none of them", as distinct from "I have never said". */
export const NO_FIELDS = "none";

export type FieldDef = {
  key: string;
  label: string;
  /** In the default set. */
  standard: boolean;
  /** Only drawn once the viewport is wide enough, whatever this says. */
  wide?: boolean;
};

export const BOARD_FIELDS: FieldDef[] = [
  { key: "location", label: "Location", standard: true },
  { key: "salary", label: "Salary", standard: true },
  { key: "followUp", label: "Next follow-up", standard: true },
  { key: "quiet", label: "Quiet for", standard: true },
  { key: "resume", label: "Resume sent", standard: true },
  { key: "activity", label: "Activity count", standard: true },
  { key: "tags", label: "Tags", standard: false },
];

export const LIST_FIELDS: FieldDef[] = [
  { key: "followUp", label: "Follow-up", standard: true },
  { key: "waiting", label: "Waiting", standard: true },
  { key: "quiet", label: "Quiet", standard: true, wide: true },
  { key: "salary", label: "Salary", standard: true, wide: true },
  { key: "location", label: "Location", standard: true, wide: true },
  { key: "activity", label: "Log", standard: true, wide: true },
  { key: "updated", label: "Touched", standard: true, wide: true },
];

/**
 * The calendar draws a chip, and a chip has room for very little.
 *
 * Only two things on a schedule entry are not already inside its own title —
 * everything else would print the same words twice.
 */
export const CALENDAR_FIELDS: FieldDef[] = [
  // Both are wide-screen only: a chip in a month grid has no room for either
  // below `lg`, and a toggle that appears to do nothing is worse than one that
  // says when it applies.
  { key: "detail", label: "The role or the detail", standard: true, wide: true },
  { key: "stage", label: "Stage", standard: false, wide: true },
];

export const FIELDS: Record<PipelineView, FieldDef[]> = {
  board: BOARD_FIELDS,
  list: LIST_FIELDS,
  calendar: CALENDAR_FIELDS,
};

export const VIEW_LABEL: Record<PipelineView, string> = {
  board: "Board",
  list: "Table",
  calendar: "Calendar",
};

export function isPipelineView(value: string): value is PipelineView {
  return (PIPELINE_VIEWS as readonly string[]).includes(value);
}

/**
 * What a view actually draws, given what is stored.
 *
 * Unknown keys are dropped rather than honoured, so a field removed from a
 * catalogue does not linger in somebody's saved list forever.
 */
export function visibleFields(view: PipelineView, stored: string[]): Set<string> {
  const catalogue = FIELDS[view];
  if (stored.length === 0) {
    return new Set(catalogue.filter((field) => field.standard).map((field) => field.key));
  }
  if (stored.length === 1 && stored[0] === NO_FIELDS) return new Set();
  const known = new Set(catalogue.map((field) => field.key));
  return new Set(stored.filter((key) => known.has(key)));
}

/** The stored form of a chosen set, collapsing "nothing" to the sentinel. */
export function storedFields(view: PipelineView, chosen: Set<string>): string[] {
  if (chosen.size === 0) return [NO_FIELDS];
  const catalogue = FIELDS[view];
  const ordered = catalogue.filter((field) => chosen.has(field.key)).map((field) => field.key);
  // A set that happens to equal the default is still written out, because the
  // person said it. Only "I never chose" is the empty array.
  return ordered;
}
