/**
 * Asserts the bonus and commission arithmetic against the compensation
 * schedule's own figures.
 *
 * Run: npx tsx scripts/bonus-check.mts
 *
 * Two halves. The first is pure arithmetic -- every band boundary, including
 * the $20,000.00 case Tony singled out as the easiest thing to get backwards.
 * The second runs the real report against the live August 2026 data and
 * checks it reproduces the schedule's worked example to the cent.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";
import { withRLS } from "../src/lib/db/rls";
import { bonusFor, toCents, fromCents, type BonusBandRow } from "../src/lib/bonus/calculate";
import { loadCompensationReport } from "../src/lib/reports/compensation";
import { bountyForClient, resolveWindowStart } from "../src/lib/bounty/calculate";
import { qualifiesForBounty } from "../src/lib/bounty/qualify";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  — expected ${expected}, got ${actual}`}`);
}

const bandRows = await prisma.bonusBand.findMany({ orderBy: { lowerExclusive: "asc" } });
const bands: BonusBandRow[] = bandRows.map((b) => ({
  lowerExclusive: Number(b.lowerExclusive),
  upperInclusive: b.upperInclusive === null ? null : Number(b.upperInclusive),
  ratePercent: Number(b.ratePercent),
}));

const rateAt = (dollars: number) => bonusFor(toCents(dollars), bands).ratePercent;
const bonusAt = (dollars: number) => fromCents(bonusFor(toCents(dollars), bands).bonusCents);

console.log("Band boundaries — exclusive at the bottom, inclusive at the top\n");
check("$0 pays nothing", rateAt(0), 0);
check("$9,999.99 is below the first rung", rateAt(9999.99), 0);
check("$10,000.00 exactly is still 0%", rateAt(10000), 0);
check("$10,000.01 crosses into 1.25%", rateAt(10000.01), 1.25);
check("$12,500.00 exactly is 1.25%, not 2.50%", rateAt(12500), 1.25);
check("$12,500.01 is 2.50%", rateAt(12500.01), 2.5);
check("$15,000.00 exactly is 2.50%", rateAt(15000), 2.5);
check("$17,500.00 exactly is 3.75%", rateAt(17500), 3.75);
// The one Tony called out by name.
check("$20,000.00 exactly is 5.00%, NOT 6.25%", rateAt(20000), 5);
check("$20,000.01 is 6.25%", rateAt(20000.01), 6.25);
check("$22,500.00 exactly is 6.25%", rateAt(22500), 6.25);
check("$22,500.01 is 7.50%", rateAt(22500.01), 7.5);
check("$24,999.99 is 7.50%", rateAt(24999.99), 7.5);
check("$25,000.00 exactly is 10.00%", rateAt(25000), 10);
check("$40,000 is still 10% — the top band does not escalate", rateAt(40000), 10);

console.log("\nAbove $25,000 the rate is flat 10% — no further escalators\n");
check("$25,000.00 exactly", rateAt(25000), 10);
check("$25,000.01", rateAt(25000.01), 10);
check("$30,000", rateAt(30000), 10);
check("$50,000", rateAt(50000), 10);
check("$250,000", rateAt(250000), 10);
check("$30,000 pays $3,000.00", bonusAt(30000), 3000);
check("$100,000 pays $10,000.00", bonusAt(100000), 10000);

console.log("\nThe rate applies to the whole base, not the amount above the threshold\n");
check("$16,500 pays $618.75 (schedule, section 3.1)", bonusAt(16500), 618.75);
check("$11,000 pays $137.50", bonusAt(11000), 137.5);
check("band top $12,500 pays $156.25", bonusAt(12500), 156.25);
check("band top $20,000 pays $1,000.00", bonusAt(20000), 1000);
check("$25,000 pays $2,500.00", bonusAt(25000), 2500);

console.log("\nRounding is half UP, to cents\n");
check("$14,125 x 2.50% = $353.13, not $353.12", bonusAt(14125), 353.13);

console.log("\nAugust 2026 — the schedule's worked example, against live data\n");
const tony = await prisma.user.findFirstOrThrow({ where: { canDelegateTasks: true } });
const report = await withRLS(tony.authUserId, (tx) => loadCompensationReport(tx, "2026-08"));
if (!report) {
  console.log("FAIL  the report returned nothing");
  failures++;
} else {
  check("72 time entries", report.entryCount, 72);
  check("143.00 billable hours", report.billableHours.toFixed(2), "143.00");
  check("qualifying base $14,125.00", report.qualifyingBase.toFixed(2), "14125.00");
  check("band 2.50%", report.ratePercent, 2.5);
  check("bonus $353.13", report.bonus.toFixed(2), "353.13");
  check("retainer $1,000.00", report.retainer.toFixed(2), "1000.00");
  check("total September payment $1,353.13", report.totalPayment.toFixed(2), "1353.13");

  // The L-V line is the only entry in the month that exercises the payout
  // rule. If the base comes out at $14,650 the payout rate is not applied.
  const lv = report.serviceTypes.find((t) => t.code === "L-V");
  check("L-V hours 7.00", lv?.hours.toFixed(2), "7.00");
  check("L-V billed at $150.00", lv?.billedRate?.toFixed(2), "150.00");
  check("L-V pays out $75.00", lv?.payoutRate?.toFixed(2), "75.00");
  check("L-V qualifies at $75.00/hr", lv?.qualifyingRate?.toFixed(2), "75.00");
  check("L-V contributes $525.00", lv?.qualifying.toFixed(2), "525.00");

  const fullRate = report.serviceTypes.filter((t) => t.code !== "L-V");
  const fullHours = fullRate.reduce((s, t) => s + t.hours, 0);
  const fullQualifying = fullRate.reduce((s, t) => s + t.qualifying, 0);
  check("136.00 hours at the full rate", fullHours.toFixed(2), "136.00");
  check("worth $13,600.00", fullQualifying.toFixed(2), "13600.00");

  console.log("\nPer-client hours\n");
  const expected: Record<string, string> = {
    "Pacific Coast Civil": "37.00",
    "Sergent Construction": "32.50",
    "UWE/PMA Holdings, LLC": "29.25",
    "National Positions": "27.00",
    "Environmental Patterns Inc.": "4.00",
    "The G4 Group": "3.50",
    "NEXTects Architects": "3.25",
    "Muller Worthy Architects": "2.50",
    "Monka Soccer Academy": "1.50",
    "Quality Paving LMGP": "1.50",
    "Kasco LP": "0.50",
    "Linda Lim": "0.25",
    "Yar On The Lake": "0.25",
  };
  for (const [name, hoursExpected] of Object.entries(expected)) {
    const row = report.clients.find((c) => c.name === name);
    check(`${name} ${hoursExpected}h`, row?.hours.toFixed(2), hoursExpected);
  }
  check("no other client appears", report.clients.length, Object.keys(expected).length);

  console.log("\nBilled or not, the hour counts\n");
  check(
    "5.75 hours in August are not yet invoiced and still counted",
    report.unbilledHours.toFixed(2),
    "5.75",
  );

  console.log("\nCommission — every August entry is attributed to Tony, so it is nil\n");
  check("commission $0.00", report.commission.total.toFixed(2), "0.00");
  check("no commission rows", report.commission.rows.length, 0);
}

console.log("\nNew-client bounty\n");
{
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const windowStart = day("2026-01-15");

  // 5% of everything paid inside the first twelve months.
  const plain = bountyForClient({
    invoices: [
      { invoiceId: "a", total: 2000, reimbursable: 0, payments: [{ amount: 2000, receivedAt: day("2026-03-01") }] },
      { invoiceId: "b", total: 500, reimbursable: 0, payments: [{ amount: 500, receivedAt: day("2026-11-01") }] },
    ],
    windowStart,
    bountyPercent: 5,
    asOf: day("2027-06-01"),
  });
  check("$2,500 paid in the window earns $125", plain.bounty.toFixed(2), "125.00");
  check("the window closes on the anniversary", plain.windowEnd.toISOString().slice(0, 10), "2027-01-15");
  check("it has matured by June 2027", plain.matured, true);

  // Money arriving after the anniversary is outside the window.
  const late = bountyForClient({
    invoices: [
      { invoiceId: "a", total: 1000, reimbursable: 0, payments: [{ amount: 1000, receivedAt: day("2027-02-01") }] },
    ],
    windowStart,
    bountyPercent: 5,
    asOf: day("2027-06-01"),
  });
  check("a payment after the anniversary does not count", late.qualifyingRevenue.toFixed(2), "0.00");

  // Reimbursables never count -- SecureTECC earns nothing on them.
  const withExpenses = bountyForClient({
    invoices: [
      { invoiceId: "a", total: 2000, reimbursable: 400, payments: [{ amount: 2000, receivedAt: day("2026-03-01") }] },
    ],
    windowStart,
    bountyPercent: 5,
    asOf: day("2027-06-01"),
  });
  check("a $400 reimbursable is excluded from a $2,000 invoice", withExpenses.qualifyingRevenue.toFixed(2), "1600.00");
  check("so the bounty is $80, not $100", withExpenses.bounty.toFixed(2), "80.00");

  // A part payment contributes its share of the non-reimbursable portion.
  const partPaid = bountyForClient({
    invoices: [
      { invoiceId: "a", total: 2000, reimbursable: 400, payments: [{ amount: 1000, receivedAt: day("2026-03-01") }] },
    ],
    windowStart,
    bountyPercent: 5,
    asOf: day("2027-06-01"),
  });
  check("$1,000 of that invoice counts $800", partPaid.qualifyingRevenue.toFixed(2), "800.00");

  // Churn needs no separate rule: unpaid is uncounted.
  const unpaid = bountyForClient({
    invoices: [{ invoiceId: "a", total: 5000, reimbursable: 0, payments: [] }],
    windowStart,
    bountyPercent: 5,
    asOf: day("2027-06-01"),
  });
  check("an invoice never paid earns nothing", unpaid.bounty.toFixed(2), "0.00");

  const start = (r: string | null, e: string | null, p: string | null) =>
    resolveWindowStart({
      recorded: r ? day(r) : null,
      firstTimeEntry: e ? day(e) : null,
      firstPayment: p ? day(p) : null,
    });
  check(
    "the first time entry opens the window, not the first payment",
    start(null, "2026-06-29", "2026-08-15")?.start.toISOString().slice(0, 10),
    "2026-06-29",
  );
  check(
    "and says so",
    start(null, "2026-06-29", "2026-08-15")?.source,
    "first time entry",
  );
  check(
    "a date set at intake beats both",
    start("2026-05-01", "2026-06-29", "2026-08-15")?.start.toISOString().slice(0, 10),
    "2026-05-01",
  );
  check(
    "a recurring-only client with no time entries falls back to first payment",
    start(null, null, "2026-08-15")?.source,
    "first payment",
  );
  check("nothing at all opens no window", start(null, null, null), null);

  check("a website lead qualifies", qualifiesForBounty("Website"), true);
  check("Google Business Profile qualifies", qualifiesForBounty("GoogleBusinessProfile"), true);
  check("a referral does not", qualifiesForBounty("Referral"), false);
  check("a returning client does not", qualifiesForBounty("ReturningClient"), false);
  check("nothing recorded does not", qualifiesForBounty(null), false);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
