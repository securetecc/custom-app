import * as Sentry from "@sentry/nextjs";

/**
 * Node runtime — server components, server actions, route handlers, cron.
 *
 * `dataCollection` is deliberately NOT passed. Passing the object at all (even
 * empty) flips every unset category to its permissive default, which would
 * start shipping request bodies, cookies and headers to Sentry. This app
 * handles client billing details and ticket descriptions people type in
 * confidence; the conservative default (sendDefaultPii: false) is the right
 * one here, and anything we want reported gets attached explicitly.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Full sampling in dev where volume is trivial; 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // The attachment bug earlier today was a caught error whose cause was
  // invisible. Local variables at the throw site are exactly what would have
  // made that a one-look diagnosis.
  includeLocalVariables: true,

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
});
