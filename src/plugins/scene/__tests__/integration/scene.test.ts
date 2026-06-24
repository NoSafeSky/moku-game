/**
 * @file scene plugin — integration tests.
 *
 * Boots the full framework (ecs + scheduler + renderer + assets + scene) with
 * vi.mock("pixi.js") so no real GPU context is needed. Covers load/unload,
 * entity ownership, scene:loaded event propagation, and scene transitions.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock state
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

// ─────────────────────────────────────────────────────────────────────────────
// Framework imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { coreConfig } from "../../../../config";
import { assetsPlugin } from "../../../assets";
import { ecsPlugin } from "../../../ecs";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { scenePlugin } from "../../index";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
  });
  return createApp();
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("scene plugin integration", () => {
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

    it("exposes app.scene API after start", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.scene).toBeDefined();

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Define + load
  // ──────────────────────────────────────────────────────────────────────────

  describe("define + load", () => {
    it("loads a defined scene and calls setup", async () => {
      const app = createTestApp();
      await app.start();

      const setup = vi.fn();
      app.scene.define("menu", { setup });

      await app.scene.load("menu");

      expect(setup).toHaveBeenCalledOnce();

      await app.stop();
    });

    it("currentScene() returns the loaded scene name", async () => {
      const app = createTestApp();
      await app.start();

      app.scene.define("menu", { setup: vi.fn() });
      await app.scene.load("menu");

      expect(app.scene.currentScene()).toBe("menu");

      await app.stop();
    });

    it("throws when loading an undefined scene", async () => {
      const app = createTestApp();
      await app.start();

      await expect(app.scene.load("unknown")).rejects.toThrow();

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Entity ownership: load → load transition
  // ──────────────────────────────────────────────────────────────────────────

  describe("entity ownership", () => {
    it("despawns scene A entities when loading scene B", async () => {
      const app = createTestApp();
      await app.start();

      let sceneAEntities: unknown[] = [];

      app.scene.define("sceneA", {
        setup: world => {
          sceneAEntities = [world.spawn(), world.spawn()];
        }
      });
      app.scene.define("sceneB", { setup: vi.fn() });

      await app.scene.load("sceneA");
      // Entities should be alive after sceneA load
      for (const entity of sceneAEntities) {
        expect(app.ecs.isAlive(entity as Parameters<typeof app.ecs.isAlive>[0])).toBe(true);
      }

      await app.scene.load("sceneB");

      // Entities should be dead after sceneB load despawns sceneA's entities
      for (const entity of sceneAEntities) {
        expect(app.ecs.isAlive(entity as Parameters<typeof app.ecs.isAlive>[0])).toBe(false);
      }

      await app.stop();
    });

    it("unload() despawns owned entities and clears current", async () => {
      const app = createTestApp();
      await app.start();

      const spawnedEntities: unknown[] = [];

      app.scene.define("game", {
        setup: world => {
          spawnedEntities.push(world.spawn());
        }
      });

      await app.scene.load("game");
      expect(app.scene.currentScene()).toBe("game");

      app.scene.unload();

      expect(app.scene.currentScene()).toBeUndefined();
      for (const entity of spawnedEntities) {
        expect(app.ecs.isAlive(entity as Parameters<typeof app.ecs.isAlive>[0])).toBe(false);
      }

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Events: scene:loaded
  // ──────────────────────────────────────────────────────────────────────────

  describe("events", () => {
    it("scene:loaded fires on load and is received by a consumer plugin hook", async () => {
      const received: Array<{ name: string }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
      });

      const listenerPlugin = createPlugin("scene-listener", {
        depends: [scenePlugin],
        hooks: _ctx => ({
          "scene:loaded": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      app.scene.define("menu", { setup: vi.fn() });
      await app.scene.load("menu");

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ name: "menu" });

      await app.stop();
    });

    it("scene:loaded fires once per load (not on unload)", async () => {
      const received: Array<{ name: string }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
      });

      const listenerPlugin = createPlugin("scene-listener-2", {
        depends: [scenePlugin],
        hooks: _ctx => ({
          "scene:loaded": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      app.scene.define("menu", { setup: vi.fn() });
      await app.scene.load("menu");
      app.scene.unload();

      expect(received).toHaveLength(1);

      await app.stop();
    });

    it("scene:loaded fires for each scene in a transition", async () => {
      const received: Array<{ name: string }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
      });

      const listenerPlugin = createPlugin("scene-listener-3", {
        depends: [scenePlugin],
        hooks: _ctx => ({
          "scene:loaded": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      app.scene.define("menu", { setup: vi.fn() });
      app.scene.define("game", { setup: vi.fn() });

      await app.scene.load("menu");
      await app.scene.load("game");

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual({ name: "menu" });
      expect(received[1]).toEqual({ name: "game" });

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bundle pre-loading
  // ──────────────────────────────────────────────────────────────────────────

  describe("bundle pre-loading", () => {
    it("calls assets.loadBundle before setup when bundle is defined", async () => {
      const app = createTestApp();
      await app.start();

      const setupOrder: string[] = [];
      pixiMocks.assetsState.addBundle.mockImplementation(() => {
        setupOrder.push("addBundle");
      });
      pixiMocks.assetsState.loadBundle.mockImplementation(() => {
        setupOrder.push("loadBundle");
        return Promise.resolve({});
      });

      app.scene.define("level1", {
        setup: () => {
          setupOrder.push("setup");
        },
        bundle: { hero: "hero.png", bg: "bg.png" }
      });

      await app.scene.load("level1");

      // loadBundle must have been called before setup
      const loadBundleIdx = setupOrder.indexOf("loadBundle");
      const setupIdx = setupOrder.indexOf("setup");
      expect(loadBundleIdx).toBeGreaterThanOrEqual(0);
      expect(setupIdx).toBeGreaterThan(loadBundleIdx);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("app.scene.currentScene returns string | undefined", async () => {
      const app = createTestApp();
      await app.start();

      expectTypeOf(app.scene.currentScene).toEqualTypeOf<() => string | undefined>();

      await app.stop();
    });

    it("app.scene.load returns Promise<void>", async () => {
      const app = createTestApp();
      await app.start();

      expectTypeOf(app.scene.load).toEqualTypeOf<(name: string) => Promise<void>>();

      await app.stop();
    });

    it("scene:loaded payload is typed in consumer plugin", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
      });

      createPlugin("type-check", {
        depends: [scenePlugin],
        hooks: _ctx => ({
          "scene:loaded": payload => {
            expectTypeOf(payload).toEqualTypeOf<{ name: string }>();
          }
        })
      });
    });

    it("rejects wrong payload for scene:loaded in consumer plugin", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
      });

      const plugin = createPlugin("wrong-payload", {
        depends: [scenePlugin],
        api: ctx => ({
          test: () => {
            // @ts-expect-error — missing required name field
            ctx.emit("scene:loaded", {});
          }
        })
      });

      expect(plugin.name).toBe("wrong-payload");
    });
  });
});
