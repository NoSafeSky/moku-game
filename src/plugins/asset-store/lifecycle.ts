/**
 * @file asset-store plugin — onStart / onStop lifecycle handlers.
 *
 * `onStart` (`PluginContext`: has `state`) opens the backend, re-hydrates the session `blob:` URL
 * + metadata maps from every persisted record (so imported aliases survive a reload — the durable
 * side is the IndexedDB blob; only the ephemeral URL is re-minted here), and registers the live
 * `urls` map + `backend` in the module {@link assetStoreRegistry} WeakMap keyed on `ctx.global` —
 * because `onStop` only receives `TeardownContext` (`{ global }`, no `state`), mirroring the
 * `audio` plugin's engine-registry pattern (a confirmed kernel constraint the plugin spec's
 * "State-based onStop" prose does not account for).
 *
 * `onStop` (`TeardownContext`: `{ global }` only) reads the registered `state` via `ctx.global`; a
 * missing handle (no prior start, or a repeat call) is a safe no-op. Otherwise it revokes every
 * minted URL, clears the `urls` + `meta` maps, closes the backend connection, resets `ready` to
 * `false`, and deletes the WeakMap entry — idempotent.
 */
import type { State, StoredRecord } from "./types";
import { mintObjectUrl, revokeObjectUrl } from "./url";

// ─────────────────────────────────────────────────────────────────────────────
// Context types (structural — only fields actually accessed)
// ─────────────────────────────────────────────────────────────────────────────

/** Shared minimal logger surface (from `logPlugin`) used by the degraded-mode notice. */
export type Log = {
  /** Log at debug level (the degraded-mode / no-IndexedDB notice). */
  debug(message: string): void;
};

/** Context available in `onStart` (`PluginContext`, subset used here). */
type StartContext = {
  /** asset-store plugin state — backend, urls/meta maps, ready flag. */
  readonly state: State;
  /** Global plugin registry — key for the {@link assetStoreRegistry} WeakMap. */
  readonly global: object;
  /** Logger from logPlugin. */
  readonly log: Log;
};

/** Context available in `onStop` (`TeardownContext` — global only). */
type StopContext = {
  /** Global plugin registry — key for the {@link assetStoreRegistry} WeakMap. */
  readonly global: object;
};

/**
 * Module-level WeakMap mapping each app's global registry to its live plugin {@link State}.
 * `onStop` reaches the live `urls`/`meta` maps, the open `backend`, and the `ready` flag through
 * here because `TeardownContext` exposes only `{ global }` — no `state` (mirrors the `audio`
 * plugin's `audioRegistry`).
 */
export const assetStoreRegistry = new WeakMap<object, State>();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Project a persisted record into the cached metadata triple `entries()` reads.
 *
 * @param record - The persisted record read back from the backend.
 * @returns The metadata cached in `state.meta`.
 * @example
 * ```ts
 * toMeta(record); // { name: "sprite.png", mime: "image/png", byteLength: 2048 }
 * ```
 */
const toMeta = (record: StoredRecord): { name: string; mime: string; byteLength: number } => ({
  name: record.name,
  mime: record.mime,
  byteLength: record.blob.size
});

// ─────────────────────────────────────────────────────────────────────────────
// onStart
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the backend and re-mints session `blob:` URLs for every persisted asset, so imported
 * aliases resolve immediately after a reload. Logs a debug line when no persistent backend was
 * available (in-memory fallback this session) and continues with the (empty) maps. Registers the
 * live plugin `state` in {@link assetStoreRegistry} so `onStop` can reach its urls/meta maps,
 * backend, and ready flag.
 *
 * @param ctx - Plugin context (state, global, log).
 * @returns A Promise that resolves once the backend is open and the maps are hydrated.
 * @example
 * ```ts
 * await start(ctx);
 * ```
 */
export const start = async (ctx: StartContext): Promise<void> => {
  const opened = await ctx.state.backend.open();
  if (!opened) {
    ctx.log.debug(
      "[asset-store] IndexedDB unavailable — imported assets are in-memory only this session."
    );
  }

  const records = await ctx.state.backend.list();
  for (const record of records) {
    const url = mintObjectUrl(record.blob);
    if (url !== undefined) ctx.state.urls.set(record.alias, url);
    ctx.state.meta.set(record.alias, toMeta(record));
  }

  ctx.state.ready = true;
  assetStoreRegistry.set(ctx.global, ctx.state);
};

// ─────────────────────────────────────────────────────────────────────────────
// onStop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revokes every minted `blob:` URL, clears the session `urls` + `meta` maps, closes the backend
 * connection, and resets `ready` to `false`. Reads the live plugin state from
 * {@link assetStoreRegistry} via `ctx.global` because `onStop` only receives `TeardownContext`
 * (`{ global }`). A missing entry (no prior start, or a repeat call) is a safe no-op — idempotent.
 *
 * @param ctx - Teardown context providing only the global registry.
 * @example
 * ```ts
 * stop(ctx);
 * ```
 */
export const stop = (ctx: StopContext): void => {
  const state = assetStoreRegistry.get(ctx.global);
  if (!state) return;

  for (const url of state.urls.values()) revokeObjectUrl(url);
  state.urls.clear();
  state.meta.clear();
  state.backend.close();
  state.ready = false;
  assetStoreRegistry.delete(ctx.global);
};
