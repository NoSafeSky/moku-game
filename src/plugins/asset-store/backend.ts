/**
 * @file asset-store plugin — the default IndexedDB-or-memory AssetBackend.
 *
 * Wraps IndexedDB behind the async AssetBackend seam and falls back to an in-memory Map when
 * IndexedDB is absent/blocked (SSR/tests/partitioned iframes) — never throws. DOM globals
 * (indexedDB, Blob, URL) are typed STRUCTURALLY here (no DOM lib), mirroring storage's WebStorageLike.
 *
 * Skeleton: `createDefaultBackend` returns an inert backend whose methods throw until invoked —
 * they are never called during composition (createState only stores the reference; onStart is a
 * no-op in the skeleton). The F1 build wave replaces this with the real implementation.
 */
import type { AssetBackend, Config } from "./types";

/**
 * Placeholder backend operation — throws until the F1 build wave implements it.
 *
 * @throws {Error} Always, until implemented.
 * @example
 * ```ts
 * notImplemented();
 * ```
 */
const notImplemented = (): never => {
  throw new Error("not implemented");
};

/**
 * Creates the default IndexedDB-or-memory backend from config (inert skeleton).
 *
 * @param _config - Resolved plugin configuration (dbName / storeName).
 * @returns An AssetBackend whose async operations throw until the F1 build wave implements them.
 * @example
 * ```ts
 * const backend = createDefaultBackend({ dbName: "moku-assets", storeName: "assets", accept: ["image/"] });
 * ```
 */
export function createDefaultBackend(_config: Readonly<Config>): AssetBackend {
  return {
    open: notImplemented,
    put: notImplemented,
    get: notImplemented,
    delete: notImplemented,
    list: notImplemented,
    close: notImplemented,
    persistent: false
  };
}
