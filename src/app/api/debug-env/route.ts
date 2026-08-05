import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

// TEMPORARY diagnostic route -- delete after debugging the Vercel 500 on /dashboard.
export async function GET() {
  const envReport: Record<string, string> = {};
  for (const key of [
    "DATABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY",
    "GEMINI_API_KEY",
    "NEXT_PUBLIC_APP_URL",
  ]) {
    const v = process.env[key];
    envReport[key] = v ? `len=${v.length} start=${v.slice(0, 6)} end=${v.slice(-6)}` : "MISSING";
  }

  let dbResult: unknown;
  try {
    const rows = await prisma.$queryRawUnsafe("select 1 as ok");
    dbResult = { ok: true, rows };
  } catch (err) {
    dbResult = {
      ok: false,
      name: err instanceof Error ? err.constructor.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }

  let rlsResult: unknown;
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
      return tx.$queryRawUnsafe("select current_setting('role') as role");
    });
    rlsResult = { ok: true, rows };
  } catch (err) {
    rlsResult = {
      ok: false,
      name: err instanceof Error ? err.constructor.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
  }

  return NextResponse.json({ envReport, dbResult, rlsResult, nodeVersion: process.version, region: process.env.VERCEL_REGION });
}
