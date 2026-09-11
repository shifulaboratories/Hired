import { db } from "@/lib/db";
import { dueNow, listSchedule } from "@/lib/data/schedule";
import { diagnoseSearch, listApplications, pipelineStats, STAGE_LABEL } from "@/lib/data/pipeline";
import { timeZoneOf } from "@/lib/data/me";
import { civilDay, clockIn, weekdayIn } from "@/lib/time";
import { digestEmail, nudgeEmail, sendEmail } from "@/lib/email";
import { getSettings, emailIsConfigured } from "@/lib/settings";

/**
 * The two messages this app is willing to send you.
 *
 * Everything else here reaches you because you opened it. These are the only
 * things that go the other way, and the rules around them are deliberately
 * tight:
 *
 * - **Off until you turn them on.** Both default to false, and no admin can
 *   turn them on for somebody else. The first upgrade after this shipped must
 *   not be the day the app started emailing people.
 * - **The nudge only arrives on a day something is due.** A daily mail that
 *   says "nothing today" every day is a daily mail people filter, and then the
 *   one that mattered goes in the same folder.
 * - **Sent once per day, per person, in THEIR zone.** `lastDigestOn` and
 *   `lastNudgeOn` hold a civil day string rather than a timestamp, which is
 *   what makes the sweep safe to run hourly — or twice, by a cron that
 *   overlapped.
 * - **Nothing is scheduled inside the app.** There is no timer, no queue and no
 *   background worker; the transport has to stay stateless. A self-hoster
 *   points their platform's scheduler at /api/digest/<token> and this runs.
 */

export type DigestKind = "weekly" | "nudge";

