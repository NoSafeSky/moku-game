import { defineConfig, devices } from "@playwright/test";

/**
 * The preview port. Honoured from `PORT` so a stale preview on the default port can't be tested by
 * accident (a wrong-server run would silently pass against the old bundle).
 */
const PORT = Number(process.env.PORT ?? 4173);
const PREVIEW_URL = `http://localhost:${PORT}`;

/**
 * Playwright config for the editor shell's real-browser e2e + visual-baseline suite.
 *
 * The MAIN suite is **chromium-only, desktop-only** — deliberately, not by omission: this is a
 * single-window, docked-panel professional IDE (a Unity-2D-class editor), not a responsive content
 * app. The design context (`.planning/design/game-editor-ui/design-context.md` §6) specifies one
 * desktop editor window with no mobile layout, so there is no mobile viewport to baseline and no
 * second render engine buys coverage the WebGL-toleranced shots don't. The goldens are win32-local
 * (`*-chromium-win32.png`).
 *
 * A separate, narrowly-scoped **`mobile-smoke`** project (`testMatch: mobile-smoke.spec.ts`) runs the
 * SAME suite's one pragmatic mobile check on a real touch viewport — not a mobile redesign target (see
 * that spec's header), just the floor that the app doesn't crash/error on a phone-width touch viewport.
 * It is excluded from the `chromium` project via `testIgnore` so it never double-runs at desktop size
 * (where `.tap()` would fail — the desktop project has no touch emulation).
 *
 * The `html` reporter runs with `open: "never"` — an auto-opened report blocks a non-CI run
 * indefinitely (the historical "the suite hangs" symptom); the `list` reporter gives live progress.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Cap concurrency at 2. Every test boots a full Pixi/WebGL editor, so N workers = N live WebGL
  // contexts; past ~2 concurrent contexts this class of GPU intermittently fails shader compilation
  // ("PixiJS Error: Could not initialize shader"), which the error-guard fixture then reports as a
  // spurious failure. Two workers keeps the suite fast (~17s) AND deterministically green.
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  // Visual determinism: a fixed diff tolerance with animation/caret churn suppressed run-to-run.
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.02
    }
  },
  use: {
    baseURL: PREVIEW_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    // Fixed colour scheme + no motion so screenshots are byte-stable across runs.
    colorScheme: "dark",
    reducedMotion: "reduce"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile-smoke\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        // A comfortable desktop-IDE viewport for the 4-band dock layout.
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        // Deterministic font hinting + colour profile for stable visual baselines.
        launchOptions: { args: ["--font-render-hinting=none", "--force-color-profile=srgb"] }
      }
    },
    {
      // Pragmatic mobile floor only (see mobile-smoke.spec.ts) — not part of the desktop-IDE baseline set.
      // A Chromium-based device (not an iOS/webkit one) so this project never needs a second browser binary
      // installed — the main suite is already chromium-only by design (see the file header).
      name: "mobile-smoke",
      testMatch: /mobile-smoke\.spec\.ts$/,
      use: {
        ...devices["Pixel 7"],
        colorScheme: "dark",
        reducedMotion: "reduce"
      }
    }
  ],
  webServer: {
    // Build a fresh bundle (the bundle-audit spec reads dist/, the browser tests load it), then serve it.
    command: "bun run build && bun run preview",
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
