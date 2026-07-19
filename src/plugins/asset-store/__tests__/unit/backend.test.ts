/**
 * @file asset-store plugin — default backend unit tests.
 *
 * Drives `createDefaultBackend` against a mock `IndexedDbLike` installed on
 * `globalThis.indexedDB`: a usable database (persistent round-trip), an absent / throwing / failed
 * `open()` (all → in-memory fallback, `persistent: false`, no method rejects), and a failed `put`
 * (quota) resolving `false` rather than rejecting. Also exercises `createMemoryBackend` directly.
 */
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultBackend, createMemoryBackend } from "../../backend";
import type { Config, StoredRecord } from "../../types";
import { clearIndexedDb, installIndexedDb } from "../mock-indexeddb";

const config: Config = { dbName: "moku-assets", storeName: "assets", accept: ["image/"] };

const record: StoredRecord = {
  alias: "sprite-a",
  name: "sprite.png",
  mime: "image/png",
  blob: { type: "image/png", size: 4 }
};

afterEach(clearIndexedDb);

// ─────────────────────────────────────────────────────────────────────────────
// Persistent (usable IndexedDB) path
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store: createDefaultBackend with a usable IndexedDB", () => {
  it("is persistent and round-trips put/get/delete/list after open()", async () => {
    const { uninstall } = installIndexedDb();
    const backend = createDefaultBackend(config);

    expect(await backend.open()).toBe(true);
    expect(backend.persistent).toBe(true);

    expect(await backend.put(record)).toBe(true);
    expect(await backend.get(record.alias)).toEqual(record);
    expect(await backend.list()).toEqual([record]);

    await backend.delete(record.alias);
    expect(await backend.get(record.alias)).toBeUndefined();

    uninstall();
  });

  it("closes without throwing", async () => {
    const { uninstall } = installIndexedDb();
    const backend = createDefaultBackend(config);
    await backend.open();

    expect(() => backend.close()).not.toThrow();
    uninstall();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fallback path (absent / blocked / throwing)
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store: createDefaultBackend falls back to memory", () => {
  it("falls back when indexedDB is absent (headless) — no method rejects", async () => {
    clearIndexedDb();
    const backend = createDefaultBackend(config);

    expect(backend.persistent).toBe(false);
    expect(await backend.open()).toBe(false);
    expect(backend.persistent).toBe(false);

    await expect(backend.put(record)).resolves.toBe(true);
    await expect(backend.get(record.alias)).resolves.toEqual(record);
    await expect(backend.list()).resolves.toEqual([record]);
    await expect(backend.delete(record.alias)).resolves.toBeUndefined();
    expect(() => backend.close()).not.toThrow();
  });

  it("falls back when open() errors (blocked database) — no method rejects", async () => {
    const { uninstall } = installIndexedDb({ failOpen: true });
    const backend = createDefaultBackend(config);

    expect(await backend.open()).toBe(false);
    expect(backend.persistent).toBe(false);

    await expect(backend.put(record)).resolves.toBe(true);
    await expect(backend.get(record.alias)).resolves.toEqual(record);

    uninstall();
  });

  it("falls back when indexedDB.open throws synchronously — no method rejects", async () => {
    const globals = globalThis as { indexedDB?: unknown };
    globals.indexedDB = {
      open: () => {
        throw new Error("boom");
      }
    };

    const backend = createDefaultBackend(config);
    await expect(backend.open()).resolves.toBe(false);
    expect(backend.persistent).toBe(false);
    await expect(backend.put(record)).resolves.toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failed put (quota) — resolves false, never rejects
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store: put failure (quota) resolves false", () => {
  it("does not reject when the backend rejects a write after a successful open", async () => {
    const { uninstall } = installIndexedDb({ failPut: true });
    const backend = createDefaultBackend(config);
    await backend.open();
    expect(backend.persistent).toBe(true);

    await expect(backend.put(record)).resolves.toBe(false);

    uninstall();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createMemoryBackend directly
// ─────────────────────────────────────────────────────────────────────────────

describe("asset-store: createMemoryBackend", () => {
  it("is non-persistent and round-trips a record", async () => {
    const backend = createMemoryBackend();

    expect(backend.persistent).toBe(false);
    expect(await backend.open()).toBe(false);
    expect(await backend.put(record)).toBe(true);
    expect(await backend.get(record.alias)).toEqual(record);
    expect(await backend.list()).toEqual([record]);

    await backend.delete(record.alias);
    expect(await backend.get(record.alias)).toBeUndefined();
    expect(await backend.list()).toEqual([]);
  });

  it("no method throws or rejects (safety)", async () => {
    const backend = createMemoryBackend();

    await expect(backend.open()).resolves.toBe(false);
    await expect(backend.put(record)).resolves.toBe(true);
    await expect(backend.get("missing")).resolves.toBeUndefined();
    await expect(backend.delete("missing")).resolves.toBeUndefined();
    await expect(backend.list()).resolves.toBeDefined();
    expect(() => backend.close()).not.toThrow();
  });
});
