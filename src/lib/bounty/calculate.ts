import { roundHalfUpCents, toCents, fromCents } from "@/lib/bonus/calculate";

/**
 * The new-client bounty: 5% of everything a qualifying client pays in its
 * first twelve months, paid once at the twelve-month mark.
 *
 * Three rules from the schedule shape this, and each is a place it would be
 * easy to compute something plausible and wrong:
 *
 *  - Counted on money actually RECEIVED, not invoiced. A client that leaves
 *    after four months carries four months of bounty and one that never pays
 *    carries none, so churn needs no separate rule.
 *  - REIMBURSABLES are excluded. SecureTECC earns nothing on parts, hardware,
 *    airfare or mileage, so there is nothing to share. Everything else counts
 *    -- labor, monitoring, RMM seats, Email Security, DMARC, the annual
 *    licence line. That breadth is the point: a new client's real worth is
 *    the recurring revenue, not the first project.
 *  - The window is twelve months from the day the relationship started.
 */

export type BountyInvoice = {
  invoiceId: string;
  /** The invoice's face value, everything included. */
  total: number;
  /** The part of that total that is reimbursed expenses, which never counts. */
  reimbursable: number;
  payments: { amount: number; receivedAt: Date }[];
};

export type BountyClientResult = {
  /** Money received inside the window, net of the reimbursable share. */
  qualifyingRevenue: number;
  bounty: number;
  windowStart: Date;
  windowEnd: Date;
  /** True once the twelve months are up -- the point at which it is payable. */
  matured: boolean;
  invoicesCounted: number;
};

/** The same day twelve months later, which is when the window closes. */
export function windowEndFor(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
}

/**
 * What a single payment contributes.
 *
 * A part-paid invoice contributes its share proportionally: $1,000 received
 * against a $2,000 invoice carrying $400 of reimbursables contributes
 * 1000 x (1600/2000) = $800. Counting the payment in full would pay a bounty
 * on expenses; ignoring part payments entirely would pay nothing on a client
 * still paying in instalments. Neither is what the schedule describes.
 */
function qualifyingShareCents(invoice: BountyInvoice, paymentAmount: number): number {
  const totalCents = toCents(invoice.total);
  if (totalCents <= 0) return 0;
  const netCents = Math.max(0, totalCents - toCents(invoice.reimbursable));
  return (toCents(paymentAmount) * netCents) / totalCents;
}

export function bountyForClient(args: {
  invoices: BountyInvoice[];
  windowStart: Date;
  bountyPercent: number;
  /** Today, for deciding whether the window has closed. */
  asOf: Date;
}): BountyClientResult {
  const windowEnd = windowEndFor(args.windowStart);
  let cents = 0;
  let invoicesCounted = 0;

  for (const invoice of args.invoices) {
    let contributed = false;
    for (const payment of invoice.payments) {
      // Inclusive of the start day, exclusive of the anniversary.
      if (payment.receivedAt < args.windowStart || payment.receivedAt >= windowEnd) continue;
      cents += qualifyingShareCents(invoice, payment.amount);
      contributed = true;
    }
    if (contributed) invoicesCounted++;
  }

  const roundedRevenue = roundHalfUpCents(cents);
  return {
    qualifyingRevenue: fromCents(roundedRevenue),
    bounty: fromCents(roundHalfUpCents((roundedRevenue * args.bountyPercent) / 100)),
    windowStart: args.windowStart,
    windowEnd,
    matured: args.asOf >= windowEnd,
    invoicesCounted,
  };
}
