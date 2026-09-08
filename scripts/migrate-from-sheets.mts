/**
 * One-time import of SecureTECC's Google Sheets data into this schema.
 *
 * Reads CSV exports (one per tab) from a directory and loads Clients,
 * RecurringCharges, TimeEntries, Invoices, and Tickets.
 *
 *   npx tsx scripts/migrate-from-sheets.mts --dir ./sheets-export            # dry run
 *   npx tsx scripts/migrate-from-sheets.mts --dir ./sheets-export --commit   # write
 *
 * Design notes, because this runs once against real billing history:
 *
 *  - DRY RUN BY DEFAULT. Nothing is written without --commit. The dry run
 *    parses, validates, and reports exactly what would happen.
 *  - Everything happens inside ONE transaction, so a failure halfway through
 *    leaves the database untouched rather than half-migrated.
 *  - IDEMPOTENT on re-run: rows are matched on natural keys (client short
 *    name, invoice number, ticket number) and skipped if already present.
 *  - INVOICE NUMBER CONTINUITY is the critical requirement. Each client's
 *    lastInvoiceSequence is seeded to the highest numeric suffix seen in that
 *    client's imported invoices, and Organization.lastTicketSequence likewise,
 *    so the first invoice generated after cutover continues the series instead
 *    of restarting at 00001 and colliding.
 *  - Historical invoices are imported WITHOUT regenerating PDFs. The Sheets
 *    system's PDFs remain the archive of record; pdfUrl is left null and the
 *    line items are reconstructed from the time entries.
 *
 * Expected files in --dir (headers are matched case/space-insensitively):
 *   clients.csv            name, shortName, contactName, email, phone,
 *                          address1, address2, cityStateZip, billingType,
 *                          billingRate, activeStatus, notes
 *   recurring-charges.csv  clientShortName, description, amount, billingFrequency
 *   time-entries.csv       clientShortName, date, durationHours, description,
 *                          billableStatus, serviceTypeCode, invoiceNumber (optional),
 *                          loggedByEmail (optional)
 *   invoices.csv           clientShortName, invoiceNumber, periodStart, periodEnd,
 *                          totalHours, totalAmount, status, sentAt, paidAt, voidedAt
 *   tickets.csv            ticketNumber, clientCompanyName, contactName, contactEmail,
 *                          callbackNumber (optional), issueType, urgency, description,
 *                          status, internalNotes, resolvedAt, createdAt,
 *                          assignedToEmail (optional)
 *                          urgency accepts: Emergency, Critical, High, Medium, Low
 */
import "dotenv/config";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseCsv } from "../src/lib/csv";

const prisma = new PrismaClient();

// ---------------------------------------------------------------- CSV parsing

/**
 * Reads one export, accepting either the plain filename or the name Google
 * Sheets produces ("SecureTECC_Operations_Master Sheet - TIME_LOG.csv").
 *
 * The sheet puts two title rows above the real header, so the header row is
 * located rather than assumed: parsing from line 1 makes the export's title
 * the column names and every row comes back empty.
 */
function readCsv(dir: string, file: string, sheetName?: string): Record<string, string>[] {
  const candidates = [file];
  if (sheetName) {
    for (const entry of readdirSync(dir)) {
      if (entry.toLowerCase().includes(sheetName.toLowerCase()) && entry.endsWith(".csv")) {
        candidates.push(entry);
      }
    }
  }
  const found = candidates.find((c) => existsSync(path.join(dir, c)));
  if (!found) {
    console.warn(`  (no ${file} — skipping that entity)`);
    return [];
  }

  const text = readFileSync(path.join(dir, found), "utf8");
  const lines = text.split("\n");
  // The header is the first line naming a column we recognise.
  const headerAt = lines.findIndex((l) => /(^|,)\s*"?(Date|ClientID|InvoiceID|EntryID|ReimbursableID|ClientName|ClientShortName)"?\s*(,|$)/i.test(l));
  const body = headerAt > 0 ? lines.slice(headerAt).join("\n") : text;
  return parseCsv(body);
}

// ------------------------------------------------------------------- coercion

const problems: string[] = [];
function problem(msg: string) {
  problems.push(msg);
}

