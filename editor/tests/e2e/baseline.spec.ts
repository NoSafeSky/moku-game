/**
 * @file Visual baselines (`@visual`) — a per-engine/per-OS golden for the whole app and every panel, in both
 * the no-selection and single-selection states. The GPU-dependent WebGL canvas is masked in the full-app
 * shots and captured on its own with tolerance. Regenerate deliberately with `bun run test:e2e:update`.
 */
import { boot, DEMO, expect, row, test } from "./_helpers";

test.describe("visual baselines @visual", () => {
  test("the whole editor at rest (nothing selected)", async ({ page }) => {
    await boot(page);
    await expect(page).toHaveScreenshot("editor-empty.png", {
      mask: [page.locator('[data-island="viewport"] [data-stage] canvas')]
    });
  });

  test("the whole editor with an object selected (selection-sync headline)", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.drone02.id).click();
    await expect(page).toHaveScreenshot("editor-selected.png", {
      mask: [page.locator('[data-island="viewport"] [data-stage] canvas')]
    });
  });

  test("each chrome panel matches its baseline", async ({ page }) => {
    await boot(page);

    await expect(page.locator('[data-island="menu-bar"]')).toHaveScreenshot("menu-bar.png");
    await expect(page.locator('[data-island="toolbar"]')).toHaveScreenshot("toolbar.png");
    await expect(page.locator('[data-island="hierarchy"]')).toHaveScreenshot("hierarchy.png");
    await expect(page.locator('[data-island="asset-browser"]')).toHaveScreenshot(
      "asset-browser.png"
    );
    await expect(page.locator('[data-island="status-bar"]')).toHaveScreenshot("status-bar.png");
  });

  test("the inspector in its empty and populated states", async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-island="inspector"]')).toHaveScreenshot("inspector-empty.png");

    await row(page, DEMO.player.id).click();
    await expect(page.locator('[data-island="inspector"]')).toHaveScreenshot(
      "inspector-populated.png"
    );
  });

  test("the scene view canvas renders the demo shapes", async ({ page }) => {
    await boot(page);
    // GPU-dependent — pin with tolerance.
    await expect(page.locator('[data-island="viewport"] [data-stage] canvas')).toHaveScreenshot(
      "viewport-canvas.png",
      { maxDiffPixelRatio: 0.05 }
    );
  });
});
