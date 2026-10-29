/**
 * The address to put in an email.
 *
 * NEXT_PUBLIC_APP_URL is http://localhost:3000 in a developer's .env, which
 * is correct for the app and useless in a message someone opens on their
 * phone: a sign-in link to localhost points at the reader's own machine. A
 * localhost value is therefore ignored here rather than sent out, and the
 * deployment's own hostname is used instead.
 */
const FALLBACK = "https://manage.securetecc.com";

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

export function emailAppUrl(path: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured && !LOCAL.test(configured)) return `${configured}${path}`;

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? "";
  return host ? `https://${host}${path}` : `${FALLBACK}${path}`;
}
