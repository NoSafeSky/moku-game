/**
 * @file camera plugin — apply-system unit tests.
 *
 * Drives `createApplySystem` with a hand-built `State` and real (headless-constructed)
 * Pixi `Container`s, asserting the transform written to each layer: a factor-1 layer
 * centres `center` at the viewport centre; a factor-0.5 layer pivots at `center*0.5`
 * (parallax); zoom / rotation are written through; `followLerp` eases `center` a
 * fraction toward the target (0.5 → halfway, 1 → snaps); an injected `random` makes the
 * shake offset deterministic; and headless (no stage) still smooths `center` but writes
 * no container. The `world` argument is ignored, so a dummy satisfies the signature.
 */
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { World } from "../../../scheduler/types"; // re-exported from ecs/types
import type { Api as TweenApi } from "../../../tween/types";
import { createApplySystem } from "../../apply";
import type { Config, Layer, State } from "../../types";

/** The apply system never touches `world`; a dummy satisfies the `System` signature. */
const world = {} as World;

const makeConfig = (over: Partial<Config> = {}): Config => ({
  zoom: 1,
  minZoom: 0.1,
  maxZoom: 10,
  followLerp: 0.15,
  width: 800,
  height: 600,
  updateStage: "sync",
  ...over
});

/** Canonical linear interpolation — the only tween method the apply system calls. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** A minimal tween stand-in exposing just `lerp` (all the follow smoothing needs). */
const fakeTween = { lerp } as unknown as TweenApi;

/** Build a started camera state; `tween` is the `lerp`-only stand-in unless overridden. */
const makeState = (over: Partial<State> = {}): State => ({
  started: true,
  stage: undefined,
  layers: new Map<string, Layer>(),
  center: { x: 0, y: 0 },
  follow: undefined,
  zoom: 1,
  rotation: 0,
  shakeIntensity: 0,
  shakeHandle: undefined,
  tween: fakeTween,
  ...over
});

/** A layer registry with a single named layer, plus a truthy stage so writes run. */
const withLayer = (
  name: string,
  factor: number
): { stage: Container; layers: Map<string, Layer> } => {
  const container = new Container();
  return { stage: new Container(), layers: new Map([[name, { container, factor }]]) };
};

describe("apply — layer transform", () => {
  it("centres a factor-1 world layer and writes zoom/rotation through", () => {
    const { stage, layers } = withLayer("world", 1);
    const state = makeState({ stage, layers, center: { x: 100, y: 50 }, zoom: 2, rotation: 0.25 });

    createApplySystem({ state, config: makeConfig() })(world, 1 / 60);

    const world1 = layers.get("world")?.container as Container;
    expect(world1.pivot.x).toBe(100); // center * factor 1
    expect(world1.pivot.y).toBe(50);
    expect(world1.position.x).toBe(400); // width / 2
    expect(world1.position.y).toBe(300); // height / 2
    expect(world1.scale.x).toBe(2);
    expect(world1.scale.y).toBe(2);
    expect(world1.rotation).toBe(0.25);
  });

  it("scrolls a factor-0.5 layer at half rate (parallax)", () => {
    const { stage, layers } = withLayer("bg", 0.5);
    const state = makeState({ stage, layers, center: { x: 200, y: 80 } });

    createApplySystem({ state, config: makeConfig() })(world, 1 / 60);

    const bg = layers.get("bg")?.container as Container;
    expect(bg.pivot.x).toBe(100); // 200 * 0.5
    expect(bg.pivot.y).toBe(40); // 80 * 0.5
  });

  it("pins a factor-0 static layer regardless of the camera centre", () => {
    const { stage, layers } = withLayer("static", 0);
    const state = makeState({ stage, layers, center: { x: 999, y: -999 } });

    createApplySystem({ state, config: makeConfig() })(world, 1 / 60);

    const staticLayer = layers.get("static")?.container as Container;
    expect(staticLayer.pivot.x).toBe(0); // center * factor 0 → never scrolls
    expect(staticLayer.pivot.y).toBe(0);
    expect(staticLayer.position.x).toBe(400); // still centred at the viewport
  });
});

describe("apply — follow smoothing", () => {
  it("eases center a fraction toward the target (followLerp 0.5 → halfway)", () => {
    const state = makeState({ center: { x: 0, y: 0 }, follow: { x: 100, y: 40 } });
    createApplySystem({ state, config: makeConfig({ followLerp: 0.5 }) })(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(50, 6);
    expect(state.center.y).toBeCloseTo(20, 6);
  });

  it("snaps to the target when followLerp is 1", () => {
    const state = makeState({ center: { x: 0, y: 0 }, follow: { x: 100, y: 40 } });
    createApplySystem({ state, config: makeConfig({ followLerp: 1 }) })(world, 1 / 60);
    expect(state.center.x).toBeCloseTo(100, 6);
    expect(state.center.y).toBeCloseTo(40, 6);
  });

  it("does not move center when there is no follow target", () => {
    const state = makeState({ center: { x: 10, y: 20 } });
    createApplySystem({ state, config: makeConfig() })(world, 1 / 60);
    expect(state.center).toEqual({ x: 10, y: 20 });
  });
});

describe("apply — shake offset", () => {
  it("offsets every layer by a deterministic vector when random is injected", () => {
    const { stage, layers } = withLayer("world", 1);
    const state = makeState({ stage, layers, shakeIntensity: 10 });
    // random() = 0 → (0*2 - 1) * 10 = -10 on both axes.
    createApplySystem({ state, config: makeConfig(), random: () => 0 })(world, 1 / 60);

    const world1 = layers.get("world")?.container as Container;
    expect(world1.position.x).toBe(400 - 10);
    expect(world1.position.y).toBe(300 - 10);
  });

  it("adds no offset when shakeIntensity is 0", () => {
    const { stage, layers } = withLayer("world", 1);
    const state = makeState({ stage, layers, shakeIntensity: 0 });
    createApplySystem({ state, config: makeConfig(), random: () => 1 })(world, 1 / 60);

    const world1 = layers.get("world")?.container as Container;
    expect(world1.position.x).toBe(400);
    expect(world1.position.y).toBe(300);
  });
});

describe("apply — headless", () => {
  it("still smooths center but writes no container when there is no stage", () => {
    const orphan = new Container();
    const state = makeState({
      stage: undefined,
      layers: new Map([["world", { container: orphan, factor: 1 }]]),
      center: { x: 0, y: 0 },
      follow: { x: 100, y: 0 }
    });

    createApplySystem({ state, config: makeConfig({ followLerp: 0.5 }) })(world, 1 / 60);

    expect(state.center.x).toBeCloseTo(50, 6); // numeric state still tracks
    expect(orphan.pivot.x).toBe(0); // untouched — no stage → no container write
    expect(orphan.position.x).toBe(0);
  });
});
