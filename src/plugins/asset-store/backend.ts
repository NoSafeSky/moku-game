/**
 * @file asset-store plugin — the default IndexedDB-or-memory AssetBackend.
 *
 * Wraps IndexedDB behind the async {@link AssetBackend} seam and falls back to an in-memory `Map`
 * when IndexedDB is absent/blocked (SSR/tests/partitioned iframes/quota) — never throws. DOM
 * globals (`indexedDB`) are typed STRUCTURALLY here (no DOM lib), mirroring `storage`'s
 * `WebStorageLike`. Every request is driven through `addEventListener("success" | "error" | …)` —
 * the real, idiomatic `EventTarget` surface `IDBRequest`/`IDBOpenDBRequest` expose — rather than
 * the single-slot `onsuccess`/`onerror` property style. `createDefaultBackend` probes
 * `globalThis.indexedDB`: when absent, it returns the memory backend directly; when present, it
 * returns a **self-healing** wrapper whose `open()` attempts a real IndexedDB connection and, on
 * any failure, swaps itself to delegate every method to the in-memory fallback for the rest of the
 * session — so `persistent` only reports `true` once a real connection is actually open.
 */
import type { AssetBackend, Config, StoredRecord } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Structural IndexedDB surface (DOM lib is intentionally absent)
// ─────────────────────────────────────────────────────────────────────────────

/** A pending IndexedDB request (structural mirror of `IDBRequest`'s `EventTarget` surface). */
export type IdbRequestLike<T> = {
  /** The request's result once a `"success"` listener fires. */
  result: T;
  /** The request's error once an `"error"` listener fires. */
  error: unknown;
  /** Register a `"success"` / `"error"` listener (mirrors `EventTarget#addEventListener`). */
  addEventListener(type: "success" | "error", listener: () => void): void;
};

/** A pending "open" request — adds the schema-upgrade event (mirrors `IDBOpenDBRequest`). */
export type IdbOpenRequestLike = {
  /** The open connection once a `"success"` listener fires. */
  result: IdbDatabaseLike;
  /** The request's error once an `"error"` listener fires. */
  error: unknown;
  /** Register a `"success"` / `"error"` / `"upgradeneeded"` listener. */
  addEventListener(type: "success" | "error" | "upgradeneeded", listener: () => void): void;
};

/** One object store within a transaction (mirrors `IDBObjectStore`; `put`/`get`/`delete`/`getAll` only). */
export type IdbObjectStoreLike = {
  /** Write (insert or overwrite) a record keyed by its `alias`. */
  put(record: StoredRecord): IdbRequestLike<unknown>;
  /** Read one record by alias. */
  get(alias: string): IdbRequestLike<StoredRecord | undefined>;
  /** Delete one record by alias (no-op if absent). */
  delete(alias: string): IdbRequestLike<unknown>;
  /** Read every record in the store. */
  getAll(): IdbRequestLike<StoredRecord[]>;
};

/** A read/write transaction over one object store (mirrors `IDBTransaction`). */
export type IdbTransactionLike = {
  /** Open the named object store within this transaction. */
  objectStore(name: string): IdbObjectStoreLike;
};

/** An open database connection (mirrors `IDBDatabase`, the minimal surface used here). */
export type IdbDatabaseLike = {
  /** The set of existing object-store names. */
  readonly objectStoreNames: { contains(name: string): boolean };
  /** Create a new object store (only valid inside the `"upgradeneeded"` listener). */
  createObjectStore(name: string, options?: { keyPath?: string }): IdbObjectStoreLike;
  /** Open a transaction over the named object store. */
  transaction(storeName: string, mode: "readonly" | "readwrite"): IdbTransactionLike;
  /** Close the connection. */
  close(): void;
};

/** The global `indexedDB` factory (mirrors `IDBFactory`; `open` only). */
export type IdbFactoryLike = {
  /** Open (creating if absent) the named database. */
  open(name: string, version?: number): IdbOpenRequestLike;
};

