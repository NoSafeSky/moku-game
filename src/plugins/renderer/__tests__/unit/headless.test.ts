/**
 * @file renderer plugin — unit tests for headless mode (Cycle 3 delta).
 *
 * Tests cover:
 *   - detectHeadless(): returns true when document is absent, false when present.
 *   - Explicit headless config overrides auto-detection both ways.
 *   - Headless onStart: Pixi Application constructor NOT called; state.app stays
 *     undefined; Transform token IS defined; sync system IS registered.
 *   - All API methods are safe (no throw) when headless (state.app undefined).
 *   - Headless onStop: app.destroy is NOT called; views are cleared; idempotent.
 *   - Type-level: Config.headless is boolean.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted state — tracks Application constructor call count
// ─────────────────────────────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  constructorCallCount: 0,
  destroySpy: vi.fn(),
  initSpy: vi.fn().mockResolvedValue(undefined),
  reset(): void {
    this.constructorCallCount = 0;
    this.destroySpy.mockClear();
    this.initSpy.mockClear();
    this.initSpy.mockResolvedValue(undefined);
  }
}));

vi.mock("pixi.js", () => ({
  // Use a class so `new Application()` works. The class increments the shared
  // counter and exposes the same spy methods for both headless and non-headless.
  Application: class {
    init = mockState.initSpy;
    render = vi.fn();
    destroy = mockState.destroySpy;
    canvas = {} as HTMLCanvasElement;
    stage = {
      position: { set: vi.fn() },
      rotation: 0,
      scale: { set: vi.fn() },
      destroy: vi.fn()
    };

    constructor() {
      mockState.constructorCallCount++;
    }
  },
  Container: class {
    position = { set: vi.fn() };
    rotation = 0;
    scale = { set: vi.fn() };
    destroy = vi.fn();
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports after mocks
// ─────────────────────────────────────────────────────────────────────────────

import type { Container } from "pixi.js";
import type { Entity, World } from "../../../ecs/types";
import { createApi } from "../../api";
import { detectHeadless, start, stop } from "../../lifecycle";
import { createState } from "../../state";
import type { Config } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const baseConfig: Config = {
  width: 800,
  height: 600,
  background: 0x00_00_00,
  resolution: 0,
  antialias: true,
  mount: undefined,
  headless: true
};

const makeEntity = (n: number): Entity => n as Entity;

const makeWorld = (): World =>
  ({
    defineComponent: vi.fn().mockReturnValue({ __id: 1, __value: {} }),
    spawn: vi.fn(),
    despawn: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    get: vi.fn(),
    set: vi.fn(),
    query: vi.fn().mockReturnValue({ updateEach: vi.fn(), count: vi.fn(), first: vi.fn() }),
    add: vi.fn(),
    remove: vi.fn(),
    has: vi.fn(),
    addSystem: vi.fn().mockReturnValue(() => {
      /* no-op */
    }),
    tick: vi.fn(),
    defineTag: vi.fn()
  }) as unknown as World;

/**
 * Builds a StartContext for headless or non-headless paths.
 *
 * @param overrides - Optional config overrides (e.g. headless: false).
 * @returns A context tuple with ctx, state, log, global, addSystem, and world.
 */
const makeCtx = (overrides: Partial<Config> = {}) => {
  const config: Config = { ...baseConfig, ...overrides };
  const global = {};
  const state = createState({ global, config });
  const addSystem = vi.fn().mockReturnValue(() => {
    /* no-op */
  });
  const world = makeWorld();

  const unified = Object.assign(Object.create(world as object), { addSystem });
  const require = vi.fn().mockReturnValue(unified);

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };

  const ctx = {
    config,
    state,
    global,
    log,
    require: require as Parameters<typeof createApi>[0]["require"]
  };

  return { ctx: ctx as Parameters<typeof createApi>[0], state, log, global, addSystem, world };
};

// ─────────────────────────────────────────────────────────────────────────────
// detectHeadless()
// ─────────────────────────────────────────────────────────────────────────────

