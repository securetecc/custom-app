import type { TxClient } from "@/lib/db/rls";
import type { ResolvedRange } from "@/lib/dashboard/metrics";

/**
 * Reporting aggregates: what each client is actually worth, and where the
 * hours go.
 *
 * The metric this page exists for is the EFFECTIVE HOURLY RATE -- invoiced
 * value divided by the hours that were billed to produce it. A client on a
 * high nominal rate who absorbs unbilled hours can earn less per hour worked
 * than one on a lower rate, and nothing else in the app surfaces that.
 *
 * Two populations are kept deliberately separate rather than divided into
 * each other:
 *
 *  - INVOICED value and the hours ON those invoices. An invoice raised in
 *    August covers July's work, so dividing August's invoiced value by
 *    August's LOGGED hours would compare two different things and produce a
 *    rate that is simply wrong. The effective rate here uses the hours
 *    attached to the very invoices being counted, so numerator and
 *    denominator always describe the same work.
 *  - LOGGED hours in the range, split billable/non-billable. That answers
 *    "where did the time go", which is a question about the period, not
 *    about any invoice.
 *
 * Ranges are the dashboard's, reused rather than reimplemented, so "last 3
 * months" means the same thing on both pages -- and stays Pacific-correct.
 */

export type ClientReportRow = {
  clientId: string;
  name: string;
  /** Non-voided invoices raised in range. */
  invoicedAmount: number;
  invoiceCount: number;
  /** Hours carried by those invoices. */
  billedHours: number;
  /** invoicedAmount / billedHours, or null when nothing was billed. */
  effectiveRate: number | null;
  /** Hours logged in range, regardless of whether they were invoiced. */
  loggedBillable: number;
  loggedNonBillable: number;
  /** Share of the period's invoiced total, 0-1. */
  share: number;
};

export type ServiceTypeReportRow = {
  code: string;
  label: string;
  hours: number;
  entries: number;
  share: number;
};

export type ReportsData = {
  clients: ClientReportRow[];
  serviceTypes: ServiceTypeReportRow[];
  totals: {
    invoiced: number;
    invoiceCount: number;
    billedHours: number;
    effectiveRate: number | null;
    loggedBillable: number;
    loggedNonBillable: number;
    clientsInvoiced: number;
  };
};

/** Prisma Decimal | number | null -> number. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function loadReports(tx: TxClient, range: ResolvedRange): Promise<ReportsData> {
  const [invoices, loggedByClient, byServiceType, serviceTypes, clients] = await Promise.all([
    // createdAt, matching how the dashboard buckets invoices -- "raised in
    // this period", not "covering this period".
    tx.invoice.findMany({
      where: { voidedAt: null, createdAt: { gte: range.start, lt: range.end } },
      select: { id: true, clientId: true, totalAmount: true },
    }),
    tx.timeEntry.groupBy({
      by: ["clientId", "billableStatus"],
      where: { date: { gte: range.start, lt: range.end } },
      _sum: { durationHours: true },
    }),
    tx.timeEntry.groupBy({
      by: ["serviceTypeId"],
      where: { date: { gte: range.start, lt: range.end } },
      _sum: { durationHours: true },
      _count: true,
    }),
    tx.serviceType.findMany({ select: { id: true, code: true, label: true } }),
    tx.client.findMany({ select: { id: true, name: true } }),
  ]);

  // Hours attached to the invoices counted above -- a second query, because
  // it has to be scoped by invoice id, not by date.
  const invoiceIds = invoices.map((i) => i.id);
  const billedHourRows = invoiceIds.length
    ? await tx.timeEntry.groupBy({
        by: ["clientId"],
        where: { invoiceId: { in: invoiceIds } },
        _sum: { durationHours: true },
      })
    : [];

  const names = new Map(clients.map((c) => [c.id, c.name]));

  const invoiced = new Map<string, { amount: number; count: number }>();
  for (const inv of invoices) {
    const row = invoiced.get(inv.clientId) ?? { amount: 0, count: 0 };
    row.amount += num(inv.totalAmount);
    row.count += 1;
    invoiced.set(inv.clientId, row);
  }

  const billedHours = new Map(
    billedHourRows.map((r) => [r.clientId, num(r._sum.durationHours)]),
  );

  const logged = new Map<string, { billable: number; nonBillable: number }>();
  for (const r of loggedByClient) {
    const row = logged.get(r.clientId) ?? { billable: 0, nonBillable: 0 };
    const hours = num(r._sum.durationHours);
    if (r.billableStatus === "Billable") row.billable += hours;
    else row.nonBillable += hours;
    logged.set(r.clientId, row);
  }

  const totalInvoiced = [...invoiced.values()].reduce((a, r) => a + r.amount, 0);

  // Every client that either was invoiced or had time logged -- a client with
  // hours and no invoice is exactly the case worth seeing.
  const clientIds = new Set<string>([...invoiced.keys(), ...logged.keys()]);

  const clientRows: ClientReportRow[] = [...clientIds]
    .map((id) => {
      const inv = invoiced.get(id) ?? { amount: 0, count: 0 };
      const log = logged.get(id) ?? { billable: 0, nonBillable: 0 };
      const hours = billedHours.get(id) ?? 0;
      return {
        clientId: id,
        name: names.get(id) ?? "Unknown client",
        invoicedAmount: round2(inv.amount),
        invoiceCount: inv.count,
        billedHours: round2(hours),
        effectiveRate: hours > 0 ? round2(inv.amount / hours) : null,
        loggedBillable: round2(log.billable),
        loggedNonBillable: round2(log.nonBillable),
        share: totalInvoiced > 0 ? inv.amount / totalInvoiced : 0,
      };
    })
    .sort((a, b) => b.invoicedAmount - a.invoicedAmount || b.loggedBillable - a.loggedBillable);

  const typeLabels = new Map(serviceTypes.map((t) => [t.id, t]));
  const totalTypeHours = byServiceType.reduce((a, r) => a + num(r._sum.durationHours), 0);
  const serviceRows: ServiceTypeReportRow[] = byServiceType
    .map((r) => {
      const t = typeLabels.get(r.serviceTypeId);
      const hours = num(r._sum.durationHours);
      return {
        code: t?.code ?? "—",
        label: t?.label ?? "Unknown service type",
        hours: round2(hours),
        entries: r._count,
        share: totalTypeHours > 0 ? hours / totalTypeHours : 0,
      };
    })
    .sort((a, b) => b.hours - a.hours);

  const totalBilledHours = [...billedHours.values()].reduce((a, h) => a + h, 0);

  return {
    clients: clientRows,
    serviceTypes: serviceRows,
    totals: {
      invoiced: round2(totalInvoiced),
      invoiceCount: invoices.length,
      billedHours: round2(totalBilledHours),
      effectiveRate: totalBilledHours > 0 ? round2(totalInvoiced / totalBilledHours) : null,
      loggedBillable: round2(clientRows.reduce((a, r) => a + r.loggedBillable, 0)),
      loggedNonBillable: round2(clientRows.reduce((a, r) => a + r.loggedNonBillable, 0)),
      clientsInvoiced: invoiced.size,
    },
  };
}
