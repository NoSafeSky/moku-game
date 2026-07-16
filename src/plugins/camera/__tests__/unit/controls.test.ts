/**
 * @file camera plugin — editor-control math unit tests (Phase-1 F2).
 *
 * Pure `focusAt` / `zoomAtScreen` / `panByScreen` over a hand-built `state` + `config`
 * (no kernel). `zoomAtScreen`'s load-bearing invariant: `screenToWorld(cursor)` computed
 * after the call equals the value computed before (within epsilon), at rotation 0 AND a
 * non-zero rotation, with `zoom` clamped to `[minZoom, maxZoom]`. All three clear `follow`.
 */
import { describe, expect, it } from "vitest";
import { focusAt, panByScreen, zoomAtScreen } from "../../controls";
import { screenToWorld } from "../../transform";
import type { Config, State } from "../../types";

const makeConfig = (over: Partial<Config> = {}): Config => ({
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 10,
  followLerp: 0.15,
  width: 800,
  height: 600,
  updateStage: "sync",
  editorControls: false,
  ...over
});

const makeState = (over: Partial<State> = {}): State => ({
  started: true,
  stage: undefined,
  layers: new Map(),
  center: { x: 0, y: 0 },
  follow: undefined,
  zoom: 1,
  rotation: 0,
  shakeIntensity: 0,
  shakeHandle: undefined,
  tween: undefined,
  input: undefined,
  ...over
});

describe("focusAt", () => {
  it("snaps center to the target and clears follow (no zoom arg)", () => {
    const state = makeState({ follow: { x: 5, y: 5 }, zoom: 3 });
    focusAt(state, makeConfig(), { x: 100, y: 50 });

    expect(state.center).toEqual({ x: 100, y: 50 });
    expect(state.follow).toBeUndefined();
    expect(state.zoom).toBe(3); // unchanged — no zoom arg supplied
  });

  it("clamps + sets zoom when opts.zoom is provided", () => {
    const state = makeState();
    focusAt(state, makeConfig(), { x: 0, y: 0 }, 50); // clamps to maxZoom 10
    expect(state.zoom).toBe(10);

    focusAt(state, makeConfig(), { x: 0, y: 0 }, 0); // clamps to minZoom 0.1
    expect(state.zoom).toBe(0.1);
  });
});

describe("zoomAtScreen — cursor-anchored invariant", () => {
  it("keeps the world point under the cursor fixed at rotation 0", () => {
    const config = makeConfig();
    const state = makeState({ center: { x: 20, y: -10 }, zoom: 1 });
    const cursor = { x: 500, y: 200 };

    const worldBefore = screenToWorld(
      cursor,
      state.center,
      state.zoom,
      state.rotation,
      config.width,
      config.height
    );

    zoomAtScreen(state, config, cursor, 2);

    const worldAfter = screenToWorld(
      cursor,
      state.center,
      state.zoom,
      state.rotation,
      config.width,
      config.height
    );

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
    expect(state.zoom).toBeCloseTo(2, 6);
  });

  it("keeps the world point under the cursor fixed at a non-zero rotation", () => {
    const config = makeConfig();
    const state = makeState({ center: { x: -30, y: 15 }, zoom: 1.5, rotation: 0.9 });
    const cursor = { x: 250, y: 475 };

    const worldBefore = screenToWorld(
      cursor,
      state.center,
      state.zoom,
      state.rotation,
      config.width,
      config.height
    );

    zoomAtScreen(state, config, cursor, 0.5);

    const worldAfter = screenToWorld(
      cursor,
      state.center,
      state.zoom,
      state.rotation,
      config.width,
      config.height
    );

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it("clamps zoom to [minZoom, maxZoom]", () => {
    const config = makeConfig();
    const state = makeState({ zoom: 9 });
    zoomAtScreen(state, config, { x: 400, y: 300 }, 5); // 9*5=45 → clamps to 10
    expect(state.zoom).toBe(10);

    const low = makeState({ zoom: 0.2 });
    zoomAtScreen(low, config, { x: 400, y: 300 }, 0.1); // 0.2*0.1=0.02 → clamps to 0.1
    expect(low.zoom).toBe(0.1);
  });

  it("clears follow", () => {
    const state = makeState({ follow: { x: 1, y: 1 } });
    zoomAtScreen(state, makeConfig(), { x: 400, y: 300 }, 1.2);
    expect(state.follow).toBeUndefined();
  });
});

describe("panByScreen", () => {
  it("moves center by the world-converted delta and clears follow (identity zoom/rotation)", () => {
    const state = makeState({ center: { x: 0, y: 0 }, follow: { x: 1, y: 1 } });
    panByScreen(state, makeConfig(), 10, -5);

    // At zoom 1 / rotation 0, screenDeltaToWorld(dx,dy) === (dx,dy); center -= delta.
    expect(state.center.x).toBeCloseTo(-10, 6);
    expect(state.center.y).toBeCloseTo(5, 6);
    expect(state.follow).toBeUndefined();
  });

  it("scales the delta by zoom", () => {
    const state = makeState({ center: { x: 0, y: 0 }, zoom: 2 });
    panByScreen(state, makeConfig(), 20, 0);
    expect(state.center.x).toBeCloseTo(-10, 6); // 20 / zoom 2 = 10 world px, subtracted
  });
});
