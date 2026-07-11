/**
 * @file storage plugin — the default persistence backend (internal).
 *
 * Ships the safe-by-construction default: a `localStorage`-backed
 * {@link StorageBackend} when web storage is usable, else an in-memory `Map`
 * fallback — so a partitioned iframe, private mode, quota-full, or headless
 * runtime never crashes the game on a save (issue #5 acceptance).
 *
 * The DOM `lib` is intentionally absent from this project's tsconfig, so
 * `localStorage` is declared **structurally** as {@link WebStorageLike} and
 * probed behind a guard (mirroring how `audio` declares structural WebAudio
 * types) — keeping the shipped `.d.ts` free of ambient DOM dependencies. The
 * `getItem` contract returns `string | null` to mirror the Web Storage API so a
 * localStorage-shaped backend is drop-in (`unicorn/no-null` is scoped off for
 * this plugin in the ESLint config for exactly this reason).
 */
import type { StorageBackend } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural Web Storage surface (DOM lib is intentionally absent)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal structural view of the Web Storage API (`localStorage`), exposing only
 * the members the default backend reads. Declared here rather than pulled from
 * the DOM `lib` so the emitted `.d.ts` stays DOM-ambient-free.
 */
export type WebStorageLike = {
  /** Read a stored string by key, or `null` if absent. */
  getItem(key: string): string | null;
  /** Write a string by key (may throw `QuotaExceededError`). */
  setItem(key: string, value: string): void;
  /** Remove a key. */
  removeItem(key: string): void;
  /** The key at the given index (for enumeration), or `null` past the end. */
  key(index: number): string | null;
  /** The number of stored keys. */
  readonly length: number;
};

/** Structural view of `globalThis` exposing the optional `localStorage`. */
type GlobalWithStorage = {
  /** The Web Storage instance, absent (or access-throwing) in some runtimes. */
  localStorage?: WebStorageLike;
};

/** Reserved key the probe writes + removes to prove `localStorage` is usable. */
const PROBE_KEY = "__moku_storage_probe__";

// ─────────────────────────────────────────────────────────────────────────────
// Probe + concrete backends
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a usable `localStorage` from `globalThis`, or `undefined`.
 *
 * The property access itself can throw (partitioned iframe / blocked cookies),
 * and a present store can still reject writes, so the whole probe — access plus a
 * real write/remove round-trip — runs inside one guard.
 *
 * @returns The `WebStorageLike` when it accepts a round-trip, else `undefined`.
 * @example
 * ```ts
 * const storage = probeWebStorage();
 * const backend = storage ? createWebStorageBackend(storage) : createMemoryBackend();
 * ```
 */
export const probeWebStorage = (): WebStorageLike | undefined => {
  try {
    const candidate = (globalThis as GlobalWithStorage).localStorage;
    if (!candidate) return undefined;

    candidate.setItem(PROBE_KEY, PROBE_KEY);
    candidate.removeItem(PROBE_KEY);
    return candidate;
  } catch {
    // Access threw or the store rejects writes → treat as unavailable.
    return undefined;
  }
};

/**
 * Build a persistent {@link StorageBackend} over a usable `localStorage`. Every
 * method is wrapped so a later failure (quota on `setItem`, a blocked read)
 * degrades gracefully instead of throwing.
 *
 * @param storage - The probed, usable `localStorage`.
 * @returns A persistent backend (`persistent: true`).
 * @example
 * ```ts
 * const backend = createWebStorageBackend(globalThis.localStorage);
 * backend.setItem("game:score", "10"); // → true, or false if quota-full
 * ```
 */
