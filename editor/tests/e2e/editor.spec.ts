import { expect, test } from "@playwright/test";

test.describe("editor shell", () => {
  test("renders the panel grid (W4 drives each panel + visual baselines)", async ({ page }) => {
    test.skip(true, "W4 wires the full e2e drive + per-panel visual baselines");
    await page.goto("/");
    await expect(page.locator("[data-editor-shell]")).toBeVisible();
  });
});
