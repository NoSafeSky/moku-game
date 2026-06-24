/**
 * @file Cross-plugin integration — polled input feeding ECS systems and the
 *       scene lifecycle wiring ecs + renderer + assets.
 *
 * Boots the REAL framework (real plugins + real createCore/createApp/createPlugin
 * factory). Only the headless surfaces are mocked: PixiJS (no GPU context) and
 * globalThis.window (the input plugin's default DOM EventTarget, absent in node).
 *
 * Two cross-plugin stories are exercised:
 *  1. INPUT → SYSTEM — a real keydown handler (pulled from the recorded DOM
 *     listener) mutates the live input state; one tick rolls the immutable
 *     per-frame snapshot, and the per-frame edge (justPressed) clears next tick.
 *  2. SCENE LIFECYCLE — define/load/unload, entity ownership, the scene:loaded
 *     milestone event, view detach on transition, and bundle-before-setup order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Headless DOM EventTarget for the input plugin (node has no real window).
// Assigned BEFORE any plugin import so input's resolveTarget() picks it up.
// ─────────────────────────────────────────────────────────────────────────────

const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
Object.assign(globalThis, { window: mockEventTarget });

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted PixiJS mock state — Application/Container/Sprite are CLASSES; Assets is
// an object. No GPU context exists in the node test runner.
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

// ─── Framework imports AFTER the mocks ──
import { Container } from "pixi.js";
import { coreConfig } from "../../src/config";
import { assetsPlugin } from "../../src/plugins/assets";
import { ecsPlugin } from "../../src/plugins/ecs";
import { inputPlugin } from "../../src/plugins/input";
import { loopPlugin } from "../../src/plugins/loop";
import { rendererPlugin } from "../../src/plugins/renderer";
import { scenePlugin } from "../../src/plugins/scene";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input-focused app: input needs scheduler; loop provides a deterministic tick
 * (`app.loop.step()` → `scheduler.tick(fixedDt)` → runs the "input"-stage system).
 * loop transitively needs renderer; renderer needs ecs + scheduler.
 */
const createInputApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, inputPlugin, loopPlugin]
  });
  return createApp({ pluginConfigs: { loop: { autoStart: false } } });
};

/**
 * Scene-focused app: scene needs ecs + renderer + assets; renderer needs
 * scheduler. Matches the existing scene integration test's plugin set.
 */
const createSceneApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
  });
  return createApp();
};

/**
 * Pull the real `keydown` handler the input plugin registered on the mock target.
 *
 * `mockEventTarget.addEventListener` only RECORDS handlers (it does not dispatch),
 * so we find the recorded "keydown" entry and return its function to call directly.
 *
 * @returns The registered keydown handler invoked with a `{ key }`-shaped event.
 */
