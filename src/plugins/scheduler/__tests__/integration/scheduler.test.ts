import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { schedulerPlugin } from "../../index";
import type { Stage, System, World } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/** Per-plugin config overrides accepted by createTestApp. */
type TestPluginConfigs = { scheduler?: { strictStages?: boolean } };

/**
 * Create a minimal test app with only ecs + scheduler. Avoids depending on
 * other framework plugins (renderer, input, loop, …) that may be stubs.
 *
 * @param pluginConfigs - Optional per-plugin config overrides.
 * @returns The synchronous app instance.
 */
const createTestApp = (pluginConfigs: TestPluginConfigs = {}) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin]
  });
  return createApp({ pluginConfigs });
};

// ─── integration: lifecycle ────────────────────────────────────

describe("scheduler plugin — integration", () => {
  describe("lifecycle", () => {
    it("initialises and exposes app.scheduler", () => {
      const app = createTestApp();

      expect(app.scheduler).toBeDefined();
    });

    it("exposes the canonical stage tuple on app.scheduler.stages", () => {
      const app = createTestApp();

      expect(app.scheduler.stages).toStrictEqual(["input", "update", "physics", "sync", "render"]);
    });
  });

  // ─── addSystem + tick: stage execution order ────────────────

  describe("addSystem / tick — stage execution order", () => {
    it("runs systems registered to different stages in input→update→physics→sync→render order", () => {
      const app = createTestApp();
      const order: string[] = [];

      app.scheduler.addSystem("render", () => {
        order.push("render");
      });
      app.scheduler.addSystem("input", () => {
        order.push("input");
      });
      app.scheduler.addSystem("physics", () => {
        order.push("physics");
      });
      app.scheduler.addSystem("update", () => {
        order.push("update");
      });
      app.scheduler.addSystem("sync", () => {
        order.push("sync");
      });

      app.scheduler.tick(0.016);

      expect(order).toStrictEqual(["input", "update", "physics", "sync", "render"]);
    });

    it("passes the correct dt to each system", () => {
      const app = createTestApp();
      const receivedDts: number[] = [];

      app.scheduler.addSystem("update", (_world, dt) => {
        receivedDts.push(dt);
      });

      app.scheduler.tick(0.032);

      expect(receivedDts).toStrictEqual([0.032]);
    });

    it("systems receive a World instance as first argument", () => {
      const app = createTestApp();
      const worlds: World[] = [];

      app.scheduler.addSystem("update", world => {
        worlds.push(world);
      });

      app.scheduler.tick(0.016);

      expect(worlds).toHaveLength(1);
      expect(worlds[0]).toBeDefined();
      expect(typeof worlds[0]?.addSystem).toBe("function");
    });

    it("unsubscribe returned by addSystem stops the system from running", () => {
      const app = createTestApp();
      const calls: number[] = [];

      const unsub = app.scheduler.addSystem("update", () => {
        calls.push(1);
      });

      app.scheduler.tick(0.016);
      expect(calls).toHaveLength(1);

      unsub();
      app.scheduler.tick(0.016);
      expect(calls).toHaveLength(1); // still 1 — system removed
    });

    it("multiple systems in the same stage run in registration order", () => {
      const app = createTestApp();
      const order: string[] = [];

      app.scheduler.addSystem("update", () => {
        order.push("first");
      });
      app.scheduler.addSystem("update", () => {
        order.push("second");
      });

      app.scheduler.tick(0.016);

      expect(order).toStrictEqual(["first", "second"]);
    });
  });

  // ─── strictStages config ────────────────────────────────────

  describe("strictStages config", () => {
    it("throws when adding a system for an unknown stage with strictStages:true (default)", () => {
      const app = createTestApp();

      expect(() => {
        // @ts-expect-error -- "bogus" is not a valid Stage
        app.scheduler.addSystem("bogus", vi.fn());
      }).toThrow("[scheduler] Unknown stage");
    });

    it("does not throw when strictStages:false and stage is unknown", () => {
      const app = createTestApp({ scheduler: { strictStages: false } });

      expect(() => {
        // @ts-expect-error -- "bogus" is not a valid Stage
        app.scheduler.addSystem("bogus", () => {});
      }).not.toThrow();
    });

    it("tick after unknown-stage no-op with strictStages:false still runs known systems", () => {
      const app = createTestApp({ scheduler: { strictStages: false } });
      const calls: string[] = [];

      // @ts-expect-error -- "bogus" is not a valid Stage
      app.scheduler.addSystem("bogus", () => {
        calls.push("bogus");
      });
      app.scheduler.addSystem("update", () => {
        calls.push("update");
      });

      app.scheduler.tick(0.016);

      expect(calls).toStrictEqual(["update"]); // bogus was ignored
    });
  });

  // ─── types ──────────────────────────────────────────────────

  describe("types: API signatures", () => {
    it("app.scheduler.stages is readonly Stage[]", () => {
      const app = createTestApp();

      expectTypeOf(app.scheduler.stages).toEqualTypeOf<readonly Stage[]>();
    });

    it("app.scheduler.addSystem accepts a Stage and System", () => {
      const app = createTestApp();

      expectTypeOf(app.scheduler.addSystem).toEqualTypeOf<
        (stage: Stage, system: System) => () => void
      >();
    });

    it("app.scheduler.tick accepts a number", () => {
      const app = createTestApp();

      expectTypeOf(app.scheduler.tick).toEqualTypeOf<(dt: number) => void>();
    });

    it("rejects an invalid stage literal at the type level", () => {
      const app = createTestApp();

      // Runtime: throws because strictStages:true is the default.
      // Type level: @ts-expect-error confirms "bogus" is not assignable to Stage.
      expect(() => {
        // @ts-expect-error -- "bogus" is not assignable to Stage
        app.scheduler.addSystem("bogus", () => {});
      }).toThrow();
    });

    it("system parameter is typed (world: World, dt: number) => void", () => {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- type-level fixture, intentionally local to this test
      const system: System = (_world: World, _dt: number) => {
        /* type-level fixture */
      };
      expectTypeOf(system).toEqualTypeOf<(world: World, dt: number) => void>();
    });
  });
});
