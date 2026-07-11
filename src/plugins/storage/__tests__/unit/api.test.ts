/**
 * @file storage plugin — API unit tests.
 *
 * Drives createApi against a real in-memory backend (and purpose-built stub
 * backends): get/set round-trip + JSON, fallbacks, clear/keys/has/remove,
 * isPersistent/getVersion, once-only lazy migration, setBackend re-migration,
 * and the safety invariant that no method throws against a throwing backend.
 */
import { describe, expect, it, vi } from "vitest";

import { createApi } from "../../api";
import { createMemoryBackend } from "../../backend";
import { META_KEY } from "../../migrate";
import type { Log, State, StorageBackend } from "../../types";

const makeLog = (): Log => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const boom = () => {
  throw new Error("boom");
};

const makeState = (overrides?: Partial<State>): State => ({
  backend: createMemoryBackend(),
  namespace: "game",
  version: 1,
  migrations: {},
  migrated: false,
  ...overrides
});

const makeApi = (state: State = makeState(), log: Log = makeLog()) => createApi({ state, log });

describe("storage: createApi", () => {
  // ── get / set ──────────────────────────────────────────────────────────────

  describe("get / set", () => {
    it("returns the fallback for a missing key", () => {
      expect(makeApi().get("nope", 42)).toBe(42);
    });

    it("returns undefined for a missing key with no fallback", () => {
      expect(makeApi().get("nope")).toBeUndefined();
    });

    it("round-trips values through JSON", () => {
      const api = makeApi();
      expect(api.set("player", { hp: 3, name: "ada" })).toBe(true);
      expect(api.get("player")).toEqual({ hp: 3, name: "ada" });
    });

    it("returns the fallback for an unparseable stored value", () => {
      const state = makeState();
      state.backend.setItem("game:corrupt", "{not json");
      expect(makeApi(state).get("corrupt", "fallback")).toBe("fallback");
    });

    it("set returns false when the backend rejects the write", () => {
      const failing: StorageBackend = {
        getItem: () => null,
        setItem: () => false,
        removeItem: () => undefined,
        keys: () => [],
        persistent: true
      };
      expect(makeApi(makeState({ backend: failing })).set("k", 1)).toBe(false);
    });

    it("set returns false for an unserializable value (undefined)", () => {
      expect(makeApi().set("k", undefined)).toBe(false);
    });

    it("set returns false without throwing for a circular value", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular; // JSON.stringify throws → safeStringify catch → false

      const api = makeApi();
      expect(() => api.set("k", circular)).not.toThrow();
      expect(api.set("k", circular)).toBe(false);
    });
  });

  // ── has / remove / clear / keys ─────────────────────────────────────────────

  describe("has / remove / clear / keys", () => {
    it("has reflects presence", () => {
      const api = makeApi();
      expect(api.has("k")).toBe(false);
      api.set("k", 1);
      expect(api.has("k")).toBe(true);
    });

    it("remove deletes a key and is a no-op when absent", () => {
      const api = makeApi();
      api.set("k", 1);
      api.remove("k");
      expect(api.has("k")).toBe(false);
      expect(() => api.remove("missing")).not.toThrow();
    });

    it("keys lists namespaced keys with the prefix stripped and the meta key excluded", () => {
      const api = makeApi();
      api.set("a", 1);
      api.set("b", 2);
      expect(api.keys().toSorted()).toEqual(["a", "b"]);
    });

    it("clear removes every key but preserves the version stamp", () => {
      const state = makeState({ version: 3 });
      const api = makeApi(state);
      api.set("a", 1);
      api.set("b", 2);

      api.clear();

      expect(api.keys()).toEqual([]);
      expect(state.backend.getItem(`game:${META_KEY}`)).toBe(JSON.stringify(3));
      expect(api.getVersion()).toBe(3);
    });
  });

  // ── isPersistent / getVersion ───────────────────────────────────────────────

  describe("isPersistent / getVersion", () => {
    it("isPersistent reflects backend.persistent", () => {
      expect(makeApi().isPersistent()).toBe(false); // in-memory backend

      const persistentBackend: StorageBackend = {
        getItem: () => null,
        setItem: () => true,
        removeItem: () => undefined,
        keys: () => [],
        persistent: true
      };
      expect(makeApi(makeState({ backend: persistentBackend })).isPersistent()).toBe(true);
    });

    it("getVersion returns the configured (migrated) version", () => {
      expect(makeApi(makeState({ version: 4 })).getVersion()).toBe(4);
    });

    it("isPersistent returns false without throwing when the persistent read throws", () => {
      const backend: StorageBackend = {
        getItem: () => null,
        setItem: () => true,
        removeItem: () => undefined,
        keys: () => [],
        get persistent(): boolean {
          throw new Error("boom");
        }
      };
      const api = makeApi(makeState({ backend }));

      expect(() => api.isPersistent()).not.toThrow();
      expect(api.isPersistent()).toBe(false);
    });
  });

  // ── lazy migration ──────────────────────────────────────────────────────────

  describe("lazy migration", () => {
    it("runs the migration exactly once across accesses", () => {
      const backend = createMemoryBackend();
      backend.setItem(`game:${META_KEY}`, JSON.stringify(1));
      backend.setItem("game:score", JSON.stringify(1));

      const migrate = vi.fn(snapshot => ({ ...snapshot, score: 2 }));
      const api = makeApi(makeState({ version: 2, migrations: { 2: migrate }, backend }));

      expect(api.get("score")).toBe(2);
      expect(api.get("score")).toBe(2);
      api.has("score");
      expect(migrate).toHaveBeenCalledTimes(1);
    });

    it("logs the degraded-mode notice on first access to a non-persistent backend", () => {
      const log = makeLog();
      makeApi(makeState(), log).get("k");
      expect(log.debug).toHaveBeenCalledTimes(1);
    });

    it("setBackend resets migration so the next access migrates the new backend", () => {
      const state = makeState({ version: 2, migrations: { 2: snapshot => snapshot } });
      const api = makeApi(state);
      api.get("x"); // migrates the initial backend
      expect(state.migrated).toBe(true);

      const injected = createMemoryBackend();
      injected.setItem(`game:${META_KEY}`, JSON.stringify(1)); // a v1 store
      api.setBackend(injected);
      expect(state.migrated).toBe(false);

      api.get("x"); // re-migrates the injected backend up to v2
      expect(injected.getItem(`game:${META_KEY}`)).toBe(JSON.stringify(2));
      expect(state.migrated).toBe(true);
    });
  });

  // ── safety invariant ────────────────────────────────────────────────────────

  describe("safety (throwing backend)", () => {
    it("no public method throws against a fully-throwing backend", () => {
      const throwing: StorageBackend = {
        getItem: boom,
        setItem: boom,
        removeItem: boom,
        keys: boom,
        persistent: false
      };
      const api = makeApi(makeState({ backend: throwing }));

      expect(() => api.get("k", "fb")).not.toThrow();
      expect(api.get("k", "fb")).toBe("fb");
      expect(() => api.set("k", 1)).not.toThrow();
      expect(api.set("k", 1)).toBe(false);
      expect(() => api.has("k")).not.toThrow();
      expect(() => api.remove("k")).not.toThrow();
      expect(() => api.clear()).not.toThrow();
      expect(() => api.keys()).not.toThrow();
      expect(api.keys()).toEqual([]);
      expect(() => api.isPersistent()).not.toThrow();
      expect(() => api.getVersion()).not.toThrow();
    });
  });
});
