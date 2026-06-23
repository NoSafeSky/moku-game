import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { SchedulerContext } from "../../api";
import { createApi } from "../../api";
import type { Stage, System, World } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/**
 * Build a minimal World double for testing scheduler forwarding.
 *
 * @returns A partial World mock with addSystem and tick as vi.fn().
 */
const makeWorldMock = (): Pick<World, "addSystem" | "tick"> => ({
  addSystem: vi.fn(() => vi.fn()),
  tick: vi.fn()
});

/**
 * Build a SchedulerContext for unit tests.
 *
 * @param overrides - Partial overrides for config, log, and require.
 * @returns A typed mock SchedulerContext.
 */
const createMockCtx = (overrides: Partial<SchedulerContext> = {}): SchedulerContext => {
  const world = makeWorldMock();
  return {
    config: { strictStages: true },
    state: {},
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    require: vi.fn(() => world as unknown as World),
    ...overrides
  };
};

// ─── stages ───────────────────────────────────────────────────

describe("createApi — stages", () => {
  it("exposes the canonical ordered stage tuple", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expect(api.stages).toStrictEqual(["input", "update", "physics", "sync", "render"]);
  });

  it("stages is readonly (no push)", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expectTypeOf(api.stages).toEqualTypeOf<readonly Stage[]>();
  });
});

// ─── addSystem ────────────────────────────────────────────────

describe("createApi — addSystem", () => {
  it("forwards a known stage to world.addSystem", () => {
    const ctx = createMockCtx();
    const world = makeWorldMock();
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    const system: System = vi.fn();
    api.addSystem("update", system);

    expect(world.addSystem).toHaveBeenCalledOnce();
    expect(world.addSystem).toHaveBeenCalledWith("update", system);
  });

  it("returns the unsubscribe fn from world.addSystem", () => {
    const ctx = createMockCtx();
    const unsub = vi.fn();
    const world = makeWorldMock();
    (world.addSystem as ReturnType<typeof vi.fn>).mockReturnValue(unsub);
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    const result = api.addSystem("input", vi.fn());

    expect(result).toBe(unsub);
  });

  it("calling the unsubscribe fn removes the system", () => {
    const ctx = createMockCtx();
    const unsub = vi.fn();
    const world = makeWorldMock();
    (world.addSystem as ReturnType<typeof vi.fn>).mockReturnValue(unsub);
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    const remove = api.addSystem("render", vi.fn());
    remove();

    expect(unsub).toHaveBeenCalledOnce();
  });

  it("throws on unknown stage when strictStages is true", () => {
    const ctx = createMockCtx({ config: { strictStages: true } });
    const api = createApi(ctx);

    expect(() => {
      // @ts-expect-error -- "unknown" is not a valid Stage
      api.addSystem("unknown", vi.fn());
    }).toThrow();
  });

  it("logs a warning and returns no-op unsubscribe when strictStages is false and stage is unknown", () => {
    const warnMock = vi.fn();
    const ctx = createMockCtx({
      config: { strictStages: false },
      log: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnMock,
        error: vi.fn()
      }
    });
    const api = createApi(ctx);

    let result: (() => void) | undefined;
    expect(() => {
      // @ts-expect-error -- "unknown" is not a valid Stage
      result = api.addSystem("unknown", vi.fn());
    }).not.toThrow();

    expect(warnMock).toHaveBeenCalledOnce();
    // calling the no-op is safe
    expect(() => result?.()).not.toThrow();
  });

  it("does not forward to world.addSystem when stage is unknown and strictStages is false", () => {
    const world = makeWorldMock();
    const ctx = createMockCtx({ config: { strictStages: false } });
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    // @ts-expect-error -- "unknown" is not a valid Stage
    api.addSystem("unknown", vi.fn());

    expect(world.addSystem).not.toHaveBeenCalled();
  });

  it("forwards all canonical stages without throwing", () => {
    const stages: Stage[] = ["input", "update", "physics", "sync", "render"];
    const ctx = createMockCtx();
    const world = makeWorldMock();
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    for (const stage of stages) {
      expect(() => api.addSystem(stage, vi.fn())).not.toThrow();
    }

    expect(world.addSystem).toHaveBeenCalledTimes(stages.length);
  });
});

// ─── tick ─────────────────────────────────────────────────────

describe("createApi — tick", () => {
  it("forwards dt to world.tick", () => {
    const world = makeWorldMock();
    const ctx = createMockCtx();
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    api.tick(0.016);

    expect(world.tick).toHaveBeenCalledOnce();
    expect(world.tick).toHaveBeenCalledWith(0.016);
  });

  it("forwards dt=0 to world.tick", () => {
    const world = makeWorldMock();
    const ctx = createMockCtx();
    ctx.require = vi.fn(() => world as unknown as World);
    const api = createApi(ctx);

    api.tick(0);

    expect(world.tick).toHaveBeenCalledWith(0);
  });
});
