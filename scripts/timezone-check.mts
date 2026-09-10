/**
 * Assertions for the Pacific/Manila conversion, run without a database.
 *
 *   npx tsx scripts/timezone-check.mts
 *
 * The case that matters: Pacific observes daylight saving and Manila does
 * not, so the gap between them is 15 hours for part of the year and 16 for
 * the rest. Anything built on a fixed offset is wrong for months at a time.
 */
import {
  MANILA,
  PACIFIC,
  formatTimeInZone,
  formatMinutes,
  hoursBetween,
  offsetMinutes,
  parseMinutes,
  zoneAbbreviation,
  zonedWallTimeToUtc,
} from "../src/lib/timezones";
import { buildMember, overlapWindows } from "../src/lib/team/availability";
import { buildWeekGrid } from "../src/lib/team/week-grid";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

console.log("Offsets either side of the Pacific transitions\n");
// 2026: PDT ends 1 November, PST ends 8 March 2027.
const summer = new Date("2026-09-10T18:00:00Z");
const winter = new Date("2026-12-10T18:00:00Z");

check("Pacific is UTC-7 in September", offsetMinutes(summer, PACIFIC) / 60, -7);
check("Pacific is UTC-8 in December", offsetMinutes(winter, PACIFIC) / 60, -8);
check("Manila is UTC+8 in September", offsetMinutes(summer, MANILA) / 60, 8);
check("Manila is UTC+8 in December too — it has no DST", offsetMinutes(winter, MANILA) / 60, 8);
check("Manila is 15h ahead of Pacific in September", hoursBetween(summer, PACIFIC, MANILA), 15);
check("Manila is 16h ahead of Pacific in December", hoursBetween(winter, PACIFIC, MANILA), 16);
check("September Pacific calls itself PDT", zoneAbbreviation(summer, PACIFIC), "PDT");
check("December Pacific calls itself PST", zoneAbbreviation(winter, PACIFIC), "PST");
// Manila must never render as "PST" -- Intl gives GMT+8, and initials of its
// long name would collide with Pacific on the very page that compares them.
check("Manila is PHT in September", zoneAbbreviation(summer, MANILA), "PHT");
check("Manila is PHT in December too", zoneAbbreviation(winter, MANILA), "PHT");
check("Manila never reads as Pacific's abbreviation",
  zoneAbbreviation(winter, MANILA) === zoneAbbreviation(winter, PACIFIC), false);

console.log("\nA Manila 9am start, read in Pacific\n");
// Zia starts at 9am Manila. In Pacific that is the PREVIOUS evening, and
// which evening hour depends on whether Pacific is on DST.
const sepStart = zonedWallTimeToUtc(MANILA, 2026, 9, 10, 9, 0);
check("9am Manila on 10 Sep is 6:00 PM Pacific", formatTimeInZone(sepStart, PACIFIC), "6:00 PM");
check("...on 9 September, the day before", new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC }).format(sepStart), "2026-09-09");

const decStart = zonedWallTimeToUtc(MANILA, 2026, 12, 10, 9, 0);
check("9am Manila on 10 Dec is 5:00 PM Pacific", formatTimeInZone(decStart, PACIFIC), "5:00 PM");

console.log("\nA Pacific 8am start, read in Manila\n");
const sepTony = zonedWallTimeToUtc(PACIFIC, 2026, 9, 10, 8, 0);
check("8am Pacific on 10 Sep is 11:00 PM Manila", formatTimeInZone(sepTony, MANILA), "11:00 PM");
const decTony = zonedWallTimeToUtc(PACIFIC, 2026, 12, 10, 8, 0);
check("8am Pacific on 10 Dec is 12:00 AM Manila", formatTimeInZone(decTony, MANILA), "12:00 AM");

console.log("\nThe transition days themselves\n");
// Clocks go back at 2am Pacific on 1 November 2026.
const beforeFallBack = zonedWallTimeToUtc(PACIFIC, 2026, 10, 31, 12, 0);
const afterFallBack = zonedWallTimeToUtc(PACIFIC, 2026, 11, 1, 12, 0);
check("noon Pacific 31 Oct is PDT", zoneAbbreviation(beforeFallBack, PACIFIC), "PDT");
check("noon Pacific 1 Nov is PST", zoneAbbreviation(afterFallBack, PACIFIC), "PST");
check("the gap to Manila widens overnight", [
  hoursBetween(beforeFallBack, PACIFIC, MANILA),
  hoursBetween(afterFallBack, PACIFIC, MANILA),
], [15, 16]);

// Clocks go forward at 2am Pacific on 14 March 2027 -- 2:30am does not exist.
const skipped = zonedWallTimeToUtc(PACIFIC, 2027, 3, 14, 2, 30);
check("a wall time that never happened lands at 3:30 AM", formatTimeInZone(skipped, PACIFIC), "3:30 AM");

