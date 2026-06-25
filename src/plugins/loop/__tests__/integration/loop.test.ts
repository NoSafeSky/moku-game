/**
 * @file loop plugin — integration tests.
 *
 * Boots the full framework (ecs + scheduler + renderer + loop) with vi.mock("pixi.js")
 * and a fake rAF queue. Tests autoStart, manual start/stop, step(), multi-instance
 * WeakMap isolation, and scheduler.tick forwarding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted Pixi mock (mirrors renderer integration test exactly)
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

import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { loopPlugin } from "../../index";
import { Time } from "../../resources";

// ─────────────────────────────────────────────────────────────────────────────
// Fake rAF queue
// ─────────────────────────────────────────────────────────────────────────────

type FakeRafGlobal = {
  requestAnimationFrame: (cb: (t: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
  document: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
};

let rafCallbacks: Array<{ id: number; cb: (t: number) => void }> = [];
let rafIdCounter = 0;

const fakeRaf = (cb: (t: number) => void): number => {
  const id = ++rafIdCounter;
  rafCallbacks.push({ id, cb });
  return id;
};

const fakeCaf = (id: number): void => {
  rafCallbacks = rafCallbacks.filter(entry => entry.id !== id);
};

/** Flush one pending rAF callback with the given timestamp. */
const flushRaf = (timestampMs: number): void => {
  const entry = rafCallbacks.shift();
  if (entry) entry.cb(timestampMs);
};

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory — autoStart:false by default for deterministic control
// ─────────────────────────────────────────────────────────────────────────────

