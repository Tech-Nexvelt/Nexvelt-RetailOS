import { defineConfig } from "vitest/config";
import path from "node:path";

// Database tests: a real PostgreSQL server per test file. Slower than unit tests, so they run
// with `npm run test:db`, separately from `npm test`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    pool: "forks",
  },
});
