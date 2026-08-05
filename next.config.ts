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
  outputFileTracingIncludes: {
    "/**": ["./src/generated/prisma/**/*"],
  },
};

export default nextConfig;
