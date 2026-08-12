/**
 * Dev fixtures for exercising the invoicing flow, including a client with
 * enough time entries to force a multi-page PDF.
 *
 * IMPORTANT: this project's local .env and the Vercel deployment point at the
 * SAME Supabase database, so anything created here is visible in production.
 * Everything is therefore prefixed "TEST —" and removable:
 *
 *   npx tsx scripts/seed-invoice-fixtures.mts          # create
 *   npx tsx scripts/seed-invoice-fixtures.mts --clean  # remove
 *
 * Uses the plain Prisma client (no withRLS) on purpose -- same category as
 * prisma/seed.ts: trusted local bootstrap tooling with no authenticated user.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const TEST_PREFIX = "TEST — ";
const CLIENT_NAMES = {
  big: `${TEST_PREFIX}Acme Manufacturing`,
  small: `${TEST_PREFIX}Beta Corp`,
};

async function clean(organizationId: string) {
  const clients = await prisma.client.findMany({
    where: { organizationId, name: { startsWith: TEST_PREFIX } },
    select: { id: true, name: true },
  });
  if (clients.length === 0) {
    console.log("Nothing to clean.");
    return;
  }
  const clientIds = clients.map((c) => c.id);

  // Order matters: snapshots -> invoices -> entries -> charges -> clients.
  await prisma.invoiceRecurringCharge.deleteMany({
    where: { invoice: { clientId: { in: clientIds } } },
  });
  await prisma.timeEntry.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.invoice.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.recurringCharge.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });

  console.log(`Removed ${clients.length} test client(s) and all their data.`);
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { supportEmail: "support@securetecc.com" },
  });
  if (!org) throw new Error("SecureTECC organization not found -- run `npx prisma db seed` first.");

  if (process.argv.includes("--clean")) {
    await clean(org.id);
    return;
  }

  const user = await prisma.user.findFirst({ where: { organizationId: org.id } });
  if (!user) throw new Error("No app user found -- run `npx prisma db seed` with SEED_ADMIN_* set.");

  const serviceTypes = await prisma.serviceType.findMany({ where: { organizationId: org.id } });
  if (serviceTypes.length === 0) throw new Error("No service types -- run `npx prisma db seed`.");

  await clean(org.id);

  // --- Client A: heavy, forces a multi-page invoice -----------------------
  const big = await prisma.client.create({
    data: {
      organizationId: org.id,
      name: CLIENT_NAMES.big,
      shortName: "TESTACME",
      contactName: "Dana Reyes",
      email: "ap@example.invalid",
      phone: "(217) 555-0142",
      address1: "1200 Industrial Parkway",
      address2: "Suite 400",
      cityStateZip: "Springfield, IL 62704",
      billingType: "Hourly",
      billingRate: 125,
      activeStatus: true,
    },
  });

  await prisma.recurringCharge.createMany({
    data: [
      {
        organizationId: org.id,
        clientId: big.id,
        description: "Managed Antivirus — 24 endpoints",
        amount: 240,
        billingFrequency: "Monthly",
      },
      {
        organizationId: org.id,
        clientId: big.id,
        description: "Offsite Backup — 500GB",
        amount: 95,
        billingFrequency: "Monthly",
      },
      {
        organizationId: org.id,
        clientId: big.id,
        description: "Annual Domain & SSL Renewal",
        amount: 480,
        billingFrequency: "Annual",
      },
    ],
  });

  const entries = Array.from({ length: 72 }, (_, i) => {
    const st = serviceTypes[i % serviceTypes.length];
    const day = (i % 28) + 1;
    const hours = [0.25, 0.5, 1, 1.5, 2, 3.25][i % 6];
    return {
      organizationId: org.id,
      clientId: big.id,
      serviceTypeId: st.id,
      date: new Date(Date.UTC(2026, 6, day)), // July 2026
      durationHours: hours,
      description:
        `Resolved workstation issue #${i + 1}: diagnosed a failing update service, cleared the ` +
        "pending queue, reapplied patches, verified endpoint protection reported clean, and " +
        "confirmed resolution with the end user.",
      billableStatus: i % 11 === 0 ? ("NonBillable" as const) : ("Billable" as const),
      loggedByUserId: user.id,
    };
  });
  await prisma.timeEntry.createMany({ data: entries });

  // --- Client B: light, single page, no address2 (comma-rule case) --------
  const small = await prisma.client.create({
    data: {
      organizationId: org.id,
      name: CLIENT_NAMES.small,
      shortName: "TESTBETA",
      contactName: "Sam Ortiz",
      phone: "(309) 555-0187",
      address1: "88 Main Street",
      address2: null,
      cityStateZip: "Peoria, IL 61602",
      billingType: "Hourly",
      billingRate: 110,
      activeStatus: true,
    },
  });

  await prisma.recurringCharge.create({
    data: {
      organizationId: org.id,
      clientId: small.id,
      description: "Email Filtering — 12 mailboxes",
      amount: 60,
      billingFrequency: "Monthly",
    },
  });

  await prisma.timeEntry.createMany({
    data: Array.from({ length: 4 }, (_, i) => ({
      organizationId: org.id,
      clientId: small.id,
      serviceTypeId: serviceTypes[i % serviceTypes.length].id,
      date: new Date(Date.UTC(2026, 6, i + 3)),
      durationHours: [0.5, 1, 0.25, 2][i],
      description: `Assisted with printer configuration and driver rollout (#${i + 1}).`,
      billableStatus: "Billable" as const,
      loggedByUserId: user.id,
    })),
  });

  const billableCount = entries.filter((e) => e.billableStatus === "Billable").length;
  console.log(`Created ${CLIENT_NAMES.big} — 72 time entries (${billableCount} billable), 3 recurring charges`);
  console.log(`Created ${CLIENT_NAMES.small} — 4 time entries, 1 recurring charge, no address2`);
  console.log("\nRemove with: npx tsx scripts/seed-invoice-fixtures.mts --clean");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