const createTestApp = (loopConfigOverrides?: { autoStart?: boolean }) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, loopPlugin]
  });
  return createApp({
    pluginConfigs: {
      // headless:false → exercise the (mocked) Pixi render path; the node test
      // runtime has no DOM, so the renderer would otherwise auto-detect headless.
      renderer: { headless: false },
      loop: { autoStart: loopConfigOverrides?.autoStart ?? false }
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  rafCallbacks = [];
  rafIdCounter = 0;
  vi.clearAllMocks();
  mocks.stage = mocks.makeStage();
  mocks.init.mockResolvedValue(undefined);

  const fakeGlobal = globalThis as unknown as FakeRafGlobal;
  fakeGlobal.requestAnimationFrame = fakeRaf;
  fakeGlobal.cancelAnimationFrame = fakeCaf;
  fakeGlobal.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
});

afterEach(() => {
  const fakeGlobal = globalThis as unknown as FakeRafGlobal;
  delete (fakeGlobal as Record<string, unknown>).requestAnimationFrame;
  delete (fakeGlobal as Record<string, unknown>).cancelAnimationFrame;
  delete (fakeGlobal as Record<string, unknown>).document;
  rafCallbacks = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("loop plugin integration", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle: start / stop
  // ──────────────────────────────────────────────────────────────────────────

  describe("lifecycle", () => {
    it("starts without error (headless, autoStart:false)", async () => {
      const app = createTestApp({ autoStart: false });
      await expect(app.start()).resolves.toBeUndefined();
      await app.stop();
    });

    it("loop is not running after start() when autoStart:false", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      expect(app.loop.isRunning()).toBe(false);

      await app.stop();
    });

    it("loop is running after autoStart:true", async () => {
      const app = createTestApp({ autoStart: true });
      await app.start();

      expect(app.loop.isRunning()).toBe(true);

      await app.stop();
    });

    it("app.stop() cancels the running rAF loop", async () => {
      const app = createTestApp({ autoStart: true });
      await app.start();

      expect(rafCallbacks.length).toBeGreaterThan(0);

      await app.stop();

      // After stop, no pending rAF callbacks
      expect(rafCallbacks.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Manual start / stop
  // ──────────────────────────────────────────────────────────────────────────

  describe("manual start/stop", () => {
    it("app.loop.start() begins ticking; flushing a frame calls scheduler and renderer", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      app.loop.start();
      expect(app.loop.isRunning()).toBe(true);
      expect(rafCallbacks.length).toBe(1);

      // Seed lastTime
      flushRaf(0);
      // Advance one fixedDt worth (1/60 = ~16.67ms)
      flushRaf(1000 / 60);

      // scheduler.tick should have been called once by the loop
      // (renderer.render is called on the pixi mock)
      expect(mocks.render).toHaveBeenCalledTimes(1);

      await app.stop();
    });

    it("app.loop.stop() halts further ticks after a flush", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      app.loop.start();
      flushRaf(0);

      app.loop.stop();
      expect(app.loop.isRunning()).toBe(false);
      expect(rafCallbacks.length).toBe(0);

      // No more ticks
      const renderCallsBefore = mocks.render.mock.calls.length;
      flushRaf(1000); // nothing pending — no-op
      expect(mocks.render.mock.calls.length).toBe(renderCallsBefore);

      await app.stop();
    });

    it("start → stop → start re-schedules the loop correctly", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      app.loop.start();
      app.loop.stop();
      app.loop.start();

      expect(app.loop.isRunning()).toBe(true);
      expect(rafCallbacks.length).toBe(1);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // step()
  // ──────────────────────────────────────────────────────────────────────────

  describe("step()", () => {
    it("step() advances one tick and one render", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      app.loop.step();

      expect(mocks.render).toHaveBeenCalledTimes(1);

      await app.stop();
    });

    it("step() works without the loop running", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      expect(app.loop.isRunning()).toBe(false);
      expect(() => app.loop.step()).not.toThrow();

      await app.stop();
    });

    it("scheduler.tick is called once per step() with fixedDt", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      // Add a system that records tick calls
      const tickCount = { value: 0 };
      app.scheduler.addSystem("update", () => {
        tickCount.value += 1;
      });

      app.loop.step();

      expect(tickCount.value).toBe(1);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // WeakMap isolation: two independent app instances
  // ──────────────────────────────────────────────────────────────────────────

  describe("multi-instance isolation", () => {
    it("stopping app1 does not affect app2 loop", async () => {
      const app1 = createTestApp({ autoStart: false });
      const app2 = createTestApp({ autoStart: false });

      await app1.start();
      await app2.start();

      app1.loop.start();
      app2.loop.start();

      expect(app1.loop.isRunning()).toBe(true);
      expect(app2.loop.isRunning()).toBe(true);

      await app1.stop();

      // app2 should still be running (separate ctx.global → separate WeakMap entry)
      expect(app2.loop.isRunning()).toBe(true);

      await app2.stop();
    });

    it("two instances have independent rAF queues", async () => {
      const app1 = createTestApp({ autoStart: false });
      const app2 = createTestApp({ autoStart: false });

      await app1.start();
      await app2.start();

      app1.loop.start();
      app2.loop.start();

      // Each should have queued its own rAF
      expect(rafCallbacks.length).toBe(2);

      await app1.stop();
      await app2.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // idempotent stop
  // ──────────────────────────────────────────────────────────────────────────

  describe("idempotent teardown", () => {
    it("app.stop() twice is safe (no throw, no zombie rAF)", async () => {
      const app = createTestApp({ autoStart: true });
      await app.start();
      await app.stop();

      await expect(app.stop()).resolves.toBeUndefined();
      expect(rafCallbacks.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Time resource
  // ──────────────────────────────────────────────────────────────────────────

  describe("Time resource", () => {
    it("app.loop.time resolves via world.resource(Time) after step()", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      // Before any step: dt=0, elapsed=0, frame=0
      const timeBeforeStep = app.ecs.resource(app.loop.time);
      expect(timeBeforeStep.dt).toBe(0);
      expect(timeBeforeStep.elapsed).toBe(0);
      expect(timeBeforeStep.frame).toBe(0);

      app.loop.step();

      const timeAfterStep = app.ecs.resource(app.loop.time);
      expect(timeAfterStep.dt).toBeGreaterThan(0);
      expect(timeAfterStep.elapsed).toBeGreaterThan(0);
      expect(timeAfterStep.frame).toBe(1);

      await app.stop();
    });

    it("Time advances on each step() call", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      app.loop.step();
      app.loop.step();
      app.loop.step();

      const time = app.ecs.resource(app.loop.time);
      expect(time.frame).toBe(3);

      await app.stop();
    });

    it("world.resource(Time) is the same object reference after multiple step() calls (no realloc)", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      const ref1 = app.ecs.resource(app.loop.time);
      app.loop.step();
      const ref2 = app.ecs.resource(app.loop.time);

      expect(ref1).toBe(ref2);

      await app.stop();
    });

    it("a registered system reads the same Time values as world.resource(Time)", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      const capturedFrames: number[] = [];

      app.scheduler.addSystem("update", () => {
        const time = app.ecs.resource(Time);
        capturedFrames.push(time.frame);
      });

      app.loop.step();
      app.loop.step();

      // System ran twice; first step saw frame=1, second saw frame=2
      expect(capturedFrames).toEqual([1, 2]);

      await app.stop();
    });

    it("app.loop.time token equals the Time well-known resource", async () => {
      const app = createTestApp({ autoStart: false });
      await app.start();

      expect(app.loop.time).toBe(Time);

      await app.stop();
    });
  });
});
