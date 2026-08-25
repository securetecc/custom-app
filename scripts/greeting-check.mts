/**
 * Asserts the greeting's date logic -- run: npx tsx scripts/greeting-check.mts
 *
 * Exists because every bug this project has hit twice was a timezone bug: the
 * digest window, the imported time entries, the month buckets. A greeting that
 * wishes someone happy birthday a day early is the same class of mistake, and
 * it is only observable one day a year.
 */
import { buildGreeting, holidayFor, pacificDate, timeOfDay, pacificAbbreviation } from "../src/lib/greeting";
let pass = 0, fail = 0;
const chk = (name: string, got: unknown, want: unknown) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(48)} got="${got}"${ok ? "" : ` want="${want}"`}`);
};

// A UTC instant that is a DIFFERENT DAY in Pacific -- the case a naive
// implementation gets wrong. 2026-07-05T05:00Z is 10pm July 4 in Pacific.
console.log("\n[timezone: UTC instant that is the previous day in Pacific]");
const julyEve = new Date("2026-07-05T05:00:00Z");
chk("pacific day", pacificDate(julyEve).day, 4);
chk("UTC day (for contrast)", julyEve.getUTCDate(), 5);
chk("greeting", buildGreeting({ firstName: "Tony", birthMonth: null, birthDay: null,
  organizationName: "SecureTECC", at: julyEve }).headline, "Happy 4th of July, Tony");

console.log("\n[PST vs PDT — same clock hour, six months apart]");
// 8am Pacific in each. PDT = UTC-7, PST = UTC-8.
chk("summer 15:00Z -> hour", pacificDate(new Date("2026-07-15T15:00:00Z")).hour, 8);
chk("winter 16:00Z -> hour", pacificDate(new Date("2026-01-15T16:00:00Z")).hour, 8);
chk("summer abbreviation", pacificAbbreviation(new Date("2026-07-15T15:00:00Z")), "PDT");
chk("winter abbreviation", pacificAbbreviation(new Date("2026-01-15T16:00:00Z")), "PST");
// The spring-forward instant itself: 2026-03-08 02:00 PST -> 03:00 PDT.
chk("DST switch day is Mar 8 2026", pacificDate(new Date("2026-03-08T11:00:00Z")).day, 8);
// The 2am hour does not exist on spring-forward day: 09:59Z is 01:59 PST,
// and one minute later 10:00Z is 03:00 PDT. Nothing ever reads 02:xx.
chk("09:59Z is 01:59 PST", pacificDate(new Date("2026-03-08T09:59:00Z")).hour, 1);
chk("10:00Z jumps to 03:00 PDT", pacificDate(new Date("2026-03-08T10:00:00Z")).hour, 3);
chk("11:00Z is 04:00 PDT", pacificDate(new Date("2026-03-08T11:00:00Z")).hour, 4);
// Fall back: 2am happens twice on 2026-11-01. Both readings are valid hours.
chk("fall-back 08:30Z is 01:30 PDT", pacificDate(new Date("2026-11-01T08:30:00Z")).hour, 1);
chk("fall-back 09:30Z is 01:30 PST", pacificDate(new Date("2026-11-01T09:30:00Z")).hour, 1);
chk("fall-back day is Nov 1", pacificDate(new Date("2026-11-01T09:30:00Z")).day, 1);

console.log("\n[time of day]");
chk("00:00", timeOfDay(0), "morning");
chk("11:59", timeOfDay(11), "morning");
chk("12:00", timeOfDay(12), "afternoon");
chk("16:59", timeOfDay(16), "afternoon");
chk("17:00", timeOfDay(17), "evening");
chk("23:00", timeOfDay(23), "evening");

console.log("\n[movable holidays computed per year]");
const hol = (y: number, m: number, d: number) => holidayFor({ year: y, month: m, day: d, hour: 9, weekday: 0 })?.name ?? "(none)";
chk("Thanksgiving 2026 = Nov 26", hol(2026, 11, 26), "Thanksgiving");
chk("Thanksgiving 2027 = Nov 25", hol(2027, 11, 25), "Thanksgiving");
chk("Thanksgiving 2028 = Nov 23", hol(2028, 11, 23), "Thanksgiving");
chk("Nov 27 2026 is not Thanksgiving", hol(2026, 11, 27), "Day after Thanksgiving");
chk("Memorial Day 2026 = May 25", hol(2026, 5, 25), "Memorial Day");
chk("Memorial Day 2027 = May 31", hol(2027, 5, 31), "Memorial Day");
chk("Labor Day 2026 = Sep 7", hol(2026, 9, 7), "Labor Day");
chk("MLK Day 2026 = Jan 19", hol(2026, 1, 19), "Martin Luther King Jr. Day");
chk("Mother's Day 2026 = May 10", hol(2026, 5, 10), "Mother's Day");
chk("Father's Day 2026 = Jun 21", hol(2026, 6, 21), "Father's Day");
chk("Christmas", hol(2026, 12, 25), "Christmas Day");
chk("New Year", hol(2026, 1, 1), "New Year's Day");
chk("ordinary Tuesday", hol(2026, 8, 25), "(none)");

console.log("\n[birthday]");
const g = (m: number | null, d: number | null, at: string) =>
  buildGreeting({ firstName: "Tony", birthMonth: m, birthDay: d, organizationName: "SecureTECC", at: new Date(at) });
chk("on the day", g(8, 25, "2026-08-25T17:00:00Z").headline, "Happy birthday, Tony!");
chk("day before", g(8, 25, "2026-08-24T17:00:00Z").headline, "Good morning, Tony");
chk("beats a holiday", g(12, 25, "2026-12-25T20:00:00Z").headline, "Happy birthday, Tony!");
chk("...but still mentions it", g(12, 25, "2026-12-25T20:00:00Z").subline,
  "Merry Christmas, too — sharing your day with Christmas Day.");
chk("no birthday set", g(null, null, "2026-08-25T22:00:00Z").headline, "Good afternoon, Tony");
chk("evening", g(null, null, "2026-08-26T02:00:00Z").headline, "Good evening, Tony");
// 11:30pm Pacific on the birthday eve, which is already tomorrow in UTC.
chk("late-night eve is NOT the birthday", g(8, 26, "2026-08-26T06:30:00Z").headline, "Good evening, Tony");
chk("...and 30 min later it IS", g(8, 26, "2026-08-26T07:30:00Z").headline, "Happy birthday, Tony!");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
