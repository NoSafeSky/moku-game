/**
 * @file mcp plugin — browser-environment integration tests (Cycle 3, issue #1).
 *
 * Boots the full framework (all 8 plugins) under a SIMULATED BROWSER:
 *   - `document` is present (so the env-aware default selects "inMemory")
 *   - `process.stdin` is undefined (so a stray stdio transport would crash)
 *
 * Unlike the sibling `mcp.test.ts`, this file uses the REAL `@modelcontextprotocol/sdk`
 * (real `McpServer`, real `InMemoryTransport`, real `Client`) for an end-to-end
 * in-page round-trip. Only pixi.js is mocked. Covers:
 *   - Problem 1 regression: a default browser createApp().start() does NOT crash
 *   - The default transport selected is "inMemory"
 *   - An in-page Client over clientTransport() drives ecs:spawn → tick → entity exists
 *   - stop() closes the server and removes the published global key
 *   - Multi-instance: two apps' client transports do not cross-close (WeakMap isolation)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Simulated browser — installed at MODULE SCOPE (before the framework imports
// below) because mcp's index.ts computes its default `transports` from
// defaultTransports() at module-load time. Installing `document` here ensures
// the env-aware default resolves to ["inMemory"] for this file. process.stdin is
// dropped so a stray stdio transport would crash if it were not guarded/skipped.
// ─────────────────────────────────────────────────────────────────────────────

/** Standalone view of globalThis carrying the optional DOM + window probes. */
type SimGlobal = { document?: unknown; window?: unknown };

// Installed inside vi.hoisted() so it runs BEFORE the (hoisted) framework imports
// below — mcp's index.ts reads defaultTransports() at module-load time, so
// `document` must already be present for the env-aware default to pick inMemory.
const browserEnv = vi.hoisted(() => {
  const mockEventTarget = {
    addEventListener: () => {
      /* no-op */
    },
    removeEventListener: () => {
      /* no-op */
    },
    dispatchEvent: () => true
  };
  // document carries the surface the loop (visibilitychange), renderer, and input
  // plugins probe.
  const mockDocument = {
    addEventListener: () => {
      /* no-op */
    },
    removeEventListener: () => {
      /* no-op */
    },
    querySelector: () => undefined
  };

  const target = globalThis as SimGlobal;
  target.window = mockEventTarget;
  target.document = mockDocument;

  const originalStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: undefined, configurable: true });

  return { originalStdin };
});

