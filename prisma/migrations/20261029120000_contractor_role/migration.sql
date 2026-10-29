-- A third tier: records time, sees nothing else. Additive; nobody moves.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'contractor';