// 1:30am on 1 November happens twice; either instant is a defensible answer,
// and what matters is that it stays on the right calendar day.
const repeated = zonedWallTimeToUtc(PACIFIC, 2026, 11, 1, 1, 30);
check("a wall time that happened twice stays on its own day",
  new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC }).format(repeated), "2026-11-01");

console.log("\nRound trips and formatting\n");
for (const [zone, y, mo, d, h, mi] of [
  [PACIFIC, 2026, 9, 10, 8, 30],
  [PACIFIC, 2026, 12, 25, 17, 0],
  [MANILA, 2026, 9, 10, 9, 0],
  [MANILA, 2027, 3, 14, 18, 45],
] as const) {
  const instant = zonedWallTimeToUtc(zone, y, mo, d, h, mi);
  const back = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(instant);
  check(`${zone} ${y}-${mo}-${d} ${h}:${String(mi).padStart(2, "0")} round-trips`, back,
    `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`);
}

check("540 minutes reads as 9:00 AM", formatMinutes(540), "9:00 AM");
check("0 minutes reads as 12:00 AM", formatMinutes(0), "12:00 AM");
check("720 minutes reads as 12:00 PM", formatMinutes(720), "12:00 PM");
check("1080 minutes reads as 6:00 PM", formatMinutes(1080), "6:00 PM");
check("'09:00' parses to 540", parseMinutes("09:00"), 540);
check("'18:30' parses to 1110", parseMinutes("18:30"), 1110);
check("'25:00' is refused", parseMinutes("25:00"), null);
check("nonsense is refused", parseMinutes("half nine"), null);

console.log("\nA week of availability, resolved across the two zones\n");
{
  const nine_to_six = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday, startMinutes: 9 * 60, endMinutes: 18 * 60, label: null,
  }));
  const eight_to_five = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday, startMinutes: 8 * 60, endMinutes: 17 * 60, label: null,
  }));

  // A Thursday in September (Pacific on PDT) and one in December (PST).
  for (const [when, expectedGap] of [["2026-09-10T20:00:00Z", 15], ["2026-12-10T20:00:00Z", 16]] as const) {
    const now = new Date(when);
    const zia = buildMember({
      user: { id: "z", name: "Zia", jobTitle: null, email: "z@x", timeZone: MANILA },
      blocks: nine_to_six, viewerZone: PACIFIC, now,
    });
    const tony = buildMember({
      user: { id: "t", name: "Tony", jobTitle: null, email: "t@x", timeZone: PACIFIC },
      blocks: eight_to_five, viewerZone: PACIFIC, now,
    });

    const month = when.slice(0, 7);
    check(`${month}: Manila reads ${expectedGap}h from Pacific`, zia.hoursFromViewer, expectedGap);
    check(`${month}: Zia's week is 45 hours`, zia.weeklyHours, 45);
    check(`${month}: Tony's week is 45 hours`, tony.weeklyHours, 45);

    const ziaMonday = zia.days.find((d) => d.weekday === 1)!.blocks[0];
    check(`${month}: Zia's Monday reads 9:00 AM – 6:00 PM to her`, ziaMonday.ownHours, "9:00 AM – 6:00 PM");
    check(
      `${month}: and ${expectedGap === 15 ? "6:00 PM – 3:00 AM" : "5:00 PM – 2:00 AM"} in Pacific`,
      ziaMonday.viewerHours,
      expectedGap === 15 ? "6:00 PM – 3:00 AM" : "5:00 PM – 2:00 AM",
    );
    check(`${month}: which is the previous day in Pacific`, ziaMonday.viewerDayNote, "starts the day before");

    // 8-5 Pacific against 9-6 Manila do NOT meet: Zia starts an hour after
    // Tony finishes in September, and exactly as he finishes in December.
    // The page has to be able to say "no shared hours", because that is the
    // true answer for these defaults and the useful one.
    const windows = overlapWindows([tony, zia]);
    check(`${month}: 8-5 Pacific and 9-6 Manila share no hours`, windows.length, 0);
  }

  // Widen one side and they meet -- which is what proves the intersection is
  // computed rather than always empty.
  const now = new Date("2026-09-10T20:00:00Z");
  const ziaEarly = buildMember({
    user: { id: "z", name: "Zia", jobTitle: null, email: "z@x", timeZone: MANILA },
    blocks: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday, startMinutes: 7 * 60, endMinutes: 16 * 60, label: null,
    })),
    viewerZone: PACIFIC, now,
  });
  const tonyLate = buildMember({
    user: { id: "t", name: "Tony", jobTitle: null, email: "t@x", timeZone: PACIFIC },
    blocks: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday, startMinutes: 8 * 60, endMinutes: 18 * 60, label: null,
    })),
    viewerZone: PACIFIC, now,
  });
  const shared = overlapWindows([tonyLate, ziaEarly]);
  check("7am Manila against 8am-6pm Pacific does meet", shared.length > 0, true);
  // 4pm to 6pm Pacific, which is 7am to 9am the next morning in Manila.
  check("the shared window is two hours", (shared[0].end.getTime() - shared[0].start.getTime()) / 60_000, 120);
  check("it starts at 4:00 PM Pacific", formatTimeInZone(shared[0].start, PACIFIC), "4:00 PM");
  check("and ends at 6:00 PM Pacific", formatTimeInZone(shared[0].end, PACIFIC), "6:00 PM");
  check("which is 7:00 AM in Manila", formatTimeInZone(shared[0].start, MANILA), "7:00 AM");
}