afterAll(() => {
  delete (globalThis as SimGlobal).document;
  delete (globalThis as SimGlobal).window;
  Object.defineProperty(process, "stdin", { value: browserEnv.originalStdin, configurable: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// pixi.js mock (the only mock — the MCP SDK is real here)
// ─────────────────────────────────────────────────────────────────────────────

const pixiMocks = vi.hoisted(() => {
  const appState = {
    init: vi.fn().mockResolvedValue(undefined),
    render: vi.fn(),
    destroy: vi.fn(),
    canvas: {
      toDataURL: vi.fn(() => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==")
    } as unknown as HTMLCanvasElement,
    get stage() {
      return {
        position: { set: vi.fn() },
        rotation: 0,
        scale: { set: vi.fn() },
        destroy: vi.fn(),
        addChild: vi.fn(),
        removeChild: vi.fn()
      };
    }
  };
  return { appState };
});

vi.mock("pixi.js", () => ({
  Application: class {
    init = pixiMocks.appState.init;
    render = pixiMocks.appState.render;
    destroy = pixiMocks.appState.destroy;
    get canvas() {
      return pixiMocks.appState.canvas;
    }
    get stage() {
      return pixiMocks.appState.stage;
    }
  },
  Container: class {
    position = { set: vi.fn() };
    rotation = 0;
    scale = { set: vi.fn() };
    destroy = vi.fn();
    addChild = vi.fn();
    removeChild = vi.fn();
  },
  Assets: { load: vi.fn(), addBundle: vi.fn(), loadBundle: vi.fn(), get: vi.fn() },
  Sprite: class {
    texture: unknown;
    destroy = vi.fn();
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Framework imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { coreConfig } from "../../../../config";
import { assetsPlugin } from "../../../assets";
import { ecsPlugin } from "../../../ecs";
import { inputPlugin } from "../../../input";
import { loopPlugin } from "../../../loop";
import { rendererPlugin } from "../../../renderer";
import { scenePlugin } from "../../../scene";
import { schedulerPlugin } from "../../../scheduler";
import { mcpPlugin } from "../../index";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory — default mcp config (env-aware default selects inMemory).
// loop.autoStart=false so we drive ticks deterministically via app.loop.step().
// ─────────────────────────────────────────────────────────────────────────────

const createBrowserApp = (mcpOverrides?: Record<string, unknown>) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [
      ecsPlugin,
      schedulerPlugin,
      rendererPlugin,
      assetsPlugin,
      inputPlugin,
      loopPlugin,
      scenePlugin,
      mcpPlugin
    ]
  });
  return createApp({
    pluginConfigs: {
      loop: { autoStart: false },
      ...(mcpOverrides ? { mcp: mcpOverrides } : {})
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  pixiMocks.appState.init.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, unknown>).__MOKU_GAME_MCP__;
});

// ─────────────────────────────────────────────────────────────────────────────
// Problem 1 regression — default browser createApp().start() must NOT crash
// ─────────────────────────────────────────────────────────────────────────────

describe("mcp browser integration — issue #1 Problem 1", () => {
  it("default createApp().start() does NOT crash in a simulated browser", async () => {
    const app = createBrowserApp();
    await expect(app.start()).resolves.toBeUndefined();
    await app.stop();
  });

  it("selects the inMemory transport by default (clientTransport is available)", async () => {
    const app = createBrowserApp();
    await app.start();

    expect(app.mcp.isRunning()).toBe(true);
    expect(app.mcp.clientTransport()).toBeDefined();
    // stdio was skipped (no process.stdin) — http is off — so no HTTP endpoint.
    expect(app.mcp.httpEndpoint()).toBeUndefined();

    await app.stop();
  });

  it("publishes the client transport on the default global key and removes it on stop", async () => {
    const app = createBrowserApp();
    await app.start();

    const key = "__MOKU_GAME_MCP__";
    expect((globalThis as Record<string, unknown>)[key]).toBe(app.mcp.clientTransport());

    await app.stop();
    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
    expect(app.mcp.isRunning()).toBe(false);
    expect(app.mcp.clientTransport()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// In-page Client round-trip over clientTransport()
// ─────────────────────────────────────────────────────────────────────────────

describe("mcp browser integration — in-page Client round-trip", () => {
  it("drives ecs:spawn → tick → the entity exists (ecs:query count increments)", async () => {
    const app = createBrowserApp();
    await app.start();

    const transport = app.mcp.clientTransport();
    expect(transport).toBeDefined();

    const client = new Client({ name: "in-page-agent", version: "0.0.0" });
    // The structural transport is the real InMemoryTransport client side at runtime.
    await client.connect(transport as never);

    // ecs:spawn enqueues a mutation drained on the next input-stage tick. The tool
    // call travels over the transport asynchronously, so drive ticks on a timer
    // while the call is in flight — the drain runs once the mutation is enqueued.
    const ticker = setInterval(() => app.loop.step(), 1);
    try {
      const spawnResult = await client.callTool({ name: "ecs:spawn", arguments: {} });
      const spawnContent = spawnResult.content as Array<{ type: string; text: string }>;
      expect(spawnContent[0]?.text ?? "{}").toMatch(/entity/);

      // The entity is now tracked → ecs:query reports a count of 1.
      const queryResult = await client.callTool({
        name: "ecs:query",
        arguments: { componentNames: [] }
      });
      const queryContent = queryResult.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(queryContent[0]?.text ?? "{}") as {
        entities: number[];
        count: number;
      };
      expect(parsed.count).toBe(1);
      expect(parsed.entities).toHaveLength(1);
    } finally {
      clearInterval(ticker);
    }

    await client.close();
    await app.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-instance isolation — two apps' client transports do not cross-close
// ─────────────────────────────────────────────────────────────────────────────

describe("mcp browser integration — multi-instance isolation", () => {
  it("two apps' client transports are distinct and do not cross-close", async () => {
    const app1 = createBrowserApp({ inMemoryGlobalKey: "" });
    const app2 = createBrowserApp({ inMemoryGlobalKey: "" });

    await app1.start();
    await app2.start();

    const t1 = app1.mcp.clientTransport();
    const t2 = app2.mcp.clientTransport();
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t1).not.toBe(t2);

    await app1.stop();

    // app1 stopped; app2 still running with its own client transport intact.
    expect(app1.mcp.isRunning()).toBe(false);
    expect(app1.mcp.clientTransport()).toBeUndefined();
    expect(app2.mcp.isRunning()).toBe(true);
    expect(app2.mcp.clientTransport()).toBe(t2);

    await app2.stop();
    expect(app2.mcp.isRunning()).toBe(false);
  });
});
