/**
 * @file storage plugin — migration runner unit tests.
 *
 * Drives runMigrations against a real in-memory backend: an ordered v1→v3 chain,
 * a store already at the target (untouched), a fresh store (stamped, no
 * migration), a downgrade (warns, data intact), a chain with a missing step
 * (skipped), and a rename/deletion persisting via the snapshot.
 */
import { describe, expect, it, vi } from "vitest";

import { createMemoryBackend } from "../../backend";
import { META_KEY, runMigrations } from "../../migrate";
import type { Log, Migration, Snapshot, StorageBackend } from "../../types";

const makeLog = (): Log => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const metaKeyFor = (namespace: string) => `${namespace}:${META_KEY}`;

const readValue = (backend: StorageBackend, key: string): unknown =>
  JSON.parse(backend.getItem(key) ?? "null");

describe("storage: runMigrations", () => {
  it("runs the chain in order (v1 → v3 runs migrations[2] then migrations[3])", () => {
    const backend = createMemoryBackend();
    backend.setItem(metaKeyFor("game"), JSON.stringify(1));
    backend.setItem("game:score", JSON.stringify(10));

    const order: number[] = [];
    const migrations: Record<number, Migration> = {
      2: snapshot => {
        order.push(2);
        return { ...snapshot, score: (snapshot.score as number) + 1 };
      },
      3: snapshot => {
        order.push(3);
        return { ...snapshot, score: (snapshot.score as number) * 2 };
      }
    };

    runMigrations(backend, "game", 3, migrations, makeLog());

    expect(order).toEqual([2, 3]);
    expect(readValue(backend, "game:score")).toBe(22); // (10 + 1) * 2
    expect(readValue(backend, metaKeyFor("game"))).toBe(3);
  });

  it("leaves a store already at the target version untouched (no migration fns called)", () => {
    const backend = createMemoryBackend();
    backend.setItem(metaKeyFor("game"), JSON.stringify(2));
    backend.setItem("game:score", JSON.stringify(5));

    const migrate = vi.fn((snapshot: Snapshot) => snapshot);
    runMigrations(backend, "game", 2, { 2: migrate }, makeLog());

    expect(migrate).not.toHaveBeenCalled();
    expect(readValue(backend, "game:score")).toBe(5);
  });

  it("stamps a fresh/absent store at the target version with no migration", () => {
    const backend = createMemoryBackend();
    const migrate = vi.fn((snapshot: Snapshot) => snapshot);

    runMigrations(backend, "game", 2, { 2: migrate }, makeLog());

    expect(migrate).not.toHaveBeenCalled();
    expect(readValue(backend, metaKeyFor("game"))).toBe(2);
  });

  it("warns and leaves data intact on a downgrade (stored newer than app)", () => {
    const backend = createMemoryBackend();
    backend.setItem(metaKeyFor("game"), JSON.stringify(5));
    backend.setItem("game:score", JSON.stringify(9));
    const log = makeLog();

    runMigrations(backend, "game", 2, {}, log);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(readValue(backend, "game:score")).toBe(9); // untouched
    expect(readValue(backend, metaKeyFor("game"))).toBe(5); // not re-stamped
  });

  it("skips missing migration functions in the chain (no throw)", () => {
    const backend = createMemoryBackend();
    backend.setItem(metaKeyFor("game"), JSON.stringify(1));
    backend.setItem("game:score", JSON.stringify(3));

    // Only migrations[3] present — [2] is a gap and is skipped.
    const migrations: Record<number, Migration> = {
      3: snapshot => ({ ...snapshot, score: (snapshot.score as number) + 100 })
    };

    expect(() => runMigrations(backend, "game", 3, migrations, makeLog())).not.toThrow();
    expect(readValue(backend, "game:score")).toBe(103);
    expect(readValue(backend, metaKeyFor("game"))).toBe(3);
  });

  it("persists a rename/deletion (dropped keys are removed)", () => {
    const backend = createMemoryBackend();
    backend.setItem(metaKeyFor("game"), JSON.stringify(1));
    backend.setItem("game:old", JSON.stringify("value"));

    const migrations: Record<number, Migration> = {
      2: snapshot => {
        const { old, ...rest } = snapshot;
        return { ...rest, renamed: old };
      }
    };

    runMigrations(backend, "game", 2, migrations, makeLog());

    expect(backend.getItem("game:old")).toBe(null);
    expect(readValue(backend, "game:renamed")).toBe("value");
  });

  it("ignores the reserved meta key when building the snapshot", () => {
    const backend = createMemoryBackend();
    backend.setItem(metaKeyFor("game"), JSON.stringify(1));
    backend.setItem("game:score", JSON.stringify(1));

    const seen: string[][] = [];
    const migrations: Record<number, Migration> = {
      2: snapshot => {
        seen.push(Object.keys(snapshot));
        return snapshot;
      }
    };

    runMigrations(backend, "game", 2, migrations, makeLog());

    expect(seen).toEqual([["score"]]); // meta key excluded from the snapshot
  });
});