describe("detectHeadless()", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it("returns true when document is undefined (no DOM)", () => {
    delete (globalThis as Record<string, unknown>).document;
    expect(detectHeadless()).toBe(true);
  });

  it("returns false when document is present (DOM available)", () => {
    (globalThis as Record<string, unknown>).document = {
      querySelector: vi.fn()
    };
    expect(detectHeadless()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// headless onStart
// ─────────────────────────────────────────────────────────────────────────────

describe("headless onStart (config.headless: true)", () => {
  beforeEach(() => {
    mockState.reset();
    delete (globalThis as Record<string, unknown>).document;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it("does NOT construct the Pixi Application", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    expect(mockState.constructorCallCount).toBe(0);

    await stop({ global: ctx.global });
  });

  it("leaves state.app as undefined after start", async () => {
    const { ctx, state } = makeCtx({ headless: true });
    await start(ctx);

    expect(state.app).toBeUndefined();

    await stop({ global: ctx.global });
  });

  it("logs the expected headless info message", async () => {
    const { ctx, log } = makeCtx({ headless: true });
    await start(ctx);

    expect(log.info).toHaveBeenCalledWith("[renderer] headless — Pixi not initialised");

    await stop({ global: ctx.global });
  });

  it("still defines the Transform component on the ECS world", async () => {
    const { ctx, world } = makeCtx({ headless: true });
    await start(ctx);

    expect(world.defineComponent).toHaveBeenCalledOnce();

    await stop({ global: ctx.global });
  });

  it("stores the transform token on state so api.Transform works", async () => {
    const { ctx, state } = makeCtx({ headless: true });
    await start(ctx);

    expect(state.transformToken).toBeDefined();

    await stop({ global: ctx.global });
  });

  it("registers the sync system in the scheduler", async () => {
    const { ctx, addSystem } = makeCtx({ headless: true });
    await start(ctx);

    expect(addSystem).toHaveBeenCalledWith("sync", expect.any(Function));

    await stop({ global: ctx.global });
  });

  it("render() does not throw when headless (state.app undefined)", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    expect(() => api.render()).not.toThrow();

    await stop({ global: ctx.global });
  });

  it("getView() returns undefined when headless", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    expect(api.getView()).toBeUndefined();

    await stop({ global: ctx.global });
  });

  it("getStage() returns undefined when headless", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    expect(api.getStage()).toBeUndefined();

    await stop({ global: ctx.global });
  });

  it("attach() does not throw when headless", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    const entity = makeEntity(1);
    const container = {
      position: { set: vi.fn() },
      rotation: 0,
      scale: { set: vi.fn() },
      destroy: vi.fn()
    } as unknown as Container;

    expect(() => api.attach(entity, container)).not.toThrow();

    await stop({ global: ctx.global });
  });

  it("detach() does not throw when headless (no view attached)", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    const entity = makeEntity(99);

    expect(() => api.detach(entity)).not.toThrow();

    await stop({ global: ctx.global });
  });

  it("markDirty() does not throw when headless", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    const entity = makeEntity(2);

    expect(() => api.markDirty(entity)).not.toThrow();

    await stop({ global: ctx.global });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// headless onStop
// ─────────────────────────────────────────────────────────────────────────────

describe("headless onStop (after headless start)", () => {
  beforeEach(() => {
    mockState.reset();
    delete (globalThis as Record<string, unknown>).document;
  });

  it("does NOT call app.destroy when headless (no app was created)", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);
    await stop({ global: ctx.global });

    // Application constructor was never called → destroy was never called.
    expect(mockState.constructorCallCount).toBe(0);
    expect(mockState.destroySpy).not.toHaveBeenCalled();
  });

  it("clears managed views on stop", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    const entity = makeEntity(3);
    const container = {
      position: { set: vi.fn() },
      rotation: 0,
      scale: { set: vi.fn() },
      destroy: vi.fn()
    } as unknown as Container;
    api.attach(entity, container);

    expect(ctx.state.views.size).toBe(1);

    await stop({ global: ctx.global });

    expect(ctx.state.views.size).toBe(0);
  });

  it("disposes view containers that were attached before stop", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    const api = createApi(ctx);
    const entity = makeEntity(4);
    const destroyMock = vi.fn();
    const container = {
      position: { set: vi.fn() },
      rotation: 0,
      scale: { set: vi.fn() },
      destroy: destroyMock
    } as unknown as Container;
    api.attach(entity, container);

    await stop({ global: ctx.global });

    expect(destroyMock).toHaveBeenCalled();
  });

  it("is idempotent — a second stop after a headless start does not throw", async () => {
    const { ctx } = makeCtx({ headless: true });
    await start(ctx);
    await stop({ global: ctx.global });

    await expect(stop({ global: ctx.global })).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Config override: explicit headless overrides auto-detection
// ─────────────────────────────────────────────────────────────────────────────

describe("explicit headless config overrides auto-detection", () => {
  beforeEach(() => {
    mockState.reset();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it("explicit headless:false forces Pixi init even when no DOM is present", async () => {
    delete (globalThis as Record<string, unknown>).document;

    // headless:false explicitly → must attempt Pixi init even without a DOM.
    const { ctx } = makeCtx({ headless: false });
    await start(ctx);

    expect(mockState.constructorCallCount).toBe(1);

    await stop({ global: ctx.global });
  });

  it("explicit headless:true suppresses Pixi init even when DOM is present", async () => {
    (globalThis as Record<string, unknown>).document = {
      querySelector: vi.fn().mockReturnValue(undefined)
    };

    const { ctx } = makeCtx({ headless: true });
    await start(ctx);

    expect(mockState.constructorCallCount).toBe(0);

    await stop({ global: ctx.global });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Type-level
// ─────────────────────────────────────────────────────────────────────────────

describe("type-level: Config.headless is boolean", () => {
  it("Config.headless is typed as boolean", () => {
    expectTypeOf<Config["headless"]>().toEqualTypeOf<boolean>();
  });
});
