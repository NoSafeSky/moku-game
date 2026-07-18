/**
 * @file Toolbar — the transform-tool group, the pivot/space segmented toggles, the play/stop/step transport
 * (+ mode chip), the history buttons (undo/redo edit round-trip driving the canvas), and save/load.
 * Tools/pivot/space are transient view state (direct gizmo handles); transport/history/persistence are
 * bridge verbs.
 */
import {
  boot,
  DEMO,
  editField,
  expect,
  expectField,
  expectViewX,
  row,
  snapshot,
  test
} from "./_helpers";

const toolbar = '[data-island="toolbar"]';

/** Read the live gizmo mode from the dev handle (transient view state, not in the snapshot). */
function gizmoMode(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() =>
    (
      globalThis as unknown as {
        __MOKU_EDITOR__: { getEditor(): { gizmos: { mode(): string } } };
      }
    ).__MOKU_EDITOR__
      .getEditor()
      .gizmos.mode()
  );
}

test.describe("toolbar", () => {
  test("reflects the initial edit-mode state", async ({ page }) => {
    await boot(page);

    await expect(page.locator(toolbar)).toHaveAttribute("data-mode", "edit");
    await expect(page.locator(`${toolbar} [data-mode-chip]`)).toHaveText("EDIT MODE");
    await expect(page.locator(`${toolbar} [data-tool="translate"]`)).toHaveAttribute(
      "data-active",
      ""
    );
    await expect(
      page.locator(`${toolbar} [data-segment="pivot"] [data-segment-value="pivot"]`)
    ).toHaveAttribute("data-active", "");
    await expect(
      page.locator(`${toolbar} [data-segment="space"] [data-segment-value="global"]`)
    ).toHaveAttribute("data-active", "");
  });

  test("switching tools drives the gizmo and moves the active highlight", async ({ page }) => {
    await boot(page);

    await page.locator(`${toolbar} [data-tool="rotate"]`).click();
    await expect(page.locator(`${toolbar} [data-tool="rotate"]`)).toHaveAttribute(
      "data-active",
      ""
    );
    await expect(page.locator(`${toolbar} [data-tool="translate"]`)).not.toHaveAttribute(
      "data-active",
      ""
    );
    expect(await gizmoMode(page)).toBe("rotate");
  });

  test("the pivot and space segments switch the gizmo frame", async ({ page }) => {
    await boot(page);

    await page.locator(`${toolbar} [data-segment="pivot"] [data-segment-value="center"]`).click();
    await expect(
      page.locator(`${toolbar} [data-segment="pivot"] [data-segment-value="center"]`)
    ).toHaveAttribute("data-active", "");

    await page.locator(`${toolbar} [data-segment="space"] [data-segment-value="local"]`).click();
    await expect(
      page.locator(`${toolbar} [data-segment="space"] [data-segment-value="local"]`)
    ).toHaveAttribute("data-active", "");
  });

  test("play/step/stop toggles the runtime mode", async ({ page }) => {
    await boot(page);

    await page.locator(`${toolbar} [data-action="play"]`).click();
    await expect(page.locator(toolbar)).toHaveAttribute("data-mode", "play");
    await expect(page.locator(`${toolbar} [data-mode-chip]`)).toHaveText("PLAY MODE");
    expect((await snapshot(page)).mode).toBe("play");

    // Step advances a frame while playing (smoke — must not error, guarded by the fixture).
    await page.locator(`${toolbar} [data-action="step"]`).click();

    await page.locator(`${toolbar} [data-action="stop"]`).click();
    await expect(page.locator(toolbar)).toHaveAttribute("data-mode", "edit");
    expect((await snapshot(page)).mode).toBe("edit");
  });

  test("undo/redo revert and re-apply an edit on both data and canvas", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();
    await editField(page, "x", "555");
    await expectField(page, DEMO.player.id, "Transform", "x", 555);

    await page.locator(`${toolbar} [data-action="undo"]`).click();
    await expectField(page, DEMO.player.id, "Transform", "x", DEMO.player.x);
    await expectViewX(page, DEMO.player.id, DEMO.player.x);

    await page.locator(`${toolbar} [data-action="redo"]`).click();
    await expectField(page, DEMO.player.id, "Transform", "x", 555);
    await expectViewX(page, DEMO.player.id, 555);
  });

  test("save then load round-trips the scene and clears history", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();

    await page.locator(`${toolbar} [data-action="save"]`).click();

    await editField(page, "y", "999");
    await expectField(page, DEMO.player.id, "Transform", "y", 999);

    await page.locator(`${toolbar} [data-action="load"]`).click();
    await expectField(page, DEMO.player.id, "Transform", "y", DEMO.player.y);
    await expect.poll(async () => (await snapshot(page)).canUndo).toBe(false);
    expect((await snapshot(page)).canRedo).toBe(false);
  });
});
