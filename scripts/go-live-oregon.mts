/**
 * Runs the whole move to the new Supabase project, in order, with the checks
 * that matter between each step.
 *
 * One command rather than five, because the steps have to happen in sequence
 * and the failure mode of getting it wrong is subtle: schema without RLS
 * looks completely fine until every query is refused at runtime, and data
 * copied before the schema exists fails loudly but halfway.
 *
 * Nothing writes to the current project. It is read-only throughout, so the
 * old project remains a working fallback until the env vars are switched, and
 * switching them back is the rollback.
 *
 *   npx tsx scripts/go-live-oregon.mts            # dry run — checks only
 *   npx tsx scripts/go-live-oregon.mts --commit   # actually migrates
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const REQUIRED = [
  "NEW_DATABASE_URL",
  "NEW_DIRECT_URL",
  "NEW_SUPABASE_URL",
  "NEW_SERVICE_ROLE_KEY",
] as const;

const commit = process.argv.includes("--commit");

function run(label: string, cmd: string, args: string[], env: Record<string, string> = {}) {
  console.log(`\n── ${label}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`\nStopped: "${label}" failed. Nothing after this ran, and the current project is untouched.`);
    process.exit(1);
  }
}

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing from .env:\n" + missing.map((m) => `  ${m}`).join("\n"));
  console.error("\nSee docs/supabase-region-move.md for where each one lives in the Supabase dashboard.");
  process.exit(1);
}

console.log(commit ? "MODE: COMMIT — this will write to the new project" : "MODE: DRY RUN — checks only, nothing is written");

// 1. Region, before anything else. A Supabase region cannot be changed after
//    creation, so discovering it is wrong AFTER moving the data means doing
//    the whole thing again against a project that has to be recreated anyway.
run("Checking regions", "npx", ["tsx", "scripts/check-region.mts"]);

if (!commit) {
  run("Data preview (nothing written)", "npx", ["tsx", "scripts/migrate-to-new-supabase.mts"]);
  console.log("\nDry run complete. Re-run with --commit to migrate.");
  process.exit(0);
}

// 2. Tables. Prisma owns these.
run("Creating tables", "npx", ["prisma", "migrate", "deploy"], {
  DATABASE_URL: process.env.NEW_DATABASE_URL!,
  DIRECT_URL: process.env.NEW_DIRECT_URL!,
});

// 3. Everything Prisma does not model: RLS, SECURITY DEFINER functions,
//    storage buckets and their policies. Skipping this is the failure that
//    builds, typechecks, deploys, and then refuses every query.
run("Applying RLS, functions and buckets", "npx", ["tsx", "scripts/apply-supabase-sql.mts", "--commit"], {
  DATABASE_URL: process.env.NEW_DATABASE_URL!,
});

// 4. Rows, parent-first. Auth users carry their password hashes, so nobody
//    has to reset anything.
run("Copying data", "npx", ["tsx", "scripts/migrate-to-new-supabase.mts", "--commit"]);

// 5. Files.
run("Copying storage objects", "npx", ["tsx", "scripts/migrate-to-new-supabase.mts", "--commit", "--storage"], {
  OLD_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  OLD_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
});

console.log(`
── Done. The new project is populated; nothing has been switched over yet.

Next, and in this order:
  1. Vercel → Environment Variables: replace DATABASE_URL, DIRECT_URL,
     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
     SUPABASE_SERVICE_ROLE_KEY with the new project's.
  2. Add SAFE_MODE=1 for the cutover deploy — a cron firing mid-switch would
     email real clients from half-migrated data. Remove it once verified.
  3. Redeploy, then sign in as each user. That is what proves the password
     copy worked.

The old project is untouched. Putting the old values back is the rollback.
`);
