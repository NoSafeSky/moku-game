/**
 * @file context plugin — unit tests for createState.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = { bindGameContext: true };

const makeMinimalCtx = (configOverrides?: Partial<Config>) => ({
  global: Object.freeze({}),
  config: { ...defaultConfig, ...configOverrides }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createState", () => {
  it("returns an empty state object (no per-instance state)", () => {
    const state = createState(makeMinimalCtx());
    expect(state).toStrictEqual({});
  });

  it("returns distinct state objects for separate calls", () => {
    const state1 = createState(makeMinimalCtx());
    const state2 = createState(makeMinimalCtx());
    expect(state1).not.toBe(state2);
  });

  it("ignores bindGameContext config (state is empty regardless)", () => {
    const state = createState(makeMinimalCtx({ bindGameContext: false }));
    expect(state).toStrictEqual({});
  });
});
