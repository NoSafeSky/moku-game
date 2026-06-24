/**
 * @file loop plugin — unit tests for createApi and lifecycle (frame driver).
 *
 * Tests the accumulator stepping, delta clamping, maxStepsPerFrame cap,
 * start/stop/isRunning transitions, step(), and visibilitychange reset.
 *
 * DOM globals (requestAnimationFrame, cancelAnimationFrame, document) are
 * injected as fakes — no jsdom needed.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { createApi, type LoopContext } from "../../api";
import { loopRegistry } from "../../lifecycle";
import { createState } from "../../state";
import type { Api, Config, State } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fake rAF / cancelAF / document
// ─────────────────────────────────────────────────────────────────────────────

type FakeRafGlobal = {
  requestAnimationFrame: (cb: (t: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  document: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
};

let rafCallbacks: Array<{ id: number; cb: (t: number) => void }> = [];
let rafIdCounter = 0;

const fakeRaf = (cb: (t: number) => void): number => {
  const id = ++rafIdCounter;
  rafCallbacks.push({ id, cb });
  return id;
};

const fakeCaf = (id: number): void => {
  rafCallbacks = rafCallbacks.filter(entry => entry.id !== id);
};

/** Flush exactly N pending rAF callbacks with the given timestamp, returning new pending count. */
const flushRaf = (timestampMs: number, count = 1): void => {
  for (let flushed = 0; flushed < count; flushed++) {
    const entry = rafCallbacks.shift();
    if (!entry) break;
    entry.cb(timestampMs);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock context factory
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = {
  fixedDt: 1 / 60,
  maxFrameDelta: 0.25,
  maxStepsPerFrame: 5,
  autoStart: false
};

type MockDeps = {
  tick: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
};

const makeCtx = (
  configOverrides?: Partial<Config>,
  stateOverrides?: Partial<State>
): {
  config: Readonly<Config>;
  state: State;
  global: object;
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  deps: MockDeps;
  require: (_plugin: unknown) => {
    tick: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
  };
} => {
  const config = { ...defaultConfig, ...configOverrides };
  const state: State = {
    running: false,
    accumulator: 0,
    lastTime: undefined,
    ...stateOverrides
  };
  const globalObj = Object.freeze({});
  const tick = vi.fn();
  const render = vi.fn();

  const require = (_plugin: unknown) => ({ tick, render });

  return {
    config,
    state,
    global: globalObj,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    deps: { tick, render },
    require
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to seed WeakMap via lifecycle start
// ─────────────────────────────────────────────────────────────────────────────

import { start, stop } from "../../lifecycle";

/** Sets up a ctx with lifecycle started (seeds the WeakMap). */
const bootCtx = async (configOverrides?: Partial<Config>, stateOverrides?: Partial<State>) => {
  const ctx = makeCtx(configOverrides, stateOverrides);

  // Both requires return an object that satisfies scheduler (tick) and renderer (render).
  // lifecycle.ts calls require(schedulerPlugin) → uses .tick
  //                  require(rendererPlugin)  → uses .render
  // Returning both fields from a single mock satisfies both call sites.
  const depsMock = {
    tick: ctx.deps.tick,
    render: ctx.deps.render,
    addSystem: vi.fn(),
    stages: [] as readonly string[]
  };

  const typedRequire = (_plugin: unknown) => depsMock;

  const fullCtx = {
    ...ctx,
    require: typedRequire
  };

  await start(fullCtx as Parameters<typeof start>[0]);
  // Cast at the mock boundary: vi.fn() mocks aren't structurally assignable to
  // LoopContext.require's precise (dt: number) => void overloads. deps is kept
  // on the type so call-order tests can still reach ctx.deps.tick/render.
  return { ctx: fullCtx as unknown as LoopContext & { deps: MockDeps }, deps: ctx.deps };
};

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  rafCallbacks = [];
  rafIdCounter = 0;
  vi.clearAllMocks();

  const fakeGlobal = globalThis as unknown as FakeRafGlobal;
  fakeGlobal.requestAnimationFrame = fakeRaf;
  fakeGlobal.cancelAnimationFrame = fakeCaf;
  fakeGlobal.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
});

afterEach(() => {
  const fakeGlobal = globalThis as unknown as FakeRafGlobal;
  // Clean up fakes
  delete (fakeGlobal as Record<string, unknown>).requestAnimationFrame;
  delete (fakeGlobal as Record<string, unknown>).cancelAnimationFrame;
  delete (fakeGlobal as Record<string, unknown>).document;
  rafCallbacks = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// State unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: createState", () => {
  it("initial state is running=false, accumulator=0, lastTime=undefined", () => {
    const state = createState({ global: Object.freeze({}), config: defaultConfig });
    expect(state.running).toBe(false);
    expect(state.accumulator).toBe(0);
    expect(state.lastTime).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API: isRunning
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: isRunning", () => {
  it("returns false before start", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);
    expect(api.isRunning()).toBe(false);
  });

  it("returns true after start()", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);
    api.start();
    expect(api.isRunning()).toBe(true);
  });

  it("returns false after stop()", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);
    api.start();
    api.stop();
    expect(api.isRunning()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API: start / stop (no-op guards)
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: start / stop transitions", () => {
  it("start() is a no-op if already running", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);

    api.start();
    const countBefore = rafCallbacks.length;
    api.start(); // second start — should not add another rAF
    expect(rafCallbacks.length).toBe(countBefore);
  });

  it("stop() is a no-op if not running (no throw)", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);
    expect(() => api.stop()).not.toThrow();
  });

  it("stop() cancels the pending rAF", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);

    api.start();
    expect(rafCallbacks.length).toBe(1);
    api.stop();
    expect(rafCallbacks.length).toBe(0);
  });

  it("start() resets accumulator and lastTime", async () => {
    const { ctx } = await bootCtx();
    // Contaminate state
    ctx.state.accumulator = 0.999;
    ctx.state.lastTime = 12_345;

    const api = createApi(ctx);
    api.start();

    expect(ctx.state.accumulator).toBe(0);
    expect(ctx.state.lastTime).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API: step()
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: step()", () => {
  it("calls scheduler.tick once with fixedDt", async () => {
    const { ctx, deps } = await bootCtx();
    const api = createApi(ctx);

    api.step();

    expect(deps.tick).toHaveBeenCalledTimes(1);
    expect(deps.tick).toHaveBeenCalledWith(defaultConfig.fixedDt);
  });

  it("calls renderer.render once per step()", async () => {
    const { ctx, deps } = await bootCtx();
    const api = createApi(ctx);

    api.step();

    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it("calls scheduler.tick before renderer.render in step()", async () => {
    const { ctx } = await bootCtx();
    const callOrder: string[] = [];

    ctx.deps.tick.mockImplementation(() => callOrder.push("tick"));
    ctx.deps.render.mockImplementation(() => callOrder.push("render"));

    const api = createApi(ctx);
    api.step();

    expect(callOrder).toEqual(["tick", "render"]);
  });

  it("step() works when loop is not running", async () => {
    const { ctx, deps } = await bootCtx();
    const api = createApi(ctx);

    expect(api.isRunning()).toBe(false);
    expect(() => api.step()).not.toThrow();
    expect(deps.tick).toHaveBeenCalledTimes(1);
    expect(deps.render).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Frame driver: accumulator stepping
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: accumulator and fixed steps", () => {
  it("steps exactly N times for a delta of N * fixedDt", async () => {
    // fixedDt = 1/60, 3 steps → delta = 3/60 seconds = 50ms
    const { ctx, deps } = await bootCtx({ fixedDt: 1 / 60, maxStepsPerFrame: 10 });
    const api = createApi(ctx);
    api.start();

    // First rAF call seeds lastTime
    flushRaf(0);
    // Second rAF call provides 3 * fixedDt = 50ms of elapsed time
    flushRaf(3 * (1000 / 60));

    expect(deps.tick).toHaveBeenCalledTimes(3);
  });

  it("clamps delta to maxFrameDelta (spiral-of-death guard)", async () => {
    // maxFrameDelta = 0.25s, fixedDt = 1/60, maxStepsPerFrame = 5
    // 2s real elapsed → clamped to 0.25s → floor(0.25 / (1/60)) = 15 steps, but capped at 5
    const { ctx, deps } = await bootCtx({
      fixedDt: 1 / 60,
      maxFrameDelta: 0.25,
      maxStepsPerFrame: 5
    });
    const api = createApi(ctx);
    api.start();

    flushRaf(0);
    // 2000ms = 2s elapsed — should clamp to maxFrameDelta (0.25s)
    flushRaf(2000);

    // 0.25s / (1/60) ≈ 15 steps, capped at maxStepsPerFrame=5
    expect(deps.tick).toHaveBeenCalledTimes(5);
  });

  it("hard-caps at maxStepsPerFrame even without clamping", async () => {
    // fixedDt = 0.01s, maxStepsPerFrame = 3
    // 10 * fixedDt = 0.1s of delta → would normally step 10 times, but capped at 3
    const { ctx, deps } = await bootCtx({
      fixedDt: 0.01,
      maxFrameDelta: 1,
      maxStepsPerFrame: 3
    });
    const api = createApi(ctx);
    api.start();

    flushRaf(0);
    flushRaf(100); // 100ms = 0.1s = 10 * fixedDt

    expect(deps.tick).toHaveBeenCalledTimes(3);
  });

  it("calls renderer.render exactly once per frame regardless of step count", async () => {
    const { ctx, deps } = await bootCtx({ fixedDt: 1 / 60, maxStepsPerFrame: 10 });
    const api = createApi(ctx);
    api.start();

    flushRaf(0);
    flushRaf(3 * (1000 / 60)); // 3 steps

    expect(deps.tick).toHaveBeenCalledTimes(3);
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it("does not tick when delta is less than fixedDt", async () => {
    const { ctx, deps } = await bootCtx({ fixedDt: 1 / 60 });
    const api = createApi(ctx);
    api.start();

    flushRaf(0);
    // 1ms = 0.001s << 1/60 ≈ 0.0167s
    flushRaf(1);

    expect(deps.tick).toHaveBeenCalledTimes(0);
    // render still called once
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it("accumulates remainder for the next frame", async () => {
    // fixedDt = 0.1s, send 0.15s → 1 step, 0.05s remainder
    // then 0.1s more → 0.15s accumulated → 1 more step
    const { ctx, deps } = await bootCtx({ fixedDt: 0.1, maxStepsPerFrame: 10, maxFrameDelta: 1 });
    const api = createApi(ctx);
    api.start();

    flushRaf(0); // seed
    flushRaf(150); // 150ms = 0.15s → 1 step, 0.05s remainder
    expect(deps.tick).toHaveBeenCalledTimes(1);

    flushRaf(250); // 250ms - 150ms = 0.1s + 0.05s remainder = 0.15s → 1 step
    expect(deps.tick).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// visibilitychange reset
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: visibilitychange resets accumulator and lastTime", () => {
  it("resets state on visibilitychange", async () => {
    const { ctx } = await bootCtx();
    const api = createApi(ctx);
    api.start();

    // Contaminate state
    ctx.state.accumulator = 0.5;
    ctx.state.lastTime = 99_999;

    // Simulate the visibilitychange event
    const docMock = (globalThis as unknown as FakeRafGlobal).document;
    const visibilityHandler = docMock.addEventListener.mock.calls[0]?.[1] as
      | (() => void)
      | undefined;
    expect(visibilityHandler).toBeDefined();
    visibilityHandler?.();

    expect(ctx.state.accumulator).toBe(0);
    expect(ctx.state.lastTime).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onStop lifecycle: WeakMap teardown
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: onStop teardown", () => {
  it("cancels pending rAF on stop(ctx)", async () => {
    const { ctx } = await bootCtx({ autoStart: true });
    // autoStart=true means lifecycle.start already scheduled a rAF
    expect(rafCallbacks.length).toBeGreaterThan(0);

    await stop({ global: ctx.global });
    expect(rafCallbacks.length).toBe(0);
  });

  it("onStop is idempotent (second stop does not throw)", async () => {
    const { ctx } = await bootCtx({ autoStart: true });
    await stop({ global: ctx.global });
    await expect(stop({ global: ctx.global })).resolves.toBeUndefined();
  });

  it("WeakMap has an entry after start", async () => {
    const { ctx } = await bootCtx({ autoStart: false });
    expect(loopRegistry.has(ctx.global)).toBe(true);
  });

  it("WeakMap entry is removed after onStop", async () => {
    const { ctx } = await bootCtx({ autoStart: false });
    await stop({ global: ctx.global });
    expect(loopRegistry.has(ctx.global)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level tests
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: types", () => {
  it("Api.start is () => void", () => {
    expectTypeOf<Api["start"]>().toEqualTypeOf<() => void>();
  });

  it("Api.stop is () => void", () => {
    expectTypeOf<Api["stop"]>().toEqualTypeOf<() => void>();
  });

  it("Api.isRunning is () => boolean", () => {
    expectTypeOf<Api["isRunning"]>().toEqualTypeOf<() => boolean>();
  });

  it("Api.step is () => void", () => {
    expectTypeOf<Api["step"]>().toEqualTypeOf<() => void>();
  });
});
