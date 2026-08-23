import { getGoogleAccessToken, isGoogleConfigured } from "./auth";
import { ensureInvoiceFolder, uploadToDrive, DRIVE_SCOPE } from "./drive";
import { buildInvoiceSheetRows, buildSheetFormatRequests, SHEETS_SCOPE } from "./sheets";
import type { InvoicePdfData } from "@/lib/pdf/types";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export type ArchiveResult =
  | { ok: true; folderId: string; pdfLink: string; sheetLink: string }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false; error: string };

/**
 * Archives a generated invoice to Drive as both a PDF and a formatted Sheet.
 *
 * NEVER throws: archiving is a convenience, and an invoice that exists and
 * bills correctly must not be rolled back because Drive was unreachable.
 * Callers surface a warning instead -- the same posture as the post-commit
 * PDF render in invoices/actions.ts.
 */
export async function archiveInvoiceToDrive(args: {
  invoiceNumber: string;
  clientName: string;
  year: number;
  pdf: Buffer;
  data: InvoicePdfData;
}): Promise<ArchiveResult> {
  if (!isGoogleConfigured()) return { ok: false, skipped: true };

  try {
    // Both scopes in one token -- Google accepts a space-delimited list, and
    // one round trip beats two.
    const token = await getGoogleAccessToken(`${DRIVE_SCOPE} ${SHEETS_SCOPE}`);
    const folderId = await ensureInvoiceFolder(args.clientName, args.year, token);

    const pdfUpload = await uploadToDrive({
      name: `${args.invoiceNumber}.pdf`,
      mimeType: "application/pdf",
      content: args.pdf,
      folderId,
      token,
    });

    const sheetLink = await createInvoiceSheet(args.invoiceNumber, args.data, folderId, token);

    return { ok: true, folderId, pdfLink: pdfUpload.webViewLink, sheetLink };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : "Drive archiving failed.",
    };
  }
}

/**
 * Creates the spreadsheet, then moves it into the target folder.
 *
 * Two steps because the Sheets create endpoint has no `parents` field --
 * a new spreadsheet always lands in My Drive root and has to be relocated
 * through Drive afterwards.
 */
async function createInvoiceSheet(
  invoiceNumber: string,
  data: InvoicePdfData,
  folderId: string,
  token: string,
): Promise<string> {
  const created = await fetch(SHEETS_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: invoiceNumber },
      sheets: [{ properties: { title: "Invoice", gridProperties: { columnCount: 5 } } }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!created.ok) throw new Error(`Sheets create ${created.status}: ${await created.text()}`);

  const sheet = (await created.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
    sheets: { properties: { sheetId: number } }[];
  };
  const sheetId = sheet.sheets[0].properties.sheetId;

  const batch = await fetch(`${SHEETS_API}/${sheet.spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          updateCells: {
            rows: buildInvoiceSheetRows(data),
            fields: "userEnteredValue,userEnteredFormat",
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
          },
        },
        ...buildSheetFormatRequests(sheetId),
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!batch.ok) throw new Error(`Sheets batchUpdate ${batch.status}: ${await batch.text()}`);

  const moved = await fetch(
    `https://www.googleapis.com/drive/v3/files/${sheet.spreadsheetId}?addParents=${folderId}&removeParents=root&fields=id`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!moved.ok) throw new Error(`Drive move ${moved.status}: ${await moved.text()}`);

  return sheet.spreadsheetUrl;
}
