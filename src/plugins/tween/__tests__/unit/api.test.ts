/**
 * @file tween plugin — API surface unit tests.
 *
 * Exercises `app.tween` via `createApi` with a minimal mock ctx (`{ config, state,
 * log }`) — no kernel. Covers before-start + over-cap dead handles, `to`/`from`
 * capture semantics, scalar `value`, non-finite skips, handle control
 * (stop/pause/resume/active/done), `killAll`/`count`, easing resolution, config
 * defaults, and the `NumericProperties` / `value` type-level contracts.
 */
import { describe, expect, it, vi } from "vitest";
import { createApi, type TweenApiContext } from "../../api";
import { easing as easingTable } from "../../easing";
import { createState } from "../../state";
import type { Config, State, TweenRecord } from "../../types";

/** Build a tween config with optional overrides. */
const makeConfig = (over: Partial<Config> = {}): Config => ({
  defaultDuration: 0.3,
  defaultEasing: "easeOutCubic",
  updateStage: "update",
  maxActive: 2048,
  ...over
});

/** A logger whose four levels are vi spies. */
const makeLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A STARTED api context (advance system assumed registered → `started: true`). */
const startedCtx = (config: Config = makeConfig()) => {
  const state = createState({ global: {}, config });
  state.started = true;
  const log = makeLog();
  const ctx: TweenApiContext = { config, state, log };
  return { api: createApi(ctx), state, log, config };
};

/** An UNSTARTED api context (`started: false` → every creator guards). */
const unstartedCtx = () => {
  const config = makeConfig();
  const state = createState({ global: {}, config });
  const log = makeLog();
  return { api: createApi({ config, state, log }), state, log };
};

/** The first record in the registry (narrowed, no non-null assertion). */
const firstRecord = (state: State): TweenRecord => {
  const record = [...state.tweens.values()][0];
  if (!record) throw new Error("expected a tween record");
  return record;
};

/** A custom ease-in-quad curve for the custom-easing contract test. */
const squareEase = (t: number): number => t * t;

describe("api — guarded no-ops before start", () => {
  it("to warns and returns a dead handle; no tween created", () => {
    const { api, state, log } = unstartedCtx();
    const handle = api.to({ x: 0 }, { x: 1 });
    expect(handle.active).toBe(false);
    expect(state.tweens.size).toBe(0);
    expect(log.warn).toHaveBeenCalled();
  });

  it("the dead handle's done is already resolved and its methods are inert", async () => {
    const { api } = unstartedCtx();
    const handle = api.value(0, 1, { onUpdate: vi.fn() });
    await expect(handle.done).resolves.toBeUndefined();
    expect(() => {
      handle.pause();
      handle.resume();
      handle.stop();
    }).not.toThrow();
    expect(handle.active).toBe(false);
  });
});

describe("api — to / from", () => {
  it("to captures the start value and lerps to the end via apply", () => {
    const { api, state } = startedCtx();
    const obj = { x: 0, y: 10 };
    api.to(obj, { x: 100, y: 20 }, { duration: 1, easing: "linear" });

    firstRecord(state).apply(0.5);
    expect(obj.x).toBe(50);
    expect(obj.y).toBe(15);
  });

  it("to forwards eased progress to onUpdate", () => {
    const { api, state } = startedCtx();
    const seen: number[] = [];
    api.to({ x: 0 }, { x: 1 }, { onUpdate: p => seen.push(p) });
    firstRecord(state).apply(0.42);
    expect(seen.at(-1)).toBe(0.42);
  });

  it("from applies the from-value immediately then tweens back to the original", () => {
    const { api, state } = startedCtx();
    const obj = { x: 100 };
    api.from(obj, { x: 0 }, { duration: 1, easing: "linear" });
    expect(obj.x).toBe(0); // from-value applied at creation

    firstRecord(state).apply(1);
    expect(obj.x).toBe(100); // back to the captured destination
  });

  it("skips a non-finite property as a no-op and debug-logs it", () => {
    const { api, state, log } = startedCtx();
    const obj = { x: 0, hp: Number.NaN };
    api.to(obj, { x: 100, hp: 5 });

    firstRecord(state).apply(1);
    expect(obj.x).toBe(100);
    expect(obj.hp).toBeNaN(); // untouched — non-finite start skipped
    expect(log.debug).toHaveBeenCalled();
  });

  it("from skips a property whose current value is non-finite and debug-logs it", () => {
    const { api, state, log } = startedCtx();
    const obj = { x: 0, hp: Number.POSITIVE_INFINITY };
    api.from(obj, { x: 100, hp: 5 });

    // x captured (from-value applied); hp skipped (non-finite destination).
    expect(obj.x).toBe(100); // from-value applied immediately
    expect(obj.hp).toBe(Number.POSITIVE_INFINITY); // untouched
    firstRecord(state).apply(1);
    expect(obj.x).toBe(0); // tweened back to the captured original
    expect(log.debug).toHaveBeenCalled();
  });
});

