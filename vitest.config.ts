import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          // Os testes de integração compartilham um único PostgreSQL local.
          fileParallelism: false,
          globalSetup: ["tests/integration/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
