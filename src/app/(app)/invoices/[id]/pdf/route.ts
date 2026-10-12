import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import {
  attachmentContentDisposition,
  downloadInvoicePdf,
  invoicePdfFileName,
} from "@/lib/storage/invoices";

/**
 * Serves the invoice PDF as a download.
 *
 * A route handler rather than a server action so "Download PDF" can be a plain
 * <a href>, which works with open-in-new-tab and save-as. RLS still scopes the
 * lookup, so an invoice from another org simply isn't found.
 *
 * The PDF is streamed from here rather than redirected to a signed URL so the
 * filename header is ours: Supabase's `download` option double-encodes the
 * name, which turned "&" into "%26" -- see attachmentContentDisposition.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data: invoice } = await requireOrgContext((tx) =>
    tx.invoice.findUnique({
      where: { id },
      select: { pdfUrl: true, invoiceNumber: true, client: { select: { name: true } } },
    }),
  );

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (!invoice.pdfUrl) {
    return NextResponse.json(
      { error: "This invoice has no PDF yet. Use Retry PDF on the invoice page." },
      { status: 409 },
    );
  }

  const pdf = await downloadInvoicePdf(invoice.pdfUrl);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": attachmentContentDisposition(
        invoicePdfFileName(invoice.invoiceNumber, invoice.client.name),
      ),
      // An invoice is one org's private document: never let a shared cache keep it.
      "Cache-Control": "private, no-store",
    },
  });
}
