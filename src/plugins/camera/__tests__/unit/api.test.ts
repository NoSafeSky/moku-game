/**
 * @file camera plugin — API surface unit tests.
 *
 * Exercises `app.camera` via `createApi` with a minimal mock ctx (`{ config, state,
 * log }`) and a fake `app.tween` injected as `state.tween` (records `to`/`value` calls
 * and returns a spy handle) — no kernel. Covers before-start guards (mutators warn +
 * no-op; animated methods return a dead handle), the instant setters (with zoom clamp),
 * follow, `moveTo` (clears follow, delegates to `tween.to`), `zoomTo`/`rotateTo`
 * (delegate to `tween.value`; their `onUpdate` writes state), `shake` (replaces the
 * in-flight shake), `addLayer` idempotence + headless `undefined`, the `world` getter,
 * the `getPosition` copy, and the pure readers working before start.
 */
import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import type { Api as TweenApi, TweenHandle } from "../../../tween/types";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";

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

const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** Canonical linear interpolation — the only tween method the follow smoothing calls. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A fake tween recording `to`/`value` calls and returning a live spy handle. */
const makeTween = () => {
  const calls: { method: "to" | "value"; args: unknown[] }[] = [];
  const handle: TweenHandle = {
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    active: true,
    done: Promise.resolve()
  };
  const to = vi.fn((...args: unknown[]) => {
    calls.push({ method: "to", args });
    return handle;
  });
  const value = vi.fn((...args: unknown[]) => {
    calls.push({ method: "value", args });
    return handle;
  });
  const tween = { to, value, lerp } as unknown as TweenApi;
  return { tween, handle, calls, to, value };
};

/** The captured options passed to the last recorded `to`/`value` call. */
const lastOpts = (calls: { args: unknown[] }[]): { onUpdate?: (v: number) => void } =>
  (calls.at(-1)?.args[2] ?? {}) as { onUpdate?: (v: number) => void };

/** A STARTED api context with the fake tween captured (no stage — headless layers). */
const startedCtx = (over: Partial<Config> = {}) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  const tweenKit = makeTween();
  state.tween = tweenKit.tween;
  state.started = true;
  const log = makeLog();
  return { api: createApi({ config, state, log }), state, log, config, ...tweenKit };
};

/** A started context that also has a captured stage + seeded `world` layer (as onStart builds). */
const startedCtxWithStage = (over: Partial<Config> = {}) => {
  const base = startedCtx(over);
  const stage = new Container();
  base.state.stage = stage;
  const world = new Container();
  stage.addChildAt(world, 0);
  base.state.layers.set("world", { container: world, factor: 1 });
  return { ...base, stage, world };
};

/** An UNSTARTED api context (`started: false`, no tween) — every mutator/animated method guards. */
const unstartedCtx = () => {
  const config = makeConfig();
  const state = createState({ global: {}, config });
  const log = makeLog();
  return { api: createApi({ config, state, log }), state, log };
};

