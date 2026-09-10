/**
 * Starting hours and time zones for the team.
 *
 * These are a STARTING POINT, not a claim about anyone's real schedule --
 * everyone can correct their own on the Team page in a few clicks. Seeding
 * something plausible beats an empty page that shows nothing about how the
 * feature works.
 *
 * Only touches people who have no hours set, so a re-run never overwrites a
 * real answer.
 *
 *   npx tsx scripts/seed-team-availability.mts
 *   npx tsx scripts/seed-team-availability.mts --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { MANILA, PACIFIC } from "../src/lib/timezones";

const commit = process.argv.includes("--commit");

/** name fragment -> zone, role, and the weekday hours they keep. */
const DEFAULTS: { match: string; zone: string; title: string; start: number; end: number }[] = [
  { match: "Tony", zone: PACIFIC, title: "Owner · IT Support", start: 8 * 60, end: 17 * 60 },
  { match: "Zia", zone: MANILA, title: "Operations · Development", start: 9 * 60, end: 18 * 60 },
  { match: "Ian", zone: MANILA, title: "Operations", start: 9 * 60, end: 18 * 60 },
];

const users = await prisma.user.findMany({
  select: { id: true, name: true, timeZone: true, _count: { select: { availability: true } } },
  orderBy: { name: "asc" },
});

for (const user of users) {
  const preset = DEFAULTS.find((d) => user.name.includes(d.match));
  if (!preset) {
    console.log(`  ${user.name.padEnd(22)} no preset — left alone`);
    continue;
  }
  if (user._count.availability > 0) {
    console.log(`  ${user.name.padEnd(22)} already has hours — left alone`);
    continue;
  }

  const hours = `${String(Math.floor(preset.start / 60)).padStart(2, "0")}:00–${String(Math.floor(preset.end / 60)).padStart(2, "0")}:00`;
  console.log(`  ${user.name.padEnd(22)} ${preset.zone.padEnd(20)} Mon–Fri ${hours}`);

  if (!commit) continue;
  await prisma.user.update({
    where: { id: user.id },
    data: { timeZone: preset.zone, jobTitle: preset.title },
  });
  await prisma.userAvailability.createMany({
    data: [1, 2, 3, 4, 5].map((weekday) => ({
      userId: user.id,
      weekday,
      startMinutes: preset.start,
      endMinutes: preset.end,
    })),
  });
}

console.log(commit ? "\nCommitted." : "\nDry run — re-run with --commit to write.");
await prisma.$disconnect();