/** Structural view of `globalThis` exposing the optional `indexedDB` factory. */
type GlobalWithIdb = {
  /** The IndexedDB factory, absent in some runtimes (SSR / tests / partitioned iframes). */
  indexedDB?: IdbFactoryLike;
};

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `globalThis.indexedDB`, guarding the property access itself (some sandboxed runtimes
 * throw on the read, not just omit it).
 *
 * @returns The `IdbFactoryLike` factory, or `undefined` when unavailable.
 * @example
 * ```ts
 * const idb = probeIdb();
 * const backend = idb ? createIdbOrMemoryBackend(idb, config) : createMemoryBackend();
 * ```
 */
export const probeIdb = (): IdbFactoryLike | undefined => {
  try {
    return (globalThis as GlobalWithIdb).indexedDB;
  } catch {
    return undefined;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Request → Promise helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the error a rejected request/open call reports, preferring the request's own `error` when
 * it is already an `Error`.
 *
 * @param error - The request's `error` field at the time `"error"` fired.
 * @param fallbackMessage - The message to use when `error` is not already an `Error`.
 * @returns An `Error` suitable for `Promise` rejection.
 * @example
 * ```ts
 * reject(toRequestError(request.error, "[asset-store] indexedDB request failed."));
 * ```
 */
const toRequestError = (error: unknown, fallbackMessage: string): Error =>
  error instanceof Error ? error : new Error(fallbackMessage);

/**
 * Wrap a pending IndexedDB request in a Promise, resolving on `"success"` and rejecting on
 * `"error"`.
 *
 * @param request - The pending request.
 * @returns A Promise settling with the request's outcome.
 * @example
 * ```ts
 * await promisifyRequest(objectStore.put(record));
 * ```
 */
const promisifyRequest = <T>(request: IdbRequestLike<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(toRequestError(request.error, "[asset-store] indexedDB request failed."));
    });
  });

/**
 * Open (creating the object store on first use) the named database, resolving the live
 * `IdbDatabaseLike` connection.
 *
 * @param idb - The `IdbFactoryLike` factory.
 * @param dbName - The database name.
 * @param storeName - The single object store this plugin uses (keyed by `alias`).
 * @returns A Promise resolving the open database connection.
 * @example
 * ```ts
 * const db = await openDatabase(idb, "moku-assets", "assets");
 * ```
 */
const openDatabase = (
  idb: IdbFactoryLike,
  dbName: string,
  storeName: string
): Promise<IdbDatabaseLike> =>
  new Promise((resolve, reject) => {
    try {
      const request = idb.open(dbName, 1);
      request.addEventListener("upgradeneeded", () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName))
          db.createObjectStore(storeName, { keyPath: "alias" });
      });
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => {
        reject(toRequestError(request.error, "[asset-store] indexedDB open failed."));
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("[asset-store] indexedDB open failed."));
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Concrete backends
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the in-memory fallback {@link AssetBackend} — a plain `Map` keyed by alias. Used when
 * IndexedDB is absent, blocked, or a real connection later fails. Every write always succeeds (and
 * is lost when the app instance is garbage-collected), so `persistent` is `false`.
 *
 * @returns A non-persistent, always-succeeding backend (`persistent: false`).
 * @example
 * ```ts
 * const backend = createMemoryBackend();
 * await backend.put({ alias: "a", name: "a.png", mime: "image/png", blob }); // → true
 * ```
 */
