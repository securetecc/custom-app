-- Adds the third availability state: time someone can give, but only if it
-- is asked for. Additive, so existing rows keep whatever kind they have.
ALTER TYPE "AvailabilityKind" ADD VALUE IF NOT EXISTS 'OnRequest';
