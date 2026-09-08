/**
 * Answers "How did you hear about us?" for the clients who were already here.
 *
 * The bounty pays on a NEW client's first twelve months, and every client
 * currently in the platform arrived before any of it was tracked -- they came
 * over in the master-sheet import. Left blank they sit in the report's "no
 * attribution recorded" list forever, which reads as a gap to be filled
 * rather than a question that does not apply to them.
 *
 * Only touches clients with NO lead source set, so it will never overwrite a
 * real answer, and any client that did in fact arrive through the website can
 * simply be changed on its own record afterwards.
 *
 *   npx tsx scripts/mark-legacy-clients.mts           # report only
 *   npx tsx scripts/mark-legacy-clients.mts --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const commit = process.argv.includes("--commit");

const clients = await prisma.client.findMany({
  where: { leadSource: null },
  select: { id: true, name: true, createdAt: true, _count: { select: { invoices: true } } },
  orderBy: { name: "asc" },
});

console.log(`${clients.length} client(s) with no lead source recorded:\n`);
for (const c of clients) {
  console.log(
    `  ${c.name.slice(0, 34).padEnd(36)} ${c._count.invoices} invoice${c._count.invoices === 1 ? "" : "s"}`,
  );
}

if (commit) {
  const result = await prisma.client.updateMany({
    where: { leadSource: null },
    data: { leadSource: "Legacy" },
  });
  console.log(`\nMarked ${result.count} as Legacy.`);
} else {
  console.log("\nDry run — re-run with --commit to mark them Legacy.");
}
await prisma.$disconnect();
