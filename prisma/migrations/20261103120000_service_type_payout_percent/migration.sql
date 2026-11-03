-- A payout share agreed as a percentage of the billed rate rather than as a
-- figure per hour. Nullable and unset everywhere: every existing line keeps
-- paying out exactly what it did, from "payoutRate".
ALTER TABLE "service_types" ADD COLUMN IF NOT EXISTS "payoutPercent" DECIMAL(5,2);
