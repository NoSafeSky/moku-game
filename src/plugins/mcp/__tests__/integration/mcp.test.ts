/**
 * @file mcp plugin — integration tests.
 *
 * Boots the full framework (all 8 plugins) with pixi.js mocked.
 * MCP stdio transport is mocked to avoid attaching to real process.stdin.
 * globalThis.window is mocked with a no-op EventTarget so the input plugin
 * does not try to call addEventListener on globalThis (which lacks it in Node).
 * Covers: lifecycle, isRunning, toolNames, stop, multi-instance isolation.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DOM EventTarget for the input plugin (no real window in Node)
// ─────────────────────────────────────────────────────────────────────────────
const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
// Assign before any plugin imports so resolveTarget() picks it up
Object.assign(globalThis, { window: mockEventTarget });

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mocks — order matters (must be before framework imports)
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

  const assetsState = {
    load: vi.fn(),
    addBundle: vi.fn(),
    loadBundle: vi.fn(),
    get: vi.fn()
  };

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

// Mock stdio transport to avoid attaching to real process.stdin
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
// Test app factory — stdio only (no real HTTP listener)
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = () => {
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
      mcp: {
        transports: ["stdio"],
        httpAuth: "none"
      }
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("mcp plugin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.loadBundle.mockResolvedValue({});
    pixiMocks.assetsState.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("starts and stops without error", async () => {
      const app = createTestApp();
      await expect(app.start()).resolves.toBeUndefined();
      await app.stop();
    });

    it("exposes app.mcp API after start", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.mcp).toBeDefined();

      await app.stop();
    });

    it("isRunning() is true after start, false after stop", async () => {
      const app = createTestApp();
      await app.start();
      expect(app.mcp.isRunning()).toBe(true);

      await app.stop();
      expect(app.mcp.isRunning()).toBe(false);
    });
  });

  // ── Tool catalog ───────────────────────────────────────────────────────────

  describe("tool catalog", () => {
    it("toolNames() returns all 14 tools with default config", async () => {
      const app = createTestApp();
      await app.start();

      const names = app.mcp.toolNames();
      expect(names).toContain("ecs:spawn");
      expect(names).toContain("ecs:despawn");
      expect(names).toContain("ecs:setComponent");
      expect(names).toContain("ecs:removeComponent");
      expect(names).toContain("ecs:query");
      expect(names).toContain("input:key");
      expect(names).toContain("renderer:tree");
      expect(names).toContain("loop:step");
      expect(names).toContain("loop:pause");
      expect(names).toContain("loop:resume");
      expect(names).toContain("renderer:screenshot");
      expect(names).toContain("scene:load");
      expect(names).toContain("scene:getInfo");
      expect(names).toContain("game:reset");
      expect(names).toHaveLength(14);

      await app.stop();
    });

    it("toolNames() returns only read-only tools when enableMutations=false", async () => {
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
          mcp: {
            transports: ["stdio"],
            httpAuth: "none",
            enableMutations: false
          }
        }
      });

      await app.start();

      const names = app.mcp.toolNames();
      expect(names).toContain("ecs:query");
      expect(names).toContain("renderer:screenshot");
      expect(names).toContain("scene:getInfo");
      expect(names).not.toContain("ecs:spawn");

      await app.stop();
    });
  });

  // ── HTTP endpoint ──────────────────────────────────────────────────────────

  describe("httpEndpoint", () => {
    it("httpEndpoint() is undefined for stdio-only transport", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.mcp.httpEndpoint()).toBeUndefined();

      await app.stop();
    });
  });

  // ── Multi-instance isolation (WeakMap keyed on distinct ctx.global) ────────

  describe("multi-instance isolation", () => {
    it("two apps do not cross-close (WeakMap isolation)", async () => {
      const app1 = createTestApp();
      const app2 = createTestApp();

      await app1.start();
      await app2.start();

      expect(app1.mcp.isRunning()).toBe(true);
      expect(app2.mcp.isRunning()).toBe(true);

      await app1.stop();

      // app1 stopped, app2 still running
      expect(app1.mcp.isRunning()).toBe(false);
      expect(app2.mcp.isRunning()).toBe(true);

      await app2.stop();
      expect(app2.mcp.isRunning()).toBe(false);
    });
  });

  // ── Bearer auth validation ─────────────────────────────────────────────────

  describe("bearer auth validation", () => {
    it("throws when httpAuth=bearer and bearerToken is empty", async () => {
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
          mcp: {
            transports: ["http"],
            httpAuth: "bearer",
            bearerToken: ""
          }
        }
      });

      await expect(app.start()).rejects.toThrow();
    });
  });

  // ── Types ──────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("app.mcp.isRunning is typed as () => boolean", async () => {
      const app = createTestApp();
      await app.start();
      expectTypeOf(app.mcp.isRunning).toEqualTypeOf<() => boolean>();
      await app.stop();
    });

    it("app.mcp.httpEndpoint is typed as () => string | undefined", async () => {
      const app = createTestApp();
      await app.start();
      expectTypeOf(app.mcp.httpEndpoint).toEqualTypeOf<() => string | undefined>();
      await app.stop();
    });

    it("app.mcp.toolNames is typed as () => readonly string[]", async () => {
      const app = createTestApp();
      await app.start();
      expectTypeOf(app.mcp.toolNames).toEqualTypeOf<() => readonly string[]>();
      await app.stop();
    });
  });
});
