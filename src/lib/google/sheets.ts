import type { InvoicePdfData } from "@/lib/pdf/types";
import { buildServiceSummary, buildWorkLog, formatDate, periodLabel } from "@/lib/pdf/summary";
import { TEMPLATE_ROW_COUNT } from "@/lib/pdf/styles";

/**
 * Builds the Google Sheets `batchUpdate` requests that turn a blank
 * spreadsheet into a visual replica of the invoice template -- the same
 * navy/teal letterhead, DATE/DESCRIPTION/HOURS/RATE/AMOUNT grid, and
 * SUBTOTAL/TAX/TOTAL block the PDF renders.
 *
 * Split out from the API call itself so the request payload is a pure
 * function of the invoice data and can be inspected/asserted without
 * touching Google.
 *
 * Colors mirror src/lib/pdf/styles.ts. Sheets wants 0..1 floats rather than
 * hex, hence the conversion below.
 */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const NAVY = rgb(0x07, 0x1e, 0x37);
const TEAL = rgb(0x06, 0xe1, 0xdc);
const AMOUNT_TINT = rgb(0xbf, 0xfd, 0xfc);
const WHITE = rgb(0xff, 0xff, 0xff);

function rgb(r: number, g: number, b: number) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

type CellValue = { text: string } | { number: number } | { blank: true };

function cell(value: CellValue, style: Record<string, unknown> = {}) {
  const userEnteredValue =
    "text" in value
      ? { stringValue: value.text }
      : "number" in value
        ? { numberValue: value.number }
        : undefined;
  return { userEnteredValue, userEnteredFormat: style };
}

const CURRENCY = { numberFormat: { type: "CURRENCY", pattern: '"$"#,##0.00' } };
const BOLD = { textFormat: { bold: true } };
const RIGHT = { horizontalAlignment: "RIGHT" };

/**
 * One row of cells → a Sheets RowData. Trailing empties are kept so every row
 * spans the same 5 columns; a ragged grid renders with stray borders.
 */
function row(cells: ReturnType<typeof cell>[]) {
  const padded = [...cells];
  while (padded.length < 5) padded.push(cell({ blank: true }));
  return { values: padded };
}

