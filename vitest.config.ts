import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    pool: "forks", // each test file gets its own DB file
  },
});
