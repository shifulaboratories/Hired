import * as pipeline from "@/lib/data/pipeline";
import { listMatchedEvents } from "@/lib/data/accounts";
import { offersDueBetween, offersDueBy } from "@/lib/data/offers";
import { timeZoneOf } from "@/lib/data/me";
import { endOfDay } from "@/lib/time";

/**
 * Everything dated in a window: the pipeline's own follow-ups, tasks and
 * logged activity, plus — when a calendar is connected — the meetings on the
 * person's real calendar that involve someone on the pipeline.
 *
 * A file of its own rather than a branch in pipeline.ts because the merge
 * pulls in the provider layer, whose IMAP library is Node-only, and
 * pipeline.ts is imported by client components for its labels and tones. The
 * calendar view and list_schedule call this; nothing else needs to.
 */
export async function listSchedule(
  userId: string,
  from: Date | string,
  to: Date | string,
): Promise<pipeline.ScheduleEntry[]> {
  const start = new Date(from);
  const end = new Date(to);
  const [own, matched] = await Promise.all([
    pipeline.listSchedule(userId, from, to),
    // Empty, never an error, when nothing is connected.
    listMatchedEvents(userId, start, end).then((result) => result.events),
  ]);

  const deadlines: pipeline.ScheduleEntry[] = (await offersDueBetween(userId, start, end)).map(
    (offer) => ({
      kind: "OFFER" as const,
      id: offer.id,
      date: offer.respondBy!,
      title: `Answer ${offer.application.company.name}`,
      detail: offer.application.roleTitle,
      company: offer.application.company.name,
      applicationId: offer.applicationId,
      contactId: null,
      stage: offer.application.stage,
      done: null,
      activityType: null,
    }),
  );

  const meetings: pipeline.ScheduleEntry[] = matched.map((event) => ({
    kind: "MEETING" as const,
    id: event.id,
    date: event.start,
    title: event.title,
    detail: [
      event.contactName,
      event.companyName,
      event.allDay
        ? "All day"
        : `${event.start.toISOString().slice(11, 16)}–${event.end.toISOString().slice(11, 16)} UTC`,
    ]
      .filter(Boolean)
      .join(" · "),
    company: event.companyName,
    applicationId: event.applicationId,
    contactId: event.contactId,
    stage: null,
    done: null,
    activityType: null,
    url: event.url,
  }));

  return [...own, ...meetings, ...deadlines].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Everything whose date has come round, offer deadlines included.
 *
 * pipeline.dueNow answers the first three — a follow-up, a ping, a task. The
 * fourth lives here for the same reason MEETING does: pipeline.ts is imported
 * by client components, and the merge belongs next to the other merge rather
 * than in two places.
 *
 * An offer deadline is the one date in this app that cannot be snoozed. Missing
 * a follow-up costs you a day; missing a respond-by costs you the job. It is
 * listed last and counted first.
 */
export async function dueNow(
  userId: string,
  withinDays = 0,
): Promise<{
  followUps: pipeline.DueItem[];
  pings: pipeline.DueItem[];
  tasks: pipeline.DueItem[];
  offers: pipeline.DueItem[];
  total: number;
}> {
  const now = new Date();
  const [own, deadlines] = await Promise.all([
    pipeline.dueNow(userId, withinDays),
    timeZoneOf(userId).then((zone) => offersDueBy(userId, endOfDay(zone, withinDays))),
  ]);

  const offers: pipeline.DueItem[] = deadlines.map((offer) => ({
    kind: "OFFER" as const,
    id: offer.applicationId,
    title: `Answer ${offer.application.company.name}`,
    detail: offer.application.roleTitle,
    dueAt: offer.respondBy,
    overdue: offer.respondBy !== null && offer.respondBy < now,
  }));

  return { ...own, offers, total: own.total + offers.length };
}
