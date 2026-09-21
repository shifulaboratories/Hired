/**
 * Enough markdown to read a background, and deliberately no more.
 *
 * The app had no renderer at all: `Role.background` has been documented as
 * markdown since the first commit and every tool writes `##` headings into it,
 * but the only place it was ever shown was a monospace textarea. So people read
 * their own career history as source code.
 *
 * This is a tokeniser for the subset the tools actually emit — headings,
 * bullets, numbered lists, paragraphs, bold and inline code — rather than a
 * markdown library. Reasons, in order:
 *
 *  - This app's whole pitch is one environment variable and five minutes. A
 *    parser and a sanitiser for content nobody else can see is weight that
 *    every self-hoster pays for.
 *  - The output is React elements built from plain strings. There is no
 *    dangerouslySetInnerHTML anywhere in the path, so a paste cannot inject
 *    anything — which is the reason most people reach for a library.
 *  - Anything it does not understand comes back as literal text rather than
 *    disappearing. A background is somebody's raw material; dropping a line
 *    because the syntax was unusual would be the worst bug this file could
 *    have.
 *
 * If a person ever needs tables, links or images here, that is the moment to
 * take the dependency — not before.
 */

export type Block =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "paragraph"; text: string };

/** A run of text with at most one mark on it. */
export type Segment = { text: string; bold?: boolean; code?: boolean };

const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{2,3})\s*(.*)$/;

/**
 * Markdown to blocks.
 *
 * Lines are taken in order and never reordered or dropped. A list ends at the
 * first line that is not an item of it, which is how people actually type.
 */
export function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: heading[1].length === 2 ? 2 : 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const list = BULLET.exec(line) ? BULLET : ORDERED.exec(line) ? ORDERED : null;
    if (list) {
      flushParagraph();
      const items: string[] = [];
      // Consume every consecutive line of the SAME list shape. A numbered list
      // interrupted by a bullet is two lists, which is what it looks like.
      while (i < lines.length) {
        const match = list.exec(lines[i]);
        if (!match) break;
        items.push(match[1].trim());
        i += 1;
      }
      i -= 1;
      blocks.push({ type: list === BULLET ? "bullets" : "ordered", items });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Inline marks within one line: `**bold**` and `` `code` ``.
 *
 * Non-nesting and non-greedy, because the alternative is a parser. An unclosed
 * marker is left as the literal characters somebody typed rather than swallowing
 * the rest of the line.
 */
export function inlineSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    if (match[2] !== undefined) segments.push({ text: match[2], bold: true });
    else segments.push({ text: match[3], code: true });
    last = match.index + match[0].length;
  }

  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.length > 0 ? segments : [{ text }];
}