describe("api — guarded before start", () => {
  it("mutators warn and leave state unchanged", () => {
    const { api, state, log } = unstartedCtx();
    api.setPosition(100, 50);
    api.setZoom(3);
    api.setRotation(1);
    api.follow({ x: 5, y: 5 });

    expect(state.center).toEqual({ x: 0, y: 0 });
    expect(state.zoom).toBe(1);
    expect(state.rotation).toBe(0);
    expect(state.follow).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it("animated methods return a dead handle (inactive, done resolved); shake no-ops", async () => {
    const { api, state } = unstartedCtx();
    const move = api.moveTo(1, 1);
    const zoom = api.zoomTo(2);
    const rotate = api.rotateTo(1);

    expect(move.active).toBe(false);
    expect(zoom.active).toBe(false);
    expect(rotate.active).toBe(false);
    await expect(move.done).resolves.toBeUndefined();

    expect(() => api.shake(10, 0.5)).not.toThrow();
    expect(state.shakeIntensity).toBe(0);
  });
});

describe("api — instant setters", () => {
  it("setPosition sets center and clears follow", () => {
    const { api, state } = startedCtx();
    state.follow = { x: 9, y: 9 };
    api.setPosition(120, 60);
    expect(state.center).toEqual({ x: 120, y: 60 });
    expect(state.follow).toBeUndefined();
  });

  it("setZoom clamps into [minZoom, maxZoom]", () => {
    const { api, state } = startedCtx();
    api.setZoom(50);
    expect(state.zoom).toBe(10); // maxZoom
    api.setZoom(0);
    expect(state.zoom).toBe(0.1); // minZoom
  });

  it("setRotation sets rotation", () => {
    const { api, state } = startedCtx();
    api.setRotation(Math.PI / 3);
    expect(state.rotation).toBeCloseTo(Math.PI / 3, 6);
  });

  it("follow stores the target; follow() clears it", () => {
    const { api, state } = startedCtx();
    const target = { x: 1, y: 2 };
    api.follow(target);
    expect(state.follow).toBe(target);
    api.follow();
    expect(state.follow).toBeUndefined();
  });
});

describe("api — animated (delegates to app.tween)", () => {
  it("moveTo clears follow and tweens the center object to (x, y)", () => {
    const { api, state, to, handle } = startedCtx();
    state.follow = { x: 0, y: 0 };
    const result = api.moveTo(640, 360, { duration: 0.6 });

    expect(state.follow).toBeUndefined();
    expect(to).toHaveBeenCalledTimes(1);
    expect(to.mock.calls[0]?.[0]).toBe(state.center); // tweens the live center object
    expect(to.mock.calls[0]?.[1]).toEqual({ x: 640, y: 360 });
    expect(result).toBe(handle);
  });

  it("zoomTo tweens from current zoom to the clamped target; onUpdate writes zoom", () => {
    const { api, state, value, calls } = startedCtx();
    state.zoom = 1;
    api.zoomTo(50, { duration: 0.4 }); // 50 clamps to maxZoom 10

    expect(value).toHaveBeenCalledTimes(1);
    expect(value.mock.calls[0]?.[0]).toBe(1); // from = current zoom
    expect(value.mock.calls[0]?.[1]).toBe(10); // to = clamped target
    lastOpts(calls).onUpdate?.(4.5);
    expect(state.zoom).toBe(4.5);
  });

  it("rotateTo tweens from current rotation to the target; onUpdate writes rotation", () => {
    const { api, state, value, calls } = startedCtx();
    state.rotation = 0;
    api.rotateTo(Math.PI, { duration: 0.5 });

    expect(value.mock.calls[0]?.[0]).toBe(0);
    expect(value.mock.calls[0]?.[1]).toBeCloseTo(Math.PI, 6);
    lastOpts(calls).onUpdate?.(1.23);
    expect(state.rotation).toBe(1.23);
  });

  it("shake replaces any in-flight shake, sets intensity, and decays via tween.value", () => {
    const { api, state, value, calls, handle } = startedCtx();
    const priorStop = vi.fn();
    state.shakeHandle = {
      stop: priorStop,
      pause: vi.fn(),
      resume: vi.fn(),
      active: true,
      done: Promise.resolve()
    };

    api.shake(20, 0.5);
    expect(priorStop).toHaveBeenCalled(); // in-flight shake stopped
    expect(state.shakeHandle).toBe(handle); // reassigned to the NEW decay handle (so the next shake can stop it)
    expect(state.shakeIntensity).toBe(20);
    expect(value.mock.calls[0]?.[0]).toBe(20); // from = intensity
    expect(value.mock.calls[0]?.[1]).toBe(0); // to = 0 (decay)
    lastOpts(calls).onUpdate?.(7); // decay callback writes the live intensity
    expect(state.shakeIntensity).toBe(7);
  });
});

describe("api — layers", () => {
  it("world getter returns the world container when a stage exists, undefined headless", () => {
    const withStage = startedCtxWithStage();
    expect(withStage.api.world).toBe(withStage.world);

    const headless = startedCtx();
    expect(headless.api.world).toBeUndefined();
  });

  it("addLayer creates a layer once and is idempotent by name", () => {
    const { api, state } = startedCtxWithStage();
    const bg = api.addLayer("background", 0.5);
    expect(bg).toBeInstanceOf(Container);
    expect(state.layers.get("background")?.factor).toBe(0.5);

    const again = api.addLayer("background", 0.9); // idempotent — factor NOT overwritten
    expect(again).toBe(bg);
    expect(state.layers.get("background")?.factor).toBe(0.5);
  });

  it("addLayer returns undefined and warns when headless", () => {
    const { api, log } = startedCtx();
    expect(api.addLayer("bg", 0.5)).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it("layer(name) resolves a previously-added container", () => {
    const { api } = startedCtxWithStage();
    const fg = api.addLayer("fg", 1.5);
    expect(api.layer("fg")).toBe(fg);
    expect(api.layer("missing")).toBeUndefined();
  });
});

describe("api — pure readers (work before start)", () => {
  it("getPosition returns a copy — mutating it does not change state (before start)", () => {
    const { api, state } = unstartedCtx(); // pure reader — works before start, no guard
    state.center.x = 42;
    const p = api.getPosition();
    expect(p).toEqual({ x: 42, y: 0 });
    p.x = 999;
    expect(state.center.x).toBe(42);
  });

  it("screenToWorld / worldToScreen map correctly before start without warning", () => {
    const { api, log } = unstartedCtx();
    expect(api.screenToWorld({ x: 400, y: 300 })).toEqual({ x: 0, y: 0 });
    expect(api.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
    expect(log.warn).not.toHaveBeenCalled(); // readers are not guarded
  });

  it("getZoom / getRotation read the current numeric state before start", () => {
    const { api } = unstartedCtx();
    expect(api.getZoom()).toBe(1);
    expect(api.getRotation()).toBe(0);
  });
});

describe("api — type-level contracts", () => {
  it("MoveOptions omits repeat/yoyo (a repeating camera pan is nonsensical)", () => {
    const { api } = startedCtx();
    const contracts = (): void => {
      api.moveTo(1, 1, { duration: 0.3, easing: "linear" }); // ok
      // @ts-expect-error — repeat is not a MoveOptions field.
      api.moveTo(1, 1, { repeat: 2 });
      // @ts-expect-error — yoyo is not a MoveOptions field.
      api.zoomTo(2, { yoyo: true });
    };
    expect(typeof contracts).toBe("function");
  });
});