export const createMemoryBackend = (): AssetBackend => {
  const records = new Map<string, StoredRecord>();

  return {
    persistent: false,
    /**
     * Reports no real connection — this backend IS the fallback.
     *
     * @returns Always `false`.
     * @example
     * ```ts
     * await backend.open(); // false — the memory fallback owns no real connection
     * ```
     */
    async open(): Promise<boolean> {
      return false;
    },
    /**
     * Insert or overwrite a record, keyed by its alias. Always succeeds.
     *
     * @param record - The record to persist.
     * @returns Always `true`.
     * @example
     * ```ts
     * await backend.put({ alias: "a", name: "a.png", mime: "image/png", blob }); // true
     * ```
     */
    async put(record: StoredRecord): Promise<boolean> {
      records.set(record.alias, record);
      return true;
    },
    /**
     * Read one record by alias.
     *
     * @param alias - The alias to read.
     * @returns The record, or `undefined` if absent.
     * @example
     * ```ts
     * const record = await backend.get("sprite-1");
     * ```
     */
    async get(alias: string): Promise<StoredRecord | undefined> {
      return records.get(alias);
    },
    /**
     * Delete one record by alias (no-op if absent).
     *
     * @param alias - The alias to delete.
     * @example
     * ```ts
     * await backend.delete("sprite-1");
     * ```
     */
    async delete(alias: string): Promise<void> {
      records.delete(alias);
    },
    /**
     * Read every persisted record.
     *
     * @returns Every record currently in the Map.
     * @example
     * ```ts
     * const all = await backend.list();
     * ```
     */
    async list(): Promise<readonly StoredRecord[]> {
      return [...records.values()];
    },
    /**
     * Close the connection — a no-op for the in-memory Map (nothing to release).
     *
     * @example
     * ```ts
     * backend.close();
     * ```
     */
    close(): void {
      // No-op — nothing to release for an in-memory Map.
    }
  };
};

/**
 * Build a real, already-open IndexedDB-backed {@link AssetBackend} over a live connection. Every
 * operation is wrapped in try/catch so a mid-session failure (quota, blocked transaction) degrades
 * to the method's safe default instead of throwing/rejecting.
 *
 * @param db - The open database connection.
 * @param storeName - The object store this plugin uses (keyed by `alias`).
 * @returns A persistent backend (`persistent: true`) delegating to the open connection.
 * @example
 * ```ts
 * const db = await openDatabase(idb, "moku-assets", "assets");
 * const backend = createOpenIdbBackend(db, "assets");
 * ```
 */
const createOpenIdbBackend = (db: IdbDatabaseLike, storeName: string): AssetBackend => ({
  persistent: true,
  /**
   * Reports the connection is already open — a repeat call is a safe success.
   *
   * @returns Always `true`.
   * @example
   * ```ts
   * await backend.open(); // true — the connection is already open
   * ```
   */
  async open(): Promise<boolean> {
    return true;
  },
  /**
   * Insert or overwrite a record via a `readwrite` transaction.
   *
   * @param record - The record to persist.
   * @returns `true` on success, `false` on a rejected write (quota/blocked) — never throws.
   * @example
   * ```ts
   * const ok = await backend.put(record);
   * ```
   */
  async put(record: StoredRecord): Promise<boolean> {
    try {
      await promisifyRequest(
        db.transaction(storeName, "readwrite").objectStore(storeName).put(record)
      );
      return true;
    } catch {
      return false;
    }
  },
  /**
   * Read one record by alias via a `readonly` transaction.
   *
   * @param alias - The alias to read.
   * @returns The record, or `undefined` — never throws.
   * @example
   * ```ts
   * const record = await backend.get("sprite-1");
   * ```
   */
  async get(alias: string): Promise<StoredRecord | undefined> {
    try {
      return await promisifyRequest(
        db.transaction(storeName, "readonly").objectStore(storeName).get(alias)
      );
    } catch {
      return undefined;
    }
  },
  /**
   * Delete one record by alias via a `readwrite` transaction; best-effort.
   *
   * @param alias - The alias to delete.
   * @example
   * ```ts
   * await backend.delete("sprite-1");
   * ```
   */
  async delete(alias: string): Promise<void> {
    try {
      await promisifyRequest(
        db.transaction(storeName, "readwrite").objectStore(storeName).delete(alias)
      );
    } catch {
      // Best-effort removal — never throw.
    }
  },
  /**
   * Read every persisted record via a `readonly` transaction.
   *
   * @returns Every persisted record, or `[]` on a blocked read — never throws.
   * @example
   * ```ts
   * const all = await backend.list();
   * ```
   */
  async list(): Promise<readonly StoredRecord[]> {
    try {
      return await promisifyRequest(
        db.transaction(storeName, "readonly").objectStore(storeName).getAll()
      );
    } catch {
      return [];
    }
  },
  /**
   * Close the underlying IndexedDB connection (best-effort — never throws).
   *
   * @example
   * ```ts
   * backend.close();
   * ```
   */
  close(): void {
    try {
      db.close();
    } catch {
      // Best-effort close — never throw.
    }
  }
});

