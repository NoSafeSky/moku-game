import { defineConfig, devices } from "@playwright/test";

const PREVIEW_URL = "http://localhost:4173";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: PREVIEW_URL,
    trace: "on-first-retry"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build a fresh bundle (the bundle-audit spec reads dist/, the browser tests load it), then serve it.
    command: "bun run build && bun run preview",
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
