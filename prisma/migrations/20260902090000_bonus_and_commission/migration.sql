-- Compensation reporting: the performance bonus and BBZ's commission.

-- What SecureTECC pays out per hour on a service type, and whether an hour of
-- it earns commission. Both are fields rather than constants so a rate change
-- follows through the reports without a deploy or an amended schedule.
ALTER TABLE "service_types"
  ADD COLUMN "payoutRate" DECIMAL(10,2),
  ADD COLUMN "commissionEligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users" ADD COLUMN "isBbzStudio" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "organizations"
  ADD COLUMN "bbzRetainerAmount" DECIMAL(10,2) NOT NULL DEFAULT 1000,
  ADD COLUMN "bbzCommissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- performedByUserId is NOT NULL, so it arrives nullable, is backfilled, and
-- is then constrained. Every existing entry was logged by Tony and describes
-- work he did, so loggedByUserId is the correct source for the backfill --
-- and it stays correct if this runs against a database where that is no
-- longer uniformly true.
ALTER TABLE "time_entries" ADD COLUMN "performedByUserId" TEXT;
UPDATE "time_entries" SET "performedByUserId" = "loggedByUserId" WHERE "performedByUserId" IS NULL;
ALTER TABLE "time_entries" ALTER COLUMN "performedByUserId" SET NOT NULL;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_performedByUserId_fkey"
  FOREIGN KEY ("performedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "time_entries_performedByUserId_idx" ON "time_entries"("performedByUserId");

-- The escalator, as rows. Bands are exclusive at the bottom and inclusive at
-- the top; the top band has no ceiling.
CREATE TABLE "bonus_bands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lowerExclusive" DECIMAL(12,2) NOT NULL,
    "upperInclusive" DECIMAL(12,2),
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonus_bands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bonus_bands_organizationId_idx" ON "bonus_bands"("organizationId");
CREATE UNIQUE INDEX "bonus_bands_organizationId_lowerExclusive_key"
  ON "bonus_bands"("organizationId", "lowerExclusive");

ALTER TABLE "bonus_bands"
  ADD CONSTRAINT "bonus_bands_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
