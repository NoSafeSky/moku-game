/**
 * @file asset-store plugin — integration tests.
 *
 * Boots the framework with `assetStorePlugin` and a fake persistent `IndexedDbLike` + a fake `URL`
 * recorder installed on `globalThis`. Covers the full import → url/entries/get round trip, reload
 * survival (a second `createApp` over the SAME backing store re-hydrates the alias at `onStart`
 * with a freshly minted URL), `remove`, and that `stop()` revokes every minted URL.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { assetStorePlugin } from "../../index";
import { clearIndexedDb, installIndexedDb } from "../mock-indexeddb";
import { installUrl, type MockUrl } from "../mock-url";

const pngBlob = { type: "image/png", size: 2048 };

const createAssetStoreApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [assetStorePlugin] });
  return createApp();
};

let mockUrl: MockUrl;
let uninstallUrl: () => void;
let uninstallIndexedDb: () => void;

beforeEach(() => {
  ({ mock: mockUrl, uninstall: uninstallUrl } = installUrl());
  ({ uninstall: uninstallIndexedDb } = installIndexedDb());
});

afterEach(() => {
  uninstallUrl();
  uninstallIndexedDb();
  clearIndexedDb();
});

// ─────────────────────────────────────────────────────────────────────────────
// Import → url / entries / get round trip
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store plugin integration", () => {
  it("imports a blob and exposes it via url/entries/get", async () => {
    const app = createAssetStoreApp();
    await app.start();

    const asset = await app["asset-store"].import(pngBlob, {
      name: "sprite.png",
      alias: "sprite-1"
    });
    expect(asset.alias).toBe("sprite-1");
    expect(asset.url).toMatch(/^blob:/);

    expect(app["asset-store"].url("sprite-1")).toBe(asset.url);
    expect(app["asset-store"].has("sprite-1")).toBe(true);
    expect(app["asset-store"].entries()).toEqual([
      { alias: "sprite-1", name: "sprite.png", mime: "image/png", byteLength: 2048, url: asset.url }
    ]);
    await expect(app["asset-store"].get("sprite-1")).resolves.toEqual(pngBlob);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Reload survival: a second createApp over the SAME backend re-hydrates
  // ──────────────────────────────────────────────────────────────────────────

  it("re-hydrates an imported alias with a freshly minted URL after a reload (second createApp)", async () => {
    const app1 = createAssetStoreApp();
    await app1.start();
    const first = await app1["asset-store"].import(pngBlob, {
      name: "sprite.png",
      alias: "sprite-1"
    });
    await app1.stop(); // revokes the first session's URL, closes the connection

    // A fresh createApp — same globalThis.indexedDB (the fake IDB's records persist on "disk").
    const app2 = createAssetStoreApp();
    await app2.start();

    expect(app2["asset-store"].has("sprite-1")).toBe(true);
    const rehydratedUrl = app2["asset-store"].url("sprite-1");
    expect(rehydratedUrl).toMatch(/^blob:/);
    expect(rehydratedUrl).not.toBe(first.url); // re-minted, not reused across the reload
    await expect(app2["asset-store"].get("sprite-1")).resolves.toEqual(pngBlob);

    await app2.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // remove
  // ──────────────────────────────────────────────────────────────────────────

  it("remove clears the alias — url/has/entries no longer report it", async () => {
    const app = createAssetStoreApp();
    await app.start();

    const asset = await app["asset-store"].import(pngBlob, {
      name: "sprite.png",
      alias: "sprite-1"
    });
    await app["asset-store"].remove("sprite-1");

    expect(app["asset-store"].has("sprite-1")).toBe(false);
    expect(app["asset-store"].url("sprite-1")).toBeUndefined();
    expect(app["asset-store"].entries()).toEqual([]);
    expect(mockUrl.revoked).toContain(asset.url);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // stop() revokes every minted URL
  // ──────────────────────────────────────────────────────────────────────────

  it("stop() revokes every URL minted this session", async () => {
    const app = createAssetStoreApp();
    await app.start();

    const first = await app["asset-store"].import(pngBlob, { name: "a.png", alias: "a" });
    const second = await app["asset-store"].import(pngBlob, { name: "b.png", alias: "b" });

    await app.stop();

    expect(mockUrl.revoked).toContain(first.url);
    expect(mockUrl.revoked).toContain(second.url);
  });
});
