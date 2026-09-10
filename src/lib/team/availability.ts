import {
  formatMinutes,
  formatTimeInZone,
  offsetMinutes,
  partsInZone,
  zoneAbbreviation,
  zonedWallTimeToUtc,
  type TimeZoneId,
} from "@/lib/timezones";

/**
 * A working week, resolved onto real dates so it can be read in any zone.
 *
 * The stored hours are wall-clock times in each person's own zone. Rendering
 * them somewhere else needs an actual date, because the answer depends on
 * whether either zone is on daylight saving that week -- which is exactly why
 * this resolves against a real calendar week rather than doing offset
 * arithmetic.
 */

export type StoredBlock = {
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  label: string | null;
};

export type ResolvedBlock = {
  /** As it reads on the person's own clock: "9:00 AM – 6:00 PM". */
  ownHours: string;
  /** The same block on the viewer's clock, which may land on another day. */
  viewerHours: string;
  /** Set when the block starts on a different day in the viewer's zone. */
  viewerDayNote: string | null;
  label: string | null;
  start: Date;
  end: Date;
};

export type TeamDay = {
  /** 0 = Sunday, in the PERSON'S zone -- the day they think of it as. */
  weekday: number;
  date: string;
  blocks: ResolvedBlock[];
};

export type TeamMember = {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string;
  timeZone: TimeZoneId;
  /** "PDT", "GMT+8" -- what their zone calls itself right now. */
  zoneAbbr: string;
  /** Their local time right now. */
  localTime: string;
  localDay: string;
  /** Hours ahead (+) or behind (−) the viewer, right now. */
  hoursFromViewer: number;
  /** Working right now, by their own hours. */
  availableNow: boolean;
  /** When they next start, when they are not working now. */
  nextStart: { own: string; viewer: string; dayLabel: string } | null;
  days: TeamDay[];
  weeklyHours: number;
};

const DAY_MS = 86_400_000;

/** The Sunday that starts the week `at` falls in, as a date in `zone`. */
export function weekStartIn(at: Date, zone: TimeZoneId): { year: number; month: number; day: number } {
  const here = partsInZone(at, zone);
  const noon = Date.UTC(here.year, here.month - 1, here.day, 12, 0, 0, 0);
  const sunday = new Date(noon - here.weekday * DAY_MS);
  return {
    year: sunday.getUTCFullYear(),
    month: sunday.getUTCMonth() + 1,
    day: sunday.getUTCDate(),
  };
}

/** The calendar date `offset` days after a week start, as y/m/d. */
function dayFromWeekStart(
  weekStart: { year: number; month: number; day: number },
  offset: number,
): { year: number; month: number; day: number } {
  const noon = Date.UTC(weekStart.year, weekStart.month - 1, weekStart.day + offset, 12);
  const d = new Date(noon);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const isoDate = (p: { year: number; month: number; day: number }) =>
  `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

export function buildMember(args: {
  user: { id: string; name: string; jobTitle: string | null; email: string; timeZone: string };
  blocks: StoredBlock[];
  /** The zone the person LOOKING at the page is in. */
  viewerZone: TimeZoneId;
  now: Date;
}): TeamMember {
  const { user, blocks, viewerZone, now } = args;
  const zone = user.timeZone;

  // Their week, in their own zone -- Monday is whichever Monday it is where
  // they are, which on a Sunday evening in Manila is not the same date as it
  // is in California.
  const weekStart = weekStartIn(now, zone);

  const days: TeamDay[] = [];
  let weeklyMinutes = 0;

  for (let weekday = 0; weekday < 7; weekday++) {
    const date = dayFromWeekStart(weekStart, weekday);
    const dayBlocks = blocks
      .filter((b) => b.weekday === weekday)
      .sort((a, b) => a.startMinutes - b.startMinutes)
      .map((b) => {
        const start = zonedWallTimeToUtc(
          zone,
          date.year,
          date.month,
          date.day,
          Math.floor(b.startMinutes / 60),
          b.startMinutes % 60,
        );
        // An end before the start is an overnight shift, so it belongs to the
        // following day -- 10pm to 6am is eight hours, not minus sixteen.
        const endsNextDay = b.endMinutes <= b.startMinutes;
        const endDate = endsNextDay ? dayFromWeekStart(weekStart, weekday + 1) : date;
        const end = zonedWallTimeToUtc(
          zone,
          endDate.year,
          endDate.month,
          endDate.day,
          Math.floor(b.endMinutes / 60),
          b.endMinutes % 60,
        );

        weeklyMinutes += (end.getTime() - start.getTime()) / 60_000;

        // The viewer's calendar day for the start, compared with the
        // person's, so a block that lands "yesterday evening" says so.
        const ownDay = partsInZone(start, zone);
        const viewerDay = partsInZone(start, viewerZone);
        const ownIso = isoDate(ownDay);
        const viewerIso = isoDate(viewerDay);

        return {
          ownHours: `${formatMinutes(b.startMinutes)} – ${formatMinutes(b.endMinutes)}`,
          viewerHours: `${formatTimeInZone(start, viewerZone)} – ${formatTimeInZone(end, viewerZone)}`,
          viewerDayNote:
            viewerIso === ownIso
              ? null
              : viewerIso < ownIso
                ? "starts the day before"
                : "starts the next day",
          label: b.label,
          start,
          end,
        };
      });

    days.push({ weekday, date: isoDate(date), blocks: dayBlocks });
  }

  const allBlocks = days.flatMap((d) => d.blocks);
  const availableNow = allBlocks.some((b) => now >= b.start && now < b.end);
  const upcoming = allBlocks
    .filter((b) => b.start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  return {
    id: user.id,
    name: user.name,
    jobTitle: user.jobTitle,
    email: user.email,
    timeZone: zone,
    zoneAbbr: zoneAbbreviation(now, zone),
    localTime: formatTimeInZone(now, zone),
    localDay: new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long" }).format(now),
    hoursFromViewer: (offsetMinutes(now, zone) - offsetMinutes(now, viewerZone)) / 60,
    availableNow,
    nextStart: upcoming
      ? {
          own: formatTimeInZone(upcoming.start, zone),
          viewer: formatTimeInZone(upcoming.start, viewerZone),
          dayLabel: new Intl.DateTimeFormat("en-US", {
            timeZone: viewerZone,
            weekday: "long",
          }).format(upcoming.start),
        }
      : null,
    days,
    weeklyHours: Math.round((weeklyMinutes / 60) * 100) / 100,
  };
}

/**
 * The hours where everybody is working at once, for the coming week.
 *
 * The number the page exists for: a team split across Pacific and Manila has
 * a narrow window where a conversation can happen live, and it moves when one
 * side changes its clocks and the other does not.
 */
export function overlapWindows(members: TeamMember[]): { start: Date; end: Date }[] {
  const withHours = members.filter((m) => m.days.some((d) => d.blocks.length > 0));
  if (withHours.length < 2) return [];

  const [first, ...rest] = withHours;
  let windows = first.days.flatMap((d) => d.blocks.map((b) => ({ start: b.start, end: b.end })));

  for (const member of rest) {
    const theirs = member.days.flatMap((d) => d.blocks.map((b) => ({ start: b.start, end: b.end })));
    const next: { start: Date; end: Date }[] = [];
    for (const a of windows) {
      for (const b of theirs) {
        const start = a.start > b.start ? a.start : b.start;
        const end = a.end < b.end ? a.end : b.end;
        if (start < end) next.push({ start, end });
      }
    }
    windows = next;
  }

  return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}
