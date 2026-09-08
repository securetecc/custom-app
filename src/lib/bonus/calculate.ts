/**
 * The performance-bonus arithmetic, on plain numbers.
 *
 * Kept free of Prisma and React so it can be asserted directly --
 * scripts/bonus-check.mts runs it against the schedule's own worked example
 * and against every band boundary.
 *
 * Two rules carry the whole calculation and both are easy to get backwards:
 *
 *  1. An hour enters at its NET figure. Where SecureTECC pays a third party
 *     out of a billed hour -- the low-voltage subcontractor at $75, BBZ at
 *     $20 on web and automation work -- only SecureTECC's share qualifies.
 *     Everything else qualifies at the full billed rate, whoever worked it.
 *  2. The band rate applies to the WHOLE qualifying base, not to the portion
 *     above the threshold, and bands are exclusive at the bottom, inclusive
 *     at the top. $20,000.00 exactly pays 5.00%, not 6.25%.
 */

export type BonusBandRow = {
  /** The band covers (lowerExclusive, upperInclusive]. */
  lowerExclusive: number;
  /** Null on the top band, which has no ceiling. */
  upperInclusive: number | null;
  /** As written in the schedule: 1.25 means 1.25%. */
  ratePercent: number;
};

/** Money as integer cents, so a chain of multiplications cannot drift. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Half UP, as the schedule specifies -- not JavaScript's Math.round, which
 * rounds half away from zero and would differ on a negative value, and not
 * banker's rounding, which would turn $353.125 into $353.12.
 */
export function roundHalfUpCents(cents: number): number {
  return Math.floor(cents + 0.5);
}

/** What one line contributes: hours x (billed rate - whatever is paid out). */
export function qualifyingCents(entry: {
  hours: number;
  billedRate: number;
  payoutRate: number | null;
}): number {
  const netRateCents = toCents(entry.billedRate) - toCents(entry.payoutRate ?? 0);
  return entry.hours * netRateCents;
}

/**
 * The band a base falls in, or null when it is below the first rung.
 *
 * Bands are read from the database rather than a constant here: the schedule
 * says the thresholds are re-based whenever the rate card changes, and that
 * must not require a deploy.
 */
export function bandFor(baseCents: number, bands: BonusBandRow[]): BonusBandRow | null {
  const applicable = bands.filter((band) => {
    const above = baseCents > toCents(band.lowerExclusive);
    const withinTop = band.upperInclusive === null || baseCents <= toCents(band.upperInclusive);
    return above && withinTop;
  });
  if (applicable.length === 0) return null;

  // Defensive: with well-formed bands exactly one matches. If two overlap,
  // the higher floor is the more specific one.
  return applicable.reduce((a, b) => (b.lowerExclusive > a.lowerExclusive ? b : a));
}

export type BonusResult = {
  qualifyingBaseCents: number;
  ratePercent: number;
  bonusCents: number;
  band: BonusBandRow | null;
};

export function bonusFor(baseCents: number, bands: BonusBandRow[]): BonusResult {
  const band = bandFor(baseCents, bands);
  const ratePercent = band?.ratePercent ?? 0;
  return {
    qualifyingBaseCents: baseCents,
    ratePercent,
    // The rate is on the whole base. Applying it only to the amount above the
    // threshold is the classic tax-bracket instinct and is wrong here.
    bonusCents: roundHalfUpCents((baseCents * ratePercent) / 100),
    band,
  };
}

/**
 * What the next rung costs, and what it would pay.
 *
 * The escalator is a target, not just a lookup: the point of the arrangement
 * is to get the month up the ladder. Saying "another $875 moves this month
 * from 2.50% to 3.75%, worth $187 more" is the number that changes behaviour,
 * and it is otherwise arithmetic someone has to do by hand every month.
 *
 * Null once the top band is reached -- above it there is nothing further to
 * climb, which is itself worth saying.
 */
export function nextRung(
  baseCents: number,
  bands: BonusBandRow[],
): { needCents: number; atCents: number; ratePercent: number; bonusThenCents: number } | null {
  const higher = bands
    .filter((b) => toCents(b.lowerExclusive) >= baseCents)
    .sort((a, b) => a.lowerExclusive - b.lowerExclusive);
  const next = higher[0];
  if (!next) return null;

  // A cent past the floor is the smallest figure that lands in the band.
  const atCents = toCents(next.lowerExclusive) + 1;
  return {
    needCents: atCents - baseCents,
    atCents,
    ratePercent: next.ratePercent,
    bonusThenCents: roundHalfUpCents((atCents * next.ratePercent) / 100),
  };
}

/** Cents back to a number of dollars, for display and storage. */
export function fromCents(cents: number): number {
  return cents / 100;
}
