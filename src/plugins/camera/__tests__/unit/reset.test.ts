/**
 * @file camera plugin — unit tests for the editor-cycle `reset()` delta.
 *
 * `reset()` recentres to (0,0), sets `zoom → config.zoom` and `rotation → 0`, clears any `follow`
 * target, and stops an in-flight `shake` (`shakeIntensity → 0`), leaving layers + tween intact.
 */
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

/** A shake handle whose `stop` is a separately-returned spy, so reset()'s stop() is observable. */
const makeShakeHandle = () => {
  const stop = vi.fn();
  const handle: TweenHandle = {
    stop,
    pause: vi.fn(),
    resume: vi.fn(),
    active: true,
    done: Promise.resolve()
  };
  return { handle, stop };
};

/** A started camera api context with a fake captured tween. */
const startedCtx = (over: Partial<Config> = {}) => {
  const config = makeConfig(over);
  const state = createState({ global: {}, config });
  state.started = true;
  const { handle, stop } = makeShakeHandle();
  state.tween = {
    value: vi.fn(() => handle),
    lerp: (a: number, b: number, t: number) => a + (b - a) * t
  } as unknown as TweenApi;
  const log = makeLog();
  return { api: createApi({ config, state, log }), state, log, handle, stop };
};

describe("camera — reset()", () => {
  it("recentres, restores zoom→config.zoom + rotation→0, and clears follow", () => {
    const { api, state } = startedCtx({ zoom: 2 });
    state.center.x = 123;
    state.center.y = -45;
    state.zoom = 7;
    state.rotation = 1.2;
    state.follow = { x: 10, y: 10 };

    api.reset();

    expect(state.center).toEqual({ x: 0, y: 0 });
    expect(state.zoom).toBe(2); // config.zoom
    expect(state.rotation).toBe(0);
    expect(state.follow).toBeUndefined();
  });

  it("stops an in-flight shake and zeroes shakeIntensity", () => {
    const { api, state, handle, stop } = startedCtx();
    state.shakeIntensity = 16;
    state.shakeHandle = handle;

    api.reset();

    expect(stop).toHaveBeenCalledOnce();
    expect(state.shakeHandle).toBeUndefined();
    expect(state.shakeIntensity).toBe(0);
  });
});
