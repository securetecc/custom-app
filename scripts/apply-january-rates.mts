/**
 * The 1 January 2027 rate card: $125 standard, $150 on-site.
 *
 * Applied as SCHEDULED rates, not current ones. Setting them today would
 * charge January's prices for the rest of this year; scheduling them means
 * the change lands by itself on the day, and December work written up in
 * January still bills at December's rate.
 *
 * The standard sits on every client and the on-site figure on the service
 * type, because the card splits by service rather than by client. L-V stays
 * at $150 (the subcontractor arrangement, unchanged) and W-D/A-I stay at $50.
 *
 *   npx tsx scripts/apply-january-rates.mts
 *   npx tsx scripts/apply-january-rates.mts --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const commit = process.argv.includes("--commit");
const FROM = new Date(Date.UTC(2027, 0, 1));
const STANDARD = 125;
const ONSITE = 150;

const clients = await prisma.client.findMany({
  select: { id: true, name: true, billingRate: true, scheduledRate: true },
  orderBy: { name: "asc" },
});

console.log(`Clients — standard rate $${STANDARD}/hr from ${FROM.toISOString().slice(0, 10)}\n`);
let changed = 0;
for (const c of clients) {
  const current = c.billingRate ? Number(c.billingRate) : null;
  const already = c.scheduledRate ? Number(c.scheduledRate) : null;
  const note = already === STANDARD ? "already scheduled" : `${current ?? "no rate"} → ${STANDARD}`;
  if (already !== STANDARD) changed++;
  console.log(`  ${c.name.slice(0, 32).padEnd(34)} ${note}`);
}

if (commit) {
  await prisma.client.updateMany({
    data: { scheduledRate: STANDARD, scheduledRateFrom: FROM },
  });
}

console.log(`\nService types\n`);
const types = await prisma.serviceType.findMany({
  select: { id: true, code: true, label: true, rateOverride: true },
  orderBy: { code: "asc" },
});
for (const t of types) {
  const override = t.rateOverride ? Number(t.rateOverride) : null;
  // Only on-site gets its own January figure. Everything without an override
  // follows the client's standard rate and so becomes $125 by itself; L-V,
  // W-D and A-I keep the overrides they already have.
  const scheduled = t.code.toUpperCase() === "O-S" ? ONSITE : null;
  console.log(
    `  ${t.code.padEnd(5)} ${t.label.slice(0, 22).padEnd(24)} now ${override === null ? "client rate" : `$${override}`}` +
      `  →  ${scheduled === null ? (override === null ? `$${STANDARD} (follows the client)` : `$${override} (unchanged)`) : `$${scheduled}`}`,
  );
  if (commit && scheduled !== null) {
    await prisma.serviceType.update({
      where: { id: t.id },
      data: { scheduledRate: scheduled, scheduledRateFrom: FROM },
    });
  }
}

console.log(commit ? `\nCommitted. ${changed} client(s) newly scheduled.` : "\nDry run — re-run with --commit.");
await prisma.$disconnect();
