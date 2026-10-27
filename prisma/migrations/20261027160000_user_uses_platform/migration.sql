-- Someone can be on the team calendar without having been invited to the
-- platform. Defaults true, so every existing person is unaffected.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "usesPlatform" BOOLEAN NOT NULL DEFAULT true;
