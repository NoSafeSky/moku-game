/**
 * @file Core framework lifecycle — root integration tests.
 *
 * Boots the REAL game framework (real plugins + real createCore/createApp/createPlugin
 * factory). Only the external/headless surfaces are mocked: PixiJS (GPU), the MCP stdio
 * transport (process I/O), and globalThis.window (DOM global absent in node).
 *
 * Covers: full 8-plugin boot, the shipped createApp wiring, lifecycle toggles,
 * per-plugin config composition, idempotent stop, and consumer plugin registration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Headless DOM EventTarget for the input plugin (node has no real window).
// Assign BEFORE any plugin import so input's resolveTarget() picks it up.
const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
Object.assign(globalThis, { window: mockEventTarget });

// Mock PixiJS — no GPU context in tests. Application/Container/Sprite are CLASSES; Assets is an object.
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
  const assetsState = { load: vi.fn(), addBundle: vi.fn(), loadBundle: vi.fn(), get: vi.fn() };
  return { appState, assetsState };
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
  Assets: {
    load: pixiMocks.assetsState.load,
    addBundle: pixiMocks.assetsState.addBundle,
    loadBundle: pixiMocks.assetsState.loadBundle,
    get: pixiMocks.assetsState.get
  },
  Sprite: class {
    texture: unknown;
    destroy = vi.fn();
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
}));

// Mock the MCP stdio transport so onStart does not attach to real process.stdin.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    async start() {
      /* no-op */
    }
    async close() {
      /* no-op */
    }
    async send() {
      /* no-op */
    }
  }
}));

// ── Framework imports AFTER the mocks ──
import { coreConfig } from "../../src/config";
import { createApp as shippedCreateApp } from "../../src/index";
import { assetsPlugin } from "../../src/plugins/assets";
import { ecsPlugin } from "../../src/plugins/ecs";
import { inputPlugin } from "../../src/plugins/input";
import { loopPlugin } from "../../src/plugins/loop";
import { mcpPlugin } from "../../src/plugins/mcp";
import { rendererPlugin } from "../../src/plugins/renderer";
import { scenePlugin } from "../../src/plugins/scene";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory — full 8-plugin app, stdio-only mcp (no real HTTP listener).
// ─────────────────────────────────────────────────────────────────────────────

const createFullApp = () => {
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
  return createApp({ pluginConfigs: { mcp: { transports: ["stdio"], httpAuth: "none" } } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("core framework lifecycle (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.loadBundle.mockResolvedValue({});
    pixiMocks.assetsState.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: full 8-plugin app boots ────────────────────────────────────

  it("boots a full 8-plugin app with every plugin API defined", async () => {
    const app = createFullApp();

    await expect(app.start()).resolves.toBeUndefined();

    // All eight built-in plugin APIs are present on the app.
    expect(app.ecs).toBeDefined();
    expect(app.scheduler).toBeDefined();
    expect(app.renderer).toBeDefined();
    expect(app.input).toBeDefined();
    expect(app.loop).toBeDefined();
    expect(app.assets).toBeDefined();
    expect(app.scene).toBeDefined();
    expect(app.mcp).toBeDefined();

    await app.stop();
  });

  // ── Scenario 2: shipped wiring via the real createApp ──────────────────────

  it("boots via the shipped createApp export with every shipped plugin API (incl. audio + storage)", async () => {
    const app = shippedCreateApp({
      pluginConfigs: { mcp: { transports: ["stdio"], httpAuth: "none" } }
    });

    await app.start();

    expect(app.ecs).toBeDefined();
    expect(app.scheduler).toBeDefined();
    expect(app.renderer).toBeDefined();
    expect(app.input).toBeDefined();
    expect(app.loop).toBeDefined();
    expect(app.assets).toBeDefined();
    expect(app.context).toBeDefined();
    expect(app.scene).toBeDefined();
    expect(app.mcp).toBeDefined();

    // audio (Wave 1) is wired into the shipped framework; its getters work even
    // headless (no AudioContext in node), returning the config-seeded defaults.
    expect(app.audio).toBeDefined();
    expect(app.audio.isMuted()).toBe(false);
    expect(app.audio.getVolume("master")).toBe(1);

    // storage (Wave 1) is wired too; in node (no localStorage) it degrades to the
    // in-memory fallback — isPersistent() is false, and the save schema starts at v1.
    expect(app.storage).toBeDefined();
    expect(app.storage.isPersistent()).toBe(false);
    expect(app.storage.getVersion()).toBe(1);

    await app.stop();
  });

  // ── Scenario 3: lifecycle toggles ──────────────────────────────────────────

  it("toggles loop and mcp running state across start/stop", async () => {
    const app = createFullApp();

    await app.start();
    expect(app.loop.isRunning()).toBe(true);
    expect(app.mcp.isRunning()).toBe(true);

    await app.stop();
    expect(app.loop.isRunning()).toBe(false);
    expect(app.mcp.isRunning()).toBe(false);
  });

  // ── Scenario 4: config composition reaches plugins ─────────────────────────

  it("composes per-plugin config into the mcp plugin (enableMutations override)", async () => {
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
    const app = createApp({
      pluginConfigs: {
        mcp: { transports: ["stdio"], httpAuth: "none", enableMutations: false }
      }
    });

    await app.start();

    // enableMutations:false → only the four read-only tools are registered.
    expect(app.mcp.toolNames()).toHaveLength(4);
    expect(app.mcp.toolNames()).toContain("ecs:query");
    expect(app.mcp.toolNames()).toContain("renderer:screenshot");
    expect(app.mcp.toolNames()).toContain("renderer:tree");
    expect(app.mcp.toolNames()).toContain("scene:getInfo");

    await app.stop();
  });

  it("registers all 15 mcp tools with default (mutations-enabled) config", async () => {
    // Contrast with the read-only app above: default config exposes the full catalog.
    const app = createFullApp();
    await app.start();

    expect(app.mcp.toolNames()).toHaveLength(15);

    await app.stop();
  });

  // ── Scenario 5: idempotent stop ────────────────────────────────────────────

  it("stops idempotently — a second stop does not throw", async () => {
    const app = createFullApp();

    await app.start();
    await app.stop();
    await expect(app.stop()).resolves.toBeUndefined();
  });

  // ── Scenario 6: consumer plugin registration + reachable API ───────────────

  it("registers a consumer plugin whose API is reachable on the app", async () => {
    const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
      plugins: [ecsPlugin]
    });

    const consumerPlugin = createPlugin("consumer", {
      depends: [ecsPlugin],
      api: _ctx => ({
        ping: () => "pong"
      })
    });

    const app = createApp({ plugins: [consumerPlugin] });
    await app.start();

    expect(app.consumer).toBeDefined();
    expect(app.consumer.ping()).toBe("pong");

    await app.stop();
  });
});
