import type { TxClient } from "@/lib/db/rls";
import { bountyForClient, windowEndFor, type BountyInvoice } from "@/lib/bounty/calculate";
import { qualifiesForBounty } from "@/lib/bounty/qualify";
import type { LeadSource } from "@/generated/prisma/enums";

export type BountyRow = {
  clientId: string;
  name: string;
  leadSource: LeadSource | null;
  leadSourceNote: string | null;
  windowStart: string;
  windowEnd: string;
  /** Whether the start date was set at intake or inferred from first payment. */
  windowStartSource: "recorded" | "first payment";
  qualifyingRevenue: number;
  bounty: number;
  matured: boolean;
  /** The window closed inside the month being reported -- so it is payable now. */
  dueThisMonth: boolean;
  invoicesCounted: number;
};

export type BountyReport = {
  percent: number;
  /** Bounties that matured in the selected month, which is when they are paid. */
  due: BountyRow[];
  dueTotal: number;
  /** Windows still open, for visibility rather than payment. */
  accruing: BountyRow[];
  /** Clients that would qualify but have no lead source recorded. */
  unattributed: { clientId: string; name: string }[];
};

/**
 * The new-client bounty, for every client whose lead source qualifies.
 *
 * A bounty is PAID in the month its twelve-month window closes, on top of
 * whatever the escalator pays that month. Windows still open are listed
 * separately: they are worth seeing, and they are not owed yet.
 */
export async function loadBountyReport(
  tx: TxClient,
  monthStart: Date,
  monthEnd: Date,
): Promise<BountyReport> {
  const [clients, org] = await Promise.all([
    tx.client.findMany({
      select: {
        id: true,
        name: true,
        leadSource: true,
        leadSourceNote: true,
        relationshipStartedOn: true,
        invoices: {
          where: { voidedAt: null },
          select: {
            id: true,
            totalAmount: true,
            reimbursableExpenses: { select: { amount: true } },
            payments: { select: { amount: true, receivedAt: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    tx.organization.findFirstOrThrow({ select: { bbzBountyPercent: true } }),
  ]);

  const percent = Number(org.bbzBountyPercent);
  const asOf = new Date();
  const due: BountyRow[] = [];
  const accruing: BountyRow[] = [];
  const unattributed: { clientId: string; name: string }[] = [];

  for (const client of clients) {
    if (!qualifiesForBounty(client.leadSource)) {
      // Worth surfacing rather than silently skipping: a client with NO lead
      // source is one where the answer was never captured, which is fixable
      // at the client record. A client marked Legacy or Referral has been
      // answered and is not on this list.
      if (client.leadSource === null && client.invoices.length > 0) {
        unattributed.push({ clientId: client.id, name: client.name });
      }
      continue;
    }

    const invoices: BountyInvoice[] = client.invoices.map((invoice) => ({
      invoiceId: invoice.id,
      total: Number(invoice.totalAmount),
      reimbursable: invoice.reimbursableExpenses.reduce((s, e) => s + Number(e.amount), 0),
      payments: invoice.payments.map((p) => ({
        amount: Number(p.amount),
        receivedAt: p.receivedAt,
      })),
    }));

    // Set at intake where it exists. Otherwise the first payment opens the
    // window, which is the earliest defensible date and is stated on the row
    // so nobody has to guess which was used.
    const payments = invoices.flatMap((i) => i.payments);
    const earliestPayment = payments.reduce<Date | null>(
      (earliest, p) => (earliest === null || p.receivedAt < earliest ? p.receivedAt : earliest),
      null,
    );
    const windowStart = client.relationshipStartedOn ?? earliestPayment;
    if (!windowStart) continue; // nothing has been paid and no start date: nothing to count

    const result = bountyForClient({ invoices, windowStart, bountyPercent: percent, asOf });
    const windowEnd = windowEndFor(windowStart);

    const row: BountyRow = {
      clientId: client.id,
      name: client.name,
      leadSource: client.leadSource,
      leadSourceNote: client.leadSourceNote,
      windowStart: windowStart.toISOString().slice(0, 10),
      windowEnd: windowEnd.toISOString().slice(0, 10),
      windowStartSource: client.relationshipStartedOn ? "recorded" : "first payment",
      qualifyingRevenue: result.qualifyingRevenue,
      bounty: result.bounty,
      matured: result.matured,
      dueThisMonth: windowEnd >= monthStart && windowEnd < monthEnd,
      invoicesCounted: result.invoicesCounted,
    };

    if (row.dueThisMonth) due.push(row);
    else if (!result.matured) accruing.push(row);
  }

  return {
    percent,
    due: due.sort((a, b) => b.bounty - a.bounty),
    dueTotal: Math.round(due.reduce((s, r) => s + r.bounty, 0) * 100) / 100,
    accruing: accruing.sort((a, b) => a.windowEnd.localeCompare(b.windowEnd)),
    unattributed,
  };
}
