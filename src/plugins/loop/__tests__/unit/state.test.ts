/**
 * @file loop plugin — unit tests for createState.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = {
  fixedDt: 1 / 60,
  maxFrameDelta: 0.25,
  maxStepsPerFrame: 5,
  autoStart: true
};

const makeMinimalCtx = (configOverrides?: Partial<Config>) => ({
  global: Object.freeze({}),
  config: { ...defaultConfig, ...configOverrides }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createState", () => {
  it("returns running: false initially", () => {
    const state = createState(makeMinimalCtx());
    expect(state.running).toBe(false);
  });

  it("returns accumulator: 0 initially", () => {
    const state = createState(makeMinimalCtx());
    expect(state.accumulator).toBe(0);
  });

  it("returns lastTime: undefined initially", () => {
    const state = createState(makeMinimalCtx());
    expect(state.lastTime).toBeUndefined();
  });

  it("returns distinct state objects for separate calls", () => {
    const state1 = createState(makeMinimalCtx());
    const state2 = createState(makeMinimalCtx());
    expect(state1).not.toBe(state2);
  });
});