export type DigestContent = {
  kind: DigestKind;
  /** The email subject. Says the number, because that is what gets it opened. */
  subject: string;
  /** The opening line, in the app's voice. */
  intro: string;
  sections: { heading: string; lines: string[] }[];
  /** True when there is genuinely nothing to say. The nudge does not send. */
  empty: boolean;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What is owed today.
 *
 * Deliberately short. It is read on a phone before work, and its whole job is
 * to get somebody to open the app — so it names the things and stops.
 */
export async function nudgeContent(userId: string): Promise<DigestContent> {
  const due = await dueNow(userId);
  const sections: { heading: string; lines: string[] }[] = [];

  if (due.offers.length > 0) {
    sections.push({
      heading: "Answer by today",
      lines: due.offers.map((item) => `${item.title} — ${item.detail}`),
    });
  }
  if (due.followUps.length > 0) {
    sections.push({
      heading: "Chase",
      lines: due.followUps.map(
        (item) => `${item.title} — ${item.detail}${item.overdue ? " (overdue)" : ""}`,
      ),
    });
  }
  if (due.pings.length > 0) {
    sections.push({
      heading: "Ping",
      lines: due.pings.map((item) => `${item.title} — ${item.detail}`),
    });
  }
  if (due.tasks.length > 0) {
    sections.push({
      heading: "Tasks",
      lines: due.tasks.map((item) => `${item.title}${item.detail ? ` — ${item.detail}` : ""}`),
    });
  }

  const overdue =
    due.offers.filter((item) => item.overdue).length +
    due.followUps.filter((item) => item.overdue).length +
    due.tasks.filter((item) => item.overdue).length;

  return {
    kind: "nudge",
    subject:
      due.total === 0
        ? "Nothing due today"
        : `${plural(due.total, "thing")} today${overdue > 0 ? `, ${overdue} already late` : ""}`,
    intro:
      due.offers.length > 0
        ? "An offer needs an answer. That one first."
        : overdue > 0
          ? "Some of this was due before today."
          : "Here is what today owes.",
    sections,
    empty: due.total === 0,
  };
}

/**
 * The week: what happened, what is coming, and the one thing worth fixing.
 *
 * Built from the same reads `pipeline_review` and `log_my_week` walk an
 * assistant through, which is on purpose — the mail and the conversation
 * should not disagree about how the search is going.
 */
export async function weeklyContent(userId: string): Promise<DigestContent> {
  const zone = await timeZoneOf(userId);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

  const [stats, quiet, past, ahead, diagnosis] = await Promise.all([
    pipelineStats(userId),
    listApplications(userId, { quietForDays: 14 }),
    listSchedule(userId, weekAgo, now),
    listSchedule(userId, now, weekAhead),
    diagnoseSearch(userId),
  ]);

  const moves = past.filter((entry) => entry.kind === "ACTIVITY");
  const coming = ahead.filter((entry) => entry.kind !== "ACTIVITY");

  const sections: { heading: string; lines: string[] }[] = [];

  sections.push({
    heading: "Where it stands",
    lines: [
      `${plural(stats.active, "application")} still live`,
      `${plural(stats.interviews, "interview")} in play`,
      stats.offers > 0 ? `${plural(stats.offers, "offer")} on the table` : "",
      `${plural(stats.thisWeek, "application")} sent this week`,
    ].filter(Boolean),
  });

  if (moves.length > 0) {
    sections.push({
      heading: "What moved",
      lines: moves.slice(0, 8).map((entry) => `${entry.title}${entry.company ? "" : ""}`),
    });
  }

  if (coming.length > 0) {
    sections.push({
      heading: "This week",
      lines: coming
        .slice(0, 10)
        .map((entry) => `${civilDay(entry.date, zone)} — ${entry.title}`),
    });
  }

  if (quiet.length > 0) {
    sections.push({
      heading: "Gone quiet",
      lines: quiet
        .slice(0, 8)
        .map(
          (row) =>
            `${row.company.name} — ${row.roleTitle}, ${plural(row.quietDays, "day")} since anything happened (${STAGE_LABEL[row.stage]})`,
        ),
    });
  }

  // The headline only, not the whole report. A weekly mail carrying six
  // findings is a weekly mail nobody acts on — and the diagnosis withholds its
  // own headline until there is enough data to mean it.
  if (diagnosis.confident) {
    sections.push({ heading: "Worth fixing", lines: [diagnosis.headline, diagnosis.detail] });
  }

  const nothing = stats.total === 0;
  return {
    kind: "weekly",
    subject: nothing
      ? "Your week — nothing on the board yet"
      : `Your week — ${plural(stats.active, "live application")}, ${plural(coming.length, "thing")} coming up`,
    intro: nothing
      ? "Nothing on the board yet. The fastest way to start is to paste a job link into the chat and let it capture the posting."
      : moves.length === 0
        ? "Quiet week — nothing was logged against anything."
        : `${plural(moves.length, "thing")} happened.`,
    sections,
    empty: false,
  };
}

export async function digestContent(userId: string, kind: DigestKind) {
  return kind === "nudge" ? nudgeContent(userId) : weeklyContent(userId);
}

export type DigestPreferences = {
  weeklyDigest: boolean;
  dailyNudge: boolean;
  digestHour: number;
  lastDigestOn: string;
  lastNudgeOn: string;
  /** Whether the instance can send at all. A switch that cannot work is a lie. */
  emailConfigured: boolean;
};

export async function getDigestPreferences(userId: string): Promise<DigestPreferences> {
  const [profile, settings] = await Promise.all([
    db.profile.findUnique({
      where: { userId },
      select: {
        weeklyDigest: true,
        dailyNudge: true,
        digestHour: true,
        lastDigestOn: true,
        lastNudgeOn: true,
      },
    }),
    getSettings(),
  ]);
  return {
    weeklyDigest: profile?.weeklyDigest ?? false,
    dailyNudge: profile?.dailyNudge ?? false,
    digestHour: profile?.digestHour ?? 8,
    lastDigestOn: profile?.lastDigestOn ?? "",
    lastNudgeOn: profile?.lastNudgeOn ?? "",
    emailConfigured: emailIsConfigured(settings),
  };
}

export async function setDigestPreferences(
  userId: string,
  patch: { weeklyDigest?: boolean; dailyNudge?: boolean; digestHour?: number },
) {
  const data: { weeklyDigest?: boolean; dailyNudge?: boolean; digestHour?: number } = {};
  if (patch.weeklyDigest !== undefined) data.weeklyDigest = patch.weeklyDigest;
  if (patch.dailyNudge !== undefined) data.dailyNudge = patch.dailyNudge;
  if (patch.digestHour !== undefined) {
    const hour = Math.trunc(patch.digestHour);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      throw new Error("The hour is a number from 0 to 23, in your own time zone.");
    }
    data.digestHour = hour;
  }
  await db.profile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  return getDigestPreferences(userId);
}

export type SendOutcome =
  | { sent: true; kind: DigestKind; to: string; subject: string }
  | { sent: false; kind: DigestKind; reason: string };

/**
 * Send one person one message, now.
 *
 * `force` is what the "send me one now" button passes: it skips the
 * once-a-day guard and the empty check, because somebody who just clicked a
 * button is entitled to see what the mail looks like even on a quiet day. It
 * does NOT skip the opt-in — there is no path in this file that mails somebody
 * who has not asked to be mailed, and `force` must never become one.
 */
