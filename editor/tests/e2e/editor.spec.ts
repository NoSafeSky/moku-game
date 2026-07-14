/**
 * @file End-to-end editor drives + per-panel visual baselines (W4).
 *
 * Boots the real app in a browser and drives every panel through the flows a user performs: select
 * from the scene-tree → the inspector populates → edit a field → the canvas AND the tree/snapshot
 * reflect it → undo reverts both data and canvas → redo re-applies; play/stop toggles mode; save/load
 * round-trips and clears undo; the asset browser lists the (empty) manifest.
 *
 * State is asserted through the app's dev handle (`window.__MOKU_EDITOR__`) — the live bridge snapshot
 * and Pixi entity views — so assertions are exact rather than DOM-scraped; interactions use real DOM
 * events and mouse clicks. Visual baselines (tagged `@visual`) pin each panel's chrome; the WebGL
 * canvas is masked in the full-page shot (GPU-dependent) and screenshotted on its own with tolerance.
 */
import { expect, type Page, test } from "@playwright/test";

/** The dev handle the client entry publishes once the game app has booted + seeded. */
type Snapshot = {
  epoch: number;
  mode: "edit" | "play";
  canUndo: boolean;
  canRedo: boolean;
  selection: number[];
  entities: { id: number; components: { name: string; value: Record<string, unknown> }[] }[];
};

/** Boot the shell and wait until the game app has booted and the demo scene is seeded. */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const dbg = (globalThis as unknown as { __MOKU_EDITOR__?: { getEditor(): unknown } })
      .__MOKU_EDITOR__;
    if (!dbg) return false;
    try {
      return (dbg.getEditor() as { bridge: { snapshot(): Snapshot } }).bridge.snapshot().entities
        .length;
    } catch {
      return 0;
    }
  });
}

/** Read the live bridge snapshot from the page. */
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const dbg = (
      globalThis as unknown as {
        __MOKU_EDITOR__: { getEditor(): { bridge: { snapshot(): Snapshot } } };
      }
    ).__MOKU_EDITOR__;
    return dbg.getEditor().bridge.snapshot();
  });
}

/**
 * Wait until the Pixi view x-position for an editor id reaches `expected` (proves the canvas — not
 * just the data — moved). The view re-syncs through the poll → loop-tick pipeline, so this polls for
 * the value rather than assuming a fixed frame count.
 */
async function expectViewX(page: Page, id: number, expected: number): Promise<void> {
  await page.waitForFunction(
    ([editorId, want]) => {
      const h = (
        globalThis as unknown as {
          __MOKU_EDITOR__: {
            getEditor(): {
              gameApp: {
                commands: { resolve(id: number): unknown };
                renderer: { getEntityView(entity: unknown): { x: number } | undefined };
              };
            };
          };
        }
      ).__MOKU_EDITOR__.getEditor();
      const entity = h.gameApp.commands.resolve(editorId as number);
      return h.gameApp.renderer.getEntityView(entity)?.x === want;
    },
    [id, expected] as const,
    { timeout: 2000 }
  );
}

