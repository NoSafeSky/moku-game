/**
 * @file context plugin — lifecycle unit tests.
 *
 * Tests that start() binds the correct resources onto the ECS world via a
 * mock ctx. Uses a spy-instrumented fake world to verify setResource calls.
 */
import { describe, expect, it, vi } from "vitest";
import { assetsPlugin } from "../../../assets";
import { ecsPlugin } from "../../../ecs";
import type { Resource, World } from "../../../ecs/types";
import { start } from "../../lifecycle";
import { Assets, GameContext } from "../../resources";
import type { GameContextValue } from "../../types";

// ─── Fake world ───────────────────────────────────────────────────────────────

/**
 * Builds a fake World with a setResource spy and a resource store so tests can
 * verify what was bound without needing the real ECS world.
 */
const makeFakeWorld = (): {
  world: Pick<World, "setResource" | "resource" | "getResource" | "hasResource">;
  setResourceSpy: ReturnType<typeof vi.fn>;
  store: Map<string, unknown>;
} => {
  const store = new Map<string, unknown>();
  const setResourceSpy = vi.fn(<T>(res: Resource<T>, value: T) => {
    store.set(res.__key, value);
  });
  const world = {
    setResource: setResourceSpy as typeof setResourceSpy & World["setResource"],
    resource: <T>(res: Resource<T>): T => {
      if (!store.has(res.__key)) throw new Error(`resource "${res.__key}" is not set`);
      return store.get(res.__key) as T;
    },
    getResource: <T>(res: Resource<T>): T | undefined => store.get(res.__key) as T | undefined,
    hasResource: <T>(res: Resource<T>): boolean => store.has(res.__key)
  };
  return { world, setResourceSpy, store };
};

// ─── Fake assets API ──────────────────────────────────────────────────────────

const fakeAssetsApi = {
  load: vi.fn(),
  loadBundle: vi.fn(),
  get: vi.fn(),
  sprite: vi.fn(),
  isLoaded: vi.fn()
} as const;

// ─── Mock ctx factory ─────────────────────────────────────────────────────────

// Structural mock of the ctx passed to start() — only fields start() accesses.
// Cast via `as unknown as Parameters<typeof start>[0]` because LogApi / EnvApi have
// more methods than the test needs; this is the R9-approved pattern for test mocks
// of complex external types.
type MockCtx = {
  config: { bindGameContext: boolean };
  log: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  emit: ReturnType<typeof vi.fn>;
  env: { get: ReturnType<typeof vi.fn> };
  require: ReturnType<typeof vi.fn>;
};

const makeCtx = (
  world: Pick<World, "setResource" | "resource" | "getResource" | "hasResource">,
  overrides?: { bindGameContext?: boolean }
): MockCtx => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const emit = vi.fn();
  const env = { get: vi.fn() };

  return {
    config: { bindGameContext: overrides?.bindGameContext ?? true },
    log,
    emit,
    env,
    require: vi.fn().mockImplementation((plugin: unknown) => {
      if (plugin === ecsPlugin) return world;
      if (plugin === assetsPlugin) return fakeAssetsApi;
      throw new Error("unknown plugin");
    })
  };
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("context lifecycle — start()", () => {
  it("calls ctx.require(ecsPlugin) to get the world", async () => {
    const { world } = makeFakeWorld();
    const ctx = makeCtx(world);
    await start(ctx as unknown as Parameters<typeof start>[0]);
    expect(ctx.require).toHaveBeenCalledWith(ecsPlugin);
  });

  it("calls ctx.require(assetsPlugin) to get the assets API", async () => {
    const { world } = makeFakeWorld();
    const ctx = makeCtx(world);
    await start(ctx as unknown as Parameters<typeof start>[0]);
    expect(ctx.require).toHaveBeenCalledWith(assetsPlugin);
  });

  it("binds Assets token → the assets API via world.setResource", async () => {
    const { world, setResourceSpy } = makeFakeWorld();
    const ctx = makeCtx(world);
    await start(ctx as unknown as Parameters<typeof start>[0]);
    expect(setResourceSpy).toHaveBeenCalledWith(Assets, fakeAssetsApi);
  });

  it("binds GameContext token → {log,emit,env} when bindGameContext is true", async () => {
    const { world, store } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: true });
    await start(ctx as unknown as Parameters<typeof start>[0]);

    const bound = store.get(GameContext.__key) as GameContextValue | undefined;
    expect(bound).toBeDefined();
    expect(bound?.log).toBe(ctx.log);
    expect(bound?.emit).toBe(ctx.emit);
    expect(bound?.env).toBe(ctx.env);
  });

  it("bound GameContext.log is the SAME reference as ctx.log", async () => {
    const { world, store } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: true });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    const gc = store.get(GameContext.__key) as GameContextValue;
    expect(gc.log).toBe(ctx.log);
  });

  it("bound GameContext.env is the SAME reference as ctx.env", async () => {
    const { world, store } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: true });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    const gc = store.get(GameContext.__key) as GameContextValue;
    expect(gc.env).toBe(ctx.env);
  });

  it("GameContext.emit forwards to ctx.emit (spy)", async () => {
    const { world, store } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: true });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    const gc = store.get(GameContext.__key) as GameContextValue;
    gc.emit("assets:loaded", { alias: "hero", kind: "asset" });
    expect(ctx.emit).toHaveBeenCalledWith("assets:loaded", { alias: "hero", kind: "asset" });
  });

  it("bindGameContext:false — Assets is STILL bound", async () => {
    const { world, setResourceSpy } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: false });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    expect(setResourceSpy).toHaveBeenCalledWith(Assets, fakeAssetsApi);
  });

  it("bindGameContext:false — GameContext is NOT bound", async () => {
    const { world, setResourceSpy } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: false });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    const gameCtxCall = setResourceSpy.mock.calls.find(
      call => (call[0] as Resource<unknown>).__key === GameContext.__key
    );
    expect(gameCtxCall).toBeUndefined();
  });

  it("setResource is called exactly twice when bindGameContext is true", async () => {
    const { world, setResourceSpy } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: true });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    expect(setResourceSpy).toHaveBeenCalledTimes(2);
  });

  it("setResource is called exactly once when bindGameContext is false", async () => {
    const { world, setResourceSpy } = makeFakeWorld();
    const ctx = makeCtx(world, { bindGameContext: false });
    await start(ctx as unknown as Parameters<typeof start>[0]);
    expect(setResourceSpy).toHaveBeenCalledTimes(1);
  });
});
