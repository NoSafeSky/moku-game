/**
 * @file loop plugin — unit tests for the Time resource.
 *
 * Verifies that:
 * - step() advances Time by exactly fixedDt (dt, elapsed, frame)
 * - Time is advanced BEFORE tickFunction runs (ordering)
 * - N accumulated fixed steps in one rAF frame advance Time N times
 * - The Time object on LoopRuntime is the SAME reference as world.resource(Time)
 * - loop.time on the API equals the Time token (re-exported from resources.ts)
 * - TimeState type inference: readonly contract (type-level)
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { Resource, World } from "../../../ecs/types";
import { createApi, type LoopContext } from "../../api";
import { loopRegistry, start } from "../../lifecycle";
import { Time } from "../../resources";
import { createState } from "../../state";
import type { Api, Config, State, TimeState, TimeStepResult } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fake rAF / cancelAF / document  (mirrors api.test.ts setup)
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

/** Flush exactly one pending rAF callback at the given timestamp. */
const flushRaf = (timestampMs: number): void => {
  const entry = rafCallbacks.shift();
  if (entry) entry.cb(timestampMs);
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock World factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal mock World for Time resource tests.
 *
 * `resource`, `setResource`, and `getResource` use plain generic functions stored
 * in a local Map so TypeScript preserves the `T` type parameter at each call site.
 * A separate `vi.fn()` spy is attached as `setResource.spy` so tests can inspect calls.
 */
type MockWorld = Omit<World, "setResource"> & {
  /** Records calls and also populates the registry. */
  readonly setResource: World["setResource"] & {
    readonly mock: ReturnType<typeof vi.fn>["mock"];
  };
};

const makeMockWorld = (): MockWorld => {
  const registry = new Map<string, unknown>();
  const setResourceSpy = vi.fn();

  const mockWorld: MockWorld = {
    setResource: Object.assign(
      <T>(res: Resource<T>, value: T): void => {
        setResourceSpy(res, value);
        registry.set(res.__key, value);
      },
      { mock: setResourceSpy.mock }
    ) as MockWorld["setResource"],
    resource<T>(res: Resource<T>): T {
      const val = registry.get(res.__key);
      if (val === undefined) throw new Error(`Resource "${res.__key}" not set`);
      return val as T;
    },
    getResource<T>(res: Resource<T>): T | undefined {
      return registry.get(res.__key) as T | undefined;
    },
    hasResource<T>(res: Resource<T>): boolean {
      return registry.has(res.__key);
    },
    defineResource: vi.fn() as unknown as World["defineResource"],
    removeResource: vi.fn() as unknown as World["removeResource"],
    // entity ops — not used but required for structural typing as World
    defineComponent: vi.fn() as unknown as World["defineComponent"],
    defineTag: vi.fn() as unknown as World["defineTag"],
    spawn: vi.fn() as unknown as World["spawn"],
    despawn: vi.fn() as unknown as World["despawn"],
    isAlive: vi.fn() as unknown as World["isAlive"],
    add: vi.fn() as unknown as World["add"],
    remove: vi.fn() as unknown as World["remove"],
    has: vi.fn() as unknown as World["has"],
    get: vi.fn() as unknown as World["get"],
    set: vi.fn() as unknown as World["set"],
    query: vi.fn() as unknown as World["query"],
    addSystem: vi.fn() as unknown as World["addSystem"],
    tick: vi.fn() as unknown as World["tick"],
    // introspection facet (Cycle 4) — unused here but required for structural typing as World
    liveEntities: vi.fn() as unknown as World["liveEntities"],
    entityCount: vi.fn() as unknown as World["entityCount"],
    componentNames: vi.fn() as unknown as World["componentNames"],
    componentsOf: vi.fn() as unknown as World["componentsOf"],
    componentByName: vi.fn() as unknown as World["componentByName"]
  };

  return mockWorld;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock context factory (mirrors api.test.ts, extended with ECS world)
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

/** Boots a ctx with lifecycle.start() seeded and a real mock World attached. */
const bootCtxWithWorld = async (configOverrides?: Partial<Config>) => {
  const config = { ...defaultConfig, ...configOverrides };
  const state: State = { running: false, accumulator: 0, lastTime: undefined };
  const globalObj = Object.freeze({});
  const tick = vi.fn();
  const render = vi.fn();
  const world = makeMockWorld();

  // Put world fields first, then override with scheduler/renderer fields explicitly.
  // world.tick (ECS tick) must NOT shadow the scheduler's tick — they are different.
  const depsMock = {
    ...world,
    // scheduler API (overwrites world.tick which is the ECS tick method)
    tick,
    render,
    addSystem: vi.fn(),
    stages: [] as readonly string[]
  };

  // Single-require mock that satisfies all overloads:
  // - schedulerPlugin → returns tick/addSystem/stages
  // - rendererPlugin  → returns render
  // - ecsPlugin       → returns world
  // Since it's a mock, one object with all fields works.
  const typedRequire = (_plugin: unknown) => depsMock;

  const fullCtx = {
    config,
    state,
    global: globalObj,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    deps: { tick, render },
    require: typedRequire
  };

  await start(fullCtx as Parameters<typeof start>[0]);

  return {
    ctx: fullCtx as unknown as LoopContext & { deps: MockDeps },
    deps: { tick, render },
    world
  };
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
  delete (fakeGlobal as Record<string, unknown>).requestAnimationFrame;
  delete (fakeGlobal as Record<string, unknown>).cancelAnimationFrame;
  delete (fakeGlobal as Record<string, unknown>).document;
  rafCallbacks = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// Time resource token
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: Time resource token", () => {
  it('Time.__key is "loop:time"', () => {
    expect(Time.__key).toBe("loop:time");
  });

  it("loop.time on the API equals the Time token", async () => {
    const { ctx } = await bootCtxWithWorld();
    const api = createApi(ctx);
    expect(api.time).toBe(Time);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Time bound to world on start
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: Time resource bound at onStart", () => {
  it("world.setResource is called with Time during lifecycle.start", async () => {
    const { world } = await bootCtxWithWorld();
    // setResource should have been called once with the Time token
    const callArgs = world.setResource.mock.calls.find(
      ([token]) => (token as { __key: string }).__key === "loop:time"
    );
    expect(callArgs).toBeDefined();
  });

  it("world.resource(Time) reflects the cached object (same reference)", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const runtime = loopRegistry.get(ctx.global);
    expect(runtime).toBeDefined();

    if (!runtime) throw new Error("runtime not found in registry");
    const timeFromRegistry = world.resource(Time);
    // The object stored in world must be the SAME reference as runtime.time
    expect(timeFromRegistry).toBe(runtime.time);
  });

  it("Time starts at { dt: 0, elapsed: 0, frame: 0 }", async () => {
    const { world } = await bootCtxWithWorld();
    const time = world.resource(Time);
    expect(time.dt).toBe(0);
    expect(time.elapsed).toBe(0);
    expect(time.frame).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// step() advances Time
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: step() advances Time", () => {
  it("step() sets dt === fixedDt", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const api = createApi(ctx);

    api.step();

    const time = world.resource(Time);
    expect(time.dt).toBe(defaultConfig.fixedDt);
  });

  it("step() increments elapsed by fixedDt", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const api = createApi(ctx);

    api.step();

    const time = world.resource(Time);
    expect(time.elapsed).toBeCloseTo(defaultConfig.fixedDt, 10);
  });

  it("step() increments frame by 1", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const api = createApi(ctx);

    api.step();

    const time = world.resource(Time);
    expect(time.frame).toBe(1);
  });

  it("three step() calls accumulate frame=3 and elapsed=3*fixedDt", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const api = createApi(ctx);

    api.step();
    api.step();
    api.step();

    const time = world.resource(Time);
    expect(time.frame).toBe(3);
    expect(time.elapsed).toBeCloseTo(3 * defaultConfig.fixedDt, 10);
  });

  it("step() advances Time BEFORE tickFunction runs (ordering)", async () => {
    const { ctx, world, deps } = await bootCtxWithWorld();
    const capturedFrame: number[] = [];

    deps.tick.mockImplementation(() => {
      const time = world.resource(Time);
      capturedFrame.push(time.frame);
    });

    const api = createApi(ctx);
    api.step();

    // tickFunction saw frame=1, meaning Time was already advanced before the tick
    expect(capturedFrame[0]).toBe(1);
  });

  it("step() advances Time BEFORE renderFunction runs (ordering)", async () => {
    const { ctx, world, deps } = await bootCtxWithWorld();
    const capturedElapsed: number[] = [];

    deps.render.mockImplementation(() => {
      const time = world.resource(Time);
      capturedElapsed.push(time.elapsed);
    });

    const api = createApi(ctx);
    api.step();

    // renderFunction saw elapsed = fixedDt, meaning Time was already advanced
    expect(capturedElapsed[0]).toBeCloseTo(defaultConfig.fixedDt, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rAF driver advances Time (N steps per frame)
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: rAF driver advances Time N times per frame", () => {
  it("3 fixed steps in one rAF frame advance frame to 3", async () => {
    const { ctx, world } = await bootCtxWithWorld({
      fixedDt: 1 / 60,
      maxStepsPerFrame: 10
    });
    const api = createApi(ctx);
    api.start();

    // Seed lastTime
    flushRaf(0);
    // Provide exactly 3 * fixedDt of elapsed time
    flushRaf(3 * (1000 / 60));

    const time = world.resource(Time);
    expect(time.frame).toBe(3);
    expect(time.elapsed).toBeCloseTo(3 * (1 / 60), 10);
  });

  it("Time.dt equals fixedDt after each rAF step", async () => {
    const { ctx, world } = await bootCtxWithWorld({ fixedDt: 0.02 });
    const api = createApi(ctx);
    api.start();

    flushRaf(0);
    flushRaf(20); // 20ms = 0.02s = 1 fixedDt

    const time = world.resource(Time);
    expect(time.dt).toBe(0.02);
  });

  it("tickFunction captures the incremented Time during each rAF step", async () => {
    const { ctx, world, deps } = await bootCtxWithWorld({
      fixedDt: 1 / 60,
      maxStepsPerFrame: 10
    });
    const capturedFrames: number[] = [];

    deps.tick.mockImplementation(() => {
      const time = world.resource(Time);
      capturedFrames.push(time.frame);
    });

    const api = createApi(ctx);
    api.start();

    flushRaf(0);
    // 2 * fixedDt → 2 ticks
    flushRaf(2 * (1000 / 60));

    // Each tick should have seen frame 1 then 2 (incremented before calling tick)
    expect(capturedFrames).toEqual([1, 2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reference identity: no reallocation
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: Time mutated in place (no realloc)", () => {
  it("world.resource(Time) returns the same object after step()", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const api = createApi(ctx);

    const ref1 = world.resource(Time);
    api.step();
    const ref2 = world.resource(Time);

    // Same reference — no per-step setResource realloc
    expect(ref1).toBe(ref2);
  });

  it("runtime.time and world.resource(Time) are always the same object", async () => {
    const { ctx, world } = await bootCtxWithWorld();
    const runtime = loopRegistry.get(ctx.global);
    expect(runtime).toBeDefined();
    if (!runtime) throw new Error("runtime not found");

    const api = createApi(ctx);
    api.step();
    api.step();

    const fromWorld = world.resource(Time);
    expect(fromWorld).toBe(runtime.time);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level tests
// ─────────────────────────────────────────────────────────────────────────────

describe("loop: Time type-level", () => {
  it("Api.time has the correct Resource<TimeState> type", () => {
    expectTypeOf<Api["time"]>().toEqualTypeOf<Resource<TimeState>>();
  });

  it("TimeState.dt is number (readonly)", () => {
    expectTypeOf<TimeState["dt"]>().toEqualTypeOf<number>();
  });

  it("TimeState.elapsed is number (readonly)", () => {
    expectTypeOf<TimeState["elapsed"]>().toEqualTypeOf<number>();
  });

  it("TimeState.frame is number (readonly)", () => {
    expectTypeOf<TimeState["frame"]>().toEqualTypeOf<number>();
  });

  it("createState result does not include time (state shape unchanged)", () => {
    const state = createState({ global: Object.freeze({}), config: defaultConfig });
    // State does not have a 'time' field — Time lives in the World registry
    expect("time" in state).toBe(false);
  });

  it("Api.step returns TimeStepResult (Cycle 5 — type-level)", () => {
    expectTypeOf<Api["step"]>().toEqualTypeOf<() => TimeStepResult>();
  });

  it("TimeStepResult.frame is number", () => {
    expectTypeOf<TimeStepResult["frame"]>().toEqualTypeOf<number>();
  });

  it("TimeStepResult.elapsed is number", () => {
    expectTypeOf<TimeStepResult["elapsed"]>().toEqualTypeOf<number>();
  });

  it("TimeStepResult.dt is number", () => {
    expectTypeOf<TimeStepResult["dt"]>().toEqualTypeOf<number>();
  });
});
