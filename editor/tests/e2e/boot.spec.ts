/**
 * @file Boot guard — the SPA client hydrates without unexpected browser errors, the full four-band panel
 * grid renders, and every island is present + alive. Catches the "SSG HTML renders but the client bundle
 * throws on boot" class (a `process.env` leak → ReferenceError). Error capture is always-on via the
 * `_helpers` fixture; this spec adds the structural assertions.
 */
import { boot, DEMO, expect, snapshot, test } from "./_helpers";

test.describe("boot", () => {
  test("hydrates and renders the full panel grid with no unexpected errors", async ({ page }) => {
    await boot(page);

    await expect(page.locator("[data-editor-shell]")).toBeVisible();
    for (const name of [
      "menu-bar",
      "toolbar",
      "workspace",
      "hierarchy",
      "viewport",
      "asset-browser",
      "inspector",
      "status-bar"
    ]) {
      await expect(page.locator(`[data-island="${name}"]`)).toBeVisible();
    }
    // The game canvas is mounted into the viewport stage (proves the runtime booted, not just the shell).
    await expect(page.locator('[data-island="viewport"] [data-stage] canvas')).toBeVisible();

    // The bridge snapshot carries the seeded demo scene.
    const snap = await snapshot(page);
    expect(snap.entities).toHaveLength(DEMO.entityCount);
    expect(snap.roots).toEqual([...DEMO.rootIds]);
    expect(snap.mode).toBe("edit");
  });

  test("the status bar reads the object/selection/mode summary and tracks selection", async ({
    page
  }) => {
    await boot(page);

    const readout = page.locator('[data-island="status-bar"] [data-readout]');
    await expect(readout).toHaveText("11 objects · 0 selected · EDIT");
    await expect(page.locator('[data-island="status-bar"]')).toHaveAttribute("data-mode", "edit");

    await page.locator(`[data-island="hierarchy"] [data-row][data-id="${DEMO.player.id}"]`).click();
    await expect(readout).toHaveText("11 objects · 1 selected · EDIT");
  });
});
