import { createDAVClient, type DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import {
  ProviderError,
  type CalendarAttendee,
  type CalendarEvent,
  type CalendarReader,
  type CalendarWindow,
  type MailParticipant,
} from "@/lib/accounts/types";
import { clip, findMeetingLink, mentions, normalise } from "@/lib/accounts/text";

/**
 * Any calendar that speaks CalDAV: iCloud, Fastmail, Nextcloud, Radicale,
 * and Google's own CalDAV endpoint for the person who would rather not
 * hand over an OAuth token.
 *
 * tsdav does the discovery — the well-known URL, the principal, the
 * calendar-home — which is the part that differs between every server and
 * the part not worth writing twice. ical.js parses what comes back.
 * Recurrences are asked to be expanded server-side (RFC 4791's `expand`),
 * and expanded here when a server ignores that, so a weekly standing call
 * shows each occurrence either way.
 *
 * Read-only: only PROPFIND and REPORT are ever issued.
 */

export type CaldavConfig = {
  /** The server, or the account's calendar home. Discovery finds the rest. */
  url: string;
  username: string;
  password: string;
};

async function client(config: CaldavConfig) {
  try {
    return await createDAVClient({
      serverUrl: config.url,
      credentials: { username: config.username, password: config.password },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const auth = /401|403|unauthori[sz]ed|forbidden/i.test(message);
    throw new ProviderError(
      auth
        ? `${config.url} refused the login. Use an app password rather than the account password.`
        : `Could not discover a calendar at ${config.url}. ${message}`,
      { revoked: auth },
    );
  }
}

function eventCalendars(calendars: DAVCalendar[]): DAVCalendar[] {
  return calendars.filter((calendar) => {
    const components = calendar.components ?? [];
    return components.length === 0 || components.includes("VEVENT");
  });
}

/** Log in, discover, list calendars. The whole test of a CalDAV account. */
export async function verifyCaldav(config: CaldavConfig): Promise<{ calendars: string[] }> {
  const dav = await client(config);
  const calendars = eventCalendars(await dav.fetchCalendars());
  if (calendars.length === 0) {
    throw new ProviderError(`Signed in to ${config.url}, but it has no calendars.`);
  }
  return { calendars: calendars.map((calendar) => String(calendar.displayName ?? calendar.url)) };
}

export function caldavCalendarReader(config: CaldavConfig): CalendarReader {
  return {
    async listEvents(window: CalendarWindow) {
      const dav = await client(config);
      const calendars = eventCalendars(await dav.fetchCalendars());
      const out: CalendarEvent[] = [];
      const seen = new Set<string>();
      for (const calendar of calendars) {
        let objects;
        try {
          objects = await dav.fetchCalendarObjects({
            calendar,
            timeRange: { start: window.from.toISOString(), end: window.to.toISOString() },
            expand: true,
          });
        } catch {
          // A server that rejects `expand` answers the plain query.
          objects = await dav.fetchCalendarObjects({
            calendar,
            timeRange: { start: window.from.toISOString(), end: window.to.toISOString() },
          });
        }
        for (const object of objects) {
          if (!object.data) continue;
          for (const event of parseEvents(String(object.data), window)) {
            const key = `${event.id}@${event.start.toISOString()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (mentions(searchable(event), window.query)) out.push(event);
          }
        }
        if (out.length >= (window.limit ?? 250)) break;
      }
      return out.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, window.limit ?? 250);
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

const PARTSTAT: Record<string, string> = {
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "tentative",
  "NEEDS-ACTION": "needsAction",
};

function mailto(value: unknown): string {
  return String(value ?? "")
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
}

function personFrom(property: ICAL.Property | null): MailParticipant | null {
  if (!property) return null;
  const email = mailto(property.getFirstValue());
  if (!email.includes("@")) return null;
  return { name: String(property.getParameter("cn") ?? ""), email };
}

function attendeesOf(component: ICAL.Component): CalendarAttendee[] {
  return component
    .getAllProperties("attendee")
    .map((property) => {
      const email = mailto(property.getFirstValue());
      if (!email.includes("@")) return null;
      const partstat = String(property.getParameter("partstat") ?? "NEEDS-ACTION").toUpperCase();
      return {
        name: String(property.getParameter("cn") ?? ""),
        email,
        response: PARTSTAT[partstat] ?? "needsAction",
        self: false,
      };
    })
    .filter((attendee): attendee is CalendarAttendee => attendee !== null);
}

/** Every occurrence inside the window from one .ics, whether the server expanded it or not. */
function parseEvents(ics: string, window: CalendarWindow): CalendarEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(ics));
  } catch {
    return [];
  }
  const out: CalendarEvent[] = [];
  for (const vevent of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);
    if (String(vevent.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") continue;
    // An overridden occurrence carries RECURRENCE-ID and is its own VEVENT;
    // only a master with an RRULE needs expanding.
    if (event.isRecurring() && !event.isRecurrenceException()) {
      const iterator = event.iterator();
      let next: ICAL.Time | null;
      let guard = 0;
      while ((next = iterator.next()) && guard++ < 500) {
        const start = next.toJSDate();
        if (start > window.to) break;
        const details = event.getOccurrenceDetails(next);
        const end = details.endDate.toJSDate();
        if (end < window.from) continue;
        out.push(toEvent(vevent, event, start, end, next.isDate));
      }
    } else {
      const start = event.startDate?.toJSDate();
      if (!start) continue;
      const end = event.endDate?.toJSDate() ?? start;
      if (end < window.from || start > window.to) continue;
      out.push(toEvent(vevent, event, start, end, event.startDate.isDate));
    }
  }
  return out;
}

function toEvent(vevent: ICAL.Component, event: ICAL.Event, start: Date, end: Date, allDay: boolean): CalendarEvent {
  const description = normalise(String(event.description ?? ""));
  const url = String(vevent.getFirstPropertyValue("url") ?? "");
  const conference = String(
    vevent.getFirstPropertyValue("x-google-conference") ?? vevent.getFirstPropertyValue("conference") ?? "",
  );
  return {
    id: event.uid,
    title: String(event.summary ?? "").trim() || "(no title)",
    description: clip(description, 2000),
    location: String(event.location ?? ""),
    start,
    end,
    allDay,
    status: String(vevent.getFirstPropertyValue("status") ?? "confirmed").toLowerCase(),
    organizer: personFrom(vevent.getFirstProperty("organizer")),
    attendees: attendeesOf(vevent),
    meetingUrl: findMeetingLink(`${conference} ${url} ${event.location ?? ""} ${description}`),
    url: /^https?:/i.test(url) ? url : "",
  };
}