export async function sendDigest(
  userId: string,
  kind: DigestKind,
  options?: { force?: boolean; now?: Date },
): Promise<SendOutcome> {
  const now = options?.now ?? new Date();
  const [user, settings] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        isActive: true,
        profile: {
          select: {
            timeZone: true,
            weeklyDigest: true,
            dailyNudge: true,
            lastDigestOn: true,
            lastNudgeOn: true,
          },
        },
      },
    }),
    getSettings(),
  ]);
  if (!user) return { sent: false, kind, reason: "No such account" };
  if (!user.isActive) return { sent: false, kind, reason: "That account is suspended" };
  if (!emailIsConfigured(settings)) {
    return { sent: false, kind, reason: "Email is not configured on this instance" };
  }

  const wanted = kind === "weekly" ? user.profile?.weeklyDigest : user.profile?.dailyNudge;
  if (!wanted) return { sent: false, kind, reason: "They have not asked for this one" };

  const zone = user.profile?.timeZone || "UTC";
  const today = civilDay(now, zone);
  const already = kind === "weekly" ? user.profile?.lastDigestOn : user.profile?.lastNudgeOn;
  if (!options?.force && already === today) {
    return { sent: false, kind, reason: "Already sent today" };
  }

  const content = await digestContent(userId, kind);
  // A nudge with nothing in it is not sent. A daily mail that says "nothing
  // today" every day is a daily mail people filter, and then the one that
  // mattered lands in the same folder.
  if (content.empty && !options?.force) {
    // Stamped anyway: nothing was owed today, and the sweep should not keep
    // rebuilding the same empty answer every hour until midnight.
    await stamp(userId, kind, today);
    return { sent: false, kind, reason: "Nothing was due" };
  }

  const base = (settings.publicUrl || "").replace(/\/$/, "");
  const message =
    kind === "nudge"
      ? nudgeEmail({ instanceName: settings.instanceName, name: user.name, content, appUrl: base })
      : digestEmail({ instanceName: settings.instanceName, name: user.name, content, appUrl: base });

  const result = await sendEmail({
    to: user.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    settings,
  });
  if (!result.ok) return { sent: false, kind, reason: result.error };

  await stamp(userId, kind, today);
  return { sent: true, kind, to: user.email, subject: message.subject };
}

async function stamp(userId: string, kind: DigestKind, day: string) {
  await db.profile.updateMany({
    where: { userId },
    data: kind === "weekly" ? { lastDigestOn: day } : { lastNudgeOn: day },
  });
}

export type SweepReport = {
  considered: number;
  sent: number;
  skipped: number;
  problems: string[];
};

/**
 * The sweep. Run it hourly; it decides who is due.
 *
 * Everything about who gets what lives here rather than in the scheduler, so
 * the address a self-hoster points cron at never needs to change and running
 * it more often than necessary costs a few queries rather than a duplicate
 * mail. An hour that is nobody's hour sends nothing.
 *
 * The weekly one goes out on Monday, in the reader's own week — a Sunday
 * evening summary is a summary read on Monday morning anyway, and Monday is
 * when somebody can act on it.
 */
export async function runDigestSweep(now = new Date()): Promise<SweepReport> {
  const settings = await getSettings();
  if (!emailIsConfigured(settings)) {
    return { considered: 0, sent: 0, skipped: 0, problems: ["Email is not configured"] };
  }

  const profiles = await db.profile.findMany({
    where: { OR: [{ weeklyDigest: true }, { dailyNudge: true }] },
    select: {
      userId: true,
      timeZone: true,
      digestHour: true,
      weeklyDigest: true,
      dailyNudge: true,
      lastDigestOn: true,
      lastNudgeOn: true,
      user: { select: { isActive: true } },
    },
  });

  const report: SweepReport = { considered: profiles.length, sent: 0, skipped: 0, problems: [] };

  for (const profile of profiles) {
    if (!profile.user.isActive) {
      report.skipped += 1;
      continue;
    }
    const zone = profile.timeZone || "UTC";
    const here = clockIn(now, zone);
    const today = civilDay(now, zone);

    // Their hour, or any hour after it on the same day — a scheduler that
    // missed 08:00 should still deliver at 09:00 rather than skip the day.
    const reached = here.hour >= profile.digestHour;

    for (const kind of ["nudge", "weekly"] as const) {
      const wanted = kind === "weekly" ? profile.weeklyDigest : profile.dailyNudge;
      const already = kind === "weekly" ? profile.lastDigestOn : profile.lastNudgeOn;
      // Monday, in their week. A Sunday-evening summary is read on Monday
      // morning anyway, and Monday is when somebody can act on it.
      const rightDay = kind === "weekly" ? weekdayIn(now, zone) === 1 : true;
      if (!wanted || !reached || !rightDay || already === today) {
        report.skipped += 1;
        continue;
      }
      try {
        const outcome = await sendDigest(profile.userId, kind, { now });
        if (outcome.sent) report.sent += 1;
        else report.skipped += 1;
      } catch (error) {
        report.problems.push(
          `${kind} for one account: ${error instanceof Error ? error.message : "failed"}`,
        );
      }
    }
  }

  return report;
}