const getKeydownHandler = (): ((event: { key: string }) => void) => {
  const handlers = mockEventTarget.addEventListener.mock.calls;
  const entry = handlers.find(([type]) => type === "keydown");
  if (!entry) throw new Error("keydown handler was not registered");
  return entry[1] as (event: { key: string }) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-plugin: input → system + scene lifecycle (ecs+renderer+assets)", () => {
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
  // 1. Input → system flow
  // ──────────────────────────────────────────────────────────────────────────

  describe("input → system flow", () => {
    it("a keydown event becomes isDown after the input-stage system ticks", async () => {
      const app = createInputApp();
      await app.start();

      // Calling the recorded DOM handler mutates the live input state; one tick
      // rolls that into the immutable per-frame snapshot read by gameplay systems.
      const keydown = getKeydownHandler();
      keydown({ key: "ArrowRight" });

      app.loop.step(); // scheduler.tick → runs the input-stage system → rolls snapshot

      expect(app.input.snapshot().isDown("ArrowRight")).toBe(true);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. justPressed is a one-frame edge
  // ──────────────────────────────────────────────────────────────────────────

  describe("justPressed edge", () => {
    it("justPressed is true for exactly one frame; isDown persists", async () => {
      const app = createInputApp();
      await app.start();

      const keydown = getKeydownHandler();
      keydown({ key: "ArrowRight" });

      app.loop.step(); // frame 1: snapshot sees the press edge

      const frame1 = app.input.snapshot();
      expect(frame1.justPressed("ArrowRight")).toBe(true);
      expect(frame1.isDown("ArrowRight")).toBe(true);

      app.loop.step(); // frame 2: no new event — edge cleared, hold persists

      const frame2 = app.input.snapshot();
      expect(frame2.justPressed("ArrowRight")).toBe(false);
      expect(frame2.isDown("ArrowRight")).toBe(true);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. scene.load runs setup + tracks ownership
  // ──────────────────────────────────────────────────────────────────────────

  describe("scene.load setup + ownership", () => {
    it("runs setup, leaves spawned entities alive, and records currentScene", async () => {
      const app = createSceneApp();
      await app.start();

      const spawned: Array<ReturnType<typeof app.ecs.spawn>> = [];
      app.scene.define("level", {
        setup: world => {
          spawned.push(world.spawn(), world.spawn());
        }
      });

      await app.scene.load("level");

      expect(spawned).toHaveLength(2);
      for (const entity of spawned) {
        expect(app.ecs.isAlive(entity)).toBe(true);
      }
      expect(app.scene.currentScene()).toBe("level");

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. scene:loaded milestone event
  // ──────────────────────────────────────────────────────────────────────────

  describe("scene:loaded event", () => {
    it("a consumer plugin receives exactly one { name } on load", async () => {
      const received: Array<{ name: string }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
      });

      const listenerPlugin = createPlugin("scene-loaded-listener", {
        depends: [scenePlugin],
        hooks: _ctx => ({
          "scene:loaded": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      app.scene.define("level", { setup: vi.fn() });
      await app.scene.load("level");

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ name: "level" });

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Scene transition despawns prior entities + detaches their views
  // ──────────────────────────────────────────────────────────────────────────

  describe("scene transition", () => {
    it("despawns scene A entities and destroys their attached renderer views", async () => {
      const app = createSceneApp();
      await app.start();

      const sceneAEntities: Array<ReturnType<typeof app.ecs.spawn>> = [];
      const sceneAViews: Container[] = [];

      app.scene.define("sceneA", {
        setup: world => {
          for (let i = 0; i < 2; i += 1) {
            const entity = world.spawn();
            const view = new Container();
            app.renderer.attach(entity, view);
            sceneAEntities.push(entity);
            sceneAViews.push(view);
          }
        }
      });
      app.scene.define("sceneB", { setup: vi.fn() });

      await app.scene.load("sceneA");
      for (const entity of sceneAEntities) {
        expect(app.ecs.isAlive(entity)).toBe(true);
      }

      await app.scene.load("sceneB");

      // The scene plugin detaches each owned entity's renderer view (which
      // destroys the Pixi Container) before despawning it from the ECS world.
      for (const entity of sceneAEntities) {
        expect(app.ecs.isAlive(entity)).toBe(false);
      }
      for (const view of sceneAViews) {
        expect(view.destroy).toHaveBeenCalledOnce();
      }

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Bundle preload ordering — loadBundle BEFORE setup
  // ──────────────────────────────────────────────────────────────────────────

  describe("bundle preload ordering", () => {
    it("calls assets.loadBundle before the scene setup runs", async () => {
      const app = createSceneApp();
      await app.start();

      const order: string[] = [];
      pixiMocks.assetsState.loadBundle.mockImplementation(() => {
        order.push("loadBundle");
        return Promise.resolve({});
      });

      app.scene.define("level", {
        bundle: { hero: "hero.png", bg: "bg.png" },
        setup: () => {
          order.push("setup");
        }
      });

      await app.scene.load("level");

      const loadBundleIdx = order.indexOf("loadBundle");
      const setupIdx = order.indexOf("setup");
      expect(loadBundleIdx).toBeGreaterThanOrEqual(0);
      expect(setupIdx).toBeGreaterThan(loadBundleIdx);

      await app.stop();
    });
  });
});
