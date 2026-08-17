/**
 * Fetches an organization's logo and inlines it as a data URI for the invoice
 * PDF.
 *
 * @react-pdf/renderer can take a remote URL, but that makes every render
 * depend on a third-party host being up and fast. Inlining keeps rendering
 * self-contained, and a failure here degrades to the text wordmark rather than
 * failing the invoice.
 */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export async function fetchLogoDataUri(logoUrl: string | null): Promise<string | null> {
  if (!logoUrl) return null;

  try {
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    // react-pdf only handles raster images; an SVG would render as nothing.
    if (!/^image\/(png|jpeg|jpg)$/i.test(contentType)) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_LOGO_BYTES) return null;

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
