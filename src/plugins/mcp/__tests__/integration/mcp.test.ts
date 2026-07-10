/**
 * @file mcp plugin — integration tests.
 *
 * Boots the full framework (all 8 plugins) with pixi.js mocked.
 * MCP stdio transport is mocked to avoid attaching to real process.stdin.
 * globalThis.window is mocked with a no-op EventTarget so the input plugin
 * does not try to call addEventListener on globalThis (which lacks it in Node).
 * Covers: lifecycle, isRunning, toolNames, stop, multi-instance isolation.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
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

import type { Container } from "pixi.js";
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
// Test app factory — inMemory transport, so a real MCP Client can drive tool
// calls end-to-end (Cycle 6, issue #4). connectInMemory() runs regardless of
// whether `document` is defined; only the globalThis-publish step is browser-gated.
// ─────────────────────────────────────────────────────────────────────────────

const createInMemoryTestApp = () => {
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
        transports: ["inMemory"],
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
      expect(names).toContain("renderer:attach");
      expect(names).toHaveLength(15);

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

  // ── Cycle 6 (issue #4) — paused mutation + Transform repaint ───────────────
  //
  // Drives real MCP tool calls through a real in-memory Client (mirrors
  // mcp-browser.test.ts's round-trip pattern) to prove both bugs end-to-end:
  //   Bug 2 — a mutating tool call resolves WITHOUT hanging while the loop is
  //           paused (no loop:step needed first — pre-fix this awaited forever).
  //   Bug 1 — after the paused write, a loop:step repositions the entity's
  //           attached view (renderer.markDirty flagged it) from the new
  //           Transform. This harness's renderer is headless (no `document`),
  //           so renderer:tree is not-available here — attach() and markDirty()
  //           operate on state.views/dirty regardless of headless (mirrors
  //           renderer.test.ts's own "repositions container after markDirty +
  //           tick" pattern), so the mock view's position.set is the direct
  //           observable proxy for Bug 1. ecs:query confirms the write itself.
  describe("Cycle 6 — paused mutation + Transform repaint (issue #4)", () => {
    it("ecs:setComponent resolves without hanging while paused, and loop:step repositions the attached view", async () => {
      const app = createInMemoryTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      const view = {
        position: { set: vi.fn() },
        rotation: 0,
        scale: { set: vi.fn() },
        destroy: vi.fn()
      } as unknown as Container;
      app.renderer.attach(entity, view);

      const transport = app.mcp.clientTransport();
      expect(transport).toBeDefined();
      const client = new Client({ name: "in-page-agent", version: "0.0.0" });
      await client.connect(transport as never);

      try {
        // Pause the loop via the MCP tool — no tick will ever drain `pending` now.
        await client.callTool({ name: "loop:pause", arguments: {} });
        expect(app.loop.isRunning()).toBe(false);

        // Bug 2 regression proof: this mutating tool call must resolve WITHOUT a
        // prior loop:step. Pre-fix, enqueueMutation always deferred to the
        // input-stage drain, which never runs while paused — this await hung forever.
        const setResult = await client.callTool({
          name: "ecs:setComponent",
          arguments: {
            id: entity as unknown as number,
            component: "Transform",
            value: { x: 50, y: 60 }
          }
        });
        const setContent = setResult.content as Array<{ type: string; text: string }>;
        expect(JSON.parse(setContent[0]?.text ?? "{}")).toMatchObject({ changed: true });

        // The write applied immediately (paused path) — observable before any tick.
        const queryResult = await client.callTool({
          name: "ecs:query",
          arguments: { componentNames: ["Transform"] }
        });
        const queryContent = queryResult.content as Array<{ type: string; text: string }>;
        const parsed = JSON.parse(queryContent[0]?.text ?? "{}") as {
          entities: Array<{
            id: number;
            components: Array<{ name: string; value: { x: number; y: number } }>;
          }>;
        };
        const transform = parsed.entities
          .find(e => e.id === (entity as unknown as number))
          ?.components.find(c => c.name === "Transform");
        expect(transform?.value.x).toBe(50);
        expect(transform?.value.y).toBe(60);

        // Bug 1 regression proof: no reposition has happened yet (no tick ran).
        expect(view.position.set).not.toHaveBeenCalled();

        // Advance one tick — the sync stage repositions the dirty (markDirty-flagged) view.
        await client.callTool({ name: "loop:step", arguments: {} });
        expect(view.position.set).toHaveBeenCalledWith(50, 60);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  });
});
