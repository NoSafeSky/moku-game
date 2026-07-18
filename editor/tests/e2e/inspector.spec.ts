/**
 * @file Inspector panel — the three body states (empty / single / multi), the object header
 * (enable + rename), typed field editing routed to the canvas, add/remove component, the reference-field
 * picker, and the multi-object shared-only + mixed "—" view.
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

const inspector = '[data-island="inspector"]';

test.describe("inspector", () => {
  test("shows the empty state with nothing selected", async ({ page }) => {
    await boot(page);
    await expect(page.locator(`${inspector} [data-empty-state]`)).toBeVisible();
    await expect(page.locator(`${inspector} [data-empty-state]`)).toContainText(
      "No object selected"
    );
  });

  test("populates the object header and component sections for a selection", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();

    await expect(page.locator(`${inspector} [data-object-header] [data-name]`)).toHaveValue(
      "Player"
    );
    await expect(page.locator(`${inspector} [data-object-header] [data-enable]`)).toBeChecked();
    await expect(page.locator(`${inspector} [data-object-header] [data-tag]`)).toHaveText("#7");
    await expect(
      page.locator(`${inspector} [data-section][data-component="Transform"]`)
    ).toBeVisible();
    await expect(page.locator(`${inspector} [data-section][data-component="Shape"]`)).toBeVisible();
    await expect(page.locator(`${inspector} [data-field-key="x"]`)).toHaveValue("210");
    await expect(page.locator(`${inspector} [data-field-key="y"]`)).toHaveValue("300");
    await expect(page.locator(`${inspector} [data-add-component]`)).toBeVisible();
  });

  test("editing a field reflects on the snapshot and the canvas", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();

    await editField(page, "x", "555");

    await expectField(page, DEMO.player.id, "Transform", "x", 555);
    await expectViewX(page, DEMO.player.id, 555);
  });

  test("the object header renames and toggles enabled through the bridge", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();

    const name = page.locator(`${inspector} [data-object-header] [data-name]`);
    await name.fill("Hero");
    await name.dispatchEvent("change");
    expect((await snapshot(page)).entities.find(entity => entity.id === DEMO.player.id)?.name).toBe(
      "Hero"
    );

    await page.locator(`${inspector} [data-object-header] [data-enable]`).uncheck();
    expect(
      (await snapshot(page)).entities.find(entity => entity.id === DEMO.player.id)?.enabled
    ).toBe(false);
  });

  test("adds a component from the categorized picker, then removes it via the kebab", async ({
    page
  }) => {
    await boot(page);
    // Environment (id 1) has only Transform, so Shape is addable.
    await row(page, DEMO.environment.id).click();
    await page.locator(`${inspector} [data-add-component]`).click();

    const picker = page.locator(`${inspector} [data-add-picker]`);
    await expect(picker).toBeVisible();
    await expect(picker.locator('[data-add-option][data-component="Shape"]')).toBeVisible();
    await expect(
      picker.locator('[data-add-option][data-component="SpriteRenderer"]')
    ).toBeVisible();

    await picker.locator('[data-add-option][data-component="Shape"]').click();
    await expect(page.locator(`${inspector} [data-section][data-component="Shape"]`)).toBeVisible();
    expect(
      (await snapshot(page)).entities
        .find(entity => entity.id === DEMO.environment.id)
        ?.components.map(component => component.name)
    ).toContain("Shape");

    // Remove it via the section kebab menu.
    await page.locator(`${inspector} [data-section][data-component="Shape"] [data-kebab]`).click();
    await page
      .locator(`${inspector} [data-kebab-menu]`)
      .getByRole("button", { name: "Remove Component" })
      .click();
    await expect(page.locator(`${inspector} [data-section][data-component="Shape"]`)).toHaveCount(
      0
    );
  });

  test("the implicit Transform component cannot be removed", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.player.id).click();

    await page
      .locator(`${inspector} [data-section][data-component="Transform"] [data-kebab]`)
      .click();
    await expect(
      page
        .locator(`${inspector} [data-kebab-menu]`)
        .getByRole("button", { name: "Remove Component" })
    ).toBeDisabled();
  });

  test("a reference field opens the anchored picker", async ({ page }) => {
    await boot(page);
    // Add a SpriteRenderer (its `sprite` is an asset reference) to a Transform-only object.
    await row(page, DEMO.environment.id).click();
    await page.locator(`${inspector} [data-add-component]`).click();
    await page
      .locator(`${inspector} [data-add-picker] [data-add-option][data-component="SpriteRenderer"]`)
      .click();

    const sprite = page.locator(`${inspector} [data-field-key="sprite"]`);
    await expect(sprite).toHaveAttribute("data-ref-value", "");
    await expect(sprite.locator("[data-ref-name]")).toHaveText("None");

    await sprite.locator("[data-ref-pick]").click();
    const picker = page.locator(`${inspector} [data-ref-picker]`);
    await expect(picker).toBeVisible();
    // No assets are loaded, so only the "None" clear-row is offered.
    await expect(picker.locator("[data-ref-option]")).toHaveCount(1);
  });

  test("multi-object selection shows shared components and a mixed value", async ({ page }) => {
    await boot(page);
    await row(page, DEMO.drone01.id).click();
    await row(page, DEMO.drone02.id).click({ modifiers: ["Control"] });

    await expect(page.locator(`${inspector} [data-multi-header]`)).toHaveText("2 Objects Selected");
    await expect(
      page.locator(`${inspector} [data-section][data-component="Transform"]`)
    ).toBeVisible();
    // Drone_01.x (560) diverges from Drone_02.x (640) → the X field renders as a non-editable "—".
    await expect(page.locator(`${inspector} [data-mixed]`).first()).toHaveText("—");
  });
});
