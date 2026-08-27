/**
 * Imports history from the SecureTECC Operations Master Sheet.
 *
 * Purpose-built for the sheet's real exports rather than a generic shape:
 * it reads ClientID ("CLI-016"), pulls the service code out of the
 * description prefix, and copes with the two title rows above each header.
 *
 * Clients and recurring charges are NOT imported here -- they are already in
 * the database. This handles the four that are not: invoices, time entries,
 * reimbursable charges and tickets.
 *
 *   npx tsx scripts/import-operations-sheet.mts --dir ~/Downloads
 *   npx tsx scripts/import-operations-sheet.mts --dir ~/Downloads --commit
 *
 * Every invoice created is tagged with importedFrom, so the whole import can
 * be removed again with one delete. Re-running skips anything already present
 * rather than duplicating it.
 */
import "dotenv/config";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { parseCsv } from "../src/lib/csv";

const prisma = new PrismaClient();
const problems: string[] = [];
const note = (m: string) => problems.push(m);

// ---------------------------------------------------------------- reading

function readSheet(dir: string, sheet: string): Record<string, string>[] {
  // Google appends " (1)", " (2)" to repeat downloads, so match on the tab
  // name and take the NEWEST by modification time. Sorting by filename is
  // what you reach for first and it is wrong: "(1)" and "(2)" are the same
  // length and sort adjacently, so a stale export gets picked silently and
  // the only symptom is a row count that looks plausible.
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".csv") && f.toLowerCase().includes(sheet.toLowerCase()))
    .sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs);
  if (!files.length) {
    note(`no export found for ${sheet}`);
    return [];
  }
  const text = readFileSync(path.join(dir, files[0]), "utf8");
  const lines = text.split("\n");
  const headerAt = lines.findIndex((l) =>
    /(^|,)"?(TicketID|EntryID|InvoiceID|ReimbursableID)"?\s*,/i.test(l),
  );
  const rows = parseCsv(headerAt >= 0 ? lines.slice(headerAt).join("\n") : text);
  console.log(`  ${sheet.padEnd(14)} ${String(rows.length).padStart(4)} rows  <- ${files[0]}`);
  return rows;
}

// ---------------------------------------------------------------- coercion

/**
 * Both formats the sheet exports, parsed from the STRING.
 *
 * Never `new Date(v)` plus local getters: "2026-08-01" parses as UTC midnight
 * and reads back in Pacific as 31 July, moving work into the wrong billing
 * period. Timestamps ("8/20/2026 9:40:45") keep only their date part.
 */
function toDate(value: string | undefined, context: string): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (us) return new Date(Date.UTC(+us[3], +us[1] - 1, +us[2]));
  note(`${context}: unrecognised date "${raw}"`);
  return null;
}

/** "$1,000.00" -> 1000 */
function toMoney(value: string | undefined): number {
  return Number((value ?? "").replace(/[$,\s]/g, "")) || 0;
}

/** "PCC-00002" -> 2 */
function sequenceOf(invoiceNumber: string): number {
  return Number(/-(\d+)\s*$/.exec(invoiceNumber.trim())?.[1] ?? 0);
}

/**
 * The service code lives in the description prefix ("R-S — ...",
 * "O-S [Civil Dept] — ..."), because the sheet has no column for it.
 */
const SERVICE_PREFIX = /^([A-Z]-[A-Z])\s*(\[[^\]]*\])?\s*[—-]\s*/;
function serviceCodeOf(description: string): string | null {
  return SERVICE_PREFIX.exec(description)?.[1] ?? null;
}

/**
 * "[RATE:150]" is a note to the sheet's own formulas. The rate comes from the
 * service type here, so leaving the marker in would print it on an invoice.
 */
function cleanDescription(description: string): string {
  return description.replace(/\s*\[RATE:\d+\]\s*/g, " ").trim();
}

const TICKET_STATUS: Record<string, "New" | "InProgress" | "WaitingOnClient" | "Completed" | "Closed"> = {
  new: "New",
  "in progress": "InProgress",
  inprogress: "InProgress",
  "waiting on client": "WaitingOnClient",
  // The sheet still says Resolved; the platform renamed it Completed.
  resolved: "Completed",
  completed: "Completed",
  closed: "Closed",
};

