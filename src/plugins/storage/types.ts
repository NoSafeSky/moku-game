/**
 * @file storage plugin — type definitions.
 *
 * The public plugin contract (Config, State, Api) plus the three exported domain
 * types the migration chain and the future `platform` plugin build against —
 * {@link StorageBackend} (the synchronous persistence seam), {@link Migration}
 * (a whole-namespace snapshot transform), and {@link Snapshot} (the value a
 * migration receives and returns).
 *
 * The DOM `lib` is intentionally absent from this project's tsconfig, so
 * `localStorage` is typed structurally as a `WebStorageLike` in `backend.ts`
 * (mirroring how `audio` declares structural WebAudio types) — the shipped
 * `.d.ts` therefore has no ambient DOM dependency.
 */

/** Shared minimal logger surface (from `logPlugin`) used by the storage domain files. */
export type Log = {
  /** Log at debug level (the degraded-mode in-memory-fallback notice). */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning (a stored schema newer than the app — no downgrade). */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/**
 * The whole-namespace snapshot a {@link Migration} transforms: un-prefixed key →
 * parsed value. Built by reading every namespaced entry (JSON-parsed), excluding
 * the reserved schema-version meta key.
 */
export type Snapshot = Record<string, unknown>;

/**
 * Upgrades a namespace {@link Snapshot} from the previous schema version to the
 * next. Pure — returns the new snapshot; adding, renaming, or dropping keys is
 * the migration's responsibility. `migrations[n]` upgrades a `v(n-1)` snapshot to
 * `vn`.
 */
export type Migration = (snapshot: Snapshot) => Snapshot;

/**
 * Synchronous key/value persistence seam. Keys passed here are already
 * namespaced (`${namespace}:${key}`). Implementations **MUST NOT throw** — the
 * default backend wraps `localStorage` in try/catch and falls back to an
 * in-memory `Map`; the future `platform` plugin implements this over the
 * CrazyGames data API (async I/O bridged behind this sync facade).
 */
export type StorageBackend = {
  /**
   * Read a raw string by (already-namespaced) key.
   *
   * @param key - The fully-namespaced key.
   * @returns The stored string, or `null` if absent.
   */
  getItem(key: string): string | null;
  /**
   * Write a raw string by (already-namespaced) key.
   *
   * @param key - The fully-namespaced key.
   * @param value - The raw string to persist.
   * @returns `true` on success, `false` if the write failed (quota / blocked). Never throws.
   */
  setItem(key: string, value: string): boolean;
  /**
   * Remove a single (already-namespaced) key. No-op if absent.
   *
   * @param key - The fully-namespaced key to remove.
   */
  removeItem(key: string): void;
  /**
   * List all stored keys that begin with the given `${namespace}:` prefix.
   *
   * @param prefix - The `${namespace}:` prefix to filter by.
   * @returns The matching full keys (prefix included).
   */
  keys(prefix: string): string[];
  /** True if this backend persists across sessions (`false` = in-memory only). */
  readonly persistent: boolean;
};

/**
 * storage plugin configuration. All fields are optional at the `pluginConfigs`
 * boundary (shallow-merged over these defaults: `{ namespace: "game", version: 1,
 * migrations: {} }`).
 */
export type Config = {
  /**
   * Key prefix applied to every entry — stored as `${namespace}:${key}`. Lets
   * multiple games / features share one origin's storage without collision.
   * `@default "game"`
   */
  namespace: string;
  /**
   * Current save-schema version. On first access a stored snapshot at a lower
   * version is upgraded through the migration chain up to this number.
   * `@default 1`
   */
  version: number;
  /**
   * Migration chain: target-version → transform of the whole namespace snapshot.
   * `migrations[n]` upgrades a `v(n-1)` snapshot to `vn`. `@default {}`
   */
  migrations: Readonly<Record<number, Migration>>;
};

/**
 * storage plugin state.
 *
 * The active {@link StorageBackend} lives directly here (not in a `ctx.global`
 * WeakMap like `audio`'s AudioContext) because storage has no lifecycle. The
 * in-memory fallback `Map` is encapsulated inside the default backend object, not
 * exposed on State.
 */
export type State = {
  /**
   * Active persistence backend — the default localStorage-or-memory backend at
   * start, replaced when `platform` calls `setBackend()`.
   */
  backend: StorageBackend;
  /** Namespace prefix from config (source of truth for key construction). */
  readonly namespace: string;
  /** Target schema version from config. */
  readonly version: number;
  /** Migration chain from config (target-version → snapshot transform). */
  readonly migrations: Readonly<Record<number, Migration>>;
  /**
   * True once the migration chain has run against the *current* backend. Guards
   * the one-time lazy migration; reset to `false` by `setBackend()` so a newly
   * injected backend is migrated on its next access.
   */
  migrated: boolean;
};

/** storage plugin API, exposed as `app.storage`. Every method is non-throwing. */
export type Api = {
  /**
   * Read + JSON-parse a value by key. Returns `fallback` (or `undefined` when no
   * fallback is given) if the key is absent, unparseable, or storage is
   * unavailable. Triggers the one-time lazy migration on first call. Never throws.
   *
   * @param key - The un-namespaced key.
   * @param fallback - Value returned when the key is missing / unreadable.
   * @returns The parsed value, or the fallback.
   */
  get<T>(key: string, fallback?: T): T | undefined;
  /**
   * JSON-serialize and write a value by key. On an in-memory fallback the value
   * is still cached (returns `true`). Never throws.
   *
   * @param key - The un-namespaced key.
   * @param value - Any JSON-serializable value.
   * @returns `true` on success; `false` when the backend rejected the write
   *   (quota / blocked) or the value is not JSON-serializable.
   */
  set(key: string, value: unknown): boolean;
  /**
   * Whether the (namespaced) key currently exists.
   *
   * @param key - The un-namespaced key.
   * @returns `true` if present. Never throws.
   */
  has(key: string): boolean;
  /**
   * Remove a single key. No-op if absent. Never throws.
   *
   * @param key - The un-namespaced key to remove.
   */
  remove(key: string): void;
  /**
   * Remove **every** key in this namespace, then re-write the reserved
   * version-stamp so the schema version is preserved. Never throws.
   */
  clear(): void;
  /**
   * List all keys in this namespace, with the `${namespace}:` prefix stripped
   * (the reserved meta key excluded).
   *
   * @returns The un-namespaced keys, or `[]` on failure. Never throws.
   */
  keys(): string[];
  /**
   * Whether a real persistent backend is active. `false` when running on the
   * in-memory fallback (partitioned / blocked storage) or an injected
   * non-persistent backend — lets a game warn "progress won't be saved".
   *
   * @returns `true` when saves persist across sessions.
   */
  isPersistent(): boolean;
  /**
   * The schema version currently in effect (after any lazy migration).
   *
   * @returns The active schema version.
   */
  getVersion(): number;
  /**
   * Inject a custom backend — used by the `platform` plugin to route saves
   * through the CrazyGames data API. Resets `migrated` so the new backend is
   * migrated on the next access. All backend methods MUST be synchronous and
   * non-throwing.
   *
   * @param backend - The replacement {@link StorageBackend}.
   */
  setBackend(backend: StorageBackend): void;
};
