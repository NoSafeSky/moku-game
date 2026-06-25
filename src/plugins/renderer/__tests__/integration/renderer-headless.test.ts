/**
 * @file renderer plugin — integration test for headless mode (Cycle 3 delta).
 *
 * Regression test for GitHub issue #1 Problem 3:
 *   createApp().start() under Bun/no-DOM used to throw
 *   "this._cancelResize is not a function" because onStart unconditionally
 *   created a Pixi Application. With headless:true, the renderer is inert.
 *
 * Tests:
 *   - Full createApp() with ecs+scheduler+renderer under headless:true succeeds.
 *   - attach → tick sync → no throw → stop tears down cleanly.
 *   - The existing non-headless path (mocked Pixi) is unchanged (see renderer.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock state — track Application constructor calls
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const ApplicationConstructor = vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    render: vi.fn(),
    destroy: vi.fn(),
    canvas: {} as HTMLCanvasElement,
    stage: {
      position: { set: vi.fn() },
      rotation: 0,
      scale: { set: vi.fn() },
      destroy: vi.fn()
    }
  }));

  return { ApplicationConstructor };
});

vi.mock("pixi.js", () => ({
  Application: mocks.ApplicationConstructor,
  Container: vi.fn().mockImplementation(() => ({
    position: { set: vi.fn() },
    rotation: 0,
    scale: { set: vi.fn() },
    destroy: vi.fn()
  }))
}));

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
// Test app factory (forced headless)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a headless test app by overriding the renderer's headless config.
 *
 * @returns An app instance with renderer forced into headless mode.
 */
const createHeadlessTestApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin]
  });
  return createApp({ pluginConfigs: { renderer: { headless: true } } });
};

/**
 * Typed stub Container for tests.
 */
type MockContainer = {
  position: { set: ReturnType<typeof vi.fn> };
  rotation: number;
  scale: { set: ReturnType<typeof vi.fn> };
  destroy: ReturnType<typeof vi.fn>;
};

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

describe("renderer plugin — headless integration (Problem 3 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).document;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as Record<string, unknown>).document;
  });

  it("start() succeeds with no Pixi Application created (Problem 3 fix)", async () => {
    const app = createHeadlessTestApp();

    await expect(app.start()).resolves.toBeUndefined();

    expect(mocks.ApplicationConstructor).not.toHaveBeenCalled();

    await app.stop();
  });

  it("attach a stub container then tick sync — no throw", async () => {
    const app = createHeadlessTestApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    ) as Entity;
    const container = makeMockContainer();
    app.renderer.attach(entity, container);

    // Tick the sync stage — should not throw even without a Pixi app
    expect(() => app.scheduler.tick(0.016)).not.toThrow();

    await app.stop();
  });

  it("stop() tears down cleanly after headless start", async () => {
    const app = createHeadlessTestApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    ) as Entity;
    const container = makeMockContainer();
    app.renderer.attach(entity, container);

    await expect(app.stop()).resolves.toBeUndefined();
  });

  it("stop() is idempotent (double stop does not throw)", async () => {
    const app = createHeadlessTestApp();
    await app.start();
    await app.stop();

    await expect(app.stop()).resolves.toBeUndefined();
  });

  it("getView() returns undefined under headless", async () => {
    const app = createHeadlessTestApp();
    await app.start();

    expect(app.renderer.getView()).toBeUndefined();

    await app.stop();
  });

  it("getStage() returns undefined under headless", async () => {
    const app = createHeadlessTestApp();
    await app.start();

    expect(app.renderer.getStage()).toBeUndefined();

    await app.stop();
  });

  it("render() does not throw under headless", async () => {
    const app = createHeadlessTestApp();
    await app.start();

    expect(() => app.renderer.render()).not.toThrow();

    await app.stop();
  });

  it("app.renderer.Transform is accessible after headless start", async () => {
    const app = createHeadlessTestApp();
    await app.start();

    // Transform token must be defined so scene/ECS code works headless
    expect(app.renderer.Transform).toBeDefined();
    expect(typeof app.renderer.Transform.__id).toBe("number");

    await app.stop();
  });
});
