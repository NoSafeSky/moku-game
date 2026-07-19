/**
 * @file asset-store plugin — shared IndexedDB test double.
 *
 * A minimal in-memory fake of the structural `IdbFactoryLike` surface the plugin uses (open with a
 * schema-upgrade event + a single-store transaction/put/get/delete/getAll), reused by the backend /
 * lifecycle unit tests and the integration test. Not a test file itself (no `.test.ts`), so vitest
 * does not collect it. Every request settles on a microtask (like the real, asynchronous IndexedDB
 * API) so listeners attached synchronously after the call still fire. Storage is a plain `Map`
 * passed in by the caller — reusing the SAME map across two `createFakeIndexedDb` calls models a
 * reload (a fresh "connection" reading the same on-disk data).
 */
import type {
  IdbDatabaseLike,
  IdbFactoryLike,
  IdbObjectStoreLike,
  IdbOpenRequestLike,
  IdbRequestLike
} from "../backend";
import type { StoredRecord } from "../types";

/** The durable contents of the single object store this plugin uses: alias → record. */
export type FakeRecordStore = Map<string, StoredRecord>;

/** A fake `IdbFactoryLike` plus the durable record store it reads/writes. */
export type FakeIndexedDbHandle = {
  /** The fake IndexedDB factory, installable on `globalThis.indexedDB`. */
  readonly idb: IdbFactoryLike;
  /** The durable backing store (survives across repeated `open()` calls). */
  readonly records: FakeRecordStore;
};

/** A mock request exposing `fire*` helpers the fake factory uses to settle it on a microtask. */
type MockRequest<T> = IdbRequestLike<T> & {
  /** Settle with a result, notifying every `"success"` listener. */
  fireSuccess: (result: T) => void;
  /** Settle with an error, notifying every `"error"` listener. */
  fireError: (error: unknown) => void;
};

/** Build a settleable mock request (structural `IdbRequestLike`). */
function createMockRequest<T>(initialResult: T): MockRequest<T> {
  const successListeners: Array<() => void> = [];
  const errorListeners: Array<() => void> = [];

  const request: MockRequest<T> = {
    result: initialResult,
    error: undefined,
    addEventListener(type, listener) {
      (type === "success" ? successListeners : errorListeners).push(listener);
    },
    fireSuccess(result) {
      request.result = result;
      for (const listener of successListeners) listener();
    },
    fireError(error) {
      request.error = error;
      for (const listener of errorListeners) listener();
    }
  };

  return request;
}

/** A mock "open" request exposing `fire*` helpers for all three IndexedDB open events. */
type MockOpenRequest = IdbOpenRequestLike & {
  /** Notify every `"upgradeneeded"` listener. */
  fireUpgradeNeeded: () => void;
  /** Settle with a database connection, notifying every `"success"` listener. */
  fireSuccess: (db: IdbDatabaseLike) => void;
  /** Settle with an error, notifying every `"error"` listener. */
  fireError: (error: unknown) => void;
};

/** Build a settleable mock open request (structural `IdbOpenRequestLike`). */
function createMockOpenRequest(initialResult: IdbDatabaseLike): MockOpenRequest {
  const successListeners: Array<() => void> = [];
  const errorListeners: Array<() => void> = [];
  const upgradeListeners: Array<() => void> = [];

  const request: MockOpenRequest = {
    result: initialResult,
    error: undefined,
    addEventListener(type, listener) {
      if (type === "success") successListeners.push(listener);
      else if (type === "error") errorListeners.push(listener);
      else upgradeListeners.push(listener);
    },
    fireUpgradeNeeded() {
      for (const listener of upgradeListeners) listener();
    },
    fireSuccess(db) {
      request.result = db;
      for (const listener of successListeners) listener();
    },
    fireError(error) {
      request.error = error;
      for (const listener of errorListeners) listener();
    }
  };

  return request;
}

/** A placeholder database returned before the real one resolves (never observed by callers). */
const placeholderDatabase: IdbDatabaseLike = {
  objectStoreNames: { contains: () => false },
  createObjectStore: () => makeObjectStore(new Map()),
  transaction: () => ({ objectStore: () => makeObjectStore(new Map()) }),
  close() {
    /* no-op — mock IDBDatabase.close() */
  }
};

/** Settle `request` on a microtask, either failing (when `fail`) or succeeding with `onSettle`. */
function settleOnMicrotask<T>(request: MockRequest<T>, fail: boolean, onSettle: () => T): void {
  queueMicrotask(() => {
    if (fail) {
      request.fireError(new Error("mock indexedDB quota exceeded"));
      return;
    }
    request.fireSuccess(onSettle());
  });
}

/** Build a spied object-store view over a shared record Map, settling every request on a microtask. */
function makeObjectStore(
  records: FakeRecordStore,
  options?: { failPut?: boolean | undefined }
): IdbObjectStoreLike {
  return {
    put(record) {
      const request = createMockRequest<unknown>(undefined);
      settleOnMicrotask(request, options?.failPut ?? false, () => {
        records.set(record.alias, record);
        return undefined;
      });
      return request;
    },
    get(alias) {
      const request = createMockRequest<StoredRecord | undefined>(undefined);
      settleOnMicrotask(request, false, () => records.get(alias));
      return request;
    },
    delete(alias) {
      const request = createMockRequest<unknown>(undefined);
      settleOnMicrotask(request, false, () => {
        records.delete(alias);
        return undefined;
      });
      return request;
    },
    getAll() {
      const request = createMockRequest<StoredRecord[]>([]);
      settleOnMicrotask(request, false, () => [...records.values()]);
      return request;
    }
  };
}

/** Build the live database connection the fake factory resolves `open()` with. */
function makeDatabase(records: FakeRecordStore, failPut: boolean | undefined): IdbDatabaseLike {
  return {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => makeObjectStore(records, { failPut }),
    transaction: () => ({ objectStore: () => makeObjectStore(records, { failPut }) }),
    close() {
      /* no-op — mock IDBDatabase.close() */
    }
  };
}

/**
 * Build a fake `IdbFactoryLike` over a durable record store. `failOpen: true` makes every `open()`
 * fail (simulating a blocked/erroring database) for the fallback-path tests.
 */
export const createFakeIndexedDb = (options?: {
  failOpen?: boolean;
  failPut?: boolean;
  records?: FakeRecordStore;
}): FakeIndexedDbHandle => {
  const records = options?.records ?? new Map<string, StoredRecord>();

  const idb: IdbFactoryLike = {
    open(_name, _version) {
      const request = createMockOpenRequest(placeholderDatabase);

      queueMicrotask(() => {
        if (options?.failOpen) {
          request.fireError(new Error("mock indexedDB blocked"));
          return;
        }
        request.fireUpgradeNeeded();
        request.fireSuccess(makeDatabase(records, options?.failPut));
      });

      return request;
    }
  };

  return { idb, records };
};

/** Install a fake `indexedDB` on `globalThis`. Returns the handle + an uninstall. */
export const installIndexedDb = (
  options?: Parameters<typeof createFakeIndexedDb>[0]
): FakeIndexedDbHandle & { uninstall: () => void } => {
  const handle = createFakeIndexedDb(options);
  const globals = globalThis as { indexedDB?: unknown };
  const previous = globals.indexedDB;
  globals.indexedDB = handle.idb;

  return {
    ...handle,
    uninstall: () => {
      globals.indexedDB = previous;
    }
  };
};

/** Remove any `indexedDB` global a test installed directly (without `installIndexedDb`). */
export const clearIndexedDb = (): void => {
  Reflect.deleteProperty(globalThis, "indexedDB");
};
