import { z } from "zod";

// Period selection is locked to a single calendar month. That removes all
// ambiguity from "does this Monthly charge apply?" and from the Annual
// January gate, and matches how the business actually invoices.
export const invoicePeriodSchema = z.object({
  clientId: z.string().min(1, "Select a client"),
  billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Select a billing month"),
});

export type InvoicePeriodValues = z.infer<typeof invoicePeriodSchema>;

export const generateInvoiceSchema = z.object({
  clientId: z.string().min(1),
  billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  timeEntryIds: z.array(z.string()),
  recurringChargeIds: z.array(z.string()),
});

export type GenerateInvoiceValues = z.infer<typeof generateInvoiceSchema>;

/** First/last instant of the given YYYY-MM, in UTC. */
export function monthBounds(billingMonth: string): { periodStart: Date; periodEnd: Date } {
  const [year, month] = billingMonth.split("-").map(Number);
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    // Day 0 of the next month == last day of this one.
    periodEnd: new Date(Date.UTC(year, month, 0)),
  };
}

/**
 * Annual charges are only billed in January.
 *
 * Written as an overlap test rather than `month === 0` so it still holds if
 * periods ever stop being month-aligned.
 */
export function periodTouchesJanuary(periodStart: Date, periodEnd: Date): boolean {
  for (let y = periodStart.getUTCFullYear(); y <= periodEnd.getUTCFullYear(); y++) {
    const janStart = new Date(Date.UTC(y, 0, 1));
    const janEnd = new Date(Date.UTC(y, 0, 31));
    if (periodStart <= janEnd && periodEnd >= janStart) return true;
  }
  return false;
}
