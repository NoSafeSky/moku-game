import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "src/plugins/**/__tests__/unit/**/*.test.ts"]
        }
      },
      {
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.ts",
            "src/plugins/**/__tests__/integration/**/*.test.ts"
          ]
        }
      }
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["src/**/types.ts", "src/**/types/**", "src/**/__tests__/**"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 }
    }
  }
});
