/**
 * @file Mobile smoke pass (pragmatic, not a redesign target) — the design context is explicit that this
 * editor is a fixed-chrome, desktop-first IDE with NO mobile layout in scope (design-context §5: "This
 * design is explicitly desktop-first; mobile/narrow-viewport layouts are out of scope for this concept").
 * A squeezed/overflowing desktop layout at a phone width is therefore expected, not a defect. What IS a
 * defect: the app failing to boot, throwing, or leaving a basic tap-to-select interaction dead on a real
 * touch viewport. This spec (run via the separate `mobile-smoke` project, scoped by `testMatch`) proves
 * that floor and leaves a screenshot for human judgment of how gracefully it degrades.
 */
import { boot, DEMO, expect, row, test } from "./_helpers";

test.describe("mobile smoke (390×844 touch viewport — pragmatic floor, not a mobile redesign)", () => {
  test("boots without errors, renders the core chrome, and a tap still selects an object", async ({
    page
  }) => {
    await boot(page);

    await expect(page.locator("[data-editor-shell]")).toBeVisible();
    await expect(page.locator('[data-island="viewport"] [data-stage] canvas')).toBeVisible();

    // A basic touch interaction (tap a hierarchy row) still reaches the bridge and syncs the inspector —
    // the headline selection-sync behaviour must survive touch input even though the layout is squeezed.
    await row(page, DEMO.player.id).tap();
    await expect(
      page.locator('[data-island="inspector"] [data-object-header] [data-name]')
    ).toHaveValue("Player");

    await page.screenshot({ path: "test-results/mobile-smoke.png" });
  });
});
