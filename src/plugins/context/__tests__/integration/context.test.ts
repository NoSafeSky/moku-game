/**
 * @file context plugin — integration tests.
 *
 * Boots the full framework (ecs + scheduler + renderer + assets + context) with
 * vi.mock("pixi.js") so no real GPU context is needed. Covers:
 * - Assets resource readable in a system after start
 * - GameContext resource readable in a system after start
 * - world.resource() throws BEFORE start (resource not set)
 * - bindGameContext:false skips GameContext binding
 * - Type-level: resource value types are inferred correctly
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted Pixi mock (headless — no real GPU needed)
// ─────────────────────────────────────────────────────────────────────────────

const pixiMocks = vi.hoisted(() => {
  const appState = {
    init: vi.fn().mockResolvedValue(undefined),
    render: vi.fn(),
    destroy: vi.fn(),
    canvas: {} as HTMLCanvasElement,
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
    loadBundle: vi.fn().mockResolvedValue({}),
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

// ─────────────────────────────────────────────────────────────────────────────
// Framework imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { coreConfig } from "../../../../config";
import { assetsPlugin } from "../../../assets";
import type { Api as AssetsApi } from "../../../assets/types";
import { ecsPlugin } from "../../../ecs";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { contextPlugin } from "../../index";
import type { GameContextValue } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = (pluginConfigs?: { context?: { bindGameContext?: boolean } }) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, contextPlugin]
  });
  // exactOptionalPropertyTypes: pass pluginConfigs only when defined
  return pluginConfigs === undefined ? createApp() : createApp({ pluginConfigs });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("context plugin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.loadBundle.mockResolvedValue({});
    pixiMocks.assetsState.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("starts and stops without error", async () => {
      const app = createTestApp();
      await expect(app.start()).resolves.toBeUndefined();
      await app.stop();
    });

    it("exposes app.context API (assets + game tokens) after createApp", async () => {
      const app = createTestApp();
      expect(app.context.assets).toBeDefined();
      expect(app.context.game).toBeDefined();
      await app.start();
      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Resource binding — Assets
  // ──────────────────────────────────────────────────────────────────────────

  describe("Assets resource", () => {
    it("world.resource(app.context.assets) returns the assets API after start", async () => {
      const app = createTestApp();
      await app.start();

      const assetsApi = app.ecs.resource(app.context.assets);
      expect(assetsApi).toBeDefined();
      expect(typeof assetsApi.get).toBe("function");
      expect(typeof assetsApi.load).toBe("function");

      await app.stop();
    });

    it("world.resource() throws with 'is not set' message BEFORE start", async () => {
      const app = createTestApp();
      // Do NOT call app.start() — tokens are valid but values are unset
      expect(() => app.ecs.resource(app.context.assets)).toThrow(/is not set/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Resource binding — GameContext
  // ──────────────────────────────────────────────────────────────────────────

  describe("GameContext resource", () => {
    it("world.resource(app.context.game) returns {log,emit,env} after start", async () => {
      const app = createTestApp();
      await app.start();

      const gc = app.ecs.resource(app.context.game);
      expect(gc).toBeDefined();
      expect(typeof gc.log.info).toBe("function");
      expect(typeof gc.emit).toBe("function");
      expect(typeof gc.env.get).toBe("function");

      await app.stop();
    });

    it("a system registered before start can read both resources during tick", async () => {
      const app = createTestApp();
      await app.start();

      let seenAssetsApi: AssetsApi | undefined;
      let seenGameCtx: GameContextValue | undefined;

      app.ecs.addSystem("update", world => {
        seenAssetsApi = world.resource(app.context.assets);
        seenGameCtx = world.resource(app.context.game);
      });

      app.ecs.tick(1 / 60);

      expect(seenAssetsApi).toBeDefined();
      expect(typeof seenAssetsApi?.get).toBe("function");
      expect(seenGameCtx).toBeDefined();
      expect(typeof seenGameCtx?.log.info).toBe("function");

      await app.stop();
    });

    it("GameContext.emit in a system does not throw", async () => {
      const app = createTestApp();
      await app.start();

      let emitError: unknown;
      app.ecs.addSystem("update", world => {
        const gc = world.resource(app.context.game);
        try {
          gc.emit("assets:loaded", { alias: "test", kind: "asset" });
        } catch (error) {
          emitError = error;
        }
      });

      app.ecs.tick(1 / 60);
      expect(emitError).toBeUndefined();

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // bindGameContext: false
  // ──────────────────────────────────────────────────────────────────────────

  describe("bindGameContext: false", () => {
    it("Assets is still readable after start with bindGameContext:false", async () => {
      const app = createTestApp({ context: { bindGameContext: false } });
      await app.start();

      const assetsApi = app.ecs.resource(app.context.assets);
      expect(assetsApi).toBeDefined();
      expect(typeof assetsApi.get).toBe("function");

      await app.stop();
    });

    it("GameContext is NOT bound and world.resource() throws with bindGameContext:false", async () => {
      const app = createTestApp({ context: { bindGameContext: false } });
      await app.start();

      expect(() => app.ecs.resource(app.context.game)).toThrow(/is not set/);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Type-level tests
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("world.resource(app.context.assets) is inferred as AssetsApi", async () => {
      const app = createTestApp();
      await app.start();

      const assetsValue = app.ecs.resource(app.context.assets);
      expectTypeOf(assetsValue).toEqualTypeOf<AssetsApi>();

      await app.stop();
    });

    it("world.resource(app.context.game) is inferred as GameContextValue", async () => {
      const app = createTestApp();
      await app.start();

      const gcValue = app.ecs.resource(app.context.game);
      expectTypeOf(gcValue).toEqualTypeOf<GameContextValue>();

      await app.stop();
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- type-level test, compile-time rejection via @ts-expect-error
    it("rejects unknown event name on GameContext.emit (@ts-expect-error)", async () => {
      const app = createTestApp();
      await app.start();

      const gc = app.ecs.resource(app.context.game);
      // @ts-expect-error — "nope:event" is not a known framework event
      gc.emit("nope:event", {});

      await app.stop();
    });

    it("GameContextValue does not expose require (no kernel escape hatch)", () => {
      // Type-only: ensure GameContextValue has no `require` property
      expectTypeOf<GameContextValue>().not.toHaveProperty("require");
    });
  });
});
