import type { TxClient } from "@/lib/db/rls";
import { resolveRate, toRate } from "@/lib/billing/rates";
import { loadBountyReport, type BountyReport } from "./bounty";
import {
  bonusFor,
  nextRung,
  fromCents,
  qualifyingCents,
  roundHalfUpCents,
  toCents,
  type BonusBandRow,
} from "@/lib/bonus/calculate";

/**
 * What BBZ Studio is owed for a month: retainer, performance bonus, and
 * commission on IT hours BBZ performed.
 *
 * Five rules, each of which is a tempting thing to get wrong:
 *
 *  - TIME ENTRIES, never invoices. An invoice total mixes labor with
 *    monitoring and reimbursables; in August one carried $350 of labor
 *    against $500 of monitoring.
 *  - The ENTRY's date decides the month, never the invoice date or the
 *    invoice's period label. Seven invoices carry an August label with
 *    July-dated work inside them.
 *  - Billed or not, an hour counts in the month it was worked, and never
 *    drops back out. A month closes and does not restate.
 *  - No averaging, no rolling window, no carry-over. Each month stands alone.
 *  - performedBy does NOT touch the bonus. It is attribution, and it feeds
 *    the commission only. An IT hour qualifies at the full rate whoever
 *    worked it -- that is deliberate, not an oversight.
 */

export type ClientCompRow = {
  clientId: string;
  name: string;
  hours: number;
  qualifying: number;
};

export type ServiceTypeCompRow = {
  code: string;
  label: string;
  hours: number;
  /** Null when entries of this type were billed at more than one rate. */
  billedRate: number | null;
  payoutRate: number | null;
  qualifyingRate: number | null;
  qualifying: number;
};

export type CommissionRow = {
  entryId: string;
  date: string;
  clientName: string;
  performedBy: string;
  serviceCode: string;
  hours: number;
  billedRate: number;
  billed: number;
  commission: number;
};

export type CompensationReport = {
  month: string; // yyyy-mm
  monthLabel: string;
  entryCount: number;
  billableHours: number;
  clients: ClientCompRow[];
  serviceTypes: ServiceTypeCompRow[];
  qualifyingBase: number;
  ratePercent: number;
  band: BonusBandRow | null;
  bonus: number;
  retainer: number;
  /** retainer + bonus + commission + any bounty maturing this month. */
  totalPayment: number;
  commission: {
    percent: number;
    rows: CommissionRow[];
    billedTotal: number;
    total: number;
  };
  /** What the next rung of the escalator needs, or null at the top. */
  nextBand: { need: number; at: number; ratePercent: number; bonusThen: number } | null;
  /** The top band's floor -- the figure the whole structure is aimed at. */
  ceiling: { at: number; ratePercent: number; progress: number } | null;
  /** New-client bounties, with the ones maturing this month payable now. */
  bounty: BountyReport;
  /** Hours in the month not yet on an invoice. They still count. */
  unbilledHours: number;
  bands: BonusBandRow[];
};

