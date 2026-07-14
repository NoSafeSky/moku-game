/**
 * @file editor-history plugin — createState unit tests.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";

const defaultConfig: Config = { maxDepth: 100 };

const makeCtx = (configOverrides?: Partial<Config>) => ({
  global: {},
  config: { ...defaultConfig, ...configOverrides }
});

describe("editor-history createState", () => {
  it("creates empty undo and redo stacks", () => {
    const state = createState(makeCtx());

    expect(state.undo).toEqual([]);
    expect(state.redo).toEqual([]);
  });

  it("starts with no open gesture", () => {
    const state = createState(makeCtx());

    expect(state.gesture).toBeUndefined();
    expect(state.gestureActive).toBe(false);
  });

  it("initial shape is independent of maxDepth (state carries no config-derived field)", () => {
    const state = createState(makeCtx({ maxDepth: 3 }));

    expect(state.undo).toEqual([]);
    expect(state.gestureActive).toBe(false);
  });

  it("each call returns fresh, independent arrays", () => {
    const a = createState(makeCtx());
    const b = createState(makeCtx());

    a.undo.push({ mutations: [] });

    expect(b.undo).toHaveLength(0);
  });
});
