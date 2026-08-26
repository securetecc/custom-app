/**
 * Applies every file in supabase/migrations to whatever DATABASE_URL points
 * at, in filename order.
 *
 * Prisma's own migrations create the tables; these files carry everything
 * Prisma doesn't model -- row-level security, SECURITY DEFINER functions,
 * storage buckets and their policies. A fresh Supabase project needs both,
 * and only this half is easy to forget, because the app builds and typechecks
 * perfectly without it and then refuses every query at runtime.
 *
 *   npx tsx scripts/apply-supabase-sql.mts            # dry run: lists statements
 *   npx tsx scripts/apply-supabase-sql.mts --commit   # actually applies
 *
 * Safe to re-run: the files use `create or replace`, `drop policy if exists`
 * and `on conflict do nothing` throughout. Statements that are not idempotent
 * are reported rather than aborting the run, so a re-apply tells you what it
 * skipped instead of stopping halfway.
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { splitSqlStatements } from "../src/lib/sql-statements";

const DIR = path.join(process.cwd(), "supabase/migrations");

async function main() {
  const commit = process.argv.includes("--commit");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

  console.log(`${files.length} files from supabase/migrations`);
  console.log(commit ? "MODE: COMMIT\n" : "MODE: DRY RUN (nothing is applied)\n");

  const prisma = new PrismaClient();
  let applied = 0;
  let failed = 0;
  const problems: string[] = [];

  for (const file of files) {
    const statements = splitSqlStatements(readFileSync(path.join(DIR, file), "utf8"));
    console.log(`${file} — ${statements.length} statements`);
    if (!commit) continue;

    for (const statement of statements) {
      const label = statement.replace(/\s+/g, " ").slice(0, 72);
      try {
        await prisma.$executeRawUnsafe(statement);
        applied++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message.split("\n").pop()!.trim() : String(err);
        problems.push(`${file}: ${label}\n    ${message.slice(0, 160)}`);
      }
    }
  }

  if (commit) {
    console.log(`\n${applied} applied, ${failed} failed`);
    if (problems.length) {
      console.log("\nfailures (expected on a re-apply for non-idempotent statements):");
      for (const p of problems) console.log(`  ${p}`);
    }
  }
  await prisma.$disconnect();
  process.exit(failed > 0 && commit ? 1 : 0);
}

main();
