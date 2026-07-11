/**
 * @file storage plugin — the versioned-schema migration runner (internal).
 *
 * Runs **lazily on first access** (once, memoized by `state.migrated`) rather
 * than at a lifecycle hook — so the chain targets whichever backend is active at
 * first read, including one the `platform` plugin injects via `setBackend()`
 * after storage starts (see the plugin's IoC-seam design decision).
 *
 * The stored schema version lives under a reserved meta key ({@link META_KEY}).
 * On upgrade the whole namespace is read into a {@link Snapshot}, passed through
 * `migrations[storedVersion + 1 .. version]` in order, written back, and
 * re-stamped. A fresh store is stamped with no migration; a store already at the
 * target is untouched; a store newer than the app is left intact with a warning.
 */
import type { Log, Migration, Snapshot, StorageBackend } from "./types";

/**
 * Reserved, un-prefixed key holding the stored schema version (JSON number).
 * Stored as `${namespace}:${META_KEY}`; excluded from `keys()` and from the
 * migration {@link Snapshot}.
 */
export const META_KEY = "__moku_schema__";

/**
 * Read the stored schema version from the meta key.
 *
 * @param backend - The active backend.
 * @param metaKey - The fully-namespaced meta key.
 * @returns The stored version, or `undefined` when absent / unparseable (a fresh store).
 * @example
 * ```ts
 * const stored = readStoredVersion(backend, "game:__moku_schema__"); // 1 | undefined
 * ```
 */
const readStoredVersion = (backend: StorageBackend, metaKey: string): number | undefined => {
  const raw = backend.getItem(metaKey);
  if (raw === null) return undefined;

  const parsed = safeParse(raw);
  return typeof parsed === "number" ? parsed : undefined;
};

/**
 * JSON-parse a raw string, returning `undefined` instead of throwing on bad JSON.
 *
 * @param raw - The raw stored string.
 * @returns The parsed value, or `undefined` when the string is not valid JSON.
 * @example
 * ```ts
 * safeParse('{"n":1}'); // → { n: 1 }
 * safeParse("nope");    // → undefined
 * ```
 */
const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt entry → treat as absent rather than throwing.
    return undefined;
  }
};

/**
 * Read every namespaced data entry (JSON-parsed) into a snapshot, excluding the
 * reserved meta key.
 *
 * @param backend - The active backend.
 * @param prefix - The `${namespace}:` prefix.
 * @returns The un-prefixed key → parsed value snapshot.
 * @example
 * ```ts
 * readSnapshot(backend, "game:"); // → { score: 10, name: "ada" }
 * ```
 */
const readSnapshot = (backend: StorageBackend, prefix: string): Snapshot => {
  const snapshot: Snapshot = {};

  for (const fullKey of backend.keys(prefix)) {
    const key = fullKey.slice(prefix.length);
    if (key === META_KEY) continue; // the version stamp is not user data

    const raw = backend.getItem(fullKey);
    if (raw !== null) snapshot[key] = safeParse(raw);
  }

  return snapshot;
};

/**
 * Persist a migrated snapshot back under the namespace prefix: drop any
 * pre-migration data key the new snapshot no longer contains (renames /
 * deletions), then write each entry.
 *
 * @param backend - The active backend.
 * @param prefix - The `${namespace}:` prefix.
 * @param snapshot - The migrated snapshot to persist.
 * @example
 * ```ts
 * writeSnapshot(backend, "game:", { score: 22 });
 * ```
 */
const writeSnapshot = (backend: StorageBackend, prefix: string, snapshot: Snapshot): void => {
  // Remove data keys the migration dropped, so renames/deletions don't linger.
  for (const fullKey of backend.keys(prefix)) {
    const key = fullKey.slice(prefix.length);
    if (key === META_KEY) continue;
    if (!(key in snapshot)) backend.removeItem(fullKey);
  }

  // Write the migrated snapshot back under the namespace prefix.
  for (const [key, value] of Object.entries(snapshot)) {
    backend.setItem(prefix + key, JSON.stringify(value));
  }
};

/**
 * Run the lazy schema migration for a namespace against the active backend.
 *
 * Behaviour by stored version:
 * - **absent (fresh store):** stamp the meta key at `version`; run no migrations.
 * - **equal to `version`:** no-op (no migration functions called).
 * - **below `version`:** apply `migrations[storedVersion + 1 .. version]` in order
 *   over the whole-namespace snapshot, write it back, and re-stamp the version.
 * - **above `version` (downgrade):** warn via `log` and leave the data untouched.
 *
 * Missing migration functions in the chain are skipped (not an error). This
 * mutates the backend but is otherwise pure; the caller memoizes via
 * `state.migrated`.
 *
 * @param backend - The active persistence backend.
 * @param namespace - The key namespace (source of the `${namespace}:` prefix).
 * @param version - The target schema version from config.
 * @param migrations - The migration chain (target-version → snapshot transform).
 * @param log - Logger for the downgrade warning.
 * @example
 * ```ts
 * runMigrations(state.backend, "game", 2, { 2: (s) => ({ ...s, coins: 0 }) }, ctx.log);
 * ```
 */
export const runMigrations = (
  backend: StorageBackend,
  namespace: string,
  version: number,
  migrations: Readonly<Record<number, Migration>>,
  log: Log
): void => {
  const prefix = `${namespace}:`;
  const metaKey = prefix + META_KEY;
  const storedVersion = readStoredVersion(backend, metaKey);

  // Fresh store: stamp the current version; there is nothing to migrate.
  if (storedVersion === undefined) {
    backend.setItem(metaKey, JSON.stringify(version));
    return;
  }

  // Already current: nothing to do (no migration functions run).
  if (storedVersion === version) return;

  // Downgrade: the store is newer than this build — never mutate, just warn.
  if (storedVersion > version) {
    log.warn(
      `[storage] stored schema v${storedVersion} is newer than app v${version}; leaving saved data untouched.`
    );
    return;
  }

  // Upgrade: fold each step's transform over the snapshot, then persist + stamp.
  let snapshot = readSnapshot(backend, prefix);
  for (let target = storedVersion + 1; target <= version; target++) {
    const migrate = migrations[target];
    if (migrate) snapshot = migrate(snapshot);
  }

  writeSnapshot(backend, prefix, snapshot);
  backend.setItem(metaKey, JSON.stringify(version));
};
