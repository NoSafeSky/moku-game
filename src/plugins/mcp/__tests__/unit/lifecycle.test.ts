/**
 * @file mcp plugin — unit tests for lifecycle.ts (start / stop / validateConfig).
 *
 * These isolate the lifecycle orchestration from the SDK by mocking
 * `../../transport` (so `buildMcpHandle` is fully controllable) and pixi.js
 * (pulled in transitively via the renderer plugin import). They cover the
 * paths the integration suite cannot reach deterministically:
 * - start() validates config before touching dependencies
 * - start() wires the drain + stats systems and stores the handle in the WeakMap
 * - start() tears down both systems and rethrows when buildMcpHandle rejects
 *   (no half-open server, no dangling tick systems)
 * - stop() removes systems, closes, marks stopped, and is idempotent
 * - stop() still marks stopped + drops the entry when close() throws (try/finally)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — must precede the lifecycle import
// ─────────────────────────────────────────────────────────────────────────────

// pixi.js is loaded transitively (lifecycle.ts → renderer plugin → pixi.js).
// Nothing here is instantiated; the stubs just keep the import side-effect-free.
vi.mock("pixi.js", () => ({
  Application: class {},
  Container: class {},
  Assets: { load: vi.fn(), addBundle: vi.fn(), loadBundle: vi.fn(), get: vi.fn() },
  Sprite: class {}
}));

// Isolate the SDK transport seam — buildMcpHandle is the only boundary start() crosses.
vi.mock("../../transport", () => ({
  buildMcpHandle: vi.fn()
}));

import { mcpRegistry, start, stop, validateConfig } from "../../lifecycle";
import { buildMcpHandle } from "../../transport";
import type { Config, McpHandle } from "../../types";

const mockBuild = vi.mocked(buildMcpHandle);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (outer scope — unicorn/consistent-function-scoping)
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = {
  transports: ["stdio"],
  httpHost: "127.0.0.1",
  httpPort: 3333,
  httpAuth: "none",
  bearerToken: "",
  enableMutations: true,
  inMemoryGlobalKey: "__MOKU_GAME_MCP__"
};

const makeHandle = (overrides?: Partial<McpHandle>): McpHandle => ({
  running: true,
  httpEndpoint: undefined,
  toolNames: [],
  pending: [],
  removeDrainSystem: vi.fn(),
  removeStatsSystem: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
  ...overrides
});

/**
 * Builds a minimal start() context. `require` returns a single stub for every
 * dependency: only `world.addSystem` is exercised before buildMcpHandle (the
 * scheduler/renderer/loop/scene values flow into registrar closures that the
 * mocked buildMcpHandle never invokes). addSystem returns the drain remover on
 * the first call (input stage) and the stats remover on the second (render stage).
 */
const makeStartCtx = (config: Config = defaultConfig) => {
  const removeDrain = vi.fn();
  const removeStats = vi.fn();
  const addSystem = vi.fn();
  addSystem.mockReturnValueOnce(removeDrain).mockReturnValueOnce(removeStats);

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const global = {};
  const state = { stats: { frame: 0, lastDt: 0, entityCount: 0 } };
  const require = vi.fn(() => ({ addSystem, getView: vi.fn() }));

  const ctx = { config, state, global, log, require };
  return { ctx, removeDrain, removeStats, addSystem, log, global, state };
};

type StartCtx = Parameters<typeof start>[0];
type StopCtx = Parameters<typeof stop>[0];

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig
// ─────────────────────────────────────────────────────────────────────────────