describe("api — value", () => {
  it("drives onUpdate with the interpolated value", () => {
    const { api, state } = startedCtx();
    const seen: number[] = [];
    api.value(0, 200, { duration: 1, easing: "linear", onUpdate: v => seen.push(v) });
    firstRecord(state).apply(0.25);
    expect(seen.at(-1)).toBe(50);
  });
});

describe("api — handle control", () => {
  it("stop removes the tween and settles done without firing onComplete", async () => {
    const { api, state } = startedCtx();
    const onComplete = vi.fn();
    const handle = api.to({ x: 0 }, { x: 1 }, { onComplete });

    expect(handle.active).toBe(true);
    handle.stop();
    expect(handle.active).toBe(false);
    expect(state.tweens.size).toBe(0);
    await expect(handle.done).resolves.toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("stop is idempotent", () => {
    const { api } = startedCtx();
    const handle = api.to({ x: 0 }, { x: 1 });
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });

  it("pause flips the record's paused flag; resume clears it", () => {
    const { api, state } = startedCtx();
    const handle = api.to({ x: 0 }, { x: 1 });

    handle.pause();
    expect(firstRecord(state).paused).toBe(true);
    handle.resume();
    expect(firstRecord(state).paused).toBe(false);
  });
});

describe("api — maxActive cap", () => {
  it("over the cap, creators warn and return a dead handle", () => {
    const { api, state, log } = startedCtx(makeConfig({ maxActive: 1 }));
    api.to({ x: 0 }, { x: 1 }); // fills the cap
    const handle = api.to({ x: 0 }, { x: 1 }); // over the cap

    expect(handle.active).toBe(false);
    expect(state.tweens.size).toBe(1);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe("api — killAll / count", () => {
  it("count reflects the number of active tweens", () => {
    const { api } = startedCtx();
    expect(api.count()).toBe(0);
    api.to({ x: 0 }, { x: 1 });
    api.to({ y: 0 }, { y: 1 });
    expect(api.count()).toBe(2);
  });

  it("killAll settles + clears every tween without firing onComplete", async () => {
    const { api, state } = startedCtx();
    const onComplete = vi.fn();
    const a = api.to({ x: 0 }, { x: 1 }, { onComplete });
    const b = api.value(0, 1, { onUpdate: vi.fn(), onComplete });
    expect(state.tweens.size).toBe(2);

    api.killAll();
    expect(state.tweens.size).toBe(0);
    expect(api.count()).toBe(0);
    await expect(Promise.all([a.done, b.done])).resolves.toBeDefined();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("api — easing resolution + defaults", () => {
  it("exposes the shared easing table and lerp", () => {
    const { api } = startedCtx();
    expect(api.easing).toBe(easingTable);
    expect(api.lerp(0, 100, 0.25)).toBe(25);
  });

  it("resolves a named easing to the table curve", () => {
    const { api, state } = startedCtx();
    api.to({ x: 0 }, { x: 1 }, { easing: "easeOutCubic" });
    expect(firstRecord(state).easingFunction).toBe(easingTable.easeOutCubic);
  });

  it("resolves a custom easing function onto the record", () => {
    const { api, state } = startedCtx();
    api.to({ x: 0 }, { x: 1 }, { easing: squareEase });
    expect(firstRecord(state).easingFunction).toBe(squareEase);
  });

  it("applies config defaults for duration and easing when omitted", () => {
    const { api, state, config } = startedCtx();
    api.to({ x: 0 }, { x: 1 });
    const record = firstRecord(state);
    expect(record.duration).toBe(config.defaultDuration);
    expect(record.easingFunction).toBe(easingTable[config.defaultEasing]);
  });

  it("coerces duration 0 up to a small positive epsilon", () => {
    const { api, state } = startedCtx();
    api.to({ x: 0 }, { x: 1 }, { duration: 0 });
    expect(firstRecord(state).duration).toBeGreaterThan(0);
  });
});

describe("api — type-level contracts", () => {
  it("to/from reject non-numeric target keys; value requires onUpdate", () => {
    const { api } = startedCtx();
    const cam = { x: 0, label: "hud" };

    // Compile-time only — never invoked; tsc still type-checks the body.
    const contracts = (): void => {
      // @ts-expect-error — label is not a numeric key of cam.
      api.to(cam, { label: "x" });
      api.to(cam, { x: 100 }); // ok — numeric key
      // @ts-expect-error — value requires opts.onUpdate.
      api.value(0, 1, { duration: 1 });
    };
    expect(typeof contracts).toBe("function");
  });
});
