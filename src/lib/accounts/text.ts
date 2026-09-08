import type { MailParticipant } from "@/lib/accounts/types";

/**
 * The text handling every provider needs and none should own: parsing an
 * address header, turning HTML mail into something readable, trimming what
 * would flood a tool result.
 */

/** "Jane Doe <jane@acme.com>, bob@acme.com" → two participants. */
export function parseAddresses(header: string): MailParticipant[] {
  const out: MailParticipant[] = [];
  // Split on commas that are not inside quotes. Display names may carry one.
  const parts = header.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const angle = /^(.*?)<([^>]+)>\s*$/.exec(trimmed);
    if (angle) {
      out.push({
        name: angle[1].trim().replace(/^"|"$/g, "").trim(),
        email: angle[2].trim().toLowerCase(),
      });
    } else if (trimmed.includes("@")) {
      out.push({ name: "", email: trimmed.replace(/^"|"$/g, "").toLowerCase() });
    }
  }
  return out;
}

export function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/** Everyone across a set of address lists, deduplicated, keeping the first name seen. */
export function mergeParticipants(lists: MailParticipant[][]): MailParticipant[] {
  const seen = new Map<string, MailParticipant>();
  for (const list of lists) {
    for (const person of list) {
      if (!person.email) continue;
      const existing = seen.get(person.email);
      if (!existing) seen.set(person.email, { ...person });
      else if (!existing.name && person.name) existing.name = person.name;
    }
  }
  return [...seen.values()];
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Collapse the whitespace HTML and quoted-printable leave behind. */
export function normalise(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[… ${text.length - max} more characters]` : text;
}

/** The first Meet, Teams, Zoom or Webex link in a blob of text, or nothing. */
export function findMeetingLink(text: string): string {
  const match = /https?:\/\/(?:meet\.google\.com|teams\.microsoft\.com|[\w.-]*zoom\.us|[\w.-]*webex\.com)\/[^\s<>"')]+/i.exec(
    text,
  );
  return match?.[0] ?? "";
}

/** Whether `text` mentions any of the words, case-insensitively. Empty query matches. */
export function mentions(text: string, query: string | undefined): boolean {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = text.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
