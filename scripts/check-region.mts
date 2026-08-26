/**
 * Reports which AWS region a Supabase project actually sits in, and which
 * region the Vercel functions are configured for.
 *
 * Exists because a Supabase project's region cannot be changed after
 * creation. "I selected Oregon" and "the project is in Oregon" are different
 * claims, and the second is the one that matters before any data moves into
 * it -- getting this wrong means recreating the project, not editing it.
 *
 * The evidence is the pooler hostname in the connection string, which Supabase
 * derives from the project's region: aws-0-us-west-2.pooler.supabase.com is a
 * us-west-2 project. It is read from the connection string rather than typed
 * in, so it cannot be a transcription of what someone intended to pick.
 *
 *   npx tsx scripts/check-region.mts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const REQUIRED_SUPABASE_REGION = "us-west-2"; // West US (Oregon)
const REQUIRED_VERCEL_REGION = "pdx1"; // Portland — same metro as us-west-2

/** us-west-2 <- aws-0-us-west-2.pooler.supabase.com */
function regionFromConnectionString(url: string | undefined): string | null {
  if (!url) return null;
  const m = /aws-\d+-([a-z]{2}-[a-z]+-\d)\.pooler\.supabase\.com/.exec(url);
  return m?.[1] ?? null;
}

function projectRef(url: string | undefined): string | null {
  if (!url) return null;
  return /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? null;
}

const rows: [string, string, boolean | null][] = [];

const current = regionFromConnectionString(process.env.DATABASE_URL);
rows.push(["current project region", current ?? "could not read from DATABASE_URL", null]);
rows.push(["current project ref", projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? "unknown", null]);

const next = regionFromConnectionString(process.env.NEW_DATABASE_URL);
if (next) {
  rows.push(["NEW project region", next, next === REQUIRED_SUPABASE_REGION]);
  rows.push(["NEW project ref", projectRef(process.env.NEW_SUPABASE_URL) ?? "unknown", null]);
} else {
  rows.push(["NEW project region", "NEW_DATABASE_URL not set — cannot verify yet", null]);
}

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[] };
const vercelRegion = vercel.regions?.[0] ?? "(not set — Vercel default)";
rows.push(["Vercel function region", vercelRegion, vercelRegion === REQUIRED_VERCEL_REGION]);

console.log(`Required: Supabase ${REQUIRED_SUPABASE_REGION} (West US, Oregon), Vercel ${REQUIRED_VERCEL_REGION} (Portland)\n`);
for (const [label, value, ok] of rows) {
  const mark = ok === null ? "    " : ok ? " OK " : "FAIL";
  console.log(`  [${mark}] ${label.padEnd(24)} ${value}`);
}

const failures = rows.filter(([, , ok]) => ok === false);
if (failures.length) {
  console.log("\nA Supabase region cannot be changed after creation. If the region above is");
  console.log("wrong, the project has to be recreated — do that BEFORE migrating any data.");
}
console.log(`\nChecked ${new Date().toISOString()}`);
process.exit(failures.length ? 1 : 0);
