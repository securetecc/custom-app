import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop announcing the framework in responses -- free, no functional effect.
  poweredByHeader: false,
  // Security-audit fix: no headers were set anywhere (checked proxy.ts too).
  // Scoped deliberately narrow for now -- these three are safe, unconditional
  // wins that can't break anything the app currently does. A real script-src
  // CSP is a separate, bigger piece of work (needs nonces threaded through
  // every inline script/portal-rendered dialog) and is intentionally not
  // attempted here to avoid shipping a CSP that silently breaks the app.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Replaces the older X-Frame-Options; blocks clickjacking by
          // refusing to render this app inside anyone's <iframe>.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // 2 years + preload is a one-way door (undoing it once submitted to
          // browsers' preload lists takes months), so start without preload;
          // add it deliberately later once you're confident every subdomain
          // that will ever exist under securetecc.com is HTTPS-only.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  // A stray lockfile in a parent directory (outside this repo) otherwise
  // makes Next.js guess the wrong workspace root.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Prisma's generated client lives at a custom output path
  // (src/generated/prisma, per prisma/schema.prisma), and Next.js's
  // serverless file tracer doesn't follow the dynamically-loaded native
  // query-engine binary there on its own -- it gets left out of the
  // deployed function bundle, causing PrismaClientInitializationError
  // ("could not locate the Query Engine") in production despite `prisma
  // generate` succeeding at build time. This forces it to be included.
  // Note the glob covers src/generated/**, not just src/generated/prisma/**,
  // so the engine copy staged by scripts/stage-prisma-engine.mjs is traced too.
  outputFileTracingIncludes: {
    // public/securetecc-logo.png is read from disk at render time by
    // src/lib/pdf/logo.ts (the invoice PDF's logo + watermark fallback when
    // Organization.logoUrl isn't set). Static assets in public/ are served by
    // the CDN, not traced into function bundles, so it has to be listed here
    // or that read 404s in production and invoices silently lose their logo.
    "/**": [
      "./src/generated/**/*",
      "./public/securetecc-logo.png",
      // Montserrat/Quattrocento Sans .woff files read at render time by
      // src/lib/pdf/fonts.ts. Same reason as the logo: not traced otherwise,
      // and without them every invoice silently falls back to Helvetica.
      "./src/lib/pdf/fonts/*.woff",
    ],
  },
  // ...but shipping the binary isn't sufficient on its own. Bundling
  // @prisma/client rewrites the __dirname its runtime uses to locate that
  // binary, so it searched /var/task/src/generated (one level above where
  // the file actually lands, /var/task/src/generated/prisma) and still
  // threw "could not locate the Query Engine". Keeping the package
  // external preserves the real __dirname so the lookup resolves.
  // See https://pris.ly/d/engine-not-found-nextjs
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
