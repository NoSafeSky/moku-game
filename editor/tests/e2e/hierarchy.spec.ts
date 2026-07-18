/**
 * @file Hierarchy panel — the nested scene tree: row inventory, disabled state, selection sync (tree →
 * inspector → viewport → status bar), multi-select, expand/collapse, search filter, enable-eye toggle,
 * inline rename, and the header create/duplicate/delete actions. Rows are addressed by stable `data-id`.
 */
import { boot, DEMO, expect, row, snapshot, test } from "./_helpers";

test.describe("hierarchy", () => {
  test("renders every demo row in order with the correct names and ids", async ({ page }) => {
    await boot(page);

    const rows = page.locator('[data-island="hierarchy"] [data-tree] [data-row]');
    await expect(rows).toHaveCount(DEMO.entityCount);
    await expect(rows.locator("[data-name]")).toHaveText([...DEMO.rowOrder]);
  });

  test("marks the disabled object greyed with its eye off", async ({ page }) => {
    await boot(page);

    const platformB = row(page, DEMO.platformB.id);
    await expect(platformB).toHaveAttribute("data-enabled", "false");
    await expect(platformB.locator("[data-eye]")).toHaveAttribute("data-on", "false");
  });

  test("selecting a row syncs the inspector, viewport, and status bar", async ({ page }) => {
    await boot(page);

    await row(page, DEMO.player.id).click();

    await expect(row(page, DEMO.player.id)).toHaveAttribute("data-selected", "");
    expect((await snapshot(page)).selection).toEqual([DEMO.player.id]);
    await expect(
      page.locator('[data-island="inspector"] [data-object-header] [data-name]')
    ).toHaveValue("Player");
    await expect(page.locator('[data-island="viewport"]')).toHaveAttribute(
      "data-has-selection",
      ""
    );
    await expect(page.locator('[data-island="status-bar"] [data-readout]')).toContainText(
      "1 selected"
    );
  });

  test("ctrl-click extends the selection", async ({ page }) => {
    await boot(page);

    await row(page, DEMO.drone01.id).click();
    await row(page, DEMO.drone02.id).click({ modifiers: ["Control"] });

    const selection = (await snapshot(page)).selection;
    expect(selection).toHaveLength(2);
    expect(new Set(selection)).toEqual(new Set([DEMO.drone01.id, DEMO.drone02.id]));
  });

  test("collapsing a folder hides its descendant rows", async ({ page }) => {
    await boot(page);

    // Ground (id 4) is a folder over Platform_A (5) and Platform_B (6).
    await expect(row(page, 5)).toBeVisible();
    await row(page, DEMO.ground.id).locator("[data-twisty]").click();
    await expect(row(page, 5)).toHaveCount(0);
    await expect(row(page, 6)).toHaveCount(0);
  });

  test("the search field filters rows by name", async ({ page }) => {
    await boot(page);

    await page.locator('[data-island="hierarchy"] [data-search]').fill("Drone");
    const rows = page.locator('[data-island="hierarchy"] [data-tree] [data-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.locator("[data-name]")).toHaveText(["Drone_01", "Drone_02"]);
  });

  test("the eye toggle flips an object's enabled state through the bridge", async ({ page }) => {
    await boot(page);

    await row(page, DEMO.player.id).locator("[data-eye]").click();
    await expect(row(page, DEMO.player.id)).toHaveAttribute("data-enabled", "false");
    expect(
      (await snapshot(page)).entities.find(entity => entity.id === DEMO.player.id)?.enabled
    ).toBe(false);
  });

  test("the header create button adds a new object", async ({ page }) => {
    await boot(page);

    await page.locator('[data-island="hierarchy"] [data-action="create"]').click();
    await expect(page.locator('[data-island="hierarchy"] [data-tree] [data-row]')).toHaveCount(
      DEMO.entityCount + 1
    );
  });

  test("double-click renames a row inline (commit on Enter)", async ({ page }) => {
    await boot(page);

    await row(page, DEMO.player.id).dblclick();
    const input = page.locator('[data-island="hierarchy"] [data-name-input]');
    await expect(input).toBeVisible();
    await input.fill("Hero");
    await input.press("Enter");

    await expect(row(page, DEMO.player.id).locator("[data-name]")).toHaveText("Hero");
    expect((await snapshot(page)).entities.find(entity => entity.id === DEMO.player.id)?.name).toBe(
      "Hero"
    );
  });
});
