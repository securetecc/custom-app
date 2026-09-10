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

/**
 * One row per service type AND billed rate, not per service type.
 *
 * A client on a custom rate, or work spanning the January change, means the
 * same service type billed at two different figures in one month. Collapsing
 * those into one row would have to show "mixed" where the rate goes, and this
 * is the table that exists to make the number auditable -- anyone should be
 * able to see where a $75 or a $30 came from. Two rows, each with a real
 * rate, does that; one row saying "mixed" does not.
 */
export type ServiceTypeCompRow = {
  code: string;
  label: string;
  hours: number;
  billedRate: number;
  payoutRate: number | null;
  qualifyingRate: number;
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
  /** True for a month before the arrangement began: the hours are real, the
   *  money is not, so every payable figure is zero. */
  beforeStart: boolean;
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
            scheduledRate: true,
            scheduledRateFrom: true,
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
      select: {
        bbzRetainerAmount: true,
        bbzCommissionPercent: true,
        bbzStartMonth: true,
      },
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
  // Keyed on the type AND the rate, so a custom rate gets its own row.
  const byType = new Map<string, ServiceTypeCompRow>();
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
        serviceTypeScheduledRate: toRate(entry.serviceType.scheduledRate),
        serviceTypeScheduledRateFrom: entry.serviceType.scheduledRateFrom,
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

    const typeKey = `${entry.serviceType.code}@${billedRate}`;
    const type = byType.get(typeKey) ?? {
      code: entry.serviceType.code,
      label: entry.serviceType.label,
      hours: 0,
      billedRate,
      payoutRate,
      qualifyingRate: fromCents(toCents(billedRate) - toCents(payoutRate ?? 0)),
      qualifying: 0,
    };
    type.hours += entryHours;
    type.qualifying += fromCents(lineCents);
    byType.set(typeKey, type);

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

  // Before the arrangement began there was no retainer, no bonus and no
  // commission -- the work happened, the money did not. Reporting the hours
  // is useful; reporting a payment for them would be a claim about a month
  // nobody had agreed anything for.
  const beforeStart = month < org.bbzStartMonth;
  const retainer = beforeStart ? 0 : Number(org.bbzRetainerAmount);
  const bonusAmount = beforeStart ? 0 : fromCents(bonus.bonusCents);
  const commissionAmount = beforeStart ? 0 : fromCents(commissionTotalCents);

  return {
    month,
    monthLabel: monthLabelOf(month),
    entryCount: entries.length,
    billableHours: round2(hours),
    clients: [...byClient.values()]
      .map((c) => ({ ...c, hours: round2(c.hours), qualifying: round2(c.qualifying) }))
      .sort((a, b) => b.qualifying - a.qualifying || a.name.localeCompare(b.name)),
    serviceTypes: [...byType.values()]
      .map((row) => ({ ...row, hours: round2(row.hours), qualifying: round2(row.qualifying) }))
      .sort(
        (a, b) =>
          b.qualifying - a.qualifying ||
          a.code.localeCompare(b.code) ||
          b.billedRate - a.billedRate,
      ),
    qualifyingBase: fromCents(baseCents),
    ratePercent: beforeStart ? 0 : bonus.ratePercent,
    band: bonus.band,
    bonus: bonusAmount,
    beforeStart,
    retainer,
    totalPayment: round2(
      retainer + bonusAmount + commissionAmount + (beforeStart ? 0 : bounty.dueTotal),
    ),
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
