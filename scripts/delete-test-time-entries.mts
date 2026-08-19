/**
 * One-off cleanup: delete PDF-stress-test fixture time entries belonging to
 * the two TEST — clients, while leaving the TEST client records themselves
 * intact (kept in case PDF stress-testing is needed again later).
 *
 *   npx tsx scripts/delete-test-time-entries.mts             # dry run
 *   npx tsx scripts/delete-test-time-entries.mts --commit    # write
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(commit ? "MODE: COMMIT (will delete)\n" : "MODE: DRY RUN (no writes)\n");

  const testClients = await prisma.client.findMany({
    where: { name: { startsWith: "TEST" } },
    select: { id: true, name: true },
  });
  console.log("TEST clients found:", testClients);

  const entries = await prisma.timeEntry.findMany({
    where: { clientId: { in: testClients.map((c) => c.id) } },
    select: { id: true, invoiceId: true },
  });
  console.log(`\n${entries.length} time entries found for TEST clients.`);
  const billed = entries.filter((e) => e.invoiceId !== null);
  if (billed.length > 0) {
    console.error(`${billed.length} of these are already linked to an invoice -- refusing to delete.`);
    process.exit(1);
  }

  if (!commit) {
    console.log("\nDRY RUN -- nothing deleted. Re-run with --commit to delete.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.timeEntry.deleteMany({
    where: { clientId: { in: testClients.map((c) => c.id) } },
  });
  console.log(`\nCOMMITTED: deleted ${result.count} time entries. TEST clients left intact.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
