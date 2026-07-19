/**
 * asset-store plugin — Standard tier.
 *
 * Persistent, session-safe store for imported binary assets (IndexedDB), exposing stable
 * aliases + session `blob:` URLs. Blobs and URLs are never serialized — only the alias is
 * durable. `onStart` re-mints URLs (reload-survival); `onStop` revokes them + closes the DB.
 * Emits `asset-store:imported` / `asset-store:removed`. No dependencies (foundational). Owns a
 * real resource — an open IndexedDB connection + live object URLs — hence onStart/onStop.
 *
 * @see README.md
 */
import { createPlugin } from "../../config";
import { createApi } from "./api";
import { start, stop } from "./lifecycle";
import { createState } from "./state";
import type { Config, Events } from "./types";

const defaultConfig: Config = {
  dbName: "moku-assets",
  storeName: "assets",
  accept: ["image/"]
};

/**
 * asset-store plugin instance — Standard tier.
 *
 * Foundational (no dependencies). The one editor-subsystem plugin that owns a real resource —
 * an open IndexedDB connection + live object URLs — so it defines `onStart`/`onStop`. The F2
 * `graphics-2d` delta depends on it (`store.url(alias)` in its texture resolver), so this plugin
 * MUST register before `graphics2dPlugin` in `src/index.ts`.
 *
 * @see README.md
 */
export const assetStorePlugin = createPlugin("asset-store", {
  config: defaultConfig,
  /**
   * Declares this plugin's events so they are typed on `ctx.emit`.
   *
   * @param register - The framework event registrar.
   * @returns The registered event descriptor map.
   * @example
   * ```ts
   * events: (register) => register.map<Events>({ "asset-store:imported": "…" });
   * ```
   */
  events: register =>
    register.map<Events>({
      "asset-store:imported": "Fired when an imported asset is persisted and a blob URL minted",
      "asset-store:removed": "Fired when a stored asset is removed and its blob URL revoked"
    }),
  createState,
  /**
   * Builds the plugin API, forwarding the plugin context so declared events infer on `ctx.emit`.
   *
   * @param ctx - The plugin context.
   * @returns The plugin API surface.
   * @example
   * ```ts
   * api: (ctx) => createApi(ctx);
   * ```
   */
  api: ctx => createApi(ctx), // inline lambda so declared events infer into ctx.emit
  onStart: start, // opens the IndexedDB backend + re-mints blob: URLs (real resource)
  onStop: stop // revokes minted URLs + closes the DB connection
});

export type { AssetBackend, BlobLike, ImportOptions, StoredAsset } from "./types";
