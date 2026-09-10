/**
 * The January 2027 bonus ladder, re-based for the new rate card.
 *
 * WHY the thresholds move at all: the ladder is meant to reward more work,
 * not a higher price for the same work. From 1 January the standard rate goes
 * $100 -> $125, so an unchanged month of hours produces a qualifying base 25%
 * larger and would climb a rung or two without anybody doing anything. The
 * schedule says the thresholds get re-based whenever the rate card changes,
 * and this is that.
 *
 * THE BASIS: every threshold is multiplied by 1.25, which is the same factor
 * the rate moved. Read in hours rather than dollars, the ladder is unchanged
 * -- 100 hours reached the first rung before and reaches it after. That is
 * the only re-basing that leaves the effort behind each rung untouched, and
 * it is arithmetic anyone can check rather than a set of numbers picked to
 * feel about right.
 *
 * The August set is left exactly as it is. A closed month must not restate.
 *
 *   npx tsx scripts/rebase-bonus-bands.mts
 *   npx tsx scripts/rebase-bonus-bands.mts --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const commit = process.argv.includes("--commit");
const FROM_MONTH = "2027-01";
const FACTOR = 1.25;

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
