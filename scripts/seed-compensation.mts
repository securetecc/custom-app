/**
 * Seeds the compensation figures from the BBZ Studio schedule v7.0.
 *
 * Every value here is editable in the platform afterwards -- that is the
 * point of holding them as data. This only puts the schedule's opening
 * figures in place.
 *
 *   npx tsx scripts/seed-compensation.mts           # report only
 *   npx tsx scripts/seed-compensation.mts --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const commit = process.argv.includes("--commit");

// Section 3.2: what SecureTECC pays out per hour, and who it goes to.
const PAYOUT_RATES: Record<string, number> = {
  "L-V": 75, // low-voltage subcontractor
  "W-D": 20, // BBZ Studio
  "A-I": 20, // BBZ Studio
};

// Section 7 of the build email: commission is for IT hours only. W-D and A-I
// are already paid hourly; L-V is the subcontractor's.
const COMMISSION_ELIGIBLE = ["R-S", "O-S", "P-S", "E-S", "V-S"];

// Section 3.1. Exclusive at the bottom, inclusive at the top; the last band
// has no ceiling.
const BANDS: { lowerExclusive: number; upperInclusive: number | null; ratePercent: number }[] = [
  { lowerExclusive: 0, upperInclusive: 10000, ratePercent: 0 },
  { lowerExclusive: 10000, upperInclusive: 12500, ratePercent: 1.25 },
  { lowerExclusive: 12500, upperInclusive: 15000, ratePercent: 2.5 },
  { lowerExclusive: 15000, upperInclusive: 17500, ratePercent: 3.75 },
  { lowerExclusive: 17500, upperInclusive: 20000, ratePercent: 5 },
  { lowerExclusive: 20000, upperInclusive: 22500, ratePercent: 6.25 },
  // Tony's table tops this band at 24,999.99 and starts the 10% band AT
  // 25,000 -- the one place the schedule departs from "exclusive at the
  // bottom", since $25,000.00 exactly is meant to pay 10%. Expressed here in
  // the same (lower, upper] form as every other band, which reproduces his
  // figures exactly: 24,999.99 pays 7.5%, 25,000.00 pays 10%.
  { lowerExclusive: 22500, upperInclusive: 24999.99, ratePercent: 7.5 },
  { lowerExclusive: 24999.99, upperInclusive: null, ratePercent: 10 },
];

// Named in the schedule and in Tony's email: "when you or Ian perform an IT
// task". Everyone else is SecureTECC.
const BBZ_EMAILS = ["ziarecheyjvr@gmail.com", "iancarlosfaj@gmail.com"];

const org = await prisma.organization.findFirstOrThrow();
console.log(`Organization: ${org.name}\n`);

const serviceTypes = await prisma.serviceType.findMany({ orderBy: { code: "asc" } });
console.log("Service types");
for (const st of serviceTypes) {
  const payout = PAYOUT_RATES[st.code] ?? null;
  const eligible = COMMISSION_ELIGIBLE.includes(st.code);
  console.log(
    `  ${st.code.padEnd(5)} billed ${(st.rateOverride ? `$${st.rateOverride}` : "client rate").padEnd(12)}` +
      ` payout ${(payout === null ? "—" : `$${payout.toFixed(2)}`).padEnd(8)} commission ${eligible ? "yes" : "no"}`,
  );
  if (commit) {
    await prisma.serviceType.update({
      where: { id: st.id },
      data: { payoutRate: payout, commissionEligible: eligible },
    });
  }
}

console.log("\nBonus bands");
for (const band of BANDS) {
  const top = band.upperInclusive === null ? "no ceiling" : `$${band.upperInclusive.toLocaleString()}`;
  console.log(`  above $${band.lowerExclusive.toLocaleString().padEnd(8)} up to ${top.padEnd(12)} ${band.ratePercent}%`);
  if (commit) {
    await prisma.bonusBand.upsert({
      where: {
        organizationId_lowerExclusive: {
          organizationId: org.id,
          lowerExclusive: band.lowerExclusive,
        },
      },
      create: { organizationId: org.id, ...band },
      update: { upperInclusive: band.upperInclusive, ratePercent: band.ratePercent },
    });
  }
}

console.log("\nBBZ Studio members");
const staff = await prisma.user.findMany({ orderBy: { name: "asc" } });
for (const user of staff) {
  const isBbz = BBZ_EMAILS.includes(user.email.toLowerCase());
  console.log(`  ${user.name.padEnd(22)} ${isBbz ? "BBZ Studio" : "SecureTECC"}`);
  if (commit) {
    await prisma.user.update({ where: { id: user.id }, data: { isBbzStudio: isBbz } });
  }
}

console.log(
  `\nRetainer $${Number(org.bbzRetainerAmount).toFixed(2)} / month · commission ${Number(org.bbzCommissionPercent)}%`,
);
console.log(commit ? "\nCommitted." : "\nDry run — re-run with --commit to write.");
await prisma.$disconnect();