export function buildInvoiceSheetRows(data: InvoicePdfData) {
  const org = data.organization;
  const rows: ReturnType<typeof row>[] = [];

  // --- letterhead ---------------------------------------------------------
  rows.push(
    row([
      cell({ text: org.billerName ?? org.name }, { ...BOLD, textFormat: { bold: true, fontSize: 16 } }),
      cell({ blank: true }),
      cell({ text: "DATE" }, { ...BOLD, ...RIGHT }),
      cell({ text: formatDate(data.issuedAt) }, RIGHT),
    ]),
  );
  const addressLines = [
    [org.billerAddress1, org.billerAddress2].filter(Boolean).join(", "),
    org.billerCityStateZip,
    org.officePhone ? `Office: ${org.officePhone}` : null,
    org.mobilePhone ? `Mobile: ${org.mobilePhone}` : null,
    org.billerEmail ? `Email: ${org.billerEmail}` : null,
    org.website ? `Website: ${org.website}` : null,
  ].filter((l): l is string => Boolean(l && l.length));

  const metaRight: [string, string][] = [
    ["INVOICE #", data.invoiceNumber],
    ["FOR:", org.invoiceForLabel],
    ["BILL TO:", data.client.name],
  ];

  const letterheadDepth = Math.max(addressLines.length, metaRight.length);
  for (let i = 0; i < letterheadDepth; i++) {
    const meta = metaRight[i];
    rows.push(
      row([
        cell(addressLines[i] ? { text: addressLines[i] } : { blank: true }),
        cell({ blank: true }),
        cell(meta ? { text: meta[0] } : { blank: true }, { ...BOLD, ...RIGHT }),
        cell(meta ? { text: meta[1] } : { blank: true }, RIGHT),
      ]),
    );
  }

  // Client address block, right-aligned under BILL TO
  for (const line of [
    "Attn: Accounting Department",
    [data.client.address1, data.client.address2].filter(Boolean).join(", "),
    data.client.cityStateZip,
    data.client.phone,
  ].filter((l): l is string => Boolean(l && l.length))) {
    rows.push(row([cell({ blank: true }), cell({ blank: true }), cell({ blank: true }), cell({ text: line }, RIGHT)]));
  }

  rows.push(row([]));

  // --- table header -------------------------------------------------------
  const headerStyle = {
    backgroundColor: TEAL,
    textFormat: { bold: true, foregroundColor: NAVY },
    horizontalAlignment: "CENTER",
  };
  rows.push(
    row(
      ["DATE", "DESCRIPTION", "HOURS", "RATE", "AMOUNT"].map((h) =>
        cell({ text: h }, headerStyle),
      ),
    ),
  );

  // --- line items ---------------------------------------------------------
  // Mirrors the PDF exactly: service-code prefix, a full-width divider when a
  // charge group opens, $0.00 rather than blank in the AMOUNT column, and the
  // grid padded to the template's fixed row count.
  let emitted = 0;
  const groupsSeen = new Set<string>();

  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i];
    const previous = i > 0 ? data.lineItems[i - 1].groupLabel : null;
    if (item.groupLabel && item.groupLabel !== previous && !groupsSeen.has(item.groupLabel)) {
      groupsSeen.add(item.groupLabel);
      rows.push(
        row([
          cell({ text: `— ${item.groupLabel} —` }, {
            ...BOLD,
            horizontalAlignment: "CENTER",
          }),
          cell({ blank: true }),
          cell({ blank: true }),
          cell({ blank: true }),
          cell({ number: 0 }, CURRENCY),
        ]),
      );
      emitted++;
    }

    rows.push(
      row([
        cell(item.date ? { text: formatDate(item.date) } : { blank: true }),
        cell(
          { text: item.serviceCode ? `${item.serviceCode} — ${item.description}` : item.description },
          { wrapStrategy: "WRAP" },
        ),
        cell(item.hours === null ? { blank: true } : { number: item.hours }),
        cell(item.rate === null ? { blank: true } : { number: item.rate }, CURRENCY),
        cell({ number: item.amount ?? 0 }, CURRENCY),
      ]),
    );
    emitted++;
  }

  for (let i = emitted; i < TEMPLATE_ROW_COUNT; i++) {
    rows.push(
      row([
        cell({ blank: true }),
        cell({ blank: true }),
        cell({ blank: true }),
        cell({ blank: true }),
        cell({ number: 0 }, CURRENCY),
      ]),
    );
  }

  rows.push(row([]));

  // --- totals -------------------------------------------------------------
  // Tint and bold vary independently here exactly as in the template:
  // SALES TAX is tinted but not bold; SUBTOTAL and TOTAL are both.
  const totals: [string, CellValue, boolean][] = [
    ["SUBTOTAL", { number: data.totalAmount }, true],
    ["TAX RATE", { text: "N/A" }, false],
    ["SALES TAX", { text: "N/A" }, true],
    ["OTHER", { text: "—" }, false],
    ["TOTAL", { number: data.totalAmount }, true],
  ];
  for (const [label, value, emphasis] of totals) {
    rows.push(
      row([
        cell({ blank: true }),
        cell({ blank: true }),
        cell({ blank: true }),
        cell({ text: label }, { ...BOLD, ...RIGHT, textFormat: { bold: true, italic: true } }),
        cell(
          value,
          "number" in value
            ? { ...RIGHT, ...CURRENCY, ...BOLD, backgroundColor: emphasis ? AMOUNT_TINT : WHITE }
            : { ...RIGHT },
        ),
      ]),
    );
  }

  if (org.website) {
    rows.push(row([]));
    rows.push(
      row([
        cell({ text: org.website }, {
          backgroundColor: NAVY,
          textFormat: { bold: true, fontSize: 14, foregroundColor: TEAL },
          horizontalAlignment: "CENTER",
        }),
      ]),
    );
  }

  // --- summary: the same work log and prose the PDF's last page carries ----
  // Built from the shared helpers in lib/pdf/summary so the spreadsheet and
  // the PDF can never describe the same period differently.
  const period = periodLabel(data.periodStart, data.periodEnd);
  const SECTION = { ...BOLD, textFormat: { bold: true, fontSize: 13 } };

  rows.push(row([]));
  rows.push(row([cell({ text: "DETAILED WORK LOG" }, SECTION)]));
  for (const entry of buildWorkLog(data.lineItems)) {
    const code = entry.code ? ` — ${entry.code}` : "";
    rows.push(row([cell({ text: `• ${entry.when}${code} — ${entry.description}` })]));
  }

  rows.push(row([]));
  rows.push(row([cell({ text: "SERVICE SUMMARY" }, SECTION)]));
  for (const paragraph of buildServiceSummary({
    lineItems: data.lineItems,
    clientName: data.client.name,
    orgName: org.name,
    periodLabel: period,
  })) {
    rows.push(row([cell({ text: paragraph }, { wrapStrategy: "WRAP" })]));
  }

  rows.push(row([]));
  rows.push(
    row([
      cell({ blank: true }),
      cell({ blank: true }),
      cell({ blank: true }),
      cell({ text: "Total Due:" }, { ...BOLD, ...RIGHT, textFormat: { bold: true, fontSize: 14 } }),
      cell({ number: data.totalAmount }, {
        ...CURRENCY,
        ...RIGHT,
        textFormat: { bold: true, fontSize: 14 },
        backgroundColor: AMOUNT_TINT,
      }),
    ]),
  );

  if (org.checkPayableTo) {
    rows.push(row([]));
    rows.push(row([cell({ text: `Make all checks payable to: ${org.checkPayableTo}` }, BOLD)]));
  }
  if (org.acceptedPaymentMethods) {
    rows.push(row([cell({ text: `We also accept ${org.acceptedPaymentMethods}.` })]));
  }

  return rows;
}

/** Column widths taken from the master template's own A-E (112/330/89/80/121). */
export function buildSheetFormatRequests(sheetId: number) {
  const widths = [112, 330, 89, 80, 121];
  return widths.map((pixelSize, index) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
}