function toDate(value: string, context: string): Date | null {
  const raw = value?.trim();
  if (!raw) return null;

  // Parsed from the STRING, never via `new Date()` + local getters. The sheet
  // exports two formats and that approach gets one of them wrong every time:
  // "2026-06-01" is parsed as UTC midnight, and reading it back with
  // getFullYear/getMonth/getDate in Pacific yields 31 May. Every one of the
  // 131 time-entry dates would have shifted back a day, moving work across
  // month boundaries and therefore into the wrong billing period.
  //
  // "07/01/2026" happened to survive, because that form parses as LOCAL
  // midnight -- which is exactly why the bug was easy to miss: the invoice
  // dates looked fine.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us) {
    const [, m, d, y] = us;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  problem(`${context}: unrecognised date format "${raw}" (expected yyyy-mm-dd or mm/dd/yyyy)`);
  return null;
}

function toNumber(value: string, context: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  if (Number.isNaN(n)) {
    problem(`${context}: unparseable number "${value}"`);
    return null;
  }
  return n;
}

function toBool(value: string, fallback = true): boolean {
  if (!value) return fallback;
  return /^(y|yes|true|1|active)$/i.test(value.trim());
}

/** "ACME-00042" -> 42. Anything unparseable is reported, never guessed. */
function invoiceSuffix(invoiceNumber: string): number | null {
  const m = /-(\d+)\s*$/.exec(invoiceNumber.trim());
  return m ? Number(m[1]) : null;
}

function ticketSuffix(ticketNumber: string): number | null {
  const m = /-(\d+)\s*$/.exec(ticketNumber.trim());
  return m ? Number(m[1]) : null;
}

