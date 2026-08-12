import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

type TxClient = Prisma.TransactionClient;

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
      const claims = authUserId
        ? { sub: authUserId, role: "authenticated" }
        : { role: "anon" };

      await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${authUserId ? "authenticated" : "anon"}`);

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
