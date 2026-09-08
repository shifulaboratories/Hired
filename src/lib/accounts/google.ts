import type { InstanceSettings } from "@/lib/settings";
import {
  PROVIDER_TIMEOUT_MS,
  ProviderError,
  type AccountFeature,
  type CalendarEvent,
  type CalendarReader,
  type CalendarWindow,
  type MailMessage,
  type MailReader,
  type MailSearch,
  type MailThread,
  type MailThreadSummary,
} from "@/lib/accounts/types";
import {
  clip,
  decodeEntities,
  mentions,
  mergeParticipants,
  normalise,
  parseAddresses,
  stripHtml,
} from "@/lib/accounts/text";

/**
 * Gmail and Google Calendar over plain HTTP.
 *
 * Hand-written for the same reason sign-in is: the surface this app uses is
 * six requests, and the official client is several megabytes that would own
 * the shape of every response. Everything here takes an access token and
 * returns the shapes in types.ts; who the token belongs to is the data
 * layer's business, and nothing in this file touches the database.
 *
 * Read-only by construction. The scopes asked for cannot send, label, delete
 * or accept anything, and no function here issues anything but GET — except
 * the token endpoint, which is how a refresh token becomes a usable one.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

/** The two grants, by the feature name the rest of the app uses for each. */
export const GOOGLE_DATA_SCOPES: Record<AccountFeature, string> = {
  mail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
};

/** Which features a list of granted scopes amounts to. */
export function googleFeatures(scopes: string[]): AccountFeature[] {
  return (Object.keys(GOOGLE_DATA_SCOPES) as AccountFeature[]).filter((feature) =>
    scopes.includes(GOOGLE_DATA_SCOPES[feature]),
  );
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type GoogleGrant = {
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working. */
  expiresAt: Date;
  /** The scopes Google actually granted, which may be fewer than were asked for. */
  scopes: string[];
};

export async function refreshAccessToken(
  settings: InstanceSettings,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.googleClientId,
      client_secret: settings.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = String(body.error ?? "");
    const detail = [body.error, body.error_description].filter(Boolean).join(": ");
    // invalid_grant is Google's one word for every way a refresh token dies:
    // the person removed the app from their account, the password changed on
    // a Workspace account with that policy, or the client was rotated.
    throw new ProviderError(detail || `Google refused to refresh the token (HTTP ${response.status}).`, {
      revoked: code === "invalid_grant",
      status: response.status,
    });
  }
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) throw new ProviderError("Google did not return an access token.");
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { accessToken, expiresAt: new Date(Date.now() + seconds * 1000) };
}

/** Best effort: a revoke that fails is not a reason to keep the row. */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    // Nothing to do; the row is deleted either way.
  }
}

async function get<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    const message = body.error?.message || `Google answered HTTP ${response.status}.`;
    if (response.status === 403 && /not been used|is disabled|accessNotConfigured/i.test(message)) {
      throw new ProviderError(
        `${message} The admin has to enable this API in the Google Cloud project that owns the OAuth client.`,
        { status: 403 },
      );
    }
    throw new ProviderError(message, { status: response.status, revoked: response.status === 401 });
  }
  return (await response.json()) as T;
}

/**
 * Where the inbox lives, for a thread link that opens in the right account.
 * `authuser` picks the signed-in Google account by address, which is what
 * makes the link work for somebody with a personal and a work inbox both
 * open.
 */
export function gmailThreadUrl(accountEmail: string, threadId: string) {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${threadId}`;
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};
type GmailThread = { id: string; snippet?: string; messages?: GmailMessage[] };

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

function messageDate(message: GmailMessage): Date {
  const stamp = Number(message.internalDate ?? 0);
  if (stamp > 0) return new Date(stamp);
  const parsed = new Date(header(message, "Date"));
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * The Gmail query for a search. Braces are Gmail's OR group; `from:acme.com`
 * matches every address at that domain. Free text passes straight through so
 * Gmail's own operators keep working. Nothing is excluded on purpose — a
 * rejection that Gmail filed under Promotions is still the rejection.
 */
export function gmailQueryFor(search: MailSearch): string {
  const clauses = [
    ...(search.addresses ?? []).flatMap((address) => [`from:${address}`, `to:${address}`, `cc:${address}`]),
    ...(search.domains ?? []).flatMap((domain) => [`from:${domain}`, `to:${domain}`, `cc:${domain}`]),
  ];
  const parts = [
    clauses.length ? `{${clauses.join(" ")}}` : "",
    search.text?.trim() ?? "",
    search.newerThanDays ? `newer_than:${search.newerThanDays}d` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export function googleMailReader(token: string, accountEmail: string): MailReader {
  return {
    async searchThreads(search) {
      const query = gmailQueryFor(search);
      if (!query) return [];
      return gmailSearchThreads(token, accountEmail, query, search.limit ?? 20);
    },
    getThread(threadId) {
      return gmailGetThread(token, accountEmail, threadId);
    },
  };
}

/**
 * Threads matching a Gmail search, newest first, with enough of each to list
 * it: subject, who is on it, when it last moved. One list call plus one
 * metadata call per thread — metadata, never full, so a page never downloads
 * anyone's attachments to show a subject line.
 */
export async function gmailSearchThreads(
  token: string,
  accountEmail: string,
  query: string,
  limit: number,
): Promise<MailThreadSummary[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(Math.max(limit, 1), 50)) });
  const list = await get<{ threads?: { id: string; snippet?: string }[] }>(
    token,
    `${GMAIL}/threads?${params.toString()}`,
  );
  const ids = (list.threads ?? []).map((thread) => thread.id);
  if (ids.length === 0) return [];

  const threads = await Promise.all(
    ids.map((id) =>
      get<GmailThread>(
        token,
        `${GMAIL}/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );

  return threads
    .map((thread) => summarise(thread, accountEmail))
    .filter((thread): thread is MailThreadSummary => thread !== null)
    .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
}

