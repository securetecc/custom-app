import type { InvoicePdfData } from "@/lib/pdf/types";

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
      cell({ text: data.issuedAt }, RIGHT),
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
    ["PERIOD:", `${data.periodStart} – ${data.periodEnd}`],
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
  for (const item of data.lineItems) {
    rows.push(
      row([
        cell(item.date ? { text: item.date } : { blank: true }),
        cell({ text: item.description }, { wrapStrategy: "WRAP" }),
        cell(item.hours === null ? { blank: true } : { number: item.hours }, RIGHT),
        cell(item.rate === null ? { blank: true } : { number: item.rate }, { ...RIGHT, ...CURRENCY }),
        cell(item.amount === null ? { blank: true } : { number: item.amount }, {
          ...RIGHT,
          ...CURRENCY,
          backgroundColor: AMOUNT_TINT,
        }),
      ]),
    );
  }

  rows.push(row([]));

  // --- totals -------------------------------------------------------------
  const totals: [string, CellValue, boolean][] = [
    ["SUBTOTAL", { number: data.totalAmount }, true],
    ["TAX RATE", { text: "N/A" }, false],
    ["SALES TAX", { text: "N/A" }, false],
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

  if (org.checkPayableTo) {
    rows.push(row([]));
    rows.push(row([cell({ text: `Make all checks payable to: ${org.checkPayableTo}` }, BOLD)]));
  }
  if (org.acceptedPaymentMethods) {
    rows.push(row([cell({ text: `We also accept ${org.acceptedPaymentMethods}.` })]));
  }

  return rows;
}

/** Column widths roughly matching the PDF's 15/45/12/11/17% split. */
export function buildSheetFormatRequests(sheetId: number) {
  const widths = [110, 330, 80, 90, 110];
  return widths.map((pixelSize, index) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
      properties: { pixelSize },
      fields: "pixelSize",
    },
  }));
}
