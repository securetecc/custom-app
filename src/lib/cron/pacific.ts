/**
 * Pacific-time gating for scheduled jobs.
 *
 * Vercel Cron only accepts UTC expressions, so a fixed UTC schedule drifts an
 * hour twice a year when Pacific switches between PST (UTC-8) and PDT (UTC-7).
 * A job meant for 7pm Pacific would fire at 6pm for half the year.
 *
 * The fix is two-sided:
 *   1. vercel.json fires each job at BOTH candidate UTC hours, so one of them
 *      is always the correct Pacific local time whatever the current offset.
 *   2. Each route calls shouldRunNow() and no-ops on the wrong one.
 *
 * Everything below derives the local time from Intl with an explicit
 * timeZone rather than from a fixed offset, so DST transition dates come from
 * the runtime's tz database instead of being hard-coded and going stale.
 */
export const PACIFIC_TZ = "America/Los_Angeles";

export type PacificNow = {
  /** 0-23, local Pacific */
  hour: number;
  /** 1-31, local Pacific */
  day: number;
  /** 0 = Sunday … 6 = Saturday, local Pacific */
  weekday: number;
};

export function pacificNow(at: Date = new Date()): PacificNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    hour: "2-digit",
    hour12: false,
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    // "24" is a legal hour12:false rendering of midnight in some ICU versions.
    hour: Number(get("hour")) % 24,
    day: Number(get("day")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

export type Schedule = {
  /** Local Pacific hour the job is meant to run at. */
  hour: number;
  /** Restrict to these local weekdays (0=Sun). Omit for any day. */
  weekdays?: number[];
  /** Restrict to this local day-of-month. Omit for any day. */
  dayOfMonth?: number;
};

/**
 * True only when the current Pacific local time matches the intended
 * schedule. Weekday and day-of-month are evaluated in Pacific too -- checking
 * them in UTC would pick the wrong day for anything scheduled near midnight.
 */
export function shouldRunNow(schedule: Schedule, at: Date = new Date()): boolean {
  const now = pacificNow(at);
  if (now.hour !== schedule.hour) return false;
  if (schedule.weekdays && !schedule.weekdays.includes(now.weekday)) return false;
  if (schedule.dayOfMonth !== undefined && now.day !== schedule.dayOfMonth) return false;
  return true;
}

/** Response for a run that fired on the off-hour UTC trigger. */
export function skippedResponse(schedule: Schedule, at: Date = new Date()) {
  const now = pacificNow(at);
  return {
    ok: true,
    skipped: true,
    reason: `Not the scheduled Pacific time (now ${now.hour}:00 PT, scheduled ${schedule.hour}:00 PT).`,
  };
}