const URGENCY: Record<string, "Emergency" | "Critical" | "High" | "Medium" | "Low"> = {
  emergency: "Emergency", critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

// ---------------------------------------------------------------------- run

async function main() {
  const args = process.argv.slice(2);
  const dirArg = args.indexOf("--dir");
  const dir = (dirArg >= 0 ? args[dirArg + 1] : "").replace(/^~/, process.env.HOME ?? "~");
  const commit = args.includes("--commit");
  const tag = `sheet-${new Date().toISOString().slice(0, 10)}`;

  if (!dir || !existsSync(dir)) {
    console.error("Pass --dir pointing at the folder holding the CSV exports.");
    process.exit(1);
  }

  console.log(`Reading from ${dir}`);
  const invoiceRows = readSheet(dir, "INVOICES");
  const entryRows = readSheet(dir, "TIME_LOG");
  const expenseRows = readSheet(dir, "REIMBURSABLE");
  const ticketRows = readSheet(dir, "TICKETS").filter((r) => r.ticketid?.trim());
  console.log(commit ? "\nMODE: COMMIT\n" : "\nMODE: DRY RUN — nothing is written\n");

  const org = await prisma.organization.findFirstOrThrow();
  const clients = await prisma.client.findMany();
  const byReference = new Map(clients.filter((c) => c.reference).map((c) => [c.reference!.toUpperCase(), c]));
  const byName = new Map(clients.map((c) => [c.name.trim().toLowerCase(), c]));
  const serviceTypes = await prisma.serviceType.findMany();
  const byCode = new Map(serviceTypes.map((s) => [s.code.toUpperCase(), s]));
  const users = await prisma.user.findMany();
  // LoggedBy is blank on most rows; Tony did the work.
  const tony = users.find((u) => u.email === "tgregory@securetecc.com") ?? users[0];
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  const resolveClient = (id: string, name: string) =>
    byReference.get((id ?? "").toUpperCase()) ?? byName.get((name ?? "").trim().toLowerCase()) ?? null;

  // --- validation pass, before anything is written ------------------------
  const stats = { invoices: 0, entries: 0, expenses: 0, tickets: 0, skipped: 0 };
  const missingCode: string[] = [];

  for (const r of invoiceRows) {
    if (!resolveClient(r.clientid, r.clientname)) note(`invoice ${r.invoiceid}: unknown client ${r.clientid} "${r.clientname}"`);
    if (!sequenceOf(r.invoiceid)) note(`invoice ${r.invoiceid}: no sequence number`);
  }
  for (const r of entryRows) {
    if (!resolveClient(r.clientid, r.clientname)) note(`entry ${r.entryid}: unknown client ${r.clientid}`);
    if (!serviceCodeOf(r.description ?? "")) missingCode.push(r.entryid);
    else if (!byCode.has(serviceCodeOf(r.description)!.toUpperCase())) note(`entry ${r.entryid}: unknown service code`);
  }
  for (const r of expenseRows) if (!resolveClient(r.clientid, r.clientname)) note(`expense ${r.reimbursableid}: unknown client`);

  if (missingCode.length) {
    console.log(`${missingCode.length} time entries have no service-code prefix — defaulting to R-S (Remote Service):`);
    for (const id of missingCode) {
      const row = entryRows.find((r) => r.entryid === id)!;
      console.log(`  ${id}  "${(row.description ?? "").slice(0, 62)}"`);
    }
    console.log("");
  }

  const invoiceIds = new Map<string, string>();

  if (!commit) {
    // Report what WOULD happen, including the invoice-number continuation.
    const perClient = new Map<string, number>();
    for (const r of invoiceRows) {
      const c = resolveClient(r.clientid, r.clientname);
      if (!c) continue;
      perClient.set(c.shortName, Math.max(perClient.get(c.shortName) ?? 0, sequenceOf(r.invoiceid)));
    }
    console.log("invoice numbering would continue from:");
    for (const [shortName, seq] of [...perClient].sort()) {
      console.log(`  ${shortName.padEnd(10)} next = ${shortName}-${String(seq + 1).padStart(5, "0")}`);
    }
    const billed = entryRows.filter((r) => r.invoiceid).length;
    console.log(`\nwould create: ${invoiceRows.length} invoices, ${entryRows.length} time entries ` +
      `(${billed} linked to an invoice), ${expenseRows.length} reimbursables, ${ticketRows.length} tickets`);
    console.log(`every invoice tagged importedFrom="${tag}"`);
    if (problems.length) {
      console.log(`\n${problems.length} problem(s):`);
      for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    } else {
      console.log("\nNo problems found.");
    }
    await prisma.$disconnect();
    return;
  }

  // --- write ---------------------------------------------------------------
  //
  // Existence checks happen BEFORE the transaction and inserts go through
  // createMany, rather than a findFirst + create per row inside it. The
  // per-row version issued roughly 300 round trips to Oregon and blew the
  // transaction timeout at the tickets, rolling the whole import back. This
  // is a handful of statements instead.
  const existingInvoices = new Set(
    (await prisma.invoice.findMany({ select: { invoiceNumber: true } })).map((i) => i.invoiceNumber),
  );
  const existingExpenses = new Set(
    (await prisma.reimbursableExpense.findMany({ where: { reference: { not: null } }, select: { reference: true } }))
      .map((e) => e.reference!),
  );
  const existingTickets = new Set(
    (await prisma.ticket.findMany({ select: { ticketNumber: true } })).map((t) => t.ticketNumber),
  );
  const existingEntries = new Set(
    (await prisma.timeEntry.findMany({ select: { clientId: true, date: true, description: true } }))
      .map((e) => `${e.clientId}|${e.date.toISOString().slice(0, 10)}|${e.description}`),
  );

  await prisma.$transaction(async (tx) => {
    // --- invoices, and the per-client counters that must follow them -------
    const invoiceData = [];
    const highestSeq = new Map<string, number>();
    for (const r of invoiceRows) {
      const client = resolveClient(r.clientid, r.clientname);
      if (!client) continue;
      if (existingInvoices.has(r.invoiceid)) { stats.skipped++; continue; }
      invoiceData.push({
        organizationId: org.id,
        clientId: client.id,
        invoiceNumber: r.invoiceid,
        periodStart: toDate(r.periodstart, `invoice ${r.invoiceid}`) ?? new Date(),
        periodEnd: toDate(r.periodend, `invoice ${r.invoiceid}`) ?? new Date(),
        totalHours: Number(r.totalhours) || 0,
        totalAmount: toMoney(r.totalamount),
        status: (/paid/i.test(r.status) ? "Paid" : /sent/i.test(r.status) ? "Sent" : "Draft") as
          "Paid" | "Sent" | "Draft",
        sentAt: toDate(r.sentdate, `invoice ${r.invoiceid}`),
        paidAt: toDate(r.paiddate, `invoice ${r.invoiceid}`),
        // No PDF: the originals live in Drive, and generating our own would
        // replace a real invoice with an approximation of it.
        importedFrom: tag,
      });
      const seq = sequenceOf(r.invoiceid);
      if (seq > (highestSeq.get(client.id) ?? 0)) highestSeq.set(client.id, seq);
    }
    if (invoiceData.length) await tx.invoice.createMany({ data: invoiceData, skipDuplicates: true });
    stats.invoices = invoiceData.length;

    // Continuity: the next invoice generated must follow history, not restart.
    for (const [clientId, seq] of highestSeq) {
      await tx.client.update({ where: { id: clientId }, data: { lastInvoiceSequence: seq } });
    }

    // Ids are needed to link the time entries, so read them back by number.
    for (const i of await tx.invoice.findMany({ select: { id: true, invoiceNumber: true } })) {
      invoiceIds.set(i.invoiceNumber, i.id);
    }

    // --- time entries ------------------------------------------------------
    const entryData = [];
    for (const r of entryRows) {
      const client = resolveClient(r.clientid, r.clientname);
      if (!client) continue;
      const serviceType = byCode.get((serviceCodeOf(r.description ?? "") ?? "R-S").toUpperCase());
      if (!serviceType) continue;
      const date = toDate(r.date, `entry ${r.entryid}`) ?? new Date();
      const description = cleanDescription(r.description ?? "");
      if (existingEntries.has(`${client.id}|${date.toISOString().slice(0, 10)}|${description}`)) {
        stats.skipped++; continue;
      }
      entryData.push({
        organizationId: org.id,
        clientId: client.id,
        serviceTypeId: serviceType.id,
        date,
        // Hours are imported AS RECORDED. Re-applying today's billing minimums
        // would rewrite what was actually billed.
        durationHours: Number(r.durationhours) || 0,
        description,
        billableStatus: (/non/i.test(r.billablestatus) ? "NonBillable"
          : /residual/i.test(r.billablestatus) ? "Residual" : "Billable") as
          "NonBillable" | "Residual" | "Billable",
        rawInput: r.rawvoiceinput?.startsWith("STAGED") || r.rawvoiceinput === "MANUAL-ENTRY"
          ? null : r.rawvoiceinput || null,
        source: (r.rawvoiceinput === "MANUAL-ENTRY" ? "Manual" : "Voice") as "Manual" | "Voice",
        invoiceId: r.invoiceid ? (invoiceIds.get(r.invoiceid) ?? null) : null,
        loggedByUserId: (byEmail.get((r.loggedby ?? "").toLowerCase()) ?? tony).id,
      });
    }
    if (entryData.length) await tx.timeEntry.createMany({ data: entryData });
    stats.entries = entryData.length;

    // --- reimbursables -----------------------------------------------------
    const expenseData = [];
    for (const r of expenseRows) {
      const client = resolveClient(r.clientid, r.clientname);
      if (!client) continue;
      if (existingExpenses.has(r.reimbursableid)) { stats.skipped++; continue; }
      expenseData.push({
        organizationId: org.id,
        clientId: client.id,
        reference: r.reimbursableid,
        date: toDate(r.date, `expense ${r.reimbursableid}`) ?? new Date(),
        description: r.description,
        amount: toMoney(r.amount),
        invoiceId: r.invoiceid ? (invoiceIds.get(r.invoiceid) ?? null) : null,
        loggedByUserId: (byEmail.get((r.loggedby ?? "").toLowerCase()) ?? tony).id,
      });
    }
    if (expenseData.length) await tx.reimbursableExpense.createMany({ data: expenseData });
    stats.expenses = expenseData.length;

    // --- tickets -----------------------------------------------------------
    const ticketData = [];
    let ticketSeq = org.lastTicketSequence;
    for (const r of ticketRows) {
      if (existingTickets.has(r.ticketid)) { stats.skipped++; continue; }
      ticketData.push({
        organizationId: org.id,
        ticketNumber: r.ticketid,
        clientCompanyName: r.clientname,
        contactName: r.contactname,
        contactEmail: r.contactemail,
        callbackNumber: r.callbacknumber || null,
        issueType: r.issuetype || "Other",
        urgency: (URGENCY[(r.urgencylevel ?? "").trim().toLowerCase()] ?? "Medium"),
        description: r.description,
        status: (TICKET_STATUS[(r.status ?? "").trim().toLowerCase()] ?? "New"),
        internalNotes: r.notes || null,
        createdAt: toDate(r.submitteddate, `ticket ${r.ticketid}`) ?? new Date(),
        resolvedAt: toDate(r.resolveddate, `ticket ${r.ticketid}`),
      });
      ticketSeq = Math.max(ticketSeq, Number(/-(\d+)$/.exec(r.ticketid)?.[1] ?? 0));
    }
    if (ticketData.length) await tx.ticket.createMany({ data: ticketData });
    stats.tickets = ticketData.length;
    if (ticketSeq > org.lastTicketSequence) {
      await tx.organization.update({ where: { id: org.id }, data: { lastTicketSequence: ticketSeq } });
    }
  }, { timeout: 120_000 });

  console.log(`created: ${stats.invoices} invoices, ${stats.entries} entries, ` +
    `${stats.expenses} reimbursables, ${stats.tickets} tickets (${stats.skipped} already present)`);
  console.log(`\nUndo with: delete invoices where importedFrom = "${tag}"`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
  }
  await prisma.$disconnect();
}

main();