export const createWebStorageBackend = (storage: WebStorageLike): StorageBackend => ({
  persistent: true,

  /**
   * Read a raw string, degrading a blocked read to `null`.
   *
   * @param key - The fully-namespaced key.
   * @returns The stored string, or `null`.
   * @example
   * ```ts
   * backend.getItem("game:score"); // "10" | null
   * ```
   */
  getItem(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      // A blocked read degrades to "absent" rather than throwing.
      return null;
    }
  },

  /**
   * Write a raw string, reporting a rejected write (quota / blocked) as `false`.
   *
   * @param key - The fully-namespaced key.
   * @param value - The raw string to persist.
   * @returns `true` on success, `false` otherwise.
   * @example
   * ```ts
   * backend.setItem("game:score", "10"); // true | false (quota)
   * ```
   */
  setItem(key: string, value: string): boolean {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      // Quota exceeded / blocked → report failure; never throw.
      return false;
    }
  },

  /**
   * Remove a raw key (best-effort — a blocked delete is swallowed).
   *
   * @param key - The fully-namespaced key to remove.
   * @example
   * ```ts
   * backend.removeItem("game:score");
   * ```
   */
  removeItem(key: string): void {
    try {
      storage.removeItem(key);
    } catch {
      // Best-effort removal — never throw.
    }
  },

  /**
   * List the stored full keys beginning with `prefix`, degrading to `[]`.
   *
   * @param prefix - The `${namespace}:` prefix to filter by.
   * @returns The matching full keys, or `[]` when enumeration is blocked.
   * @example
   * ```ts
   * backend.keys("game:"); // ["game:score", "game:name"]
   * ```
   */
  keys(prefix: string): string[] {
    try {
      const matches: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) matches.push(key);
      }
      return matches;
    } catch {
      // Enumeration blocked → report an empty namespace rather than throwing.
      return [];
    }
  }
});

/**
 * Build the in-memory fallback {@link StorageBackend} — a plain `Map`. Used when
 * `localStorage` is partitioned, blocked, or absent. Writes always succeed (and
 * are lost when the app instance is garbage-collected), so `persistent` is
 * `false`.
 *
 * @returns A non-persistent, always-succeeding backend (`persistent: false`).
 * @example
 * ```ts
 * const backend = createMemoryBackend();
 * backend.setItem("game:score", "10"); // → true (cached in the Map)
 * ```
 */
export const createMemoryBackend = (): StorageBackend => {
  const store = new Map<string, string>();

  return {
    persistent: false,

    /**
     * Read a value from the Map.
     *
     * @param key - The fully-namespaced key.
     * @returns The stored string, or `null` if absent.
     * @example
     * ```ts
     * backend.getItem("game:score"); // "10" | null
     * ```
     */
    getItem(key: string): string | null {
      const value = store.get(key);
      return value === undefined ? null : value;
    },

    /**
     * Write a value into the Map (always succeeds).
     *
     * @param key - The fully-namespaced key.
     * @param value - The raw string to cache.
     * @returns Always `true`.
     * @example
     * ```ts
     * backend.setItem("game:score", "10"); // true
     * ```
     */
    setItem(key: string, value: string): boolean {
      store.set(key, value);
      return true;
    },

    /**
     * Delete a key from the Map.
     *
     * @param key - The fully-namespaced key to remove.
     * @example
     * ```ts
     * backend.removeItem("game:score");
     * ```
     */
    removeItem(key: string): void {
      store.delete(key);
    },

    /**
     * List the Map's keys beginning with `prefix`.
     *
     * @param prefix - The `${namespace}:` prefix to filter by.
     * @returns The matching full keys.
     * @example
     * ```ts
     * backend.keys("game:"); // ["game:score"]
     * ```
     */
    keys(prefix: string): string[] {
      return [...store.keys()].filter(key => key.startsWith(prefix));
    }
  };
};

/**
 * Build the safe default backend: a `localStorage`-backed backend when web
 * storage is usable, else the in-memory fallback. Created in `createState` (which
 * has no logger); the degraded-mode notice is emitted lazily by the API on first
 * access via `state.backend.persistent`.
 *
 * @returns The persistent web-storage backend, or the in-memory fallback.
 * @example
 * ```ts
 * const backend = createDefaultBackend();
 * backend.persistent; // true under localStorage, false on the in-memory fallback
 * ```
 */
export const createDefaultBackend = (): StorageBackend => {
  const storage = probeWebStorage();
  return storage ? createWebStorageBackend(storage) : createMemoryBackend();
};