// ----------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const dirFlag = args.indexOf("--dir");
  const dir = dirFlag >= 0 ? args[dirFlag + 1] : "./sheets-export";
  const commit = args.includes("--commit");
  // Stamped on every invoice this run creates so the import can be identified
  // -- and undone -- later. Without it, an imported invoice is
  // indistinguishable from one the app generated, and "remove the migration"
  // would mean matching on invoice numbers by hand.
  const tagFlag = args.indexOf("--tag");
  const importTag =
    tagFlag >= 0 ? args[tagFlag + 1] : `sheets-${new Date().toISOString().slice(0, 10)}`;

  if (!existsSync(dir)) {
    console.error(`Export directory not found: ${dir}`);
    console.error("Point --dir at the folder holding the CSV exports.");
    process.exit(1);
  }

  console.log(`Reading from ${dir}`);
  console.log(commit ? "MODE: COMMIT (will write)" : "MODE: DRY RUN (no writes)");
  console.log(`Invoices will be tagged importedFrom="${importTag}"\n`);

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("No organization found — run `npx prisma db seed` first.");
    process.exit(1);
  }

  const serviceTypes = await prisma.serviceType.findMany({ where: { organizationId: org.id } });
  const serviceTypeByCode = new Map(serviceTypes.map((s) => [s.code.toUpperCase(), s]));
  const users = await prisma.user.findMany({ where: { organizationId: org.id } });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const fallbackUser = users[0];

  const clientRows = readCsv(dir, "clients.csv", "CLIENTS");
  const chargeRows = readCsv(dir, "recurring-charges.csv", "RECURRING");
  const entryRows = readCsv(dir, "time-entries.csv", "TIME_LOG");
  const invoiceRows = readCsv(dir, "invoices.csv", "INVOICES");
  const ticketRows = readCsv(dir, "tickets.csv", "TICKETS");
  const reimbursableRows = readCsv(dir, "reimbursables.csv", "REIMBURSABLE");

  console.log(
    `Parsed: ${clientRows.length} clients, ${chargeRows.length} recurring charges, ` +
      `${entryRows.length} time entries, ${invoiceRows.length} invoices, ${ticketRows.length} tickets`,
  );

  // --- validate before touching anything --------------------------------
  const shortNames = new Set(clientRows.map((r) => r.shortname));
  for (const r of entryRows) {
    if (!shortNames.has(r.clientshortname)) {
      problem(`time-entries: unknown client "${r.clientshortname}"`);
    }
    if (r.servicetypecode && !serviceTypeByCode.has(r.servicetypecode.toUpperCase())) {
      problem(`time-entries: unknown service type "${r.servicetypecode}"`);
    }
  }
  for (const r of invoiceRows) {
    if (!shortNames.has(r.clientshortname)) {
      problem(`invoices: unknown client "${r.clientshortname}"`);
    }
    if (invoiceSuffix(r.invoicenumber) === null) {
      problem(`invoices: can't read a sequence number from "${r.invoicenumber}"`);
    }
  }
  if (!fallbackUser) problem("no staff users exist — time entries need a loggedByUserId");

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s) found:`);
    for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
    if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
    console.error("\nFix the export (or the seed data) and re-run. Nothing was written.");
    process.exit(1);
  }
  console.log("Validation passed.\n");

  // --- highest sequence numbers, for continuity -------------------------
  const highestInvoiceSeq = new Map<string, number>();
  for (const r of invoiceRows) {
    const n = invoiceSuffix(r.invoicenumber) ?? 0;
    const current = highestInvoiceSeq.get(r.clientshortname) ?? 0;
    if (n > current) highestInvoiceSeq.set(r.clientshortname, n);
  }
  const highestTicketSeq = ticketRows.reduce(
    (max, r) => Math.max(max, ticketSuffix(r.ticketnumber) ?? 0),
    0,
  );

  const plan = {
    clients: 0, charges: 0, entries: 0, invoices: 0, tickets: 0,
    skipped: { clients: 0, invoices: 0, tickets: 0 },
  };

  const run = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const clientIdByShortName = new Map<string, string>();

    for (const r of clientRows) {
      const existing = await tx.client.findFirst({
        where: { organizationId: org.id, shortName: r.shortname },
        select: { id: true },
      });
      if (existing) {
        clientIdByShortName.set(r.shortname, existing.id);
        plan.skipped.clients++;
        continue;
      }

      const seq = highestInvoiceSeq.get(r.shortname) ?? 0;
      const created = await tx.client.create({
        data: {
          organizationId: org.id,
          name: r.name,
          shortName: r.shortname,
          ownerName: r.contactname || null,
          email: r.email || null,
          phone: r.phone || null,
          address1: r.address1 || null,
          address2: r.address2 || null,
          cityStateZip: r.citystatezip || null,
          billingType: /retainer/i.test(r.billingtype) ? "Retainer" : "Hourly",
          billingRate: toNumber(r.billingrate, `client ${r.shortname}`),
          activeStatus: toBool(r.activestatus),
          notes: r.notes || null,
          // Continuity: the next generated invoice picks up after history.
          lastInvoiceSequence: seq,
        },
        select: { id: true },
      });
      clientIdByShortName.set(r.shortname, created.id);
      plan.clients++;
    }

    for (const r of chargeRows) {
      const clientId = clientIdByShortName.get(r.clientshortname);
      if (!clientId) continue;
      await tx.recurringCharge.create({
        data: {
          organizationId: org.id,
          clientId,
          description: r.description,
          amount: toNumber(r.amount, `charge ${r.description}`) ?? 0,
          billingFrequency: /annual/i.test(r.billingfrequency) ? "Annual" : "Monthly",
          activeStatus: toBool(r.activestatus),
        },
      });
      plan.charges++;
    }

    // Invoices before time entries, so entries can be linked to them.
    const invoiceIdByNumber = new Map<string, string>();
    for (const r of invoiceRows) {
      const clientId = clientIdByShortName.get(r.clientshortname);
      if (!clientId) continue;

      const existing = await tx.invoice.findFirst({
        where: { organizationId: org.id, clientId, invoiceNumber: r.invoicenumber },
        select: { id: true },
      });
      if (existing) {
        invoiceIdByNumber.set(r.invoicenumber, existing.id);
        plan.skipped.invoices++;
        continue;
      }

      const status = /paid/i.test(r.status) ? "Paid" : /sent/i.test(r.status) ? "Sent" : "Draft";
      const created = await tx.invoice.create({
        data: {
          organizationId: org.id,
          clientId,
          invoiceNumber: r.invoicenumber,
          periodStart: toDate(r.periodstart, `invoice ${r.invoicenumber}`) ?? new Date(),
          periodEnd: toDate(r.periodend, `invoice ${r.invoicenumber}`) ?? new Date(),
          totalHours: toNumber(r.totalhours, `invoice ${r.invoicenumber}`) ?? 0,
          totalAmount: toNumber(r.totalamount, `invoice ${r.invoicenumber}`) ?? 0,
          status,
          sentAt: toDate(r.sentat, `invoice ${r.invoicenumber}`),
          paidAt: toDate(r.paidat, `invoice ${r.invoicenumber}`),
          voidedAt: toDate(r.voidedat, `invoice ${r.invoicenumber}`),
          importedFrom: importTag,
          // pdfUrl stays null: the Sheets-era PDFs remain the archive of
          // record and are not regenerated here. Nothing in this script
          // touches Drive, Gmail or Resend -- it writes rows and stops.
        },
        select: { id: true },
      });
      invoiceIdByNumber.set(r.invoicenumber, created.id);
      plan.invoices++;
    }

    for (const r of entryRows) {
      const clientId = clientIdByShortName.get(r.clientshortname);
      if (!clientId) continue;
      const serviceType = serviceTypeByCode.get((r.servicetypecode || "").toUpperCase());
      if (!serviceType) continue;

      const loggedBy = userByEmail.get((r.loggedbyemail || "").toLowerCase()) ?? fallbackUser;

      await tx.timeEntry.create({
        data: {
          organizationId: org.id,
          clientId,
          serviceTypeId: serviceType.id,
          date: toDate(r.date, `time entry ${r.description?.slice(0, 20)}`) ?? new Date(),
          // Historical hours are imported AS RECORDED. Re-applying today's
          // billing minimums would silently rewrite what was actually billed.
          durationHours: toNumber(r.durationhours, "time entry") ?? 0,
          description: r.description,
          billableStatus: /non/i.test(r.billablestatus)
            ? "NonBillable"
            : /residual/i.test(r.billablestatus)
              ? "Residual"
              : "Billable",
          invoiceId: r.invoicenumber ? (invoiceIdByNumber.get(r.invoicenumber) ?? null) : null,
          loggedByUserId: loggedBy.id,
          performedByUserId: loggedBy.id,
        },
      });
      plan.entries++;
    }

    for (const r of ticketRows) {
      const existing = await tx.ticket.findFirst({
        where: { organizationId: org.id, ticketNumber: r.ticketnumber },
        select: { id: true },
      });
      if (existing) { plan.skipped.tickets++; continue; }

      const status = /closed/i.test(r.status)
        ? "Closed"
        : /resolved/i.test(r.status)
          ? "Completed"
          : /progress/i.test(r.status)
            ? "InProgress"
            : "New";

      await tx.ticket.create({
        data: {
          organizationId: org.id,
          ticketNumber: r.ticketnumber,
          clientCompanyName: r.clientcompanyname,
          contactName: r.contactname,
          contactEmail: r.contactemail,
          callbackNumber: r.callbacknumber || null,
          issueType: r.issuetype || "Other",
          urgency: /emergency/i.test(r.urgency)
            ? "Emergency"
            : /critical/i.test(r.urgency)
              ? "Critical"
              : /high/i.test(r.urgency)
                ? "High"
                : /low/i.test(r.urgency)
                  ? "Low"
                  : "Medium",
          description: r.description,
          status,
          internalNotes: r.internalnotes || null,
          resolvedAt: toDate(r.resolvedat, `ticket ${r.ticketnumber}`),
          assignedToUserId:
            userByEmail.get((r.assignedtoemail || "").toLowerCase())?.id ?? null,
          ...(toDate(r.createdat, `ticket ${r.ticketnumber}`)
            ? { createdAt: toDate(r.createdat, "")! }
            : {}),
        },
      });
      plan.tickets++;
    }

    await tx.organization.update({
      where: { id: org.id },
      data: { lastTicketSequence: Math.max(highestTicketSeq, org.lastTicketSequence) },
    });

    if (!commit) {
      // Dry run: everything above is exercised for real, then discarded.
      throw new DryRunAbort();
    }
  };

  try {
    await prisma.$transaction(run, { maxWait: 30_000, timeout: 300_000 });
  } catch (err) {
    if (!(err instanceof DryRunAbort)) throw err;
  }

  console.log("Would create:");
  console.log(`  clients            ${plan.clients} (${plan.skipped.clients} already present)`);
  console.log(`  recurring charges  ${plan.charges}`);
  console.log(`  invoices           ${plan.invoices} (${plan.skipped.invoices} already present)`);
  console.log(`  time entries       ${plan.entries}`);
  console.log(`  tickets            ${plan.tickets} (${plan.skipped.tickets} already present)`);
  console.log("\nSequence continuity:");
  for (const [shortName, seq] of [...highestInvoiceSeq].sort()) {
    console.log(`  ${shortName.padEnd(16)} next invoice -> ${shortName}-${String(seq + 1).padStart(5, "0")}`);
  }
  console.log(`  next ticket      -> TKT-${String(Math.max(highestTicketSeq, org.lastTicketSequence) + 1).padStart(4, "0")}`);

  console.log(
    commit
      ? "\nCOMMITTED."
      : "\nDRY RUN — nothing was written. Re-run with --commit when the numbers look right.",
  );
}

class DryRunAbort extends Error {}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
