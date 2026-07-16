/**
 * @file renderer plugin — integration tests for Phase-1 (Wave F1) additions.
 *
 * Boots the full framework (ecs + scheduler + renderer) with a mocked "pixi.js"
 * so no real GPU context is needed. Covers:
 *   - Injecting a world-transform resolver + a texture resolver, attachSprite-ing
 *     an entity, ticking sync, and confirming the wrapper is positioned from the
 *     WORLD-space value (not the entity's local Transform).
 *   - setGridVisible(true) adds the overlay beneath entity views (stage index 0).
 *   - stop() tears down cleanly with the grid installed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock state
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const makeStage = () => ({
    position: { set: vi.fn() },
    rotation: 0,
    scale: { set: vi.fn() },
    destroy: vi.fn(),
    children: [] as unknown[],
    addChild: vi.fn(),
    addChildAt: vi.fn()
  });

  const state = {
    destroy: vi.fn(),
    render: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    canvas: {} as HTMLCanvasElement,
    stage: makeStage(),
    makeStage
  };

  return state;
});

vi.mock("pixi.js", () => {
  class Graphics {
    rect = vi.fn();
    fill = vi.fn();
    stroke = vi.fn();
    scale = { set: vi.fn(), x: 1, y: 1 };
    position = { set: vi.fn() };
    rotation = 0;
    tint = 0xff_ff_ff;
    visible = true;
    destroy = vi.fn();
    /** Chainable no-op (real Pixi drawing methods return `this`). */
    clear(): this {
      return this;
    }
    /** Chainable no-op (real Pixi drawing methods return `this`). */
    moveTo(): this {
      return this;
    }
    /** Chainable no-op (real Pixi drawing methods return `this`). */
    lineTo(): this {
      return this;
    }
  }
  class Sprite {
    texture: unknown;
    anchor = { set: vi.fn() };
    scale = { set: vi.fn(), x: 1, y: 1 };
    position = { set: vi.fn() };
    rotation = 0;
    tint: number | string = 0xff_ff_ff;
    width = 0;
    height = 0;
    visible = true;
    destroy = vi.fn();
    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
  class Container {
    children: unknown[] = [];
    scale = { set: vi.fn(), x: 1, y: 1 };
    position = { set: vi.fn() };
    rotation = 0;
    visible = true;
    destroy = vi.fn();
    /** Records the child and returns it, matching Pixi's real addChild contract. */
    addChild(child: unknown): unknown {
      this.children.push(child);
      return child;
    }
  }
  return {
    Application: class {
      init = mocks.init;
      render = mocks.render;
      destroy = mocks.destroy;
      canvas = mocks.canvas;
      get stage() {
        return mocks.stage;
      }
    },
    Container,
    Graphics,
    Sprite
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Framework imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { Graphics, Sprite } from "pixi.js";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { schedulerPlugin } from "../../../scheduler";
import { rendererPlugin } from "../../index";
import type { TextureHandle, TransformValue } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin]
  });
  return createApp({ pluginConfigs: { renderer: { headless: false } } });
};

