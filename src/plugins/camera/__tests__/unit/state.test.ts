/**
 * @file camera plugin — state factory unit tests.
 *
 * The initial state has no captured stage/tween, an empty layer registry, a centre at
 * the origin, no follow target, zoom 1, no rotation, no shake, and `started: false`.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 10,
  followLerp: 0.15,
  width: 800,
  height: 600,
  updateStage: "sync",
  editorControls: false
};

describe("createState", () => {
  it("returns the documented initial camera state", () => {
    const state = createState({ global: {}, config });
    expect(state.started).toBe(false);
    expect(state.stage).toBeUndefined();
    expect(state.layers).toBeInstanceOf(Map);
    expect(state.layers.size).toBe(0);
    expect(state.center).toEqual({ x: 0, y: 0 });
    expect(state.follow).toBeUndefined();
    expect(state.zoom).toBe(1);
    expect(state.rotation).toBe(0);
    expect(state.shakeIntensity).toBe(0);
    expect(state.shakeHandle).toBeUndefined();
    expect(state.tween).toBeUndefined();
    expect(state.input).toBeUndefined();
  });

  it("returns a fresh layers Map and center on each call (no shared references)", () => {
    const a = createState({ global: {}, config });
    const b = createState({ global: {}, config });
    expect(a.layers).not.toBe(b.layers);
    expect(a.center).not.toBe(b.center);
  });
});