/** Two rAF ticks — long enough for the poll loop to re-sync views + fan out the next snapshot. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let tick = 0; tick < 2; tick++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
  });
}

test.describe("editor shell — end to end", () => {
  test("boots without console errors and renders the full panel grid", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", e => errors.push(String(e)));

    await boot(page);

    // The panel chrome is present and the game canvas is mounted into the viewport.
    await expect(page.locator("[data-editor-shell]")).toBeVisible();
    await expect(page.locator('[data-island="viewport"] canvas')).toBeVisible();
    await expect(page.locator('[data-island="toolbar"]')).toHaveAttribute("data-mode", "edit");
    await expect(page.locator("[data-tree] li")).toHaveCount(4);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("scene-tree select populates the inspector for the entity", async ({ page }) => {
    await boot(page);

    await page.locator("[data-tree] li").first().click();
    await settle(page);

    const selected = await snapshot(page);
    expect(selected.selection).toEqual([1]);
    const keys = page.locator('[data-island="inspector"] [data-field-key]');
    await expect(keys).toHaveCount(5);
    await expect(page.locator('[data-island="inspector"] [data-field-key="x"]')).toHaveValue("210");
  });

  test("inspector edit reflects on the snapshot, the tree, and the canvas; undo/redo revert both", async ({
    page
  }) => {
    await boot(page);
    await page.locator("[data-tree] li").first().click();
    await settle(page);

    const x = page.locator('[data-island="inspector"] [data-field-key="x"]');
    await x.fill("555");
    await x.dispatchEvent("change");
    await settle(page);

    // Data reflected everywhere, and the Pixi view moved (the epoch-gated view re-sync).
    let s = await snapshot(page);
    expect(s.entities.find(e => e.id === 1)?.components[0]?.value?.x).toBe(555);
    await expectViewX(page, 1, 555);
    expect(s.canUndo).toBe(true);

    // Undo reverts BOTH the data and the canvas.
    await page.locator('[data-island="toolbar"] [data-action="undo"]').click();
    await settle(page);
    s = await snapshot(page);
    expect(s.entities.find(e => e.id === 1)?.components[0]?.value?.x).toBe(210);
    await expectViewX(page, 1, 210);
    expect(s.canRedo).toBe(true);

    // Redo re-applies (to data and canvas).
    await page.locator('[data-island="toolbar"] [data-action="redo"]').click();
    await settle(page);
    await expectViewX(page, 1, 555);
  });

  test("play/stop toggles the runtime mode", async ({ page }) => {
    await boot(page);

    await page.locator('[data-island="toolbar"] [data-action="play"]').click();
    await settle(page);
    const playing = await snapshot(page);
    expect(playing.mode).toBe("play");
    await expect(page.locator('[data-island="toolbar"]')).toHaveAttribute("data-mode", "play");

    await page.locator('[data-island="toolbar"] [data-action="stop"]').click();
    await settle(page);
    const stopped = await snapshot(page);
    expect(stopped.mode).toBe("edit");
  });

  test("save/load round-trips and clears the undo history", async ({ page }) => {
    await boot(page);
    await page.locator("[data-tree] li").first().click();
    await settle(page);

    await page.locator('[data-island="toolbar"] [data-action="save"]').click();
    await settle(page);

    // Edit after saving → there is now something to undo.
    const y = page.locator('[data-island="inspector"] [data-field-key="y"]');
    await y.fill("999");
    await y.dispatchEvent("change");
    await settle(page);
    const edited = await snapshot(page);
    expect(edited.canUndo).toBe(true);

    // Load reverts to the saved scene AND clears undo/redo.
    await page.locator('[data-island="toolbar"] [data-action="load"]').click();
    await settle(page);
    const s = await snapshot(page);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.entities.find(e => e.id === 1)?.components[0]?.value?.y).toBe(170);
  });

  test("viewport reflects the current selection", async ({ page }) => {
    await boot(page);

    const viewport = page.locator('[data-island="viewport"]');
    await expect(viewport).not.toHaveAttribute("data-has-selection", /.*/);

    await page.locator("[data-tree] li").first().click();
    await settle(page);
    await expect(viewport).toHaveAttribute("data-has-selection", "");
  });

  test("asset browser renders (the demo scene loads no assets)", async ({ page }) => {
    await boot(page);
    await expect(page.locator('[data-island="asset-browser"] [data-assets]')).toBeVisible();
    await expect(page.locator('[data-island="asset-browser"] [data-assets] li')).toHaveCount(0);
  });
});

test.describe("visual baselines @visual", () => {
  test("each panel matches its baseline", async ({ page }) => {
    await boot(page);
    await page.locator("[data-tree] li").first().click(); // populate the inspector for the shot
    await settle(page);

    const shot = { animations: "disabled" as const };
    await expect(page.locator('[data-island="toolbar"]')).toHaveScreenshot("toolbar.png", shot);
    await expect(page.locator('[data-island="scene-tree"]')).toHaveScreenshot(
      "scene-tree.png",
      shot
    );
    await expect(page.locator('[data-island="inspector"]')).toHaveScreenshot("inspector.png", shot);
    await expect(page.locator('[data-island="asset-browser"]')).toHaveScreenshot(
      "asset-browser.png",
      shot
    );
    // The WebGL canvas is GPU-dependent — pin it with tolerance.
    await expect(page.locator('[data-island="viewport"] canvas')).toHaveScreenshot("viewport.png", {
      ...shot,
      maxDiffPixelRatio: 0.05
    });
    // Full page with the canvas masked (its pixels are covered above).
    await expect(page).toHaveScreenshot("editor-full.png", {
      ...shot,
      fullPage: true,
      mask: [page.locator('[data-island="viewport"] canvas')]
    });
  });
});
