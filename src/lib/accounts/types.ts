/**
 * What every mail and calendar provider has to produce.
 *
 * Gmail, Microsoft Graph and IMAP+CalDAV all speak a different wire protocol,
 * and none of that reaches the rest of the app: a screen or a tool asks a
 * `MailReader` for threads and a `CalendarReader` for events, and gets these
 * shapes back whichever account answered. The data layer (src/lib/data/
 * accounts.ts) is what picks the provider, holds the credentials and merges
 * across a person's accounts; nothing in this directory touches the database.
 *
 * Read-only by construction. There is no interface for sending, filing or
 * deleting, so no provider can grow one by accident.
 */

/** The two things an account can provide. Stored on the row as strings. */
export type AccountFeature = "mail" | "calendar";

export type MailParticipant = { name: string; email: string };

export type MailThreadSummary = {
  /** Opaque to callers. The data layer prefixes it with the account id. */
  id: string;
  subject: string;
  /** The provider's one-line preview of the latest message. */
  snippet: string;
  /** Everyone on the thread, the account holder included, deduplicated by address. */
  participants: MailParticipant[];
  /** Who sent the most recent message. */
  lastFrom: MailParticipant | null;
  firstMessageAt: Date;
  lastMessageAt: Date;
  messageCount: number;
  unread: boolean;
  /** Where to open it in the provider's own client. Empty when there is nowhere. */
  url: string;
};

export type MailMessage = {
  id: string;
  from: MailParticipant | null;
  to: MailParticipant[];
  cc: MailParticipant[];
  date: Date;
  subject: string;
  /** Plain text. HTML-only messages are stripped to text; long bodies are cut. */
  body: string;
};

export type MailThread = {
  id: string;
  subject: string;
  url: string;
  messages: MailMessage[];
};

/**
 * What to look for. Addresses and domains are matched on from, to and cc;
 * `text` is the provider's own free-text search — Gmail's operators pass
 * straight through, everything else treats it as words.
 */
export type MailSearch = {
  addresses?: string[];
  domains?: string[];
  text?: string;
  newerThanDays?: number;
  limit?: number;
};

export type CalendarAttendee = MailParticipant & {
  /** accepted | declined | tentative | needsAction */
  response: string;
  self: boolean;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  status: string;
  organizer: MailParticipant | null;
  attendees: CalendarAttendee[];
  /** A Meet, Teams or Zoom link, when the event has one. */
  meetingUrl: string;
  /** The event in the provider's own calendar. Empty when there is nowhere. */
  url: string;
};

export type CalendarWindow = { from: Date; to: Date; query?: string; limit?: number };

export interface MailReader {
  searchThreads(search: MailSearch): Promise<MailThreadSummary[]>;
  getThread(threadId: string): Promise<MailThread>;
}

export interface CalendarReader {
  listEvents(window: CalendarWindow): Promise<CalendarEvent[]>;
}

/**
 * A provider refused. `revoked` is the one distinction the data layer acts
 * on: the credential is dead (a revoked token, a changed app password) and
 * the person has to reconnect, as opposed to a request that merely failed.
 */
export class ProviderError extends Error {
  revoked: boolean;
  status: number;
  constructor(message: string, options: { revoked?: boolean; status?: number } = {}) {
    super(message);
    this.name = "ProviderError";
    this.revoked = options.revoked ?? false;
    this.status = options.status ?? 0;
  }
}

/** Every request to a provider has a bound; a hung call must not hang a page. */
export const PROVIDER_TIMEOUT_MS = 20_000;