/**
 * Build the self-healing IndexedDB-or-memory {@link AssetBackend}: `open()` attempts a real
 * IndexedDB connection and, on success, delegates every subsequent call to it (`persistent: true`
 * from that point on); on any failure (blocked, quota, a throwing/erroring `IdbFactoryLike`) it
 * swaps to delegate to an in-memory fallback for the rest of the session instead (`persistent`
 * reports `false`). Before `open()` is ever called, every method already delegates to the memory
 * fallback, so a caller that skips `open()` still gets a working (non-persistent) backend.
 *
 * @param idb - The probed `IdbFactoryLike` factory.
 * @param config - Resolved plugin configuration (`dbName` / `storeName`).
 * @returns The self-healing backend.
 * @example
 * ```ts
 * const backend = createIdbOrMemoryBackend(idb, config);
 * const ok = await backend.open(); // true on a real connection, false on fallback
 * ```
 */
export const createIdbOrMemoryBackend = (
  idb: IdbFactoryLike,
  config: Readonly<Config>
): AssetBackend => {
  let delegate: AssetBackend = createMemoryBackend();

  return {
    /**
     * Whether the current delegate is a real, open IndexedDB connection.
     *
     * @returns `true` once `open()` has succeeded; `false` before that / after a failure.
     * @example
     * ```ts
     * backend.persistent; // true once open() succeeded against real IndexedDB
     * ```
     */
    get persistent(): boolean {
      return delegate.persistent;
    },
    /**
     * Attempt a real IndexedDB connection; on failure, swap the delegate to memory.
     *
     * @returns `true` on a real connection, `false` on fallback — never throws.
     * @example
     * ```ts
     * const ok = await backend.open(); // true on real IndexedDB, false on fallback
     * ```
     */
    async open(): Promise<boolean> {
      try {
        const db = await openDatabase(idb, config.dbName, config.storeName);
        delegate = createOpenIdbBackend(db, config.storeName);
        return true;
      } catch {
        delegate = createMemoryBackend();
        return false;
      }
    },
    /**
     * Delegate to the current backend's `put`.
     *
     * @param record - The record to persist.
     * @returns `true` on success, `false` otherwise.
     * @example
     * ```ts
     * await backend.put(record);
     * ```
     */
    put: (record: StoredRecord) => delegate.put(record),
    /**
     * Delegate to the current backend's `get`.
     *
     * @param alias - The alias to read.
     * @returns The record, or `undefined`.
     * @example
     * ```ts
     * await backend.get("sprite-1");
     * ```
     */
    get: (alias: string) => delegate.get(alias),
    /**
     * Delegate to the current backend's `delete`.
     *
     * @param alias - The alias to delete.
     * @returns A promise that resolves once the delegate's delete completes.
     * @example
     * ```ts
     * await backend.delete("sprite-1");
     * ```
     */
    delete: (alias: string) => delegate.delete(alias),
    /**
     * Delegate to the current backend's `list`.
     *
     * @returns Every persisted record.
     * @example
     * ```ts
     * await backend.list();
     * ```
     */
    list: () => delegate.list(),
    /**
     * Delegate to the current backend's `close`.
     *
     * @example
     * ```ts
     * backend.close();
     * ```
     */
    close: () => {
      delegate.close();
    }
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Default backend
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the default IndexedDB-or-memory backend from config. Probes `globalThis.indexedDB`:
 * absent → the plain in-memory fallback directly; present → the self-healing wrapper that attempts
 * a real connection on `open()` and degrades to memory on any failure. Never throws.
 *
 * @param config - Resolved plugin configuration (`dbName` / `storeName`).
 * @returns An {@link AssetBackend} — real IndexedDB-backed once opened, or the in-memory fallback.
 * @example
 * ```ts
 * const backend = createDefaultBackend({ dbName: "moku-assets", storeName: "assets", accept: ["image/"] });
 * ```
 */
export const createDefaultBackend = (config: Readonly<Config>): AssetBackend => {
  const idb = probeIdb();
  return idb ? createIdbOrMemoryBackend(idb, config) : createMemoryBackend();
};
