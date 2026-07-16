import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

const defaultConfig: Config = {
  target: "window",
  pointer: true,
  keyboard: true,
  wheel: true,
  preventDefault: false
};

const makeCtx = (config: Config = defaultConfig) => ({
  global: {} as Readonly<Record<string, unknown>>,
  config
});

// ─── createState ──────────────────────────────────────────────

describe("createState", () => {
  it("initialises with empty down/pressed/released sets", () => {
    const state = createState(makeCtx());

    expect(state.down.size).toBe(0);
    expect(state.pressed.size).toBe(0);
    expect(state.released.size).toBe(0);
  });

  it("initialises pointer at origin with buttons=0", () => {
    const state = createState(makeCtx());

    expect(state.pointer).toEqual({ x: 0, y: 0, buttons: 0 });
  });

  it("initialises listeners as an empty array", () => {
    const state = createState(makeCtx());

    expect(state.listeners).toHaveLength(0);
  });

  it("snapshot.isDown returns false for any key by default", () => {
    const state = createState(makeCtx());

    expect(state.snapshot.isDown("ArrowRight")).toBe(false);
  });

  it("snapshot.justPressed returns false for any key by default", () => {
    const state = createState(makeCtx());

    expect(state.snapshot.justPressed("Space")).toBe(false);
  });

  it("snapshot.justReleased returns false for any key by default", () => {
    const state = createState(makeCtx());

    expect(state.snapshot.justReleased("Space")).toBe(false);
  });

  it("snapshot.pointer is at origin with buttons=0 by default", () => {
    const state = createState(makeCtx());

    expect(state.snapshot.pointer).toEqual({ x: 0, y: 0, buttons: 0 });
  });

  it("initialises the wheel accumulator at { deltaX: 0, deltaY: 0 }", () => {
    const state = createState(makeCtx());

    expect(state.wheel).toEqual({ deltaX: 0, deltaY: 0 });
  });

  it("snapshot.wheel is { deltaX: 0, deltaY: 0 } by default", () => {
    const state = createState(makeCtx());

    expect(state.snapshot.wheel).toEqual({ deltaX: 0, deltaY: 0 });
  });
});
