import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type TxClient = Prisma.TransactionClient;

/**
 * Runs `fn` inside a transaction scoped to a Postgres role that Supabase RLS
 * policies actually apply to. Prisma's DATABASE_URL connects as a privileged
 * role (postgres), which bypasses RLS entirely -- `SET LOCAL ROLE` drops that
 * session down to `authenticated`/`anon` for the duration of the transaction,
 * and `request.jwt.claims` is set so `auth.uid()` in policies resolves to the
 * given user. This is what makes RLS a real DB-level guarantee here rather
 * than decoration that's never exercised.
 *
 * `authUserId` is the verified Supabase auth user id (from
 * `supabase.auth.getUser()` server-side) -- never take this from client input.
 * Pass `null` to run as `anon` (the public ticket-submission path).
 */
export async function withRLS<T>(
  authUserId: string | null,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const role = authUserId ? "authenticated" : "anon";
      const claims = authUserId ? { sub: authUserId, role } : { role };

      // Both GUCs in ONE statement. `SET LOCAL ROLE x` is exactly
      // `set_config('role', x, true)`, so this is equivalent to the two
      // statements it replaces -- but it's one network round trip instead of
      // two, which matters because every request in the app pays this cost.
      // (Measured ~330ms saved per request from a machine far from the
      // database; a few ms in-region, but it's free either way.)
      //
      // It also removes the $executeRawUnsafe string interpolation the role
      // previously needed: both values are bound parameters here.
      await tx.$executeRaw`SELECT
        set_config('request.jwt.claims', ${JSON.stringify(claims)}, true),
        set_config('role', ${role}, true)`;

      return fn(tx);
    },
    {
      // Every request in this app goes through here, so each one occupies a
      // pooled connection for the length of an interactive transaction. Under
      // concurrency the default 2s maxWait fails fast with P2028 ("Unable to
      // start a transaction in the given time") while connections are simply
      // busy rather than broken. These give brief contention room to clear.
      maxWait: 10_000,
      timeout: 20_000,
    },
  );
}
