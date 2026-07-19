/**
 * @file Menu bar — the GameObject / Edit / Assets / Window dropdowns as a second surface onto the bridge
 * verbs: open/close, hover-switch between top-levels, a dispatched verb (Create Empty), the Window
 * panel-visibility toggle, the Assets ▸ Import New Asset… entry (P2, enabled), the scene readout + dirty dot,
 * and Escape-to-close.
 */
import { boot, DEMO, expect, snapshot, test } from "./_helpers";

const menuBar = '[data-island="menu-bar"]';

test.describe("menu-bar", () => {
  test("shows the scene readout with a clean (hidden) dirty dot at load", async ({ page }) => {
    await boot(page);

    await expect(page.locator(`${menuBar} [data-scene-name]`)).toHaveText("Level_01_Rooftops");
    await expect(page.locator(`${menuBar} [data-dirty]`)).toBeHidden();
  });

  test("the Assets menu is enabled and offers Import New Asset… (P2)", async ({ page }) => {
    await boot(page);
    await expect(page.locator(`${menuBar} [data-menu="assets"]`)).toBeEnabled();

    await page.locator(`${menuBar} [data-menu="assets"]`).click();
    const dropdown = page.locator(`${menuBar} [data-dropdown]`);
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByRole("button", { name: "Import New Asset…" })).toBeEnabled();
    // Create ▸ / Reimport All stay stubbed for a later phase.
    await expect(dropdown.getByRole("button", { name: "Reimport All" })).toBeDisabled();
  });

  test("opening GameObject shows its items with Create Sprite disabled", async ({ page }) => {
    await boot(page);

    await page.locator(`${menuBar} [data-menu="gameobject"]`).click();
    const dropdown = page.locator(`${menuBar} [data-dropdown]`);
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByRole("button", { name: "Create Empty" })).toBeEnabled();
    await expect(dropdown.getByRole("button", { name: "Create Sprite" })).toBeDisabled();
  });

  test("Create Empty adds an object and marks the scene dirty", async ({ page }) => {
    await boot(page);

    await page.locator(`${menuBar} [data-menu="gameobject"]`).click();
    await page
      .locator(`${menuBar} [data-dropdown]`)
      .getByRole("button", { name: "Create Empty" })
      .click();

    const snap = await snapshot(page);
    expect(snap.entities).toHaveLength(DEMO.entityCount + 1);
    await expect(page.locator(`${menuBar} [data-dirty]`)).toBeVisible();
  });

  test("hovering another top-level while open switches menus", async ({ page }) => {
    await boot(page);

    await page.locator(`${menuBar} [data-menu="gameobject"]`).click();
    await expect(page.locator(`${menuBar} [data-menu="gameobject"]`)).toHaveAttribute(
      "data-open",
      ""
    );

    await page.locator(`${menuBar} [data-menu="edit"]`).hover();
    await expect(page.locator(`${menuBar} [data-menu="edit"]`)).toHaveAttribute("data-open", "");
    await expect(page.locator(`${menuBar} [data-menu="gameobject"]`)).not.toHaveAttribute(
      "data-open",
      ""
    );
  });

  test("the Window menu toggles a panel's visibility", async ({ page }) => {
    await boot(page);
    const inspector = page.locator('[data-island="inspector"]');
    await expect(inspector).toBeVisible();

    await page.locator(`${menuBar} [data-menu="window"]`).click();
    const dropdown = page.locator(`${menuBar} [data-dropdown]`);
    await expect(dropdown.getByRole("button", { name: "Inspector" })).toHaveAttribute(
      "data-checked",
      ""
    );
    await dropdown.getByRole("button", { name: "Inspector" }).click();
    await expect(inspector).toBeHidden();
  });

  test("Escape closes an open menu", async ({ page }) => {
    await boot(page);

    await page.locator(`${menuBar} [data-menu="edit"]`).click();
    await expect(page.locator(`${menuBar} [data-dropdown]`)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(`${menuBar} [data-dropdown]`)).toHaveCount(0);
  });
});
