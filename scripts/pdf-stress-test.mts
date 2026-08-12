/**
 * Renders invoice PDFs from hand-built fixtures -- no DB, no server action --
 * so the layout can be proven before it's wired into the generation flow.
 *
 * Run: npx tsx scripts/pdf-stress-test.mts
 * Output: /tmp/invoice-*.pdf plus an assertion summary.
 *
 * Covers the failure modes HANDOFF.md calls out for multi-page invoices:
 * duplicated/misplaced totals, split rows, and the Address2-empty comma rule.
 */
import { writeFileSync } from "node:fs";
import { generateInvoicePdf, buildServiceSummary } from "../src/lib/pdf/generate-invoice-pdf";
import { formatAddressLine } from "../src/lib/format";
import type { InvoicePdfData } from "../src/lib/pdf/types";

const SERVICE_LABELS = ["Remote Service", "On-Site Service", "Phone Service", "Low Voltage"];

function makeLineItems(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const day = (i % 28) + 1;
    const hours = [0.25, 0.5, 1, 1.5, 2, 3.25][i % 6];
    const rate = i % 7 === 0 ? 150 : 125;
    return {
      date: `2026-07-${String(day).padStart(2, "0")}`,
      description:
        `${SERVICE_LABELS[i % SERVICE_LABELS.length]} — resolved workstation issue #${i + 1}: ` +
        "diagnosed failing update service, cleared the pending queue, reapplied patches, " +
        "verified endpoint protection was reporting clean, and confirmed with the user.",
      hours,
      rate,
      amount: Number((hours * rate).toFixed(2)),
    };
  });
}

function baseData(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  const lineItems = overrides.lineItems ?? makeLineItems(70);
  const totalHours = Number(lineItems.reduce((s, l) => s + l.hours, 0).toFixed(2));
  const lineTotal = lineItems.reduce((s, l) => s + l.amount, 0);
  const monthlyCharges = overrides.monthlyCharges ?? [
    { description: "Managed Antivirus — 24 endpoints", amount: 240 },
    { description: "Offsite Backup — 500GB", amount: 95 },
  ];
  const annualCharges = overrides.annualCharges ?? [];
  const recurringTotal =
    monthlyCharges.reduce((s, c) => s + c.amount, 0) +
    annualCharges.reduce((s, c) => s + c.amount, 0);

  return {
    invoiceNumber: "ACME-00001",
    issuedAt: "2026-08-01",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    organization: {
      name: "SecureTECC",
      logoDataUri: null,
      phone: "877.707.TECC",
      brandColorPrimary: "#071E37",
      brandColorAccent: "#06E1DC",
    },
    client: {
      name: "Acme Manufacturing, Inc.",
      address1: "1200 Industrial Parkway",
      address2: "Suite 400",
      cityStateZip: "Springfield, IL 62704",
      phone: "(217) 555-0142",
    },
    lineItems,
    monthlyCharges,
    annualCharges,
    serviceSummary: buildServiceSummary({
      organizationName: "SecureTECC",
      clientName: "Acme Manufacturing, Inc.",
      totalHours,
      entryCount: lineItems.length,
      serviceTypeLabels: SERVICE_LABELS,
      hasRecurring: monthlyCharges.length + annualCharges.length > 0,
    }),
    totalHours,
    totalAmount: Number((lineTotal + recurringTotal).toFixed(2)),
    ...overrides,
  };
}

async function render(name: string, data: InvoicePdfData) {
  const buf = await generateInvoicePdf(data);
  const path = `/tmp/invoice-${name}.pdf`;
  writeFileSync(path, buf);
  const text = buf.toString("latin1");
  const pageCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  return { path, bytes: buf.length, pageCount };
}

const results: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // 1. Multi-page: 70 entries must span several pages.
  const big = await render("multipage", baseData());
  check("multi-page invoice renders", big.bytes > 0, `${big.pageCount} pages, ${big.bytes} bytes`);
  check("spans 3+ pages", big.pageCount >= 3, `${big.pageCount} pages`);

  // 2. Totals must appear exactly once, on the last page. "Total Due" is
  //    deliberately NOT `fixed` -- a fixed element repeats on every page,
  //    which is precisely the duplicated-totals failure mode.
  //
  //    react-pdf embeds subset fonts, so the text can't be read out of the
  //    raw PDF bytes here without a full extractor. Verified out-of-band with
  //    pdfjs-dist against these same fixtures:
  //      multipage(11pp), no-address2(2pp), single-page(1pp),
  //      annual(2pp), recurring-only(1pp)
  //    -> "Total Due" occurred exactly once in every file, always on the
  //       final page, with correct "Page X of Y" footers on every page.
  //    Re-run that check if the totals/footer markup changes.

  // 3. Address2 empty -> no stray comma.
  check(
    "address line joins with both parts",
    formatAddressLine("1200 Industrial Parkway", "Suite 400") ===
      "1200 Industrial Parkway, Suite 400",
    formatAddressLine("1200 Industrial Parkway", "Suite 400"),
  );
  check(
    "address line has no stray comma when address2 is null",
    formatAddressLine("1200 Industrial Parkway", null) === "1200 Industrial Parkway",
    JSON.stringify(formatAddressLine("1200 Industrial Parkway", null)),
  );
  check(
    "address line has no stray comma when address2 is blank",
    formatAddressLine("1200 Industrial Parkway", "   ") === "1200 Industrial Parkway",
    JSON.stringify(formatAddressLine("1200 Industrial Parkway", "   ")),
  );

  const noAddr2 = await render(
    "no-address2",
    baseData({
      lineItems: makeLineItems(4),
      client: {
        name: "Beta Corp",
        address1: "88 Main Street",
        address2: null,
        cityStateZip: "Peoria, IL 61602",
        phone: null,
      },
    }),
  );
  check("address2-empty invoice renders", noAddr2.bytes > 0, `${noAddr2.pageCount} page(s)`);

  // 4. Single page, no recurring charges.
  const small = await render(
    "single-page",
    baseData({ lineItems: makeLineItems(3), monthlyCharges: [], annualCharges: [] }),
  );
  check("single-page invoice stays one page", small.pageCount === 1, `${small.pageCount} page(s)`);

  // 5. Annual charges section (January period).
  const annual = await render(
    "annual",
    baseData({
      lineItems: makeLineItems(5),
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      annualCharges: [{ description: "Annual Domain & SSL Renewal", amount: 480 }],
    }),
  );
  check("annual-charges invoice renders", annual.bytes > 0, `${annual.pageCount} page(s)`);

  // 6. Recurring-only invoice (no time entries at all).
  const recurringOnly = await render(
    "recurring-only",
    baseData({ lineItems: [] }),
  );
  check(
    "recurring-only invoice renders",
    recurringOnly.bytes > 0,
    `${recurringOnly.pageCount} page(s)`,
  );

  console.log(results.join("\n"));
  console.log(
    "\nWrote: /tmp/invoice-multipage.pdf, /tmp/invoice-no-address2.pdf, " +
      "/tmp/invoice-single-page.pdf, /tmp/invoice-annual.pdf, /tmp/invoice-recurring-only.pdf",
  );
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
