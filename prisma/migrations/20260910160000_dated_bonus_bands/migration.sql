-- Bonus bands become dated SETS.
--
-- The schedule re-bases the thresholds whenever the rate card changes, and a
-- month that has closed must not restate. Editing the numbers in place would
-- silently recompute every bonus already paid -- August's $353.13 would
-- become something else the moment January's ladder was entered.
--
-- Existing rows are the set in force since the arrangement began.
ALTER TABLE "bonus_bands" ADD COLUMN "effectiveFrom" TEXT NOT NULL DEFAULT '2026-08';

DROP INDEX IF EXISTS "bonus_bands_organizationId_lowerExclusive_key";
CREATE UNIQUE INDEX "bonus_bands_organizationId_effectiveFrom_lowerExclusive_key"
  ON "bonus_bands"("organizationId", "effectiveFrom", "lowerExclusive");
