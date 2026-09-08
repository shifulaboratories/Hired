/**
 * Civil dates, in the reader's time zone rather than the server's.
 *
 * Almost every date in this product is a CIVIL one — the day you applied, the
 * day you said you would chase, "today", "overdue". None of those are instants;
 * they are somebody's calendar. And every one of them used to be computed from
 * `new Date()` on the server, which on a hosted instance means UTC. A person in
 * Los Angeles saw a follow-up turn red at 5pm the day before it was due, was
 * greeted with "Good evening" over lunch, and had the app's 9am nudge land at
 * 1am. Nothing was broken enough to report; it was wrong every single day.
 *
 * So the profile carries an IANA zone and everything that decides a civil date
 * takes it. An empty zone means "the server's", which is what every account had
 * before this and is exactly right for a self-hoster running it on the machine
 * under their desk.
 *
 * No date library. `Intl` already ships the full IANA database in Node and in
 * every browser, and the two things this file needs — what the clock says in a
 * zone, and which instant a given local time is — are both derivable from it.
 */

/** Nothing set. Every function here treats it as "use the host's zone". */
export const SERVER_ZONE = "";

const partsOf = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const found = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // `hour12: false` reports midnight as 24 in some ICU builds, which would
    // otherwise push every midnight into the next day.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
  };
};

/**
 * What the wall clock said in `timeZone` at this instant.
 *
 * The whole file is built on this: format the instant in the zone and read the
 * numbers back. Whatever the zone's offset and DST rules are, Intl has already
 * applied them.
 */
export function clockIn(date: Date, timeZone: string) {
  return partsOf(date, timeZone);
}

/** "2026-03-14" — the calendar day this instant falls on, in that zone. */
export function civilDay(date: Date, timeZone: string): string {
  const { year, month, day } = partsOf(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The instant at which the clock in `timeZone` reads this local time.
 *
 * Guess that the local time is UTC, measure how wrong that is at the guess, and
 * correct — twice, because the offset may itself differ at the corrected
 * instant, which is exactly what happens across a DST boundary. Two passes
 * converge everywhere except inside the spring-forward gap, where the local
 * time being asked for does not exist and any answer is a choice; this one
 * lands on the instant just after the jump.
 */
export function instantAt(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    const at = partsOf(new Date(guess), timeZone);
    const shown = Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second, ms);
    guess = guess + (wanted - shown);
  }
  return new Date(guess);
}

/** Midnight this morning, where the reader is. */
export function startOfDay(timeZone: string, now = new Date()): Date {
  const { year, month, day } = partsOf(now, timeZone);
  return instantAt(timeZone, year, month, day, 0, 0, 0, 0);
}

/** The last millisecond of a day `daysAhead` from now, where the reader is. */
export function endOfDay(timeZone: string, daysAhead = 0, now = new Date()): Date {
  const start = startOfDay(timeZone, now);
  // Step by whole days on the CIVIL calendar rather than by 86,400,000ms: the
  // day a clock goes forward is 23 hours long, and adding a fixed day to it
  // lands an hour into the day after.
  const stepped = partsOf(new Date(start.getTime() + daysAhead * 86_400_000 + 3_600_000), timeZone);
  return instantAt(timeZone, stepped.year, stepped.month, stepped.day, 23, 59, 59, 999);
}

/** Monday morning of the reader's current week. */
export function startOfWeek(timeZone: string, now = new Date()): Date {
  const start = startOfDay(timeZone, now);
  // Which weekday it is where they are, not where the server is.
  const weekday = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
  }).format(now);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const back = index < 0 ? 0 : index;
  const stepped = partsOf(new Date(start.getTime() - back * 86_400_000 + 3_600_000), timeZone);
  return instantAt(timeZone, stepped.year, stepped.month, stepped.day, 0, 0, 0, 0);
}

/**
 * `daysAhead` days from now at `hour` o'clock, where the reader is.
 *
 * This is what schedules a follow-up: "in a week, at nine in the morning" has
 * to mean nine in THEIR morning or the reminder is useless.
 */
export function atHourInDays(
  timeZone: string,
  daysAhead: number,
  hour: number,
  now = new Date(),
): Date {
  const start = startOfDay(timeZone, now);
  const stepped = partsOf(new Date(start.getTime() + daysAhead * 86_400_000 + 3_600_000), timeZone);
  return instantAt(timeZone, stepped.year, stepped.month, stepped.day, hour, 0, 0, 0);
}

/** How many calendar days apart two instants are, on the reader's calendar. */
export function daysBetween(from: Date, to: Date, timeZone: string): number {
  const a = partsOf(from, timeZone);
  const b = partsOf(to, timeZone);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/**
 * Whether a string is a zone this runtime actually knows.
 *
 * Anything reaching this came from a browser or from an assistant, and an
 * unknown zone would make every Intl call below throw at render time rather
 * than at the point it was set.
 */
export function isValidTimeZone(value: string): boolean {
  if (!value) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
