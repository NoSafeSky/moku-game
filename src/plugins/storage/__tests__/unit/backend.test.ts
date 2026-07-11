/**
 * @file storage plugin — default backend unit tests.
 *
 * Drives createDefaultBackend against a mock `WebStorageLike` installed on
 * `globalThis.localStorage`: a usable store (persistent round-trip), a throwing
 * store + a throwing property access + an absent store (all → in-memory
 * fallback, `persistent: false`, no method throws), and a store that passes the
 * probe but rejects a later write (quota → `setItem` returns false).
 */
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultBackend, createMemoryBackend, type WebStorageLike } from "../../backend";

// ─────────────────────────────────────────────────────────────────────────────
// Mock WebStorageLike + globalThis.localStorage install helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeWebStorage = () => {
  const store = new Map<string, string>();
  let blocked = false;

  // Once blocked, EVERY operation throws — models a store that passes the initial
  // probe but is later blocked mid-session (quota, revoked permission).
  const guard = () => {
    if (blocked) throw new Error("SecurityError");
  };

  const storage: WebStorageLike = {
    getItem(key) {
      guard();
      const value = store.get(key);
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      guard();
      store.set(key, value);
    },
    removeItem(key) {
      guard();
      store.delete(key);
    },
    key(index) {
      guard();
      return [...store.keys()][index] ?? null;
    },
    get length() {
      guard();
      return store.size;
    }
  };

  return { storage, store, block: () => (blocked = true) };
};

const setLocalStorage = (value: unknown) =>
  Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });

const setThrowingLocalStorage = () =>
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: localStorage is not available");
    }
  });

const clearLocalStorage = () => Reflect.deleteProperty(globalThis, "localStorage");

afterEach(clearLocalStorage);

// ─────────────────────────────────────────────────────────────────────────────
// Persistent (usable localStorage) path
// ─────────────────────────────────────────────────────────────────────────────

describe("storage: createDefaultBackend with a usable localStorage", () => {
  it("is persistent and round-trips getItem/setItem/removeItem", () => {
    setLocalStorage(makeWebStorage().storage);
    const backend = createDefaultBackend();

    expect(backend.persistent).toBe(true);
    expect(backend.setItem("game:score", "10")).toBe(true);
    expect(backend.getItem("game:score")).toBe("10");
    backend.removeItem("game:score");
    expect(backend.getItem("game:score")).toBe(null);
  });

  it("keys() returns only full keys under the given prefix", () => {
    setLocalStorage(makeWebStorage().storage);
    const backend = createDefaultBackend();
    backend.setItem("game:a", "1");
    backend.setItem("game:b", "2");
    backend.setItem("other:c", "3");

    expect(backend.keys("game:").toSorted()).toEqual(["game:a", "game:b"]);
  });

  it("setItem returns false (not throw) when a later write is rejected (quota)", () => {
    const web = makeWebStorage();
    setLocalStorage(web.storage);
    const backend = createDefaultBackend(); // probe passes
    expect(backend.persistent).toBe(true);

    web.block(); // subsequent writes throw QuotaExceededError
    expect(() => backend.setItem("game:big", "x")).not.toThrow();
    expect(backend.setItem("game:big", "x")).toBe(false);
  });

  it("degrades every method without throwing when the store blocks mid-session", () => {
    const web = makeWebStorage();
    setLocalStorage(web.storage);
    const backend = createDefaultBackend(); // probe passes → persistent backend
    backend.setItem("game:score", "10");

    web.block(); // now getItem / removeItem / keys all throw internally

    expect(() => backend.getItem("game:score")).not.toThrow();
    expect(backend.getItem("game:score")).toBe(null); // blocked read → absent
    expect(() => backend.removeItem("game:score")).not.toThrow();
    expect(() => backend.keys("game:")).not.toThrow();
    expect(backend.keys("game:")).toEqual([]); // blocked enumeration → empty
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fallback path (blocked / throwing / absent)
// ─────────────────────────────────────────────────────────────────────────────

describe("storage: createDefaultBackend falls back to memory", () => {
  it("falls back when localStorage access throws (partitioned iframe)", () => {
    setThrowingLocalStorage();
    const backend = createDefaultBackend();

    expect(backend.persistent).toBe(false);
    expect(() => backend.setItem("game:x", "1")).not.toThrow();
    expect(backend.setItem("game:x", "1")).toBe(true);
    expect(backend.getItem("game:x")).toBe("1");
  });

  it("falls back when the probe write throws (blocked storage)", () => {
    const web = makeWebStorage();
    web.block(); // even the probe setItem throws
    setLocalStorage(web.storage);
    const backend = createDefaultBackend();

    expect(backend.persistent).toBe(false);
    expect(backend.setItem("game:x", "1")).toBe(true); // memory always succeeds
  });

  it("falls back when localStorage is absent (headless)", () => {
    clearLocalStorage();
    const backend = createDefaultBackend();

    expect(backend.persistent).toBe(false);
    expect(backend.getItem("game:missing")).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createMemoryBackend directly
// ─────────────────────────────────────────────────────────────────────────────

describe("storage: createMemoryBackend", () => {
  it("is non-persistent and round-trips values", () => {
    const backend = createMemoryBackend();

    expect(backend.persistent).toBe(false);
    expect(backend.setItem("game:k", "v")).toBe(true);
    expect(backend.getItem("game:k")).toBe("v");
    expect(backend.keys("game:")).toEqual(["game:k"]);
    backend.removeItem("game:k");
    expect(backend.getItem("game:k")).toBe(null);
  });

  it("keys() filters by prefix", () => {
    const backend = createMemoryBackend();
    backend.setItem("a:1", "x");
    backend.setItem("b:2", "y");

    expect(backend.keys("a:")).toEqual(["a:1"]);
  });

  it("no method throws (safety)", () => {
    const backend = createMemoryBackend();

    expect(() => {
      backend.getItem("z");
      backend.setItem("z", "1");
      backend.removeItem("z");
      backend.keys("z");
    }).not.toThrow();
  });
});
