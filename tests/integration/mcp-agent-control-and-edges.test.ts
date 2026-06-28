/**
 * @file Root integration — MCP runtime exposure + ECS / scene edge cases.
 *
 * Boots the REAL framework (all 8 plugins) with PixiJS mocked (no GPU), a
 * headless DOM EventTarget for the input plugin, and the MCP stdio transport
 * mocked so onStart does not attach to the real process.stdin.
 *
 * Two themes:
 *  1. MCP agent-control surface — the registered tool catalog (15 default / 4
 *     read-only), lifecycle (`isRunning`), the stdio-only `httpEndpoint`, and
 *     that the input-stage drain system coexists with the loop without throwing.
 *  2. EDGE cases — loading an undefined scene rejects, empty-world queries are
 *     safe (zero count, zero iterations, `isAlive` false without throwing), and
 *     bearer auth with an empty token is rejected at startup.
 *
 * The loop never auto-drives frames in node (rAF is absent), so scenarios that
 * need to advance the simulation use `app.loop.step()` (one fixed tick + render).
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
import { assetsPlugin } from "../../src/plugins/assets";
import { ecsPlugin } from "../../src/plugins/ecs";
import { inputPlugin } from "../../src/plugins/input";
import { loopPlugin } from "../../src/plugins/loop";
import { mcpPlugin } from "../../src/plugins/mcp";
import { rendererPlugin } from "../../src/plugins/renderer";
import { scenePlugin } from "../../src/plugins/scene";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factories
// ─────────────────────────────────────────────────────────────────────────────

/** The eight framework plugins in shipped registration order. */
const allPlugins = [
  ecsPlugin,
  schedulerPlugin,
  rendererPlugin,
  assetsPlugin,
  inputPlugin,
  loopPlugin,
  scenePlugin,
  mcpPlugin
] as const;

/**
 * Build the full 8-plugin app with the MCP plugin configured for stdio only
 * (no real HTTP listener) and open ("none") auth. The loop is left at its
 * defaults; in node rAF is absent so it never auto-drives — advance with `step()`.
 *
 * @returns A freshly created (not yet started) full App instance.
 * @example
 * ```ts
 * const app = createFullApp();
 * await app.start();
 * ```
 */
const createFullApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: [...allPlugins] });
  return createApp({ pluginConfigs: { mcp: { transports: ["stdio"], httpAuth: "none" } } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("mcp agent-control surface + edge cases (root integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.loadBundle.mockResolvedValue({});
    pixiMocks.assetsState.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Full default tool catalog ───────────────────────────────────────────

  describe("tool catalog", () => {
    it("registers all 15 default tools after start", async () => {
      const app = createFullApp();
      await app.start();

      const names = app.mcp.toolNames();
      const expected = [
        "ecs:spawn",
        "ecs:despawn",
        "ecs:setComponent",
        "ecs:removeComponent",
        "ecs:query",
        "input:key",
        "renderer:tree",
        "renderer:attach",
        "loop:step",
        "loop:pause",
        "loop:resume",
        "renderer:screenshot",
        "scene:load",
        "scene:getInfo",
        "game:reset"
      ];
      for (const tool of expected) {
        expect(names).toContain(tool);
      }
      expect(names).toHaveLength(15);

      await app.stop();
    });

    // ── 2. enableMutations:false → only the 4 read-only tools ────────────────

    it("registers exactly the 4 read-only tools when enableMutations is false", async () => {
      const { createApp } = coreConfig.createCore(coreConfig, { plugins: [...allPlugins] });
      const app = createApp({
        pluginConfigs: {
          mcp: { transports: ["stdio"], httpAuth: "none", enableMutations: false }
        }
      });
      await app.start();

      const names = app.mcp.toolNames();

      // The four read-only tools are present.
      expect(names).toContain("ecs:query");
      expect(names).toContain("renderer:screenshot");
      expect(names).toContain("renderer:tree");
      expect(names).toContain("scene:getInfo");

      // Exactly four tools, no more.
      expect([...names].toSorted()).toEqual(
        ["ecs:query", "renderer:screenshot", "renderer:tree", "scene:getInfo"].toSorted()
      );

      // None of the mutating / interaction tools leak through.
      for (const mutating of [
        "ecs:spawn",
        "ecs:despawn",
        "ecs:setComponent",
        "ecs:removeComponent",
        "input:key",
        "loop:step",
        "loop:pause",
        "loop:resume",
        "scene:load",
        "game:reset"
      ]) {
        expect(names).not.toContain(mutating);
      }

      await app.stop();
    });
  });

  // ── 3. Lifecycle + stdio-only endpoint ─────────────────────────────────────

  describe("lifecycle + endpoint", () => {
    it("isRunning() flips with start/stop and httpEndpoint() is undefined for stdio", async () => {
      const app = createFullApp();

      await app.start();
      expect(app.mcp.isRunning()).toBe(true);
      expect(app.mcp.httpEndpoint()).toBeUndefined();

      await app.stop();
      expect(app.mcp.isRunning()).toBe(false);
    });
  });

  // ── 4. Frame-safe coexistence: drain system + loop steps ───────────────────

  describe("frame-safe coexistence", () => {
    it("steps the loop with mcp wired in without throwing; input stage is present", async () => {
      const app = createFullApp();
      await app.start();

      // The mcp drain system is registered on the "input" stage.
      expect(app.scheduler.stages).toContain("input");

      // Several deterministic fixed steps must not throw with mcp's drain system
      // and stats probe both registered alongside the loop.
      expect(() => {
        for (let i = 0; i < 5; i += 1) app.loop.step();
      }).not.toThrow();

      await expect(app.stop()).resolves.toBeUndefined();
    });
  });

  // ── 5. EDGE — loading an undefined scene rejects ───────────────────────────

  describe("edge: undefined scene", () => {
    it("rejects when loading a scene that was never defined", async () => {
      const app = createFullApp();
      await app.start();

      await expect(app.scene.load("does-not-exist")).rejects.toThrow();

      await app.stop();
    });
  });

  // ── 6. EDGE — empty-world queries are safe ─────────────────────────────────

  describe("edge: empty world", () => {
    it("queries with no entities report zero and iterate zero times; isAlive is false", async () => {
      const app = createFullApp();
      await app.start();

      // A real component, defined but never used to spawn anything.
      const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));

      // count() is 0 on an empty world.
      expect(app.ecs.query(Position).count()).toBe(0);

      // updateEach runs its callback zero times.
      let iterations = 0;
      app.ecs.query(Position).updateEach(() => {
        iterations += 1;
      });
      expect(iterations).toBe(0);

      // first() is undefined and the entity iterator yields nothing.
      expect(app.ecs.query(Position).first()).toBeUndefined();
      expect([...app.ecs.query(Position)]).toHaveLength(0);

      // isAlive on an entity that was spawned then despawned is false (no throw).
      const ephemeral = app.ecs.spawn(Position({ x: 1, y: 2 }));
      app.ecs.despawn(ephemeral);
      expect(app.ecs.isAlive(ephemeral)).toBe(false);

      // The empty query is still safe after the spawn/despawn churn.
      expect(app.ecs.query(Position).count()).toBe(0);

      await app.stop();
    });
  });

  // ── 7. EDGE — bearer auth requires a non-empty token (startup validation) ──

  describe("edge: bearer auth requires a token", () => {
    it("rejects start() when httpAuth is bearer and bearerToken is empty", async () => {
      const { createApp } = coreConfig.createCore(coreConfig, { plugins: [...allPlugins] });
      const app = createApp({
        pluginConfigs: {
          mcp: { transports: ["http"], httpAuth: "bearer", bearerToken: "" }
        }
      });

      // validateConfig() runs first in the mcp onStart — before any dependency
      // resolution or HTTP bind — so this rejects on the validation error, not a
      // bind error. The message names bearerToken specifically.
      await expect(app.start()).rejects.toThrow(/bearerToken/);
    });
  });
});