function summarise(thread: GmailThread, accountEmail: string): MailThreadSummary | null {
  const messages = (thread.messages ?? []).slice().sort((a, b) => messageDate(a).getTime() - messageDate(b).getTime());
  if (messages.length === 0) return null;
  const first = messages[0];
  const last = messages[messages.length - 1];

  return {
    id: thread.id,
    subject: header(first, "Subject") || header(last, "Subject") || "(no subject)",
    snippet: decodeEntities(last.snippet ?? thread.snippet ?? ""),
    participants: mergeParticipants(
      messages.flatMap((message) => [
        parseAddresses(header(message, "From")),
        parseAddresses(header(message, "To")),
        parseAddresses(header(message, "Cc")),
      ]),
    ),
    lastFrom: parseAddresses(header(last, "From"))[0] ?? null,
    firstMessageAt: messageDate(first),
    lastMessageAt: messageDate(last),
    messageCount: messages.length,
    unread: messages.some((message) => message.labelIds?.includes("UNREAD")),
    url: gmailThreadUrl(accountEmail, thread.id),
  };
}

/** One thread in full, as readable text. */
export async function gmailGetThread(
  token: string,
  accountEmail: string,
  threadId: string,
  options: { maxBodyChars?: number } = {},
): Promise<MailThread> {
  const thread = await get<GmailThread>(token, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  const messages: MailMessage[] = (thread.messages ?? [])
    .slice()
    .sort((a, b) => messageDate(a).getTime() - messageDate(b).getTime())
    .map((message) => ({
      id: message.id,
      from: parseAddresses(header(message, "From"))[0] ?? null,
      to: parseAddresses(header(message, "To")),
      cc: parseAddresses(header(message, "Cc")),
      date: messageDate(message),
      subject: header(message, "Subject"),
      body: clip(bodyText(message.payload), options.maxBodyChars ?? 6000),
    }));
  return {
    id: thread.id,
    subject: messages[0]?.subject || "(no subject)",
    url: gmailThreadUrl(accountEmail, thread.id),
    messages,
  };
}

/**
 * The readable part of a MIME tree: the first text/plain leaf, else the first
 * text/html leaf stripped to text. Attachments are never read.
 */
function bodyText(part: GmailPart | undefined): string {
  if (!part) return "";
  const plain = findLeaf(part, "text/plain");
  if (plain) return normalise(decodeBody(plain));
  const html = findLeaf(part, "text/html");
  if (html) return normalise(stripHtml(decodeBody(html)));
  return "";
}

function findLeaf(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findLeaf(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodeBody(part: GmailPart): string {
  const data = part.body?.data ?? "";
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

type GcalTime = { dateTime?: string; date?: string };
type GcalEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  start?: GcalTime;
  end?: GcalTime;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean }[];
};

export function googleCalendarReader(token: string): CalendarReader {
  return {
    listEvents(window) {
      return calendarListEvents(token, window);
    },
  };
}

/**
 * Events on the primary calendar in a window, expanded so a weekly interview
 * loop shows each occurrence. Free text is matched here rather than through
 * Google's `q`, so every provider answers the same question the same way.
 */
export async function calendarListEvents(token: string, window: CalendarWindow): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: window.from.toISOString(),
    timeMax: window.to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(Math.min(Math.max(window.limit ?? 250, 1), 2500)),
  });
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("pageToken", pageToken);
    const page = await get<{ items?: GcalEvent[]; nextPageToken?: string }>(
      token,
      `${CALENDAR}/calendars/primary/events?${params.toString()}`,
    );
    for (const item of page.items ?? []) {
      const event = toEvent(item);
      if (event && mentions(searchable(event), window.query)) out.push(event);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < (window.limit ?? 250));
  return out;
}

function searchable(event: CalendarEvent): string {
  return [
    event.title,
    event.description,
    event.location,
    ...event.attendees.map((a) => `${a.name} ${a.email}`),
    event.organizer ? `${event.organizer.name} ${event.organizer.email}` : "",
  ].join(" ");
}

function toEvent(item: GcalEvent): CalendarEvent | null {
  if (item.status === "cancelled") return null;
  const allDay = Boolean(item.start?.date && !item.start?.dateTime);
  const start = new Date(item.start?.dateTime ?? item.start?.date ?? "");
  const end = new Date(item.end?.dateTime ?? item.end?.date ?? "");
  if (Number.isNaN(start.getTime())) return null;
  const meeting =
    item.hangoutLink ||
    item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ||
    "";
  return {
    id: item.id,
    title: item.summary?.trim() || "(no title)",
    description: clip(normalise(stripHtml(item.description ?? "")), 2000),
    location: item.location ?? "",
    start,
    end: Number.isNaN(end.getTime()) ? start : end,
    allDay,
    status: item.status ?? "confirmed",
    organizer: item.organizer?.email
      ? { name: item.organizer.displayName ?? "", email: item.organizer.email.toLowerCase() }
      : null,
    attendees: (item.attendees ?? [])
      .filter((attendee) => attendee.email)
      .map((attendee) => ({
        name: attendee.displayName ?? "",
        email: attendee.email!.toLowerCase(),
        response: attendee.responseStatus ?? "needsAction",
        self: attendee.self === true,
      })),
    meetingUrl: meeting,
    url: item.htmlLink ?? "",
  };
}
