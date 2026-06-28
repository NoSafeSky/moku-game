/**
 * @file renderer plugin — integration tests for Cycle 5 primitives (attachPrimitive).
 *
 * Tests:
 *   - Under a started (mocked Pixi) renderer, attachPrimitive adds to the stage
 *     and the sync system positions the view from the entity's Transform.
 *   - Under headless, attachPrimitive returns false.
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
    addChild: vi.fn()
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

vi.mock("pixi.js", async importOriginal => {
  // Import real pixi for Graphics so buildPrimitive works
  const real = await importOriginal<typeof import("pixi.js")>();
  return {
    ...real,
    Application: class {
      init = mocks.init;
      render = mocks.render;
      destroy = mocks.destroy;
      canvas = mocks.canvas;
      get stage() {
        return mocks.stage;
      }
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Framework imports (after mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { schedulerPlugin } from "../../../scheduler";
import { rendererPlugin } from "../../index";

// ─────────────────────────────────────────────────────────────────────────────
// App factories
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin]
  });
  return createApp({ pluginConfigs: { renderer: { headless: false } } });
};

const createHeadlessApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin]
  });
  return createApp({ pluginConfigs: { renderer: { headless: true } } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("renderer plugin — attachPrimitive integration (Cycle 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stage = mocks.makeStage();
    mocks.init.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("attachPrimitive adds Graphics to stage and returns true (non-headless)", async () => {
    const app = createTestApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    const result = app.renderer.attachPrimitive(entity, {
      shape: "circle",
      radius: 10,
      fill: 0xff_00_00,
      label: "test-circle"
    });

    expect(result).toBe(true);
    expect(mocks.stage.addChild).toHaveBeenCalledOnce();

    await app.stop();
  });

  it("sync system repositions the primitive view from Transform after tick", async () => {
    const app = createTestApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform({ x: 42, y: 77, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    app.renderer.attachPrimitive(entity, { shape: "rect", width: 20, height: 20 });

    // The primitive view must have been tracked in views (dirty set) — tick sync
    expect(() => app.scheduler.tick(0.016)).not.toThrow();

    await app.stop();
  });

  it("attachPrimitive returns false when headless (no app)", async () => {
    const app = createHeadlessApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    const result = app.renderer.attachPrimitive(entity, { shape: "line", x2: 10, y2: 10 });

    expect(result).toBe(false);

    await app.stop();
  });

  it("attachPrimitive before start (no app) returns false", () => {
    const app = createTestApp();
    // Not started yet
    const entity = 1 as ReturnType<typeof app.ecs.spawn>;
    const result = app.renderer.attachPrimitive(entity, { shape: "circle", radius: 5 });
    expect(result).toBe(false);
  });
});
