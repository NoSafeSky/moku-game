/**
 * @file Scene View — selection reflection (`data-has-selection`), the grid/snap overlay toggles, the
 * zoom readout + zoom in/out/reset, and Focus. Grid/snap/zoom/focus are transient view state driven through
 * the camera/renderer/gizmo direct handles (never the undo bridge), so this spec reads the live handle
 * getters to confirm the effect.
 */
import { boot, DEMO, expect, row, test } from "./_helpers";

const viewport = '[data-island="viewport"]';

/** Read the live camera zoom from the dev handle. */
function zoom(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() =>
    (
      globalThis as unknown as {
        __MOKU_EDITOR__: { getEditor(): { camera: { getZoom(): number } } };
      }
    ).__MOKU_EDITOR__
      .getEditor()
      .camera.getZoom()
  );
}

/** Read the live camera position from the dev handle. */
function cameraPos(page: import("@playwright/test").Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() =>
    (
      globalThis as unknown as {
        __MOKU_EDITOR__: { getEditor(): { camera: { getPosition(): { x: number; y: number } } } };
      }
    ).__MOKU_EDITOR__
      .getEditor()
      .camera.getPosition()
  );
}

test.describe("viewport", () => {
  test("reflects the current selection", async ({ page }) => {
    await boot(page);

    await expect(page.locator(viewport)).not.toHaveAttribute("data-has-selection", /.*/);
    await row(page, DEMO.player.id).click();
    await expect(page.locator(viewport)).toHaveAttribute("data-has-selection", "");
  });

  test("grid starts on and snap starts off; both toggle", async ({ page }) => {
    await boot(page);

    const grid = page.locator(`${viewport} [data-vp="grid"]`);
    const snap = page.locator(`${viewport} [data-vp="snap"]`);
    await expect(grid).toHaveAttribute("data-on", "");
    await expect(snap).not.toHaveAttribute("data-on", /.*/);

    await grid.click();
    await expect(grid).not.toHaveAttribute("data-on", /.*/);
    await snap.click();
    await expect(snap).toHaveAttribute("data-on", "");
  });

  test("zoom in/out and reset update the readout and the camera", async ({ page }) => {
    await boot(page);

    const readout = page.locator(`${viewport} [data-zoom]`);
    await expect(readout).toHaveText("100%");

    await page.locator(`${viewport} [data-vp="zoom-in"]`).click();
    await expect.poll(() => zoom(page)).toBeGreaterThan(1);
    await expect(readout).not.toHaveText("100%");

    await page.locator(`${viewport} [data-vp="zoom-reset"]`).click();
    await expect.poll(() => zoom(page)).toBe(1);
    await expect(readout).toHaveText("100%");
  });

  test("Focus recentres the camera on the selected object", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();

    await page.locator(`${viewport} [data-vp="focus"]`).click();
    await expect.poll(async () => Math.round((await cameraPos(page)).x)).toBe(DEMO.player.x);
  });
});
