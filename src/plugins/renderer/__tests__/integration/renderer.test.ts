/**
 * @file renderer plugin — integration tests.
 *
 * Boots the full framework (ecs + scheduler + renderer) with vi.mock("pixi.js")
 * so no real GPU context is needed. Tests the full plugin lifecycle, API surface,
 * sync system behaviour, and onStart failure path.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock state — accessible inside vi.mock factory (hoisted to top)
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const makeStage = () => ({
    position: { set: vi.fn() },
    rotation: 0,
    scale: { set: vi.fn() },
    destroy: vi.fn()
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
    Container: class {
      position = { set: vi.fn() };
      rotation = 0;
      scale = { set: vi.fn() };
      destroy = vi.fn();
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Framework imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import type { Container } from "pixi.js";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import type { Entity } from "../../../ecs/types";
import { schedulerPlugin } from "../../../scheduler";
import { rendererPlugin } from "../../index";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin]
  });
  // Force headless:false so the mocked Pixi Application is exercised regardless
  // of whether the test environment has a DOM (Bun auto-detects headless:true).
  return createApp({ pluginConfigs: { renderer: { headless: false } } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Typed stub shape for a Pixi Container — mock-only fields. */
type MockContainer = {
  position: { set: ReturnType<typeof vi.fn> };
  rotation: number;
  scale: { set: ReturnType<typeof vi.fn> };
  destroy: ReturnType<typeof vi.fn>;
};

/**
 * Create a typed stub Container with vi.fn() spies on position.set, scale.set, and destroy.
 * Cast to Container once at the call site boundary so production code accepts it.
 */
const makeMockContainer = (): MockContainer & Container =>
  ({
    position: { set: vi.fn() },
    rotation: 0,
    scale: { set: vi.fn() },
    destroy: vi.fn()
  }) as unknown as MockContainer & Container;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("renderer plugin integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stage = mocks.makeStage();
    mocks.init.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("starts without error (headless, no mount)", async () => {
      const app = createTestApp();
      await expect(app.start()).resolves.toBeUndefined();
      await app.stop();
    });

    it("stop calls app.destroy with texture cleanup options", async () => {
      const app = createTestApp();
      await app.start();
      await app.stop();

      expect(mocks.destroy).toHaveBeenCalledWith(true, {
        children: true,
        texture: true,
        textureSource: true
      });
    });

    it("getView returns the canvas after start", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.renderer.getView()).toBe(mocks.canvas);

      await app.stop();
    });

    it("getView returns undefined before start", () => {
      const app = createTestApp();

      expect(app.renderer.getView()).toBeUndefined();
    });

    it("getStage returns the stage after start", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.renderer.getStage()).toBe(mocks.stage);

      await app.stop();
    });

    it("getStage returns undefined before start", () => {
      const app = createTestApp();

      expect(app.renderer.getStage()).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // onStart failure path
  // ──────────────────────────────────────────────────────────────────────────

  describe("onStart failure path", () => {
    it("calls app.destroy and rethrows when init rejects", async () => {
      const initError = new Error("GPU unavailable");
      mocks.init.mockRejectedValueOnce(initError);

      const app = createTestApp();
      await expect(app.start()).rejects.toThrow("GPU unavailable");

      expect(mocks.destroy).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // API surface
  // ──────────────────────────────────────────────────────────────────────────

  describe("API: attach / detach / markDirty / render", () => {
    it("attach records the view and the sync system processes it", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      const container = makeMockContainer();
      app.renderer.attach(entity, container);

      // Tick the sync stage — repositioning should occur (no throw)
      expect(() => app.scheduler.tick(0.016)).not.toThrow();

      await app.stop();
    });

    it("detach disposes the view and removes it from state", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      const container = makeMockContainer();
      app.renderer.attach(entity, container);
      app.renderer.detach(entity);

      expect(container.destroy).toHaveBeenCalled();

      await app.stop();
    });

    it("render calls app.render after start", async () => {
      const app = createTestApp();
      await app.start();

      app.renderer.render();

      expect(mocks.render).toHaveBeenCalled();

      await app.stop();
    });

    it("render is a no-op before start", () => {
      const app = createTestApp();
      expect(() => app.renderer.render()).not.toThrow();
      expect(mocks.render).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Sync system: reposition on tick
  // ──────────────────────────────────────────────────────────────────────────

  describe("sync system", () => {
    it("repositions container from Transform on tick", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 10, y: 20, rotation: 0.5, scaleX: 2, scaleY: 3 })
      );
      const container = makeMockContainer();
      app.renderer.attach(entity, container);

      app.scheduler.tick(0.016);

      expect(container.position.set).toHaveBeenCalledWith(10, 20);
      expect(container.scale.set).toHaveBeenCalledWith(2, 3);

      await app.stop();
    });

    it("repositions container after markDirty + tick", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      const container = makeMockContainer();
      app.renderer.attach(entity, container);

      // First tick clears dirty
      app.scheduler.tick(0.016);

      // Move entity and mark dirty
      app.ecs.set(entity, app.renderer.Transform, { x: 50, y: 60 });
      app.renderer.markDirty(entity);
      app.scheduler.tick(0.016);

      const lastCall = container.position.set.mock.calls.at(-1) as [number, number];
      expect(lastCall[0]).toBe(50);
      expect(lastCall[1]).toBe(60);

      await app.stop();
    });

    it("despawn reconciliation removes dead entity views on tick", async () => {
      const app = createTestApp();
      await app.start();

      const entity = app.ecs.spawn(
        app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
      );
      const container = makeMockContainer();
      app.renderer.attach(entity, container);

      // Despawn the entity
      app.ecs.despawn(entity);

      // Tick — reconciliation should detect the dead entity and dispose the view
      app.scheduler.tick(0.016);

      expect(container.destroy).toHaveBeenCalled();

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WeakMap teardown: entry removed after stop
  // ──────────────────────────────────────────────────────────────────────────

  describe("WeakMap teardown", () => {
    it("stop removes the WeakMap entry (subsequent stop is safe)", async () => {
      const app = createTestApp();
      await app.start();
      await app.stop();

      // A second stop should not throw (WeakMap entry is gone)
      await expect(app.stop()).resolves.toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Type-level
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("app.renderer.Transform is callable with TransformValue", () => {
      const app = createTestApp();

      // Type-query form (no runtime getter call — Transform throws before start).
      expectTypeOf<typeof app.renderer.Transform>().toMatchTypeOf<{
        readonly __id: number;
        (value: {
          x: number;
          y: number;
          rotation: number;
          scaleX: number;
          scaleY: number;
        }): unknown;
      }>();
    });

    it("app.renderer.getView returns HTMLCanvasElement | undefined", () => {
      const app = createTestApp();

      expectTypeOf(app.renderer.getView).toEqualTypeOf<() => HTMLCanvasElement | undefined>();
    });

    it("app.renderer.attach requires Entity and Container", () => {
      const app = createTestApp();

      expectTypeOf(app.renderer.attach).toMatchTypeOf<(entity: Entity, view: Container) => void>();
    });
  });
});
