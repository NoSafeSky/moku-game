/**
 * @file Asset pipeline e2e (P2) — import an image into the store, drag it onto the Scene View to spawn a
 * sprite, and prove the alias round-trips through save/load. Drag-to-scene is HTML5 native DnD, which
 * Playwright's mouse-based drag does not drive, so the drop is dispatched as a real `DragEvent` carrying a
 * `DataTransfer` (exactly what a browser hands the island). A `@visual` baseline pins the imported tile grid.
 */

import type { Page } from "@playwright/test";
import { boot, expect, settle, snapshot, test } from "./_helpers";

// A 1×1 red PNG — a valid image the store can persist + the <img> can decode into a real thumbnail.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const IMPORT_INPUT = '[data-island="asset-browser"] [data-action="import-input"]';
const ASSET_DND_TYPE = "application/x-moku-asset";

/** The bridge + store surface these specs drive directly (via the dev handle), typed for `page.evaluate`. */
type BridgeApi = {
  createSprite(alias: string, opts?: { transform?: { x: number; y: number } }): number;
  delete(...ids: number[]): void;
  save(name: string): boolean;
  load(name: string): boolean;
};
type StoreApi = { entries(): { alias: string }[] };
type DebugGlobal = {
  __MOKU_EDITOR__: { getEditor(): { bridge: BridgeApi; assetStore: StoreApi } };
};

/**
 * Import a PNG through the hidden file input and return the newly-derived store alias once the import
 * settles. The alias is read from the store handle (not the DOM), so it is exact regardless of how the
 * name-sorted tile grid orders it — then the matching tile is asserted loaded with a blob thumbnail.
 */
async function importImage(page: Page, name: string): Promise<string> {
  const known = await page.evaluate(() =>
    (globalThis as unknown as DebugGlobal).__MOKU_EDITOR__
      .getEditor()
      .assetStore.entries()
      .map(asset => asset.alias)
  );

  await page.setInputFiles(IMPORT_INPUT, {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1x1, "base64")
  });

  // Wait for the import to resolve, then capture exactly the alias it added.
  const alias = await page.evaluate(async seen => {
    const store = (globalThis as unknown as DebugGlobal).__MOKU_EDITOR__.getEditor().assetStore;
    for (let frame = 0; frame < 180; frame++) {
      const fresh = store
        .entries()
        .map(asset => asset.alias)
        .find(candidate => !seen.includes(candidate));
      if (fresh) return fresh;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    throw new Error("import did not resolve");
  }, known);

  const tile = page.locator(`[data-island="asset-browser"] li[data-alias="${alias}"]`);
  await expect(tile).toHaveAttribute("data-state", "loaded");
  await expect(tile.locator("img")).toHaveAttribute("src", /^blob:/);
  return alias;
}

/** Dispatch a real asset drop onto the Scene View stage centre (native DnD Playwright's mouse can't drive). */
async function dropOnScene(page: Page, alias: string): Promise<void> {
  await page.evaluate(
    ([assetAlias, dndType]) => {
      const stage = document.querySelector('[data-island="viewport"] [data-stage]');
      if (!stage) throw new Error("no viewport stage");
      const rect = stage.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      dataTransfer.setData(dndType, assetAlias);
      const init: DragEventInit = {
        bubbles: true,
        cancelable: true,
        dataTransfer,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      };
      stage.dispatchEvent(new DragEvent("dragover", init));
      stage.dispatchEvent(new DragEvent("drop", init));
    },
    [alias, ASSET_DND_TYPE] as const
  );
  await settle(page);
}

/** The alias bound to some entity's SpriteRenderer.sprite, for asserting a sprite exists post-drop/-load. */
function spriteAliases(page: Page): Promise<string[]> {
  return snapshot(page).then(snap =>
    snap.entities
      .map(entity => entity.components.find(component => component.name === "SpriteRenderer"))
      .map(component => component?.value["sprite"])
      .filter((sprite): sprite is string => typeof sprite === "string")
  );
}

test.describe("asset pipeline — import + drag-to-scene", () => {
  test("imports an image and shows a loaded thumbnail tile", async ({ page }) => {
    await boot(page);

    const alias = await importImage(page, "coin.png");

    const tile = page.locator(`[data-island="asset-browser"] li[data-alias="${alias}"]`);
    await expect(tile).toHaveAttribute("data-kind", "imported");
    await expect(tile.locator("[data-name]")).toHaveText("coin.png");
    await expect(tile.locator("[data-badge]")).toHaveText("PNG");
  });

  test("drags an imported asset onto the Scene View → spawns a selected sprite bound to the alias", async ({
    page
  }) => {
    await boot(page);
    const initial = await snapshot(page);
    const before = initial.entities.length;
    const alias = await importImage(page, "hero.png");

    await dropOnScene(page, alias);

    // A new entity was created, bound to the imported alias, and is the current selection.
    await expect
      .poll(async () => {
        const snap = await snapshot(page);
        return snap.entities.length;
      })
      .toBe(before + 1);
    expect(await spriteAliases(page)).toContain(alias);

    const snap = await snapshot(page);
    const sprite = snap.entities.find(entity =>
      entity.components.some(
        component => component.name === "SpriteRenderer" && component.value["sprite"] === alias
      )
    );
    expect(sprite, "the dropped sprite exists").toBeTruthy();
    expect(snap.selection).toContain(sprite?.id);
  });

  test("save/load round-trips a scene with an imported sprite (the alias persists)", async ({
    page
  }) => {
    await boot(page);
    const alias = await importImage(page, "keeper.png");

    // Bind a sprite to the imported alias, save, delete it, then load — the alias must come back.
    const id = await page.evaluate(
      a =>
        (globalThis as unknown as DebugGlobal).__MOKU_EDITOR__
          .getEditor()
          .bridge.createSprite(a, { transform: { x: 120, y: 80 } }),
      alias
    );
    await settle(page);
    expect(await spriteAliases(page)).toContain(alias);

    const saved = await page.evaluate(() =>
      (globalThis as unknown as DebugGlobal).__MOKU_EDITOR__.getEditor().bridge.save("a6-assets")
    );
    expect(saved, "the scene saved").toBe(true);

    await page.evaluate(
      entityId =>
        (globalThis as unknown as DebugGlobal).__MOKU_EDITOR__.getEditor().bridge.delete(entityId),
      id
    );
    await settle(page);

    const loaded = await page.evaluate(() =>
      (globalThis as unknown as DebugGlobal).__MOKU_EDITOR__.getEditor().bridge.load("a6-assets")
    );
    expect(loaded, "the scene loaded").toBe(true);
    await settle(page);

    // The alias round-trips through serialization; the store (still holding the blob) re-resolves the texture.
    await expect.poll(() => spriteAliases(page)).toContain(alias);
  });
});

test.describe("asset pipeline visual @visual", () => {
  test("the asset browser after an import (tile grid + thumbnail)", async ({ page }) => {
    await boot(page);
    await importImage(page, "coin.png");
    await expect(page.locator('[data-island="asset-browser"]')).toHaveScreenshot(
      "asset-browser-imported.png"
    );
  });
});
