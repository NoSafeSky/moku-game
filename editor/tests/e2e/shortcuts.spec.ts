/**
 * @file Global shortcuts — the document-level keymap (a second surface onto the same gizmo/bridge actions):
 * W/E/R/T switch the transform tool (and the toolbar reflects it), Ctrl+Z undoes, and the keymap is
 * suppressed while a text field is focused.
 */
import { boot, DEMO, editField, expect, expectField, row, test } from "./_helpers";

/** Read the live gizmo mode from the dev handle. */
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

test.describe("shortcuts", () => {
  test("W/E/R/T switch the transform tool and the toolbar reflects it", async ({ page }) => {
    await boot(page);

    await page.keyboard.press("e");
    await expect.poll(() => gizmoMode(page)).toBe("rotate");
    await expect(page.locator('[data-island="toolbar"] [data-tool="rotate"]')).toHaveAttribute(
      "data-active",
      ""
    );

    await page.keyboard.press("w");
    await expect.poll(() => gizmoMode(page)).toBe("translate");
    await expect(page.locator('[data-island="toolbar"] [data-tool="translate"]')).toHaveAttribute(
      "data-active",
      ""
    );
  });

  test("Ctrl+Z undoes the last edit", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();
    await editField(page, "x", "555");
    await expectField(page, DEMO.player.id, "Transform", "x", 555);

    // Move focus off the field (the keymap ignores keys while a text input is focused).
    await page.locator('[data-island="menu-bar"] [data-brand]').click();
    await page.keyboard.press("Control+z");
    await expectField(page, DEMO.player.id, "Transform", "x", DEMO.player.x);
  });

  test("the keymap is suppressed while a text field is focused", async ({ page }) => {
    await boot(page);

    const search = page.locator('[data-island="hierarchy"] [data-search]');
    await search.click();
    await search.press("r"); // would switch to the Scale tool if not guarded
    await expect.poll(() => gizmoMode(page)).toBe("translate");
  });
});
