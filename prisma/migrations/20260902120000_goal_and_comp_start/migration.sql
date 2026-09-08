-- The dashboard's invoicing target starts at $10,000 -- the current floor,
-- not the ambition. Existing rows move with it; the ladder to $25,000 is
-- offered as presets in Settings rather than baked in here.
ALTER TABLE "organizations" ALTER COLUMN "monthlyRevenueGoal" SET DEFAULT 10000;
UPDATE "organizations" SET "monthlyRevenueGoal" = 10000 WHERE "monthlyRevenueGoal" = 20000;

-- The retainer and bonus begin in August 2026. Before that there was no
-- arrangement, and a report defaulting to July would imply one.
ALTER TABLE "organizations" ADD COLUMN "bbzStartMonth" TEXT NOT NULL DEFAULT '2026-08';
