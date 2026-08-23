import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Resolves the logo for an invoice PDF to an inlined data URI.
 *
 * @react-pdf/renderer can take a remote URL, but that makes every render
 * depend on a third-party host being up and fast. Inlining keeps rendering
 * self-contained, and a failure here degrades to the text wordmark rather than
 * failing the invoice.
 *
 * Resolution order:
 *  1. Organization.logoUrl, if set (lets a tenant override the mark).
 *  2. The bundled public/securetecc-logo.png -- the same asset /login, the
 *     sidebar, and the support portal already use. Without this fallback an
 *     org that never fills in logoUrl (the default state after seeding) gets
 *     an unbranded text-only invoice plus no watermark, even though the logo
 *     is sitting right there in the repo.
 *
 * next.config.ts traces public/securetecc-logo.png into the serverless bundle
 * so step 2 still resolves in production, where process.cwd() is the function
 * root rather than the repo.
 */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const BUNDLED_LOGO = "securetecc-logo.png";

export async function fetchLogoDataUri(logoUrl: string | null): Promise<string | null> {
  if (logoUrl) {
    const remote = await fetchRemoteLogo(logoUrl);
    if (remote) return remote;
    // Fall through to the bundled logo rather than returning null -- a
    // misconfigured or briefly-unreachable logoUrl shouldn't strip the
    // branding off an invoice.
  }
  return readBundledLogo();
}

async function fetchRemoteLogo(logoUrl: string): Promise<string | null> {
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

async function readBundledLogo(): Promise<string | null> {
  try {
    const buffer = await readFile(path.join(process.cwd(), "public", BUNDLED_LOGO));
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}
