/**
 * Copies a SecureTECC database from one Supabase project to another.
 *
 * Written because the project moved region. Everything here is additive: the
 * source database is only ever read, so a failed run costs nothing and the old
 * project stays a working fallback until DNS and env vars are switched.
 *
 * Order matters and is not alphabetical -- rows are inserted parent-first so
 * foreign keys resolve. The auth schema goes first of all, because every
 * users row points at an auth.users row.
 *
 * Passwords survive. auth.users is copied at the row level including
 * encrypted_password, rather than through the Admin API which can only create
 * a user with a NEW password. That is the difference between a silent cutover
 * and four people locked out on a Monday morning.
 *
 * Usage:
 *   NEW_DATABASE_URL=... npx tsx scripts/migrate-to-new-supabase.mts
 *   NEW_DATABASE_URL=... npx tsx scripts/migrate-to-new-supabase.mts --commit
 *
 * Storage objects are handled separately by --storage, which needs
 * OLD_SUPABASE_URL / OLD_SERVICE_ROLE_KEY / NEW_SUPABASE_URL /
 * NEW_SERVICE_ROLE_KEY.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { createClient } from "@supabase/supabase-js";

/** Parent-first. A table may only appear after everything it references. */
const TABLES = [
  "organizations",
  "users",
  "clients",
  "service_types",
  "addon_pricing",
  "recurring_charges",
  "recurring_charge_audit_log",
  "invoices",
  "time_entries",
  "reimbursable_expenses",
  "invoice_recurring_charges",
  "invoice_custom_items",
  "invoice_retainer_periods",
  "tickets",
  "ticket_attachments",
  "tasks",
  "cron_runs",
  // rate_limit_hits is deliberately omitted: it is a throwaway counter, and
  // copying it would carry stale rate-limit state into a fresh project.
] as const;

