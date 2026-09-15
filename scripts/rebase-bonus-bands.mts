/**
 * Re-bases the bonus ladder by a factor, as a NEW dated set.
 *
 * NOT RUN FOR JANUARY 2027. A x1.25 re-base was built and seeded for the
 * January rate card, then withdrawn: Tony chose to keep the original ladder,
 * because "the rate increase rewards ALL of us" -- the same hours at $125
 * are meant to climb higher on the same dollar thresholds. The 2027-01 set
 * was deleted and January calculates against the 2026-08 ladder.
 *
 * Kept as a tool for a future re-base, which is a business decision rather
 * than an automatic consequence of a rate change. So there is deliberately no
 * default month and no default factor: both must be named, and the script
 * refuses to run without them rather than quietly re-applying a ladder that
 * was considered and rejected.
 *
 * The basis, when one is wanted: multiplying every threshold by the factor
 * the rate moved keeps the ladder identical when read in hours.
 *
 * Existing sets are never edited. A closed month must not restate.
 *
 *   npx tsx scripts/rebase-bonus-bands.mts --from 2028-01 --factor 1.1
 *   npx tsx scripts/rebase-bonus-bands.mts --from 2028-01 --factor 1.1 --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const commit = process.argv.includes("--commit");
const FROM_MONTH = arg("--from");
const FACTOR = Number(arg("--factor"));

if (!FROM_MONTH || !/^\d{4}-\d{2}$/.test(FROM_MONTH) || !Number.isFinite(FACTOR) || FACTOR <= 0) {
  console.log(
    "Name the month and the factor explicitly, e.g. --from 2028-01 --factor 1.1\n" +
      "There is no default: January 2027 was deliberately NOT re-based.",
  );
  process.exit(1);
}

const org = await prisma.organization.findFirstOrThrow();
const current = await prisma.bonusBand.findMany({
  where: { organizationId: org.id, effectiveFrom: "2026-08" },
  orderBy: { lowerExclusive: "asc" },
});

if (current.length === 0) {
  console.log("No August ladder to re-base from. Run seed-compensation first.");
  process.exit(1);
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const hours = (dollars: number, rate: number) => (dollars / rate).toFixed(0);

console.log(`Re-basing the ladder x${FACTOR} for ${FROM_MONTH}\n`);
console.log("                     AUGUST (at $100/hr)              JANUARY (at $125/hr)");
console.log("rate      above            up to            above            up to");

// Rounded to cents, or the top band's floor comes out at $31,249.988 -- a
// fraction of a cent, which is not a figure any invoice can produce and not
// one anybody can read. Rounding lands it on $31,249.99, keeping the
// schedule's own shape: the 10% band opens at exactly $31,250.
const cents = (n: number) => Math.round(n * 100) / 100;

const rebased = current.map((band) => {
  const lower = cents(Number(band.lowerExclusive) * FACTOR);
  const upper = band.upperInclusive === null ? null : cents(Number(band.upperInclusive) * FACTOR);
  const rate = Number(band.ratePercent);

  console.log(
    `${rate.toFixed(2).padStart(5)}%  ${usd(Number(band.lowerExclusive)).padStart(12)}  ` +
      `${(band.upperInclusive === null ? "no ceiling" : usd(Number(band.upperInclusive))).padStart(14)}  ` +
      `${usd(lower).padStart(14)}  ${(upper === null ? "no ceiling" : usd(upper)).padStart(14)}`,
  );
  return { lowerExclusive: lower, upperInclusive: upper, ratePercent: rate };
});

console.log("\nThe same ladder read in hours, which is what does not change:\n");
for (let i = 0; i < current.length; i++) {
  const augLower = Number(current[i].lowerExclusive);
  console.log(
    `${Number(current[i].ratePercent).toFixed(2).padStart(5)}%  above ` +
      `${hours(augLower, 100).padStart(3)}h before  ·  ` +
      `${hours(rebased[i].lowerExclusive, 125).padStart(3)}h after`,
  );
}

if (commit) {
  await prisma.bonusBand.deleteMany({
    where: { organizationId: org.id, effectiveFrom: FROM_MONTH },
  });
  await prisma.bonusBand.createMany({
    data: rebased.map((b) => ({ organizationId: org.id, effectiveFrom: FROM_MONTH, ...b })),
  });
  console.log(`\nCommitted ${rebased.length} bands effective ${FROM_MONTH}. August is untouched.`);
} else {
  console.log("\nDry run — re-run with --commit to write.");
}
await prisma.$disconnect();
