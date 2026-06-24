/**
 * @file scene plugin — unit tests for createState.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = { initial: undefined, despawnOnUnload: true };

const makeCtx = (config?: Partial<Config>) => ({
  global: {} as Readonly<Record<string, unknown>>,
  config: { ...defaultConfig, ...config }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createState", () => {
  it("returns a state object with a scenes Map", () => {
    const state = createState(makeCtx());
    expect(state.scenes).toBeInstanceOf(Map);
  });

  it("starts with an empty scenes Map", () => {
    const state = createState(makeCtx());
    expect(state.scenes.size).toBe(0);
  });

  it("starts with current === undefined", () => {
    const state = createState(makeCtx());
    expect(state.current).toBeUndefined();
  });

  it("returns a state object with an owned Set", () => {
    const state = createState(makeCtx());
    expect(state.owned).toBeInstanceOf(Set);
  });

  it("starts with an empty owned Set", () => {
    const state = createState(makeCtx());
    expect(state.owned.size).toBe(0);
  });

  it("returns a fresh scenes Map on each call (no shared state)", () => {
    const stateA = createState(makeCtx());
    const stateB = createState(makeCtx());
    expect(stateA.scenes).not.toBe(stateB.scenes);
  });

  it("returns a fresh owned Set on each call (no shared state)", () => {
    const stateA = createState(makeCtx());
    const stateB = createState(makeCtx());
    expect(stateA.owned).not.toBe(stateB.owned);
  });
});
