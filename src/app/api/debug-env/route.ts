import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

// TEMPORARY diagnostic route -- delete once the Prisma engine bundling
// issue on Vercel is resolved. Reports what actually exists on disk in the
// deployed Lambda, which is the one thing the error message alone can't tell us.
export const dynamic = "force-dynamic";

function safeList(dir: string): string[] | string {
  try {
    if (!existsSync(dir)) return "DOES NOT EXIST";
    return readdirSync(dir).slice(0, 50);
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function GET() {
  const cwd = process.cwd();

  const probes: Record<string, string[] | string> = {};
  for (const dir of [
    cwd,
    path.join(cwd, "src"),
    path.join(cwd, "src/generated"),
    path.join(cwd, "src/generated/prisma"),
    "/var/task",
    "/var/task/src/generated/prisma",
    "/var/task/node_modules/.prisma/client",
  ]) {
    probes[dir] = safeList(dir);
  }

  let prismaInit: unknown;
  try {
    const { PrismaClient } = await import("@/generated/prisma/client");
    const client = new PrismaClient();
    const rows = await client.$queryRawUnsafe("select 1 as ok");
    await client.$disconnect();
    prismaInit = { ok: true, rows };
  } catch (err) {
    prismaInit = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    cwd,
    nodeVersion: process.version,
    region: process.env.VERCEL_REGION,
    databaseUrlPresent: Boolean(process.env.DATABASE_URL),
    probes,
    prismaInit,
  });
}
