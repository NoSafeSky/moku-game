/**
 * @file storage plugin — integration tests.
 *
 * Boots the framework with storagePlugin (no game-plugin dependencies) and
 * exercises: lifecycle, set/get round-trip, versioned migration of a pre-seeded
 * snapshot on first read, the deferred platform-handoff shape (setBackend routing
 * + isPersistent flip), and the public type contracts.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { coreConfig } from "../../../../config";
import { createMemoryBackend } from "../../backend";
import { storagePlugin } from "../../index";
import { META_KEY } from "../../migrate";
import type { Migration, Snapshot, StorageBackend } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

const bootDefault = async () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [storagePlugin] });
  const app = createApp();
  await app.start();
  return app;
};

// Negative type check: a Migration must return a Snapshot, not a number.
// @ts-expect-error -- return type must be Snapshot, not number
const badReturnMigration: Migration = () => 5;

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("storage plugin integration", () => {
  describe("lifecycle", () => {
    it("starts and stops without error", async () => {
      const { createApp } = coreConfig.createCore(coreConfig, { plugins: [storagePlugin] });
      const app = createApp();
      await expect(app.start()).resolves.toBeUndefined();
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it("exposes app.storage after start", async () => {
      const app = await bootDefault();
      expect(app.storage).toBeDefined();
      await app.stop();
    });
  });

  // ── Round-trip ───────────────────────────────────────────────────────────────

  describe("round-trip", () => {
    it("set then get round-trips a value", async () => {
      const app = await bootDefault();
      expect(app.storage.set("k", { n: 1 })).toBe(true);
      expect(app.storage.get("k")).toEqual({ n: 1 });
      await app.stop();
    });

    it("get returns the fallback on a fresh store", async () => {
      const app = await bootDefault();
      expect(app.storage.get("bestHeight", 0)).toBe(0);
      await app.stop();
    });
  });

  // ── Versioned migration ──────────────────────────────────────────────────────

  describe("versioned migration", () => {
    it("upgrades a pre-seeded v1 snapshot to v2 on first read", async () => {
      const seeded = createMemoryBackend();
      seeded.setItem(`save:${META_KEY}`, JSON.stringify(1));
      seeded.setItem("save:coins", JSON.stringify(10));

      const migrations: Record<number, Migration> = {
        2: (snapshot: Snapshot) => ({ ...snapshot, coins: (snapshot.coins as number) * 100 })
      };

      const { createApp } = coreConfig.createCore(coreConfig, { plugins: [storagePlugin] });
      const app = createApp({
        pluginConfigs: { storage: { namespace: "save", version: 2, migrations } }
      });
      await app.start();

      // Inject the pre-seeded backend (the deferred platform-handoff shape).
      app.storage.setBackend(seeded);

      expect(app.storage.get("coins")).toBe(1000);
      expect(app.storage.getVersion()).toBe(2);
      await app.stop();
    });
  });

  // ── Backend injection (platform handoff shape) ───────────────────────────────

  describe("backend injection (platform handoff shape)", () => {
    it("routes subsequent saves through an injected backend", async () => {
      const injected = createMemoryBackend();
      const { createApp } = coreConfig.createCore(coreConfig, { plugins: [storagePlugin] });
      const app = createApp({ pluginConfigs: { storage: { namespace: "p" } } });
      await app.start();

      app.storage.setBackend(injected);
      app.storage.set("hp", 42);

      expect(injected.getItem("p:hp")).toBe(JSON.stringify(42));
      await app.stop();
    });

    it("flips isPersistent when a non-persistent backend is injected", async () => {
      const app = await bootDefault();

      const stub: StorageBackend = {
        getItem: () => null,
        setItem: () => true,
        removeItem: () => undefined,
        keys: () => [],
        persistent: false
      };
      app.storage.setBackend(stub);

      expect(app.storage.isPersistent()).toBe(false);
      await app.stop();
    });
  });

  // ── Types ────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("get<T> yields T | undefined", async () => {
      const app = await bootDefault();
      const value = app.storage.get<number>("k");
      expectTypeOf(value).toEqualTypeOf<number | undefined>();
      await app.stop();
    });

    it("set accepts an unknown value and returns boolean", async () => {
      const app = await bootDefault();
      expectTypeOf(app.storage.set).parameter(1).toEqualTypeOf<unknown>();
      expectTypeOf(app.storage.set).returns.toEqualTypeOf<boolean>();
      await app.stop();
    });

    it("a Migration is (Snapshot) => Snapshot, and a wrong return shape is rejected", () => {
      expectTypeOf<Migration>().toEqualTypeOf<(snapshot: Snapshot) => Snapshot>();
      expect(typeof badReturnMigration).toBe("function"); // rejected shape (see @ts-expect-error)
    });

    it("StorageBackend.setItem returns boolean", () => {
      const backend = createMemoryBackend();
      expectTypeOf(backend.setItem).returns.toEqualTypeOf<boolean>();
    });

    it("setBackend rejects a backend missing persistent (type-level)", async () => {
      const app = await bootDefault();
      app.storage.setBackend({
        getItem: () => null,
        setItem: () => true,
        removeItem: () => undefined,
        keys: () => [],
        // @ts-expect-error -- `persistent` is required on StorageBackend
        persistent: undefined
      });
      expect(() => app.storage.isPersistent()).not.toThrow(); // reads the injected backend without throwing
      await app.stop();
    });
  });
});