const BUCKETS = ["invoices", "ticket-attachments", "avatars"] as const;

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Columns the two databases have in common, so a version drift doesn't fail. */
async function sharedColumns(
  from: PrismaClient,
  to: PrismaClient,
  schema: string,
  table: string,
): Promise<string[]> {
  const q = (db: PrismaClient) =>
    db.$queryRawUnsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns
       where table_schema = $1 and table_name = $2 order by ordinal_position`,
      schema,
      table,
    );
  const [a, b] = await Promise.all([q(from), q(to)]);
  const inTarget = new Set(b.map((r) => r.column_name));
  return a.map((r) => r.column_name).filter((c) => inTarget.has(c));
}

async function copyTable(
  from: PrismaClient,
  to: PrismaClient,
  schema: string,
  table: string,
  commit: boolean,
): Promise<{ table: string; read: number; written: number; skipped: number; error?: string }> {
  const ref = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  try {
    const cols = await sharedColumns(from, to, schema, table);
    if (cols.length === 0) return { table, read: 0, written: 0, skipped: 0, error: "table missing in target" };

    const rows = await from.$queryRawUnsafe<Record<string, unknown>[]>(`select * from ${ref}`);
    if (!commit) return { table, read: rows.length, written: 0, skipped: 0 };

    let written = 0;
    let skipped = 0;
    for (const row of rows) {
      const values = cols.map((c) => row[c] ?? null);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql =
        `insert into ${ref} (${cols.map(quoteIdent).join(", ")}) values (${placeholders}) ` +
        // Re-runnable: a partially completed run can be repeated without
        // duplicating what already landed.
        `on conflict do nothing`;
      const affected = await to.$executeRawUnsafe(sql, ...values);
      if (affected > 0) written++;
      else skipped++;
    }
    return { table, read: rows.length, written, skipped };
  } catch (err) {
    return {
      table,
      read: 0,
      written: 0,
      skipped: 0,
      error: err instanceof Error ? err.message.split("\n").pop()!.trim().slice(0, 140) : String(err),
    };
  }
}

async function copyStorage(commit: boolean) {
  const oldUrl = process.env.OLD_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.OLD_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const newUrl = process.env.NEW_SUPABASE_URL;
  const newKey = process.env.NEW_SERVICE_ROLE_KEY;
  if (!oldUrl || !oldKey || !newUrl || !newKey) {
    console.log("\nstorage: skipped — needs OLD_SUPABASE_URL/OLD_SERVICE_ROLE_KEY and NEW_SUPABASE_URL/NEW_SERVICE_ROLE_KEY");
    return;
  }

  const src = createClient(oldUrl, oldKey, { auth: { persistSession: false } });
  const dst = createClient(newUrl, newKey, { auth: { persistSession: false } });

  console.log("\nstorage:");
  for (const bucket of BUCKETS) {
    // Objects are nested by org/client, so listing has to recurse rather than
    // read the bucket root.
    const paths: string[] = [];
    const walk = async (prefix: string) => {
      const { data, error } = await src.storage.from(bucket).list(prefix, { limit: 1000 });
      if (error || !data) return;
      for (const entry of data) {
        const full = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) await walk(full); // a folder
        else paths.push(full);
      }
    };
    await walk("");

    if (!commit) {
      console.log(`  ${bucket.padEnd(20)} ${paths.length} objects (dry run)`);
      continue;
    }

    let copied = 0;
    let failed = 0;
    for (const path of paths) {
      const { data, error } = await src.storage.from(bucket).download(path);
      if (error || !data) { failed++; continue; }
      const buf = Buffer.from(await data.arrayBuffer());
      const { error: upErr } = await dst.storage
        .from(bucket)
        .upload(path, buf, { contentType: data.type || "application/octet-stream", upsert: true });
      if (upErr) failed++; else copied++;
    }
    console.log(`  ${bucket.padEnd(20)} ${copied} copied${failed ? `, ${failed} FAILED` : ""}`);
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const storageOnly = process.argv.includes("--storage");

  const target = process.env.NEW_DATABASE_URL;
  if (!target) {
    console.error("NEW_DATABASE_URL is not set — point it at the new project's pooled connection string.");
    process.exit(1);
  }

  const from = new PrismaClient();
  const to = new PrismaClient({ datasources: { db: { url: target } } });

  // Refuse to write into a database that already holds data, unless it is a
  // resumed run. Copying into a populated project is how two organisations
  // end up interleaved.
  const existing = await to
    .$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from public.organizations`)
    .catch(() => null);
  if (existing === null) {
    console.error("Target has no public.organizations table — run `prisma migrate deploy` against it first.");
    process.exit(1);
  }

  console.log(`target already holds ${existing[0].n} organization row(s)`);
  console.log(commit ? "MODE: COMMIT\n" : "MODE: DRY RUN (nothing is written)\n");

  if (!storageOnly) {
    console.log("auth (passwords preserved — encrypted_password is copied, not reset):");
    for (const t of ["users", "identities"]) {
      const r = await copyTable(from, to, "auth", t, commit);
      console.log(`  auth.${t.padEnd(14)} read ${r.read}` +
        (commit ? ` -> wrote ${r.written}, already present ${r.skipped}` : "") +
        (r.error ? `  ERROR: ${r.error}` : ""));
    }

    console.log("\napplication tables:");
    let problems = 0;
    for (const t of TABLES) {
      const r = await copyTable(from, to, "public", t, commit);
      if (r.error) problems++;
      console.log(`  ${t.padEnd(28)} read ${String(r.read).padStart(4)}` +
        (commit ? ` -> wrote ${String(r.written).padStart(4)}, present ${r.skipped}` : "") +
        (r.error ? `  ERROR: ${r.error}` : ""));
    }
    if (problems) console.log(`\n${problems} table(s) reported an error — nothing was rolled back, re-run after fixing.`);
  }

  await copyStorage(commit);

  await from.$disconnect();
  await to.$disconnect();
  console.log(commit ? "\nDone. Verify before switching env vars." : "\nDry run only. Add --commit to write.");
}

main();