/** "2026-08" -> the calendar month's date-only bounds. */
export function monthBounds(month: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  // Date-only bounds, matching how time_entries.date is stored. Prisma sends
  // these as DATE parameters, so this is a calendar comparison with no
  // timezone in it at all -- which is what "the month it was worked" means.
  return {
    start: new Date(Date.UTC(year, monthIndex, 1)),
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

export function monthLabelOf(month: string): string {
  const bounds = monthBounds(month);
  if (!bounds) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(bounds.start);
}

export async function loadCompensationReport(
  tx: TxClient,
  month: string,
): Promise<CompensationReport | null> {
  const bounds = monthBounds(month);
  if (!bounds) return null;

  const [entries, bandRows, org, bounty] = await Promise.all([
    tx.timeEntry.findMany({
      where: {
        // Billable only. Non-billable and Residual hours are excluded by the
        // schedule, along with recurring charges and reimbursables -- neither
        // of which is a time entry, so neither can reach this query.
        billableStatus: "Billable",
        date: { gte: bounds.start, lt: bounds.end },
      },
      select: {
        id: true,
        date: true,
        durationHours: true,
        rateOverride: true,
        invoiceId: true,
        client: {
          select: {
            id: true,
            name: true,
            billingRate: true,
            scheduledRate: true,
            scheduledRateFrom: true,
          },
        },
        serviceType: {
          select: {
            code: true,
            label: true,
            rateOverride: true,
            payoutRate: true,
            commissionEligible: true,
          },
        },
        performedByUser: { select: { name: true, isBbzStudio: true } },
      },
      orderBy: [{ date: "asc" }],
    }),
    tx.bonusBand.findMany({ orderBy: { lowerExclusive: "asc" } }),
    tx.organization.findFirstOrThrow({
      select: { bbzRetainerAmount: true, bbzCommissionPercent: true },
    }),
    // Paid once, at the twelve-month mark, on top of whatever the escalator
    // pays that month -- so it belongs to a month the same way the bonus does.
    loadBountyReport(tx, bounds.start, bounds.end),
  ]);

  const bands: BonusBandRow[] = bandRows.map((b) => ({
    lowerExclusive: Number(b.lowerExclusive),
    upperInclusive: b.upperInclusive === null ? null : Number(b.upperInclusive),
    ratePercent: Number(b.ratePercent),
  }));

  const byClient = new Map<string, ClientCompRow>();
  const byType = new Map<string, ServiceTypeCompRow & { rates: Set<number> }>();
  const commissionRows: CommissionRow[] = [];

  let baseCents = 0;
  let hours = 0;
  let unbilledHours = 0;
  let commissionBilledCents = 0;

  for (const entry of entries) {
    const entryHours = Number(entry.durationHours);
    // The rate the client was actually charged -- the app's own resolution
    // (this entry's own rate, then the service type, then the client's rate
    // or its scheduled replacement), so the bonus can never disagree with
    // the invoice about what an hour was worth.
    const billedRate =
      resolveRate({
        entryRateOverride: toRate(entry.rateOverride),
        serviceTypeRateOverride: toRate(entry.serviceType.rateOverride),
        clientBillingRate: toRate(entry.client.billingRate),
        clientScheduledRate: toRate(entry.client.scheduledRate),
        clientScheduledRateFrom: entry.client.scheduledRateFrom,
        entryDate: entry.date,
      }) ?? 0;
    const payoutRate = toRate(entry.serviceType.payoutRate);
    const lineCents = qualifyingCents({ hours: entryHours, billedRate, payoutRate });

    hours += entryHours;
    baseCents += lineCents;
    if (entry.invoiceId === null) unbilledHours += entryHours;

    const client = byClient.get(entry.client.id) ?? {
      clientId: entry.client.id,
      name: entry.client.name,
      hours: 0,
      qualifying: 0,
    };
    client.hours += entryHours;
    client.qualifying += fromCents(lineCents);
    byClient.set(entry.client.id, client);

    const type = byType.get(entry.serviceType.code) ?? {
      code: entry.serviceType.code,
      label: entry.serviceType.label,
      hours: 0,
      billedRate: null,
      payoutRate,
      qualifyingRate: null,
      qualifying: 0,
      rates: new Set<number>(),
    };
    type.hours += entryHours;
    type.qualifying += fromCents(lineCents);
    type.rates.add(billedRate);
    byType.set(entry.serviceType.code, type);

    // Commission: BBZ-performed IT hours, at 10% of what was BILLED -- not of
    // the qualifying figure. It is a share of what the client paid, so the
    // payout subtraction does not apply here.
    if (entry.performedByUser.isBbzStudio && entry.serviceType.commissionEligible) {
      const billedCents = entryHours * toCents(billedRate);
      commissionBilledCents += billedCents;
      commissionRows.push({
        entryId: entry.id,
        date: entry.date.toISOString().slice(0, 10),
        clientName: entry.client.name,
        performedBy: entry.performedByUser.name,
        serviceCode: entry.serviceType.code,
        hours: entryHours,
        billedRate,
        billed: fromCents(billedCents),
        commission: 0, // filled below, once the org percentage is known
      });
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const bonus = bonusFor(baseCents, bands);

  const commissionPercent = Number(org.bbzCommissionPercent);
  const commissionTotalCents = roundHalfUpCents((commissionBilledCents * commissionPercent) / 100);
  for (const row of commissionRows) {
    // Each row shows its own share; the month's total is rounded once, from
    // the summed billed figure, so the rows cannot fail to add up to it by a
    // cent or two of rounding.
    row.commission = round2((row.billed * commissionPercent) / 100);
  }

  const rung = nextRung(baseCents, bands);
  const topBand = bands.find((b) => b.upperInclusive === null) ?? null;

  const retainer = Number(org.bbzRetainerAmount);
  const bonusAmount = fromCents(bonus.bonusCents);
  const commissionAmount = fromCents(commissionTotalCents);

  return {
    month,
    monthLabel: monthLabelOf(month),
    entryCount: entries.length,
    billableHours: round2(hours),
    clients: [...byClient.values()]
      .map((c) => ({ ...c, hours: round2(c.hours), qualifying: round2(c.qualifying) }))
      .sort((a, b) => b.qualifying - a.qualifying || a.name.localeCompare(b.name)),
    serviceTypes: [...byType.values()]
      .map(({ rates, ...row }) => {
        // One rate across every entry of this type is the normal case and the
        // one worth showing. Mixed rates -- a negotiated client rate, or work
        // spanning the January change -- show blank rather than a figure that
        // looks authoritative and is only one of several.
        const single = rates.size === 1 ? [...rates][0] : null;
        return {
          ...row,
          hours: round2(row.hours),
          billedRate: single,
          qualifyingRate: single === null ? null : round2(single - (row.payoutRate ?? 0)),
          qualifying: round2(row.qualifying),
        };
      })
      .sort((a, b) => b.qualifying - a.qualifying || a.code.localeCompare(b.code)),
    qualifyingBase: fromCents(baseCents),
    ratePercent: bonus.ratePercent,
    band: bonus.band,
    bonus: bonusAmount,
    retainer,
    totalPayment: round2(retainer + bonusAmount + commissionAmount + bounty.dueTotal),
    commission: {
      percent: commissionPercent,
      rows: commissionRows.sort((a, b) => a.date.localeCompare(b.date)),
      billedTotal: fromCents(commissionBilledCents),
      total: commissionAmount,
    },
    nextBand: rung
      ? {
          need: fromCents(rung.needCents),
          at: fromCents(rung.atCents),
          ratePercent: rung.ratePercent,
          bonusThen: fromCents(rung.bonusThenCents),
        }
      : null,
    ceiling: topBand
      ? (() => {
          // The smallest figure that actually lands in the top band, not the
          // band's exclusive floor -- so this reads $25,000.00 rather than
          // $24,999.99, which is the figure Tony and the schedule both use.
          const at = fromCents(toCents(topBand.lowerExclusive) + 1);
          return {
            at,
            ratePercent: topBand.ratePercent,
            progress: at > 0 ? Math.min(1, fromCents(baseCents) / at) : 0,
          };
        })()
      : null,
    bounty,
    unbilledHours: round2(unbilledHours),
    bands,
  };
}
