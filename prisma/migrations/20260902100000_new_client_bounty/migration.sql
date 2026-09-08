-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('Website', 'GoogleBusinessProfile', 'SEO', 'Campaign', 'Referral', 'ExistingClient', 'ReturningClient', 'Other');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "leadSource" "LeadSource",
ADD COLUMN     "leadSourceNote" TEXT,
ADD COLUMN     "relationshipStartedOn" DATE;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "bbzBountyPercent" DECIMAL(5,2) NOT NULL DEFAULT 5;

