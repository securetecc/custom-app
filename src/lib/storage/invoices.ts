import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "invoices";

/**
 * Storage paths keep orgId as the first segment in both the active and
 * archived forms, because the bucket's RLS policies scope on
 * (storage.foldername(name))[1] -- see supabase/migrations/0002_invoicing.sql.
 */
export function invoicePdfPath(orgId: string, clientId: string, invoiceId: string): string {
  return `${orgId}/${clientId}/${invoiceId}.pdf`;
}

export function archivedInvoicePdfPath(
  orgId: string,
  clientId: string,
  invoiceId: string,
): string {
  return `${orgId}/archived/${clientId}/${invoiceId}.pdf`;
}

/**
 * Uploads a rendered invoice PDF. Uses the service-role client: this runs in
 * trusted server-side code right after the generation transaction, and the
 * bucket policies exist as defense-in-depth rather than as the access path.
 */
export async function uploadInvoicePdf(path: string, pdf: Buffer): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: true, // regenerating a Draft's PDF should replace, not fail
  });
  if (error) throw new Error(`Invoice PDF upload failed: ${error.message}`);
}

/** Short-lived signed URL -- the bucket is private, so there is no public URL. */
export async function getInvoicePdfSignedUrl(path: string, expiresInSeconds = 60): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) throw new Error(`Could not sign invoice PDF URL: ${error?.message}`);
  return data.signedUrl;
}

/**
 * Moves a voided invoice's PDF under an `archived/` prefix.
 *
 * "Archive, don't hard-delete" is an explicit requirement -- the file stays in
 * the same private bucket so a Voided view can still open it. Returns the new
 * path, or null if there was nothing to move.
 */
export async function archiveInvoicePdf(
  currentPath: string,
  orgId: string,
  clientId: string,
  invoiceId: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const destination = archivedInvoicePdfPath(orgId, clientId, invoiceId);
  if (currentPath === destination) return destination;

  const { error } = await supabase.storage.from(BUCKET).move(currentPath, destination);
  if (error) {
    // Non-fatal: the void's DB effects are the correctness-critical part.
    // Caller surfaces this as a warning rather than rolling the void back.
    return null;
  }
  return destination;
}
