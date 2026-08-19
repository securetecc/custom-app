import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireOrgContext } from "@/lib/auth";
import { getInvoicePdfSignedUrl } from "@/lib/storage/invoices";

/**
 * Redirects to a short-lived signed URL for the invoice PDF.
 *
 * A route handler rather than a server action so "Download PDF" can be a plain
 * <a href>, which works with open-in-new-tab and save-as. RLS still scopes the
 * lookup, so an invoice from another org simply isn't found.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { data: invoice } = await requireOrgContext((tx) =>
    tx.invoice.findUnique({ where: { id }, select: { pdfUrl: true } }),
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

  redirect(await getInvoicePdfSignedUrl(invoice.pdfUrl));
}