describe("validateConfig", () => {
  it("accepts httpAuth=none with an empty token", () => {
    expect(() => validateConfig(defaultConfig)).not.toThrow();
  });

  it("accepts httpAuth=bearer with a non-empty token", () => {
    expect(() =>
      validateConfig({ ...defaultConfig, httpAuth: "bearer", bearerToken: "secret" })
    ).not.toThrow();
  });

  it("throws when httpAuth=bearer and the token is empty", () => {
    expect(() => validateConfig({ ...defaultConfig, httpAuth: "bearer", bearerToken: "" })).toThrow(
      /bearerToken/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// start
// ─────────────────────────────────────────────────────────────────────────────

describe("start", () => {
  it("registers drain + stats systems and stores the handle in the WeakMap", async () => {
    const { ctx, addSystem, global, log } = makeStartCtx();
    const handle = makeHandle();
    mockBuild.mockResolvedValueOnce(handle);

    await start(ctx as unknown as StartCtx);

    // Two systems registered: drain on "input", stats on "render"
    expect(addSystem).toHaveBeenCalledTimes(2);
    expect(addSystem.mock.calls[0]?.[0]).toBe("input");
    expect(addSystem.mock.calls[1]?.[0]).toBe("render");

    // Handle stored under ctx.global; connection logged
    expect(mcpRegistry.get(global)).toBe(handle);
    expect(log.info).toHaveBeenCalledOnce();
  });

  it("passes the system removers, config, and pending queue to buildMcpHandle", async () => {
    const { ctx, removeDrain, removeStats } = makeStartCtx();
    mockBuild.mockResolvedValueOnce(makeHandle());

    await start(ctx as unknown as StartCtx);

    expect(mockBuild).toHaveBeenCalledOnce();
    const opts = mockBuild.mock.calls[0]?.[0];
    expect(opts?.config).toBe(defaultConfig);
    expect(opts?.removeDrainSystem).toBe(removeDrain);
    expect(opts?.removeStatsSystem).toBe(removeStats);
    expect(Array.isArray(opts?.pending)).toBe(true);
    expect(typeof opts?.registerAllTools).toBe("function");
    expect(typeof opts?.registerAllResources).toBe("function");
  });

  it("validates config before requiring dependencies or wiring systems", async () => {
    const { ctx, addSystem } = makeStartCtx({
      ...defaultConfig,
      httpAuth: "bearer",
      bearerToken: ""
    });

    await expect(start(ctx as unknown as StartCtx)).rejects.toThrow(/bearerToken/);

    // Bailed out before any side effects
    expect(addSystem).not.toHaveBeenCalled();
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("removes both systems and rethrows when buildMcpHandle fails", async () => {
    const { ctx, removeDrain, removeStats, global } = makeStartCtx();
    const failure = new Error("transport connect failed");
    mockBuild.mockRejectedValueOnce(failure);

    await expect(start(ctx as unknown as StartCtx)).rejects.toThrow("transport connect failed");

    // No half-open server: both tick systems unwound, nothing stored
    expect(removeDrain).toHaveBeenCalledOnce();
    expect(removeStats).toHaveBeenCalledOnce();
    expect(mcpRegistry.get(global)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle 6 (issue #4, Bug 2) — enqueueMutation loop-awareness
//
// enqueueMutation is a local closure inside start() — not exported. It is
// exercised through the smallest seam the existing suite already touches:
// the real `registerTools` (invoked via the captured `registerAllTools`
// passed to the mocked buildMcpHandle) registers real tool handlers whose
// mutating path calls enqueueMutation. Per-dependency stubs are supplied via
// `require.mockReturnValueOnce(...)` chained in start()'s call order
// (ecs, scheduler, renderer, loop, scene, input) — mirroring the existing
// addSystem.mockReturnValueOnce(...).mockReturnValueOnce(...) pattern above.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fake McpServerLike — records registered tools for direct invocation. */
type FakeTool = {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
};

const createFakeServer = (): { tools: FakeTool[]; registerTool: (...args: never[]) => void } => {
  const tools: FakeTool[] = [];
  return {
    tools,
    registerTool: ((name: string, _config: unknown, handler: FakeTool["handler"]): void => {
      tools.push({ name, handler });
    }) as (...args: never[]) => void
  };
};

const getFakeToolHandler = (server: ReturnType<typeof createFakeServer>, name: string) => {
  const found = server.tools.find(tool => tool.name === name);
  if (!found) throw new Error(`Tool ${name} not registered`);
  return found.handler;
};

/**
 * Builds a start() context whose `require` returns a DISTINCT stub per
 * dependency (call-order based: ecs, scheduler, renderer, loop, scene, input),
 * so `loop.isRunning` can be independently controlled per test. Only the
 * fields the mutating tool paths under test actually touch are meaningful;
 * the rest are harmless no-op stubs.
 */
const makeMutationCtx = (loopIsRunning: () => boolean) => {
  const removeDrain = vi.fn();
  const removeStats = vi.fn();
  const addSystem = vi.fn();
  addSystem.mockReturnValueOnce(removeDrain).mockReturnValueOnce(removeStats);

  const world = {
    addSystem,
    spawn: vi.fn(() => 1),
    despawn: vi.fn(),
    isAlive: vi.fn(() => true),
    has: vi.fn(() => false),
    add: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    componentByName: vi.fn(() => undefined),
    liveEntities: vi.fn((): unknown[] => []),
    entityCount: vi.fn(() => 0),
    componentNames: vi.fn((): string[] => []),
    componentsOf: vi.fn((): unknown[] => [])
  };
  const scheduler = { addSystem, tick: vi.fn(), stages: [] as string[] };
  const renderer = {
    screenshot: vi.fn(async (): Promise<undefined> => undefined),
    tree: vi.fn(() => undefined),
    attachPrimitive: vi.fn(() => false),
    markDirty: vi.fn()
  };
  const loop = {
    step: vi.fn(() => ({ frame: 0, elapsed: 0, dt: 0 })),
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn(loopIsRunning)
  };
  const scene = {
    load: vi.fn(() => Promise.resolve()),
    unload: vi.fn(),
    currentScene: vi.fn((): string | undefined => undefined),
    sceneNames: vi.fn((): string[] => []),
    ownedEntities: vi.fn((): unknown[] => [])
  };
  const input = { keyDown: vi.fn(), keyUp: vi.fn(), keyPress: vi.fn() };

  const require = vi
    .fn()
    .mockReturnValueOnce(world)
    .mockReturnValueOnce(scheduler)
    .mockReturnValueOnce(renderer)
    .mockReturnValueOnce(loop)
    .mockReturnValueOnce(scene)
    .mockReturnValueOnce(input);

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const global = {};
  const state = { stats: { frame: 0, lastDt: 0, entityCount: 0 } };
  const emit = vi.fn();

  const ctx = { config: defaultConfig, state, global, log, require, emit };
  return { ctx, world, loop, addSystem };
};

describe("start — enqueueMutation loop-awareness (Cycle 6, issue #4 Bug 2)", () => {
  it("applies a mutation immediately (no drain tick) when the loop is paused", async () => {
    const { ctx, world } = makeMutationCtx(() => false);
    mockBuild.mockResolvedValueOnce(makeHandle());
    await start(ctx as unknown as StartCtx);

    const opts = mockBuild.mock.calls[0]?.[0];
    const server = createFakeServer();
    opts?.registerAllTools(server as unknown as Parameters<typeof opts.registerAllTools>[0]);

    world.spawn.mockReturnValue(42);
    const result = await getFakeToolHandler(server, "ecs:spawn")({});
    expect(world.spawn).toHaveBeenCalledOnce();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ entity: 42 });
  });

  it("defers a mutation to the drain tick when the loop is running", async () => {
    const { ctx, world, addSystem } = makeMutationCtx(() => true);
    mockBuild.mockResolvedValueOnce(makeHandle());
    await start(ctx as unknown as StartCtx);

    const opts = mockBuild.mock.calls[0]?.[0];
    const server = createFakeServer();
    opts?.registerAllTools(server as unknown as Parameters<typeof opts.registerAllTools>[0]);

    world.spawn.mockReturnValue(7);
    const settled = vi.fn();
    const resultPromise = getFakeToolHandler(server, "ecs:spawn")({});
    const settledPromise = resultPromise.then(settled);

    // Not applied yet — the loop is running, so the closure sits in `pending`.
    await Promise.resolve();
    expect(world.spawn).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();

    // Run the real drain system captured from the first addSystem("input", ...) call.
    const drainSystem = addSystem.mock.calls[0]?.[1] as (world: unknown, dt: number) => void;
    drainSystem(world, 0);

    const result = await resultPromise;
    await settledPromise;
    expect(world.spawn).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledOnce();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({ entity: 7 });
  });

  it("flushes already-queued closures FIFO before applying a new one once paused", async () => {
    let running = true;
    const { ctx, world } = makeMutationCtx(() => running);
    mockBuild.mockResolvedValueOnce(makeHandle());
    await start(ctx as unknown as StartCtx);

    const opts = mockBuild.mock.calls[0]?.[0];
    const server = createFakeServer();
    opts?.registerAllTools(server as unknown as Parameters<typeof opts.registerAllTools>[0]);

    world.spawn.mockReturnValueOnce(1).mockReturnValueOnce(2);

    // Enqueued while running — deferred, sits in `pending`.
    const p1 = getFakeToolHandler(server, "ecs:spawn")({});

    // Now pause — the next mutation must flush p1's closure FIRST, then run its own.
    running = false;
    const p2 = getFakeToolHandler(server, "ecs:spawn")({});

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(JSON.parse(r1.content[0]?.text ?? "{}")).toMatchObject({ entity: 1 });
    expect(JSON.parse(r2.content[0]?.text ?? "{}")).toMatchObject({ entity: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stop
// ─────────────────────────────────────────────────────────────────────────────

describe("stop", () => {
  it("removes systems, closes the server, marks stopped, and drops the entry", async () => {
    const global = {};
    const handle = makeHandle({ running: true });
    mcpRegistry.set(global, handle);

    await stop({ global } as unknown as StopCtx);

    expect(handle.removeDrainSystem).toHaveBeenCalledOnce();
    expect(handle.removeStatsSystem).toHaveBeenCalledOnce();
    expect(handle.close).toHaveBeenCalledOnce();
    expect(handle.running).toBe(false);
    expect(mcpRegistry.get(global)).toBeUndefined();
  });

  it("is a no-op when no handle is registered", async () => {
    const global = {};
    await expect(stop({ global } as unknown as StopCtx)).resolves.toBeUndefined();
  });

  it("is idempotent — a second stop does not close again", async () => {
    const global = {};
    const handle = makeHandle({ running: true });
    mcpRegistry.set(global, handle);

    await stop({ global } as unknown as StopCtx);
    await stop({ global } as unknown as StopCtx);

    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("marks stopped and drops the entry even when close() throws", async () => {
    const global = {};
    const handle = makeHandle({
      running: true,
      close: vi.fn(() => Promise.reject(new Error("close boom")))
    });
    mcpRegistry.set(global, handle);

    await expect(stop({ global } as unknown as StopCtx)).rejects.toThrow("close boom");

    // finally block ran despite the rejection
    expect(handle.running).toBe(false);
    expect(mcpRegistry.get(global)).toBeUndefined();
  });

  // ── Cycle 3: inMemory global-key teardown via handle.close() ────────────────

  it("removes globalThis[key] on stop (close() owns the key) and a second stop is a no-op", async () => {
    const global = {};
    const key = "__MOKU_GAME_MCP__";
    // Simulate a browser-published key: the real transport.ts close() deletes it.
    (globalThis as Record<string, unknown>)[key] = { closed: false };

    let closeCalls = 0;
    const handle = makeHandle({
      running: true,
      publishedGlobalKey: key,
      close: vi.fn(() => {
        closeCalls += 1;
        delete (globalThis as Record<string, unknown>)[key];
        return Promise.resolve();
      })
    });
    mcpRegistry.set(global, handle);

    await stop({ global } as unknown as StopCtx);
    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
    expect(closeCalls).toBe(1);

    // Second stop: no handle in the registry → close() not called again (idempotent)
    await stop({ global } as unknown as StopCtx);
    expect(closeCalls).toBe(1);

    delete (globalThis as Record<string, unknown>)[key];
  });
});
