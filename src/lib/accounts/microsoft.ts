import {
  PROVIDER_TIMEOUT_MS,
  ProviderError,
  type AccountFeature,
  type CalendarEvent,
  type CalendarReader,
  type CalendarWindow,
  type MailMessage,
  type MailParticipant,
  type MailReader,
  type MailSearch,
  type MailThread,
  type MailThreadSummary,
} from "@/lib/accounts/types";
import { clip, findMeetingLink, mentions, mergeParticipants, normalise, stripHtml } from "@/lib/accounts/text";

/**
 * Microsoft 365 — Outlook mail and calendar — through Microsoft Graph.
 *
 * Same shape as google.ts: OAuth against the common tenant so a personal
 * outlook.com and a work account both work, a refresh token kept by the data
 * layer, and read-only scopes. `Mail.Read` and `Calendars.Read` cannot send,
 * accept, move or delete anything, and nothing here issues anything but GET
 * apart from the token endpoint.
 *
 * Graph groups messages by `conversationId`, which is what a thread is here.
 * A search returns messages, not conversations, so a thread listed from a
 * search knows about the messages the search matched — a long thread where
 * only the last reply mentions the recruiter is still found, and get_thread
 * fills in the rest.
 */

const AUTH_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** The signed state cookie for the consent round trip. Same shape as Google's. */
export const MICROSOFT_STATE_COOKIE = "hired_microsoft_oauth";

