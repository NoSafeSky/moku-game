/**
 * @file assets plugin — integration tests.
 *
 * Boots the full framework (ecs + scheduler + renderer + assets) with
 * vi.mock("pixi.js") so no real GPU context is needed. Covers load/event/sprite
 * end-to-end and event propagation to a consumer plugin via hooks.
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
        destroy: vi.fn()
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

import type { Sprite, Texture } from "pixi.js";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { assetsPlugin } from "../../index";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory
// ─────────────────────────────────────────────────────────────────────────────

const fakeTexture = { source: {} } as unknown as Texture;

const createTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin]
  });
  return createApp();
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("assets plugin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.load.mockResolvedValue(fakeTexture);
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

    it("exposes app.assets API after start", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.assets).toBeDefined();

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Runtime: API behavior
  // ──────────────────────────────────────────────────────────────────────────

  describe("runtime: API behavior", () => {
    it("load resolves a texture and records it as loaded", async () => {
      const app = createTestApp();
      await app.start();

      const texture = await app.assets.load("ship");

      expect(texture).toBe(fakeTexture);
      expect(app.assets.isLoaded("ship")).toBe(true);

      await app.stop();
    });

    it("isLoaded returns false for unloaded alias", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.assets.isLoaded("unknown")).toBe(false);

      await app.stop();
    });

    it("get delegates to Assets.get", async () => {
      pixiMocks.assetsState.get.mockReturnValue(fakeTexture);
      const app = createTestApp();
      await app.start();

      const result = app.assets.get("ship");
      expect(result).toBe(fakeTexture);

      await app.stop();
    });

    it("sprite returns a Sprite with the loaded texture", async () => {
      const app = createTestApp();
      await app.start();

      const sp = await app.assets.sprite("ship");

      expect(sp).toBeDefined();
      expect((sp as { texture: unknown }).texture).toBe(fakeTexture);

      await app.stop();
    });

    it("loadBundle records each alias and returns the record", async () => {
      const fakeTexture2 = { source: {} } as unknown as Texture;
      const entries = { ship: "ship.png", tank: "tank.png" };
      const bundleResult = { ship: fakeTexture, tank: fakeTexture2 };
      pixiMocks.assetsState.loadBundle.mockResolvedValueOnce(bundleResult);

      const app = createTestApp();
      await app.start();

      const result = await app.assets.loadBundle("vehicles", entries);

      expect(result).toEqual({ ship: fakeTexture, tank: fakeTexture2 });
      expect(app.assets.isLoaded("ship")).toBe(true);
      expect(app.assets.isLoaded("tank")).toBe(true);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Runtime: events
  // ──────────────────────────────────────────────────────────────────────────

  describe("runtime: events", () => {
    it("assets:loaded fires on load and is received by a consumer plugin hook", async () => {
      const received: Array<{ alias: string; kind: "asset" | "bundle" }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin]
      });

      const listenerPlugin = createPlugin("assets-listener", {
        depends: [assetsPlugin],
        hooks: _ctx => ({
          "assets:loaded": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      await app.assets.load("ship");

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ alias: "ship", kind: "asset" });

      await app.stop();
    });

    it("assets:loaded fires once with kind 'bundle' for loadBundle", async () => {
      const received: Array<{ alias: string; kind: "asset" | "bundle" }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin]
      });

      const fakeTexture2 = { source: {} } as unknown as Texture;
      const bundleResult = { ship: fakeTexture, tank: fakeTexture2 };
      pixiMocks.assetsState.loadBundle.mockResolvedValueOnce(bundleResult);

      const listenerPlugin = createPlugin("bundle-listener", {
        depends: [assetsPlugin],
        hooks: _ctx => ({
          "assets:loaded": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({ plugins: [listenerPlugin] });
      await app.start();

      await app.assets.loadBundle("vehicles", { ship: "ship.png", tank: "tank.png" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ alias: "vehicles", kind: "bundle" });

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("app.assets.load returns Promise<Texture>", async () => {
      const app = createTestApp();
      await app.start();

      expectTypeOf(app.assets.load).toEqualTypeOf<(alias: string) => Promise<Texture>>();

      await app.stop();
    });

    it("app.assets.sprite returns Promise<Sprite>", async () => {
      const app = createTestApp();
      await app.start();

      expectTypeOf(app.assets.sprite).toEqualTypeOf<(alias: string) => Promise<Sprite>>();

      await app.stop();
    });

    it("app.assets.isLoaded returns boolean", async () => {
      const app = createTestApp();
      await app.start();

      expectTypeOf(app.assets.isLoaded).toEqualTypeOf<(alias: string) => boolean>();

      await app.stop();
    });

    it("assets:loaded payload is typed in consumer plugin", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin]
      });

      createPlugin("type-check", {
        depends: [assetsPlugin],
        hooks: _ctx => ({
          "assets:loaded": payload => {
            expectTypeOf(payload).toEqualTypeOf<{ alias: string; kind: "asset" | "bundle" }>();
          }
        })
      });
    });

    it("rejects wrong kind in assets:loaded payload", () => {
      const { createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin]
      });

      const plugin = createPlugin("wrong-payload", {
        depends: [assetsPlugin],
        api: ctx => ({
          test: () => {
            // @ts-expect-error -- "texture" is not a valid kind
            ctx.emit("assets:loaded", { alias: "ship", kind: "texture" });
          }
        })
      });

      expect(plugin.name).toBe("wrong-payload");
    });
  });
});
