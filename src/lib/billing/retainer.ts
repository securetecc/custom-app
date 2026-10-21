import type { TxClient } from "@/lib/db/rls";
import { toRate } from "@/lib/billing/rates";
import { toIsoDate } from "@/lib/validations/invoice";

/**
 * What unbilled work is worth for a Retainer client.
 *
 * A Retainer client's billingRate is the flat MONTHLY fee, not an hourly rate,
 * and the invoice generator treats their hours as informational only -- it
 * bills one InvoiceRetainerPeriod per calendar month instead. Pricing their
 * entries through resolveRate counted every hour as a whole month's fee, so a
 * fortnight of retainer work showed as five figures waiting to be invoiced.
 *
 * The figure here mirrors generateInvoice: each calendar month that has
 * unbilled work and no retainer period on a live invoice is worth one month's
 * fee. Months with no logged work are not counted -- there is no start date
 * on the client to count elapsed months from, and inventing one would put a
 * number on the dashboard nobody can trace back to an entry.
 */
export type RetainerBacklog = Map<
  string,
  {
    /** Client.billingRate -- the monthly fee generateInvoice would charge. */
    rate: number;
    /** "YYYY-MM" for each month not yet billed, oldest first. */
    months: string[];
  }
>;

/** The calendar month a date-only column falls in, as "YYYY-MM". */
export function retainerMonthKey(date: Date): string {
  return toIsoDate(date).slice(0, 7);
}

export function isRetainer(client: { billingType: string }): boolean {
  return client.billingType === "Retainer";
}

export async function loadRetainerBacklog(
  tx: TxClient,
  entries: {
    clientId: string;
    date: Date;
    client: { billingType: string; billingRate: unknown };
  }[],
): Promise<RetainerBacklog> {
  const worked = new Map<string, { rate: number; months: Set<string> }>();
  for (const e of entries) {
    if (!isRetainer(e.client)) continue;
    const row = worked.get(e.clientId) ?? { rate: toRate(e.client.billingRate) ?? 0, months: new Set() };
    row.months.add(retainerMonthKey(e.date));
    worked.set(e.clientId, row);
  }

  const backlog: RetainerBacklog = new Map();
  if (worked.size === 0) return backlog;

  // Same ledger and the same voided-invoice rule generateInvoice dedupes on.
  const billed = await tx.invoiceRetainerPeriod.findMany({
    where: { clientId: { in: [...worked.keys()] }, invoice: { voidedAt: null } },
    select: { clientId: true, periodStart: true },
  });
  const billedKeys = new Set(billed.map((b) => `${b.clientId}:${retainerMonthKey(b.periodStart)}`));

  for (const [clientId, row] of worked) {
    const months = [...row.months].filter((m) => !billedKeys.has(`${clientId}:${m}`)).sort();
    if (months.length > 0) backlog.set(clientId, { rate: row.rate, months });
  }
  return backlog;
}
