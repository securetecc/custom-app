/**
 * One-time import of SecureTECC's real client list from the Operations
 * Master Sheet export.
 *
 *   npx tsx scripts/import-clients-csv.mts --file "<path>"            # dry run
 *   npx tsx scripts/import-clients-csv.mts --file "<path>" --commit   # write
 *
 * This is real billing data (client contacts, billing rates), so it follows
 * the same safety shape as scripts/migrate-from-sheets.mts:
 *   - dry run BY DEFAULT
 *   - one transaction, so a mid-way failure writes nothing
 *   - idempotent on re-run: matched and skipped by shortName
 *   - validates before writing anything (missing shortName, duplicate
 *     shortNames within the file, unparseable billing rate) and refuses to
 *     write if anything fails
 *
 * The source file has two title/description rows before the real header, so
 * this parser locates the header by content ("ClientID") rather than
 * assuming row 1 -- unlike migrate-from-sheets.mts's cleaner exports.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function toNumber(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isNaN(n) ? null : n;
}

/** Trims a trailing comma left over from a source cell like "31280 Oak Crest Dr,". */
function cleanAddressLine(value: string): string {
  return value.trim().replace(/,\s*$/, "");
}

async function main() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const filePath = fileFlag >= 0 ? args[fileFlag + 1] : null;
  const commit = args.includes("--commit");

  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-clients-csv.mts --file <path> [--commit]");
    process.exit(1);
  }

  console.log(`Reading ${filePath}`);
  console.log(commit ? "MODE: COMMIT (will write)\n" : "MODE: DRY RUN (no writes)\n");

  const rows = parseCsv(readFileSync(filePath, "utf8"));
  const headerIndex = rows.findIndex((r) => r[0]?.trim() === "ClientID");
  if (headerIndex === -1) {
    console.error('Could not find the header row (looking for a "ClientID" first column).');
    process.exit(1);
  }
  const header = rows[headerIndex].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);

  const idx = {
    clientId: col("ClientID"),
    clientName: col("ClientName"),
    shortName: col("ShortName"),
    ownerName: col("ContactName"),
    email: col("Email"),
    phone: col("Phone"),
    address1: col("Address1"),
    address2: col("Address2"),
    cityStateZip: col("CityStateZip"),
    billingType: col("BillingType"),
    billingRate: col("BillingRate"),
    activeStatus: col("ActiveStatus"),
    notes: col("Notes"),
  };
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1) {
      console.error(`Expected column "${key}" not found in header: ${header.join(", ")}`);
      process.exit(1);
    }
  }

  const dataRows = rows.slice(headerIndex + 1);
  console.log(`Parsed ${dataRows.length} client rows.\n`);

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("No organization found -- run `npx prisma db seed` first.");
    process.exit(1);
  }

  // --- validate --------------------------------------------------------
  const problems: string[] = [];
  const seenShortNames = new Set<string>();
  const candidates: {
    row: number;
    clientId: string;
    name: string;
    shortName: string;
    ownerName: string | null;
    email: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    cityStateZip: string | null;
    billingType: "Hourly" | "Retainer";
    billingRate: number | null;
    activeStatus: boolean;
    notes: string | null;
  }[] = [];

  dataRows.forEach((r, i) => {
    const rowNum = headerIndex + 2 + i; // 1-indexed, matching the source file
    const clientId = (r[idx.clientId] ?? "").trim();
    const name = (r[idx.clientName] ?? "").trim();
    const shortName = (r[idx.shortName] ?? "").trim();

    if (!name) { problems.push(`row ${rowNum} (${clientId}): missing ClientName`); return; }
    if (!shortName) { problems.push(`row ${rowNum} (${clientId}): missing ShortName`); return; }
    if (seenShortNames.has(shortName)) {
      problems.push(`row ${rowNum} (${clientId}): duplicate ShortName "${shortName}" within the file`);
      return;
    }
    seenShortNames.add(shortName);

    const rateRaw = (r[idx.billingRate] ?? "").trim();
    const billingRate = rateRaw ? toNumber(rateRaw) : null;
    if (rateRaw && billingRate === null) {
      problems.push(`row ${rowNum} (${clientId}): unparseable BillingRate "${rateRaw}"`);
      return;
    }

    const email = (r[idx.email] ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      problems.push(`row ${rowNum} (${clientId}): "${email}" doesn't look like a valid email`);
      return;
    }

    candidates.push({
      row: rowNum,
      clientId,
      name,
      shortName,
      ownerName: (r[idx.ownerName] ?? "").trim() || null,
      email: email || null,
      phone: (r[idx.phone] ?? "").trim() || null,
      address1: cleanAddressLine(r[idx.address1] ?? "") || null,
      address2: (r[idx.address2] ?? "").trim() || null,
      cityStateZip: (r[idx.cityStateZip] ?? "").trim() || null,
      billingType: /retainer/i.test(r[idx.billingType] ?? "") ? "Retainer" : "Hourly",
      billingRate,
      activeStatus: /active/i.test(r[idx.activeStatus] ?? "") || !r[idx.activeStatus]?.trim(),
      notes: (r[idx.notes] ?? "").trim() || null,
    });
  });

  if (problems.length > 0) {
    console.error(`${problems.length} problem(s) found -- nothing written:`);
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }

  const existing = await prisma.client.findMany({
    where: { organizationId: org.id, shortName: { in: candidates.map((c) => c.shortName) } },
    select: { shortName: true },
  });
  const existingSet = new Set(existing.map((c) => c.shortName));
  const toCreate = candidates.filter((c) => !existingSet.has(c.shortName));
  const toSkip = candidates.filter((c) => existingSet.has(c.shortName));

  console.log("Preview:");
  for (const c of candidates) {
    const flag = existingSet.has(c.shortName) ? "SKIP (exists)" : "CREATE";
    const rate = c.billingRate !== null ? `$${c.billingRate}/hr` : "no rate";
    console.log(`  [${flag}] ${c.shortName.padEnd(10)} ${c.name}  (${c.billingType}, ${rate})`);
  }
  console.log(`\n${toCreate.length} to create, ${toSkip.length} already present.`);

  if (!commit) {
    console.log("\nDRY RUN — nothing was written. Re-run with --commit to import.");
    await prisma.$disconnect();
    return;
  }

  // Explicit timeout: the default 5s interactive-transaction limit is easily
  // exceeded by 30 sequential creates over a remote connection. Confirmed
  // atomic on the failure that motivated this -- a timed-out attempt left
  // zero rows behind, not a partial import.
  await prisma.$transaction(
    async (tx) => {
      for (const c of toCreate) {
        await tx.client.create({
          data: {
            organizationId: org.id,
            name: c.name,
            shortName: c.shortName,
            ownerName: c.ownerName,
            email: c.email,
            phone: c.phone,
            address1: c.address1,
            address2: c.address2,
            cityStateZip: c.cityStateZip,
            billingType: c.billingType,
            billingRate: c.billingRate,
            activeStatus: c.activeStatus,
            notes: c.notes,
          },
        });
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  console.log(`\nCOMMITTED: created ${toCreate.length} client(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
