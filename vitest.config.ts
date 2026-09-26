import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Scenario tests tick whole cycles of a 4096-cell field sim; give them room.
    testTimeout: 30_000,
  },
});
