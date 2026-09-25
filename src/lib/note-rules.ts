/**
 * One long note of rules, read as the separate rules it contains.
 *
 * Standing rules reach every client in a briefing with room for roughly five
 * hundred characters of them. A single "Guardrails — hard rules, never
 * violate" note of two and a half thousand characters does not fit, so it is
 * dropped from the briefing whole and only reaches a client that goes and
 * fetches it. Split into one rule per note, the short ones fit and travel with
 * every connection; the long ones at least overflow individually rather than
 * taking every other rule down with them.
 *
 * Pure: the preview in the Notes tab and the write in me.ts read the same way.
 */

export type RuleDraft = { title: string; body: string };

const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;

/** Past this, a rule is title plus body rather than one long title. */
const TITLE_MAX = 140;

function clean(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Title and body for one rule. Short rules are all title, because the
 * briefing prints "title — body" and a rule that fits on one line reads best
 * as one line. A long one is split after its first sentence.
 */
function draft(text: string, label: string): RuleDraft {
  const full = label ? `${label}: ${text}` : text;
  if (full.length <= TITLE_MAX) return { title: full, body: "" };
  const stop = /[.!?](\s|$)/.exec(full.slice(20));
  if (stop && stop.index + 21 <= TITLE_MAX) {
    const cut = stop.index + 21;
    return { title: full.slice(0, cut).trim(), body: full.slice(cut).trim() };
  }
  return { title: full, body: "" };
}

/**
 * The rules in a note body, in order.
 *
 * Bullets are the rules, with indented continuation lines folded into the
 * bullet above. A line ending in a colon, or a markdown heading, is a label
 * for the bullets under it and is carried into each of their titles —
 * "Numbers: never cite a figure without a source" — because the label is
 * often the half of the rule that says what it applies to. A body with no
 * bullets at all is read as one rule per paragraph.
 */
export function splitIntoRules(body: string): RuleDraft[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const hasBullets = lines.some((line) => BULLET.test(line));

  if (!hasBullets) {
    return body
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(HEADING, ""))
      .map(clean)
      .filter(Boolean)
      .map((paragraph) => draft(paragraph, ""));
  }

  const rules: RuleDraft[] = [];
  let label = "";
  let current: string | null = null;
  const flush = () => {
    if (current !== null && clean(current)) rules.push(draft(clean(current), label));
    current = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (HEADING.test(line)) {
      flush();
      label = clean(line.replace(HEADING, "")).replace(/:$/, "");
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      current = line.replace(BULLET, "");
      continue;
    }
    if (current !== null && /^\s{2,}\S/.test(line)) {
      current += ` ${line.trim()}`;
      continue;
    }
    flush();
    // A plain line ending in a colon labels what follows; any other plain line
    // between bullets is a rule of its own.
    const text = clean(line);
    if (/:$/.test(text)) label = text.replace(/:$/, "");
    else rules.push(draft(text, ""));
  }
  flush();
  return rules;
}
