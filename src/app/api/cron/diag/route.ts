import { NextResponse } from "next/server";
import { isAuthorizedCronRequest, unauthorizedResponse } from "@/lib/cron/auth";
import { prisma } from "@/lib/db/prisma";
import { withRLS } from "@/lib/db/rls";

/**
 * TEMPORARY diagnostic. Delete once the Server Action hang is resolved.
 *
 * Lives under /api/cron so it inherits the CRON_SECRET gate and the
 * host-agnostic routing exemption -- it is not publicly callable.
 *
 * Times each database access pattern separately, each behind its own timeout,
 * so a hang is REPORTED rather than hanging the whole request. The question it
 * answers: does a plain query work while an interactive transaction (withRLS)
 * hangs? That is the difference between the rate-limit write, which we know
 * succeeds in production, and every Server Action, which does not.
 */
export const maxDuration = 60;

async function timed<T>(label: string, ms: number, fn: () => Promise<T>) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`HUNG (no answer in ${ms}ms)`)), ms),
      ),
    ]);
    return { step: label, ok: true, ms: Date.now() - started, value: JSON.stringify(value).slice(0, 90) };
  } catch (err) {
    return {
      step: label,
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message.split("\n")[0].slice(0, 140) : String(err),
    };
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return unauthorizedResponse();

  const results = [];

  // 1. Plain query, no transaction. This is the shape checkRateLimit uses,
  //    and we already know that one works in production.
  results.push(await timed("plain query", 12_000, () => prisma.$queryRawUnsafe(`select 1 as ok`)));

  // 2. Prisma interactive transaction, WITHOUT the role switching. Isolates
  //    the transaction itself from anything withRLS adds.
  results.push(
    await timed("interactive transaction", 12_000, () =>
      prisma.$transaction(async (tx) => tx.$queryRawUnsafe(`select 2 as ok`)),
    ),
  );

  // 3. The real thing: withRLS as anon, exactly as the public actions use it.
  results.push(
    await timed("withRLS(null) — as anon", 15_000, () =>
      withRLS(null, (tx) => tx.$queryRawUnsafe(`select 3 as ok`)),
    ),
  );

  // 4. The actual status-lookup query, through the same path.
  results.push(
    await timed("lookup_ticket_status via withRLS", 15_000, () =>
      withRLS(null, (tx) =>
        tx.$queryRawUnsafe(`select * from public.lookup_ticket_status($1, $2)`, "TKT-9999", "nobody@example.com"),
      ),
    ),
  );

  return NextResponse.json(
    {
      region: process.env.VERCEL_REGION ?? "unknown",
      // Shape only -- never the credentials themselves.
      databaseUrlPort: /:(\d+)\//.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown",
      pgbouncerFlag: /pgbouncer=true/.test(process.env.DATABASE_URL ?? ""),
      connectionLimit: /connection_limit=(\d+)/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unset",
      directUrlPort: /:(\d+)\//.exec(process.env.DIRECT_URL ?? "")?.[1] ?? "unset",
      results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
