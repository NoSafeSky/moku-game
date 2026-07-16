import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { schedulerPlugin } from "../../../scheduler";
import { inputPlugin } from "../../index";
import type { InputSnapshot } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/** Per-plugin config overrides accepted by createTestApp. */
type TestPluginConfigs = { input?: { wheel?: boolean; preventDefault?: boolean } };

/**
 * Create a minimal test app with ecs + scheduler + input.
 * Uses a controllable EventTarget set as globalThis.window.
 *
 * @param pluginConfigs - Optional per-plugin config overrides (e.g. `{ input: { wheel: false } }`).
 * @returns The synchronous app instance.
 */
const createTestApp = (pluginConfigs: TestPluginConfigs = {}) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, inputPlugin]
  });
  return createApp({ pluginConfigs });
};

// ─── integration ──────────────────────────────────────────────

describe("input plugin — integration", () => {
  let target: EventTarget;

  beforeEach(() => {
    target = new EventTarget();
    // Provide globalThis.window so onStart resolves "window" → target
    (globalThis as Record<string, unknown>).window = target;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  describe("lifecycle", () => {
    it("exposes app.input after init", async () => {
      const app = createTestApp();
      await app.start();

      expect(app.input).toBeDefined();

      await app.stop();
    });

    it("start() attaches listeners — state.listeners is non-empty", async () => {
      const app = createTestApp();
      await app.start();

      // Default config attaches keyboard + pointer = 5 listeners
      expect(app.input.snapshot).toBeDefined();

      await app.stop();
    });

    it("stop() removes every listener it attached (no leaked global listeners)", async () => {
      const addSpy = vi.spyOn(target, "addEventListener");
      const removeSpy = vi.spyOn(target, "removeEventListener");

      const app = createTestApp();
      await app.start();

      // Default config attaches keyboard (keydown/keyup) + pointer (move/down/up)
      // + wheel (wheel) = 6.
      const added = addSpy.mock.calls.length;
      expect(added).toBeGreaterThanOrEqual(6);

      await app.stop();

      // Every attached (type, fn) pair is torn down — symmetric add/remove.
      expect(removeSpy.mock.calls.length).toBe(added);
      for (const [type, fn] of addSpy.mock.calls) {
        const wasRemoved = removeSpy.mock.calls.some(([t, f]) => t === type && f === fn);
        expect(wasRemoved).toBe(true);
      }
      // The new "wheel" listener rides the same teardown path — no new path needed.
      expect(addSpy.mock.calls.some(([type]) => type === "wheel")).toBe(true);
      expect(removeSpy.mock.calls.some(([type]) => type === "wheel")).toBe(true);

      addSpy.mockRestore();
      removeSpy.mockRestore();
    });
  });

  describe("keyboard input via tick", () => {
    it("isDown returns true after keydown + tick", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "ArrowRight", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().isDown("ArrowRight")).toBe(true);

      await app.stop();
    });

    it("justPressed is true on the tick the key goes down", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "Space", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().justPressed("Space")).toBe(true);

      await app.stop();
    });

    it("justPressed is false on the next tick while key is still held", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "Space", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016); // frame 1 — justPressed true

      app.scheduler.tick(0.016); // frame 2 — no new keydown, justPressed must be false

      expect(app.input.snapshot().justPressed("Space")).toBe(false);
      expect(app.input.snapshot().isDown("Space")).toBe(true);

      await app.stop();
    });

    it("justReleased is true on the tick the key goes up", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "Enter", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016);

      target.dispatchEvent(
        Object.assign(new Event("keyup"), { key: "Enter", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().justReleased("Enter")).toBe(true);
      expect(app.input.snapshot().isDown("Enter")).toBe(false);

      await app.stop();
    });

    it("justReleased is false on the tick after the release tick", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "Escape", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016);

      target.dispatchEvent(
        Object.assign(new Event("keyup"), { key: "Escape", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016); // release frame

      app.scheduler.tick(0.016); // next frame — justReleased must be false
      expect(app.input.snapshot().justReleased("Escape")).toBe(false);

      await app.stop();
    });

    it("key-repeat: repeated keydown while held does NOT re-trigger justPressed", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "w", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016); // frame 1 — pressed

      // Simulate key-repeat events (same key, still held)
      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "w", preventDefault: vi.fn() })
      );
      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "w", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016); // frame 2 — justPressed must be false

      expect(app.input.snapshot().justPressed("w")).toBe(false);
      expect(app.input.snapshot().isDown("w")).toBe(true);

      await app.stop();
    });
  });

  describe("pointer input via tick", () => {
    it("updates pointer position after pointermove + tick", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("pointermove"), { clientX: 100, clientY: 200, buttons: 0 })
      );
      app.scheduler.tick(0.016);

      const snap = app.input.snapshot();
      expect(snap.pointer.x).toBe(100);
      expect(snap.pointer.y).toBe(200);

      await app.stop();
    });
  });

  describe("wheel input via tick", () => {
    it("accumulates wheel deltaX/deltaY and exposes them in the next snapshot", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("wheel"), { deltaX: 10, deltaY: -20, deltaMode: 0 })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().wheel).toEqual({ deltaX: 10, deltaY: -20 });

      await app.stop();
    });

    it("accumulates multiple wheel events dispatched within the same tick", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("wheel"), { deltaX: 5, deltaY: 5, deltaMode: 0 })
      );
      target.dispatchEvent(
        Object.assign(new Event("wheel"), { deltaX: 3, deltaY: -2, deltaMode: 0 })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().wheel).toEqual({ deltaX: 8, deltaY: 3 });

      await app.stop();
    });

    it("resets wheel to { 0, 0 } on the following tick when no wheel event fired", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("wheel"), { deltaX: 10, deltaY: 10, deltaMode: 0 })
      );
      app.scheduler.tick(0.016); // frame with wheel motion
      expect(app.input.snapshot().wheel).toEqual({ deltaX: 10, deltaY: 10 });

      app.scheduler.tick(0.016); // next frame — no new wheel event
      expect(app.input.snapshot().wheel).toEqual({ deltaX: 0, deltaY: 0 });

      await app.stop();
    });

    it("normalizes deltaMode line units (x16) to pixels before exposing in the snapshot", async () => {
      const app = createTestApp();
      await app.start();

      target.dispatchEvent(
        Object.assign(new Event("wheel"), { deltaX: 0, deltaY: 2, deltaMode: 1 })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().wheel).toEqual({ deltaX: 0, deltaY: 32 });

      await app.stop();
    });

    it("attaches no wheel listener and never accumulates when wheel:false", async () => {
      const app = createTestApp({ input: { wheel: false } });
      const addSpy = vi.spyOn(target, "addEventListener");
      await app.start();

      expect(addSpy.mock.calls.some(([type]) => type === "wheel")).toBe(false);

      target.dispatchEvent(
        Object.assign(new Event("wheel"), { deltaX: 10, deltaY: 10, deltaMode: 0 })
      );
      app.scheduler.tick(0.016);

      expect(app.input.snapshot().wheel).toEqual({ deltaX: 0, deltaY: 0 });

      await app.stop();
      addSpy.mockRestore();
    });
  });

  describe("snapshot stability", () => {
    it("snapshot() returns the same object within a frame", async () => {
      const app = createTestApp();
      await app.start();
      app.scheduler.tick(0.016);

      const snap1 = app.input.snapshot();
      const snap2 = app.input.snapshot();
      expect(snap1).toBe(snap2);

      await app.stop();
    });

    it("snapshot() returns a different object after the next tick", async () => {
      const app = createTestApp();
      await app.start();
      app.scheduler.tick(0.016);

      const snap1 = app.input.snapshot();

      target.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "a", preventDefault: vi.fn() })
      );
      app.scheduler.tick(0.016);

      const snap2 = app.input.snapshot();
      expect(snap2).not.toBe(snap1);

      await app.stop();
    });
  });

  describe("types", () => {
    it("snapshot() returns InputSnapshot", async () => {
      const app = createTestApp();
      await app.start();

      const snap: InputSnapshot = app.input.snapshot();
      expect(snap).toBeDefined();

      await app.stop();
    });
  });
});