const makeHandle = (): TextureHandle => ({}) as TextureHandle;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("renderer plugin — Phase-1 (Wave F1) integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stage = mocks.makeStage();
    mocks.init.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // attachSprite + world-resolver sync
  // ──────────────────────────────────────────────────────────────────────────

  describe("attachSprite + world-transform resolver", () => {
    it("positions the wrapper from the injected world resolver on sync tick", async () => {
      const app = createTestApp();
      await app.start();

      // Local Transform deliberately differs from the world-space value the
      // resolver supplies, to prove the sync sources from the resolver.
      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 1, y: 1, rotation: 0, scaleX: 1, scaleY: 1 })
      );

      const worldValue: TransformValue = { x: 300, y: 400, rotation: 0.25, scaleX: 2, scaleY: 2 };
      app.renderer.setWorldTransformResolver(e => (e === entity ? worldValue : undefined));
      app.renderer.setTextureResolver(() => makeHandle());

      const ok = app.renderer.attachSprite(entity, { alias: "player" });
      expect(ok).toBe(true);

      app.scheduler.tick(0.016);

      const wrapper = app.renderer.getEntityView(entity);
      expect(wrapper?.position.set).toHaveBeenCalledWith(300, 400);
      expect(wrapper?.position.set).not.toHaveBeenCalledWith(1, 1);

      await app.stop();
    });

    it("attaches a placeholder Graphics child when no texture resolver is installed", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );

      app.renderer.attachSprite(entity, { alias: "unresolved" });

      const wrapper = app.renderer.getEntityView(entity);
      const child = (wrapper as unknown as { children: unknown[] }).children[0];
      expect(child).toBeInstanceOf(Graphics);

      await app.stop();
    });

    it("attaches a Sprite child when the texture resolver resolves the alias", async () => {
      const app = createTestApp();
      await app.start();

      app.renderer.setTextureResolver(() => makeHandle());
      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );

      app.renderer.attachSprite(entity, { alias: "player" });

      const wrapper = app.renderer.getEntityView(entity);
      const child = (wrapper as unknown as { children: unknown[] }).children[0];
      expect(child).toBeInstanceOf(Sprite);

      await app.stop();
    });

    it("attachSprite returns false before start (no app)", () => {
      const app = createTestApp();
      const entity = 1 as ReturnType<typeof app.ecs.spawn>;

      expect(app.renderer.attachSprite(entity, { alias: "player" })).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // setEntityVisible
  // ──────────────────────────────────────────────────────────────────────────

  describe("setEntityVisible", () => {
    it("toggles the attached view's visible flag", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      app.renderer.attachPrimitive(entity, { shape: "rect", width: 5, height: 5 });

      app.renderer.setEntityVisible(entity, false);

      const view = app.renderer.getEntityView(entity);
      expect((view as unknown as { visible: boolean }).visible).toBe(false);

      await app.stop();
    });

    it("is a safe no-op for an entity with no view", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn();
      expect(() => app.renderer.setEntityVisible(entity, true)).not.toThrow();

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // setGridVisible
  // ──────────────────────────────────────────────────────────────────────────

  describe("setGridVisible", () => {
    it("adds the overlay beneath entity views (stage index 0) and toggles it", async () => {
      const app = createTestApp();
      await app.start();

      app.renderer.setGridVisible(true);

      expect(mocks.stage.addChildAt).toHaveBeenCalledWith(expect.anything(), 0);

      app.renderer.setGridVisible(false);

      await app.stop();
    });

    it("is headless-tolerant (no throw) before start", () => {
      const app = createTestApp();
      expect(() => app.renderer.setGridVisible(true)).not.toThrow();
    });

    it("stop() tears down cleanly with the grid installed", async () => {
      const app = createTestApp();
      await app.start();

      app.renderer.setGridVisible(true);

      await expect(app.stop()).resolves.toBeUndefined();
      expect(mocks.destroy).toHaveBeenCalledWith(true, {
        children: true,
        texture: true,
        textureSource: true
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // setTextureResolver / setWorldTransformResolver clearing
  // ──────────────────────────────────────────────────────────────────────────

  describe("resolver seams — clear back to undefined", () => {
    it("clearing the world resolver restores local-Transform positioning", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 9, y: 9, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      app.renderer.attachPrimitive(entity, { shape: "rect", width: 5, height: 5 });

      app.renderer.setWorldTransformResolver(() => ({
        x: 999,
        y: 999,
        rotation: 0,
        scaleX: 1,
        scaleY: 1
      }));
      app.renderer.setWorldTransformResolver(undefined);
      app.renderer.markDirty(entity);
      app.scheduler.tick(0.016);

      const view = app.renderer.getEntityView(entity);
      expect(view?.position.set).toHaveBeenCalledWith(9, 9);

      await app.stop();
    });
  });
});
