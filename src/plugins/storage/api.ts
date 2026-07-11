/**
 * @file storage plugin — API factory.
 *
 * The public `app.storage` surface: get/set/has/remove/clear/keys +
 * isPersistent/getVersion/setBackend. Values are JSON-serialized under a
 * `${namespace}:${key}` prefix.
 *
 * **Safe by construction.** The default backend already wraps `localStorage`, but
 * `setBackend()` accepts arbitrary implementations, so every backend interaction
 * here is additionally guarded — no method throws, even against a misbehaving
 * backend (issue #5 acceptance: reads/writes never crash the game when storage is
 * unavailable). The versioned-schema migration runs lazily on first access, once
 * (memoized by `state.migrated`), and re-runs after `setBackend()` resets it.
 */
import { META_KEY, runMigrations } from "./migrate";
import type { Api, Log, State, StorageBackend } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type (only the fields the API factory accesses)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context required by {@link createApi}, so unit tests can pass a
 * minimal mock without wiring the full kernel. Mirrors the AudioApiContext /
 * AssetsContext pattern used across this framework. No `emit` (storage declares
 * no events) and no `global` (the backend lives on State, not a WeakMap).
 */
export type StorageApiContext = {
  /** storage plugin state — active backend, namespace/version/migrations, migrated flag. */
  readonly state: State;
  /** Logger from logPlugin (the degraded-mode + downgrade notices). */
  readonly log: Log;
};

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the storage plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.state - The plugin state (backend, namespace/version/migrations, migrated).
 * @param ctx.log - Logger from logPlugin.
 * @returns The storage plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.set("bestHeight", 128);
 * const best = api.get<number>("bestHeight", 0); // 128, or 0 on a fresh/blocked store
 * ```
 */
export const createApi = (ctx: StorageApiContext): Api => {
  const { state } = ctx;
  const prefix = `${state.namespace}:`;

  /**
   * Build the fully-namespaced key for a user key.
   *
   * @param key - The un-namespaced key.
   * @returns The `${namespace}:${key}` form the backend stores under.
   * @example
   * ```ts
   * fullKey("score"); // "game:score"
   * ```
   */
  const fullKey = (key: string): string => prefix + key;

  // ── Defensive backend wrappers (never throw) ──────────────────────────────

  /**
   * Read a raw value, degrading a throwing backend to "absent".
   *
   * @param key - The fully-namespaced key.
   * @returns The raw string, or `null`.
   * @example
   * ```ts
   * readRaw("game:score"); // "10" | null
   * ```
   */
  const readRaw = (key: string): string | null => {
    try {
      return state.backend.getItem(key);
    } catch {
      return null;
    }
  };

  /**
   * Write a raw value, degrading a throwing backend to a failed write.
   *
   * @param key - The fully-namespaced key.
   * @param value - The raw string to persist.
   * @returns `true` on success, `false` otherwise.
   * @example
   * ```ts
   * writeRaw("game:score", "10"); // true | false
   * ```
   */
  const writeRaw = (key: string, value: string): boolean => {
    try {
      return state.backend.setItem(key, value);
    } catch {
      return false;
    }
  };

  /**
   * Remove a raw key; a throwing backend is swallowed (best-effort).
   *
   * @param key - The fully-namespaced key to remove.
   * @example
   * ```ts
   * deleteRaw("game:score");
   * ```
   */
  const deleteRaw = (key: string): void => {
    try {
      state.backend.removeItem(key);
    } catch {
      // Best-effort removal — never throw.
    }
  };

  /**
   * List the namespace's full keys, degrading a throwing backend to `[]`.
   *
   * @returns The matching full keys, or `[]`.
   * @example
   * ```ts
   * listRaw(); // ["game:score", "game:__moku_schema__"]
   * ```
   */
  const listRaw = (): string[] => {
    try {
      return state.backend.keys(prefix);
    } catch {
      return [];
    }
  };

  /**
   * Whether the active backend persists, guarding a throwing `persistent` read.
   *
   * @returns `true` when the backend persists across sessions.
   * @example
   * ```ts
   * persistent(); // false on the in-memory fallback
   * ```
   */
  const persistent = (): boolean => {
    try {
      return state.backend.persistent;
    } catch {
      return false;
    }
  };

  // ── Lazy, once-only migration ─────────────────────────────────────────────

  /**
   * Run the schema migration once, on first access. Emits the degraded-mode
   * notice here (createState has no logger) and guards the runner so a
   * misbehaving injected backend can never crash the first read.
   *
   * @example
   * ```ts
   * ensureMigrated(); // runs at most once per migration cycle
   * ```
   */
  const ensureMigrated = (): void => {
    if (state.migrated) return;

    if (!persistent()) {
      ctx.log.debug(
        "[storage] persistent storage unavailable — using in-memory fallback; progress will not be saved."
      );
    }

    try {
      runMigrations(state.backend, state.namespace, state.version, state.migrations, ctx.log);
    } catch {
      // A misbehaving injected backend must not crash first access.
    }
    state.migrated = true;
  };

  return {
    /**
     * Read + JSON-parse a value by key; returns the fallback when missing or
     * unreadable. Triggers the lazy migration on first call. Never throws.
     *
     * @param key - The un-namespaced key.
     * @param fallback - Value returned when the key is absent / unparseable.
     * @returns The parsed value, or the fallback.
     * @example
     * ```ts
     * const best = app.storage.get<number>("bestHeight", 0);
     * ```
     */
    get<T>(key: string, fallback?: T): T | undefined {
      ensureMigrated();

      const raw = readRaw(fullKey(key));
      if (raw === null) return fallback;

      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback; // unparseable entry → treat as absent, never throw
      }
    },

    /**
     * JSON-serialize and write a value by key. Never throws.
     *
     * @param key - The un-namespaced key.
     * @param value - Any JSON-serializable value.
     * @returns `true` on success; `false` when the write was rejected or the
     *   value is not serializable.
     * @example
     * ```ts
     * app.storage.set("bestHeight", 128);
     * ```
     */
    set(key: string, value: unknown): boolean {
      ensureMigrated();

      const serialized = safeStringify(value);
      if (serialized === undefined) return false; // undefined / function / BigInt / cycle

      return writeRaw(fullKey(key), serialized);
    },

    /**
     * Whether the (namespaced) key currently exists. Never throws.
     *
     * @param key - The un-namespaced key.
     * @returns `true` if present.
     * @example
     * ```ts
     * if (app.storage.has("save")) resume();
     * ```
     */
    has(key: string): boolean {
      ensureMigrated();
      return readRaw(fullKey(key)) !== null;
    },

    /**
     * Remove a single key. No-op if absent. Never throws.
     *
     * @param key - The un-namespaced key to remove.
     * @example
     * ```ts
     * app.storage.remove("save");
     * ```
     */
    remove(key: string): void {
      ensureMigrated();
      deleteRaw(fullKey(key));
    },

    /**
     * Remove every key in this namespace, then re-write the reserved
     * version-stamp so the schema version is preserved. Never throws.
     *
     * @example
     * ```ts
     * app.storage.clear(); // wipe this namespace, keep the schema version
     * ```
     */
    clear(): void {
      // Wipe every namespaced entry (data + the version stamp) …
      for (const key of listRaw()) deleteRaw(key);

      // … then re-stamp the schema version so a cleared store stays current.
      writeRaw(fullKey(META_KEY), JSON.stringify(state.version));
      state.migrated = true;
    },

    /**
     * List all keys in this namespace with the prefix stripped (the reserved
     * meta key excluded). Never throws.
     *
     * @returns The un-namespaced keys, or `[]` on failure.
     * @example
     * ```ts
     * for (const key of app.storage.keys()) console.info(key);
     * ```
     */
    keys(): string[] {
      ensureMigrated();

      return listRaw()
        .map(key => key.slice(prefix.length))
        .filter(key => key !== META_KEY);
    },

    /**
     * Whether a real persistent backend is active (`false` on the in-memory
     * fallback or an injected non-persistent backend).
     *
     * @returns `true` when saves persist across sessions.
     * @example
     * ```ts
     * if (!app.storage.isPersistent()) warnProgressNotSaved();
     * ```
     */
    isPersistent(): boolean {
      return persistent();
    },

    /**
     * The schema version currently in effect (after any lazy migration).
     *
     * @returns The active schema version.
     * @example
     * ```ts
     * const version = app.storage.getVersion();
     * ```
     */
    getVersion(): number {
      ensureMigrated();
      return state.version;
    },

    /**
     * Inject a custom backend (the `platform` plugin's CrazyGames adapter).
     * Resets `migrated` so the new backend is migrated on the next access.
     *
     * @param backend - The replacement {@link StorageBackend}.
     * @example
     * ```ts
     * app.storage.setBackend(crazyGamesBackend);
     * ```
     */
    setBackend(backend: StorageBackend): void {
      state.backend = backend;
      state.migrated = false; // re-migrate against the injected backend on next access
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JSON-serialize a value for storage, reporting failure as `undefined` instead of
 * throwing. `JSON.stringify` returns `undefined` for `undefined` / functions /
 * symbols and throws on circular structures or `BigInt` — all of which map to a
 * failed `set()`.
 *
 * @param value - Any value to serialize.
 * @returns The JSON string, or `undefined` when the value is not serializable.
 * @example
 * ```ts
 * safeStringify({ n: 1 });  // → '{"n":1}'
 * safeStringify(undefined); // → undefined (set() returns false)
 * ```
 */
const safeStringify = (value: unknown): string | undefined => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : serialized;
  } catch {
    // Circular structure / BigInt → report failure via set()'s false.
    return undefined;
  }
};
