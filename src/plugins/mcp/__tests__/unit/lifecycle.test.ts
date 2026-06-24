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
  enableMutations: true
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
});
