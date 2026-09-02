/**
 * What one hour of this entry is worth.
 *
 * Three sources, most specific first:
 *
 *  1. The ENTRY's own rate. Tony asked to be able to change a rate on the fly
 *     rather than have it locked to the client record -- a job quoted
 *     differently is a property of that job, not of the relationship.
 *  2. The SERVICE TYPE's override (Low Voltage, on-site).
 *  3. The CLIENT's standard rate -- or their scheduled replacement, once the
 *     entry's date reaches it.
 *
 * The scheduled rate exists so an agreed change lands by itself. Everyone
 * moving to $125/hr on 1 Jan 2027 should not require someone to remember to
 * edit thirty client records that morning, and back-dated entries written
 * after the change must still bill at the rate that applied on the day the
 * work was done -- which is why this is decided by the ENTRY's date and never
 * by today's.
 */
export type RateInputs = {
  entryRateOverride: number | null;
  serviceTypeRateOverride: number | null;
  clientBillingRate: number | null;
  clientScheduledRate: number | null;
  clientScheduledRateFrom: Date | null;
  /** The date the work was done. */
  entryDate: Date;
};

export function resolveRate(input: RateInputs): number | null {
  if (input.entryRateOverride !== null) return input.entryRateOverride;
  if (input.serviceTypeRateOverride !== null) return input.serviceTypeRateOverride;

  if (
    input.clientScheduledRate !== null &&
    input.clientScheduledRateFrom !== null &&
    // Both are date-only values stored at UTC midnight, so a plain comparison
    // is a calendar comparison.
    input.entryDate.getTime() >= input.clientScheduledRateFrom.getTime()
  ) {
    return input.clientScheduledRate;
  }

  return input.clientBillingRate;
}

/** Prisma Decimal | number | null -> number | null, without turning null into 0. */
export function toRate(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}
