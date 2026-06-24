/**
 * @file renderer plugin — unit tests for the onStart mount branch + onStop.
 *
 * These tests drive `start`/`stop` directly (no full app boot) with a mocked
 * "pixi.js" Application and an injected `globalThis.document` so the mount
 * selector branches (match → append, miss → log.warn, no-mount → skip) are
 * exercised in isolation. The WeakMap-miss early-return in `stop` is covered too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pixi.js", () => {
  // Classes (not vi.fn().mockImplementation) so `new Application()` is always
  // constructable across every test in the file, even after vi.clearAllMocks().
  return {
    Application: class {
      init = vi.fn().mockResolvedValue(undefined);
      render = vi.fn();
      destroy = vi.fn();
      canvas = { id: "test-canvas" } as unknown as HTMLCanvasElement;
      stage = {
        position: { set: vi.fn() },
        rotation: 0,
        scale: { set: vi.fn() },
        destroy: vi.fn(),
        children: [] as unknown[]
      };
    },
    Container: class {
      position = { set: vi.fn() };
      rotation = 0;
      scale = { set: vi.fn() };
      destroy = vi.fn();
      children = [] as unknown[];
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Imports after the mock is declared
// ─────────────────────────────────────────────────────────────────────────────

import type { World } from "../../../ecs/types";
import { start, stop } from "../../lifecycle";
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
  mount: undefined
};

/** Minimal stub World — only defineComponent is exercised by start(). */
const makeWorld = (): World =>
  ({
    defineComponent: vi.fn().mockReturnValue({ __id: 1, __value: {} })
  }) as unknown as World;

/** Builds a StartContext with a unified require that satisfies ecs + scheduler. */
const makeStartCtx = (mount: string | undefined) => {
  const config: Config = { ...baseConfig, mount };
  const global = {};
  const state = createState({ global, config });
  const addSystem = vi.fn().mockReturnValue(() => {
    /* no-op unsubscribe */
  });
  const world = makeWorld();

  // require(ecsPlugin) → world (has defineComponent)
  // require(schedulerPlugin) → { addSystem }
  // A single object exposing both satisfies both call sites.
  const unified = Object.assign(Object.create(world as object), { addSystem });
  const require = vi.fn().mockReturnValue(unified) as unknown;

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
    require: require as Parameters<typeof start>[0]["require"]
  };

  return { ctx: ctx as Parameters<typeof start>[0], state, log, global, addSystem };
};

// ─────────────────────────────────────────────────────────────────────────────
// Mount-branch tests
// ─────────────────────────────────────────────────────────────────────────────

describe("renderer onStart — mount branch", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it("appends the canvas when the mount selector matches an element", async () => {
    const append = vi.fn();
    const querySelector = vi.fn().mockReturnValue({ append });
    (globalThis as Record<string, unknown>).document = { querySelector };

    const { ctx, log } = makeStartCtx("#stage");
    await start(ctx);

    expect(querySelector).toHaveBeenCalledWith("#stage");
    expect(append).toHaveBeenCalledWith(ctx.state.app?.canvas);
    expect(log.warn).not.toHaveBeenCalled();

    await stop({ global: ctx.global });
  });

  it("logs a warning when the mount selector matches nothing", async () => {
    const querySelector = vi.fn().mockReturnValue(undefined);
    (globalThis as Record<string, unknown>).document = { querySelector };

    const { ctx, log } = makeStartCtx("#missing");
    await start(ctx);

    expect(querySelector).toHaveBeenCalledWith("#missing");
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[0]).toContain("#missing");

    await stop({ global: ctx.global });
  });

  it("does not touch the DOM when mount is undefined (headless)", async () => {
    const querySelector = vi.fn();
    (globalThis as Record<string, unknown>).document = { querySelector };

    const { ctx, log } = makeStartCtx(undefined);
    await start(ctx);

    expect(querySelector).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();

    await stop({ global: ctx.global });
  });

  it("warns when mount is set but no document exists (optional-chain miss)", async () => {
    delete (globalThis as Record<string, unknown>).document;

    const { ctx, log } = makeStartCtx("#stage");
    await start(ctx);

    // querySelector?.() short-circuits to undefined → warn branch.
    expect(log.warn).toHaveBeenCalledOnce();

    await stop({ global: ctx.global });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onStop — WeakMap-miss early return
// ─────────────────────────────────────────────────────────────────────────────

describe("renderer onStop — guards", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).document;
  });

  it("is a no-op when no teardown entry exists for the global", async () => {
    await expect(stop({ global: {} })).resolves.toBeUndefined();
  });

  it("is idempotent — a second stop with the same global does not throw", async () => {
    const { ctx } = makeStartCtx(undefined);
    await start(ctx);
    await stop({ global: ctx.global });

    await expect(stop({ global: ctx.global })).resolves.toBeUndefined();
  });
});