/** Where Microsoft sends the browser back to. Registered on the app registration. */
export function microsoftRedirectUri(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/auth/microsoft/callback`;
}

export const MICROSOFT_SCOPES: Record<AccountFeature, string> = {
  mail: "Mail.Read",
  calendar: "Calendars.Read",
};

/** Always asked for alongside the two above: who the account is, and a refresh token. */
const BASE_SCOPES = ["openid", "email", "profile", "offline_access", "User.Read"];

export function microsoftFeatures(scopes: string[]): AccountFeature[] {
  // Graph hands scopes back as bare names or as full URIs, depending on the
  // tenant. Match on the tail.
  const tails = scopes.map((scope) => scope.split("/").pop() ?? scope);
  return (Object.keys(MICROSOFT_SCOPES) as AccountFeature[]).filter((feature) =>
    tails.includes(MICROSOFT_SCOPES[feature]),
  );
}

export function microsoftAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: [...BASE_SCOPES, MICROSOFT_SCOPES.mail, MICROSOFT_SCOPES.calendar].join(" "),
    state: input.state,
    nonce: input.nonce,
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type MicrosoftGrant = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

async function tokenRequest(body: Record<string, string>): Promise<MicrosoftGrant> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = String(json.error ?? "");
    const detail = [json.error, json.error_description].filter(Boolean).join(": ");
    throw new ProviderError(detail || `Microsoft refused the token request (HTTP ${response.status}).`, {
      revoked: code === "invalid_grant" || code === "interaction_required",
      status: response.status,
    });
  }
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) throw new ProviderError("Microsoft did not return an access token.");
  const seconds = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : "",
    expiresAt: new Date(Date.now() + seconds * 1000),
    scopes: typeof json.scope === "string" ? json.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export function exchangeMicrosoftCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}) {
  return tokenRequest({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
}

/**
 * Microsoft rotates refresh tokens: the response may carry a new one, and
 * the data layer stores it when it does.
 */
export function refreshMicrosoftToken(input: { clientId: string; clientSecret: string; refreshToken: string }) {
  return tokenRequest({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
    scope: [...BASE_SCOPES, MICROSOFT_SCOPES.mail, MICROSOFT_SCOPES.calendar].join(" "),
  });
}

async function get<T>(token: string, url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, ...headers },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const message = body.error?.message || `Microsoft answered HTTP ${response.status}.`;
    throw new ProviderError(message, {
      status: response.status,
      revoked: response.status === 401,
    });
  }
  return (await response.json()) as T;
}

/** Who the token belongs to. `mail` is empty on some personal accounts; the UPN is the address then. */
export async function microsoftProfile(token: string): Promise<{ id: string; email: string; name: string }> {
  const me = await get<{ id?: string; mail?: string; userPrincipalName?: string; displayName?: string }>(
    token,
    `${GRAPH}/me?$select=id,mail,userPrincipalName,displayName`,
  );
  const email = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  if (!email) throw new ProviderError("Microsoft did not say which account this is.");
  return { id: me.id ?? "", email, name: me.displayName ?? "" };
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  webLink?: string;
};

const MESSAGE_FIELDS =
  "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,webLink";

function person(recipient: GraphRecipient | undefined): MailParticipant | null {
  const address = recipient?.emailAddress?.address?.trim().toLowerCase();
  if (!address) return null;
  return { name: recipient?.emailAddress?.name ?? "", email: address };
}

function people(recipients: GraphRecipient[] | undefined): MailParticipant[] {
  return (recipients ?? []).map(person).filter((p): p is MailParticipant => p !== null);
}

function messageDate(message: GraphMessage): Date {
  const parsed = new Date(message.receivedDateTime ?? message.sentDateTime ?? "");
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

/**
 * The KQL for a search. `participants:` covers from, to and cc at once, and
 * matches on a domain as well as an address. Free text is added as words.
 */
export function graphSearchFor(search: MailSearch): string {
  const terms = [...(search.addresses ?? []), ...(search.domains ?? [])].map(
    (term) => `participants:${term}`,
  );
  const parts = [terms.length ? `(${terms.join(" OR ")})` : ""];
  if (search.text?.trim()) parts.push(search.text.trim().replace(/"/g, ""));
  if (search.newerThanDays) {
    const since = new Date(Date.now() - search.newerThanDays * 86_400_000).toISOString().slice(0, 10);
    parts.push(`received>=${since}`);
  }
  return parts.filter(Boolean).join(" AND ");
}

export function microsoftMailReader(token: string): MailReader {
  return {
    async searchThreads(search) {
      const kql = graphSearchFor(search);
      if (!kql) return [];
      const params = new URLSearchParams({
        $search: `"${kql}"`,
        $select: MESSAGE_FIELDS,
        $top: String(Math.min(Math.max((search.limit ?? 20) * 4, 25), 250)),
      });
      const page = await get<{ value?: GraphMessage[] }>(token, `${GRAPH}/me/messages?${params.toString()}`);
      const byConversation = new Map<string, GraphMessage[]>();
      for (const message of page.value ?? []) {
        const key = message.conversationId ?? message.id;
        const bucket = byConversation.get(key);
        if (bucket) bucket.push(message);
        else byConversation.set(key, [message]);
      }
      return [...byConversation.entries()]
        .map(([id, messages]) => summarise(id, messages))
        .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
        .slice(0, search.limit ?? 20);
    },

    async getThread(conversationId) {
      // No $orderby alongside this $filter: Graph rejects the pair as an
      // inefficient query. Sorted here instead.
      const params = new URLSearchParams({
        $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
        $select: `${MESSAGE_FIELDS},body`,
        $top: "50",
      });
      const page = await get<{ value?: GraphMessage[] }>(token, `${GRAPH}/me/messages?${params.toString()}`, {
        Prefer: 'outlook.body-content-type="text"',
      });
      const messages: MailMessage[] = (page.value ?? [])
        .sort((a, b) => messageDate(a).getTime() - messageDate(b).getTime())
        .map((message) => ({
          id: message.id,
          from: person(message.from),
          to: people(message.toRecipients),
          cc: people(message.ccRecipients),
          date: messageDate(message),
          subject: message.subject ?? "",
          body: clip(
            normalise(
              message.body?.contentType?.toLowerCase() === "html"
                ? stripHtml(message.body.content ?? "")
                : (message.body?.content ?? ""),
            ),
            6000,
          ),
        }));
      return {
        id: conversationId,
        subject: messages[0]?.subject || "(no subject)",
        url: page.value?.[0]?.webLink ?? "",
        messages,
      };
    },
  };
}

function summarise(conversationId: string, found: GraphMessage[]): MailThreadSummary {
  const messages = found.slice().sort((a, b) => messageDate(a).getTime() - messageDate(b).getTime());
  const first = messages[0];
  const last = messages[messages.length - 1];
  return {
    id: conversationId,
    subject: first.subject?.trim() || last.subject?.trim() || "(no subject)",
    snippet: normalise(last.bodyPreview ?? ""),
    participants: mergeParticipants(
      messages.flatMap((message) => [
        person(message.from) ? [person(message.from)!] : [],
        people(message.toRecipients),
        people(message.ccRecipients),
      ]),
    ),
    lastFrom: person(last.from),
    firstMessageAt: messageDate(first),
    lastMessageAt: messageDate(last),
    messageCount: messages.length,
    unread: messages.some((message) => message.isRead === false),
    url: last.webLink ?? "",
  };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

type GraphTime = { dateTime?: string; timeZone?: string };
type GraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  start?: GraphTime;
  end?: GraphTime;
  location?: { displayName?: string };
  organizer?: GraphRecipient;
  attendees?: { emailAddress?: { name?: string; address?: string }; status?: { response?: string } }[];
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  webLink?: string;
  responseStatus?: { response?: string };
};

/** Graph hands times back in the zone asked for, without an offset. UTC is asked for. */
function graphDate(time: GraphTime | undefined): Date {
  const raw = time?.dateTime ?? "";
  if (!raw) return new Date(NaN);
  return new Date(raw.endsWith("Z") ? raw : `${raw.replace(/\.\d+$/, "")}Z`);
}

const RESPONSES: Record<string, string> = {
  accepted: "accepted",
  declined: "declined",
  tentativelyaccepted: "tentative",
  organizer: "accepted",
  notresponded: "needsAction",
  none: "needsAction",
};

export function microsoftCalendarReader(token: string, accountEmail: string): CalendarReader {
  return {
    async listEvents(window: CalendarWindow) {
      const out: CalendarEvent[] = [];
      let url: string | undefined =
        `${GRAPH}/me/calendarView?` +
        new URLSearchParams({
          startDateTime: window.from.toISOString(),
          endDateTime: window.to.toISOString(),
          $top: "100",
          $select:
            "id,subject,bodyPreview,isAllDay,isCancelled,start,end,location,organizer,attendees,onlineMeeting,onlineMeetingUrl,webLink,responseStatus",
        }).toString();
      while (url && out.length < (window.limit ?? 250)) {
        const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await get(token, url, {
          Prefer: 'outlook.timezone="UTC"',
        });
        for (const item of page.value ?? []) {
          const event = toEvent(item, accountEmail);
          if (event && mentions(searchable(event), window.query)) out.push(event);
        }
        url = page["@odata.nextLink"];
      }
      return out;
    },
  };
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

function toEvent(item: GraphEvent, accountEmail: string): CalendarEvent | null {
  if (item.isCancelled) return null;
  const start = graphDate(item.start);
  const end = graphDate(item.end);
  if (Number.isNaN(start.getTime())) return null;
  const description = normalise(item.bodyPreview ?? "");
  return {
    id: item.id,
    title: item.subject?.trim() || "(no title)",
    description: clip(description, 2000),
    location: item.location?.displayName ?? "",
    start,
    end: Number.isNaN(end.getTime()) ? start : end,
    allDay: item.isAllDay === true,
    status: "confirmed",
    organizer: person(item.organizer),
    attendees: (item.attendees ?? [])
      .filter((attendee) => attendee.emailAddress?.address)
      .map((attendee) => {
        const email = attendee.emailAddress!.address!.trim().toLowerCase();
        return {
          name: attendee.emailAddress?.name ?? "",
          email,
          response: RESPONSES[(attendee.status?.response ?? "none").toLowerCase()] ?? "needsAction",
          self: email === accountEmail,
        };
      }),
    meetingUrl: item.onlineMeeting?.joinUrl || item.onlineMeetingUrl || findMeetingLink(description),
    url: item.webLink ?? "",
  };
}
