import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    "/**": ["./src/generated/**/*"],
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
