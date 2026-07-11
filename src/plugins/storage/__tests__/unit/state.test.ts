/**
 * @file storage plugin — state unit tests.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config, Migration } from "../../types";

const baseConfig: Config = { namespace: "game", version: 1, migrations: {} };

const makeState = (overrides?: Partial<Config>) =>
  createState({ global: {}, config: { ...baseConfig, ...overrides } });

describe("storage: createState", () => {
  it("seeds namespace/version/migrations from config and installs a default backend", () => {
    const state = makeState();

    expect(state.namespace).toBe("game");
    expect(state.version).toBe(1);
    expect(state.migrations).toEqual({});
    expect(typeof state.backend.getItem).toBe("function");
    expect(typeof state.backend.setItem).toBe("function");
  });

  it("starts with migrated false (lazy migration on first access)", () => {
    expect(makeState().migrated).toBe(false);
  });

  it("carries a custom namespace / version / migrations reference", () => {
    const migrations: Record<number, Migration> = { 2: snapshot => snapshot };
    const state = makeState({ namespace: "save", version: 2, migrations });

    expect(state.namespace).toBe("save");
    expect(state.version).toBe(2);
    expect(state.migrations).toBe(migrations);
  });

  it("installs a backend that exposes the full StorageBackend surface", () => {
    const { backend } = makeState();

    expect(typeof backend.removeItem).toBe("function");
    expect(typeof backend.keys).toBe("function");
    expect(typeof backend.persistent).toBe("boolean");
  });
});
