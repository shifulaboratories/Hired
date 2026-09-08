import * as pipeline from "@/lib/data/pipeline";
import { listMatchedEvents } from "@/lib/data/accounts";

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

  return [...own, ...meetings].sort((a, b) => a.date.getTime() - b.date.getTime());
}
