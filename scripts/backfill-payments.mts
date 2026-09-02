/**
 * Creates a Payment row for every invoice already marked Paid.
 *
 * Payments became their own records; the invoices settled before that only
 * carried paidAt + paymentMethod on the invoice row. Without this, every
 * historical payment would show a $0 received and a full balance outstanding
 * on the new Payments card -- the figures would say Tony has never been paid.
 *
 * Idempotent: an invoice that already has payments is left alone.
 *
 *   npx tsx scripts/backfill-payments.mts          # report only
 *   npx tsx scripts/backfill-payments.mts --commit
 */
import "dotenv/config";
import { prisma } from "../src/lib/db/prisma";

const commit = process.argv.includes("--commit");

const paid = await prisma.invoice.findMany({
  where: { status: "Paid", payments: { none: {} } },
  select: {
    id: true, organizationId: true, invoiceNumber: true, totalAmount: true,
    paidAt: true, sentAt: true, createdAt: true, paymentMethod: true,
    client: { select: { name: true } },
  },
  orderBy: { invoiceNumber: "asc" },
});

console.log(`${paid.length} paid invoice(s) with no payment record.`);
for (const inv of paid) {
  // paidAt is the date it was settled. Falling back to sentAt then createdAt
  // keeps a row that is missing the date from being dropped entirely -- an
  // approximate date is recoverable, a missing payment is not.
  const when = inv.paidAt ?? inv.sentAt ?? inv.createdAt;
  console.log(
    `  ${inv.invoiceNumber.padEnd(16)} ${inv.client.name.slice(0, 28).padEnd(30)} ` +
      `$${Number(inv.totalAmount).toFixed(2).padStart(10)} ${when.toISOString().slice(0, 10)} ` +
      `${inv.paymentMethod ?? "(no method)"}`,
  );
  if (!commit) continue;

  await prisma.payment.create({
    data: {
      organizationId: inv.organizationId,
      invoiceId: inv.id,
      amount: inv.totalAmount,
      receivedAt: new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate())),
      // Method is genuinely unknown on some historical rows; Other with a note
      // is honest, where guessing Check would not be.
      method: inv.paymentMethod ?? "Other",
      methodOther: inv.paymentMethod ? null : "Not recorded at the time",
      notes: "Backfilled from the invoice's own paid date when payments became records.",
    },
  });
}

console.log(commit ? "Committed." : "Dry run — re-run with --commit to write.");
await prisma.$disconnect();
