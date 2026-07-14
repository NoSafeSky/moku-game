import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"]
        }
      }
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/lib/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
});
