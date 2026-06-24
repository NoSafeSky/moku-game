/**
 * @file assets plugin — unit tests for createState.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = { basePath: "", manifest: {}, throwOnError: true };

const makeCtx = (config?: Partial<Config>) => ({
  global: {} as Readonly<Record<string, unknown>>,
  config: { ...defaultConfig, ...config }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createState", () => {
  it("returns a state object with a loaded Set", () => {
    const state = createState(makeCtx());
    expect(state.loaded).toBeInstanceOf(Set);
  });

  it("starts with an empty loaded Set", () => {
    const state = createState(makeCtx());
    expect(state.loaded.size).toBe(0);
  });

  it("returns a fresh Set on each call (no shared state)", () => {
    const stateA = createState(makeCtx());
    const stateB = createState(makeCtx());
    expect(stateA.loaded).not.toBe(stateB.loaded);
  });

  it("does not include any aliases before load calls", () => {
    const state = createState(makeCtx());
    expect(state.loaded.has("ship")).toBe(false);
  });
});