console.log("\nThe week grid — one clock, blocks split at midnight\n");
{
  const manilaNine = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday, startMinutes: 9 * 60, endMinutes: 18 * 60, label: null,
  }));
  const pacificEight = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday, startMinutes: 8 * 60, endMinutes: 17 * 60, label: null,
  }));

  const grid = buildWeekGrid({
    members: [
      { id: "t", name: "Tony", jobTitle: null, email: "t@x", timeZone: PACIFIC, blocks: pacificEight },
      { id: "z", name: "Zia", jobTitle: null, email: "z@x", timeZone: MANILA, blocks: manilaNine },
    ],
    viewerZone: PACIFIC,
    otherZone: MANILA,
    now: new Date("2026-09-10T20:00:00Z"),
  });

  check("seven day columns", grid.days.length, 7);
  check("the week starts on a Sunday", grid.days[0].weekday, 0);
  check("an ordinary day is 1440 minutes", grid.days[3].minutes, 1440);

  const tony = grid.lanes.find((l) => l.memberId === "t")!;
  const zia = grid.lanes.find((l) => l.memberId === "z")!;

  // Tony is in the viewer's own zone: five blocks, none split.
  check("Tony has five segments", tony.segments.length, 5);
  check("none of Tony's are continuations", tony.segments.some((s) => s.continued || s.continues), false);
  const tonyMon = tony.segments.find((s) => s.dayIndex === 1)!;
  check("Tony's Monday starts a third of the way down", Math.round(tonyMon.topPct), 33);
  check("and covers 37.5% of the day", Math.round(tonyMon.heightPct * 10) / 10, 37.5);

  // Zia's blocks cross midnight in Pacific, so each becomes two segments.
  check("Zia's five shifts become ten segments", zia.segments.length, 10);
  check("half of them are continuations", zia.segments.filter((s) => s.continued).length, 5);
  check("and half run past midnight", zia.segments.filter((s) => s.continues).length, 5);

  // Her Monday-in-Manila shows as Sunday evening in Pacific: 6pm to midnight.
  const sundayEvening = zia.segments.find((s) => s.dayIndex === 0 && s.continues)!;
  check("the evening piece starts at 75% of Sunday", Math.round(sundayEvening.topPct), 75);
  check("and runs to the end of the day", Math.round(sundayEvening.topPct + sundayEvening.heightPct), 100);
  check("labelled with the block's real span", `${sundayEvening.startLabel} – ${sundayEvening.endLabel}`, "6:00 PM – 3:00 AM");

  const mondayMorning = zia.segments.find((s) => s.dayIndex === 1 && s.continued)!;
  check("the morning piece starts at midnight", mondayMorning.topPct, 0);
  check("and ends at 3am — 12.5% of the day", Math.round(mondayMorning.heightPct * 10) / 10, 12.5);

  check("both axes are labelled", grid.hours.length, 8);
  check("midnight Pacific is 3:00 PM in Manila", grid.hours[0].otherLabel, "3:00 PM");

  // The transition week: Pacific loses an hour going onto PST on 1 November
  // 2026, so that Sunday is 25 hours long and positions must follow it.
  const transition = buildWeekGrid({
    members: [{ id: "t", name: "Tony", jobTitle: null, email: "t@x", timeZone: PACIFIC, blocks: pacificEight }],
    viewerZone: PACIFIC,
    otherZone: MANILA,
    now: new Date("2026-11-04T20:00:00Z"),
  });
  check("the fall-back Sunday is 25 hours", transition.days[0].minutes, 25 * 60);
  const afterChange = transition.lanes[0].segments.find((s) => s.dayIndex === 1)!;
  check("Monday after the change is still 1440 minutes", transition.days[1].minutes, 1440);
  check("and 8am still sits a third of the way down", Math.round(afterChange.topPct), 33);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
