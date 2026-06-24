/**
 * @file Cross-plugin integration — loop → scheduler → ecs.
 *
 * Boots the REAL framework (ecs + scheduler + renderer + loop) with PixiJS mocked
 * (no GPU) and a headless DOM EventTarget. Exercises the deterministic
 * fixed-timestep step path: `app.loop.step()` drives `scheduler.tick(fixedDt)`,
 * which drives `world.tick(dt)` over the canonical ordered stages and flushes the
 * deferred command buffer between stages.
 *
 * The loop never auto-drives frames in node (rAF is absent), so every scenario
 * advances the simulation with `app.loop.step()` (one fixed tick + render) or a
 * direct `app.scheduler.tick(dt)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Headless DOM EventTarget for the input plugin (node has no real window).
// Assign BEFORE any plugin import so input's resolveTarget() picks it up.
const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
Object.assign(globalThis, { window: mockEventTarget });

// Mock PixiJS — no GPU context in tests. Application/Container/Sprite are CLASSES; Assets is an object.
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

// Mock the MCP stdio transport so onStart does not attach to real process.stdin.
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    async start() {
      /* no-op */
    }
    async close() {
      /* no-op */
    }
    async send() {
      /* no-op */
    }
  }
}));

// ── Framework imports AFTER the mocks ──
import { coreConfig } from "../../src/config";
import { ecsPlugin } from "../../src/plugins/ecs";
import type { Stage } from "../../src/plugins/ecs/types";
import { loopPlugin } from "../../src/plugins/loop";
import { rendererPlugin } from "../../src/plugins/renderer";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory — subset app (loop needs scheduler+renderer; renderer needs
// ecs+scheduler). autoStart:false so step() is the only thing that advances.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a focused subset app: ecs + scheduler + renderer + loop, with the loop
 * configured not to auto-drive frames so each scenario advances deterministically
 * via `app.loop.step()`.
 *
 * @returns A freshly created (not yet started) App instance.
 * @example
 * ```ts
 * const app = createLoopApp();
 * await app.start();
 * app.loop.step();
 * ```
 */
const createLoopApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, loopPlugin]
  });
  return createApp({ pluginConfigs: { loop: { autoStart: false } } });
};

beforeEach(() => {
  vi.clearAllMocks();
  pixiMocks.appState.init.mockResolvedValue(undefined);
  pixiMocks.assetsState.loadBundle.mockResolvedValue({});
  pixiMocks.assetsState.get.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("cross-plugin: loop → scheduler → ecs", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. loop.step() drives a registered system exactly once.
  // ──────────────────────────────────────────────────────────────────────────

  it("loop.step() drives a registered scheduler system exactly once", async () => {
    const app = createLoopApp();
    await app.start();

    let runs = 0;
    app.scheduler.addSystem("update", () => {
      runs += 1;
    });

    app.loop.step();

    expect(runs).toBe(1);
    // step() also renders exactly once per fixed step.
    expect(pixiMocks.appState.render).toHaveBeenCalledTimes(1);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Component mutation accumulates over K steps.
  // ──────────────────────────────────────────────────────────────────────────

  it("component mutation accumulates: after K loop.step() calls n === K", async () => {
    const app = createLoopApp();
    await app.start();

    const Counter = app.ecs.defineComponent(() => ({ n: 0 }));
    const entity = app.ecs.spawn(Counter({ n: 0 }));

    // An "update" system that increments n on every matching entity each tick.
    app.scheduler.addSystem("update", world => {
      world.query(Counter).updateEach(([counter]) => {
        counter.n += 1;
      });
    });

    const K = 5;
    for (let i = 0; i < K; i++) app.loop.step();

    expect(app.ecs.get(entity, Counter)?.n).toBe(K);
    expect(app.ecs.query(Counter).count()).toBe(1);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Stage order: input before update before render in one step().
  // ──────────────────────────────────────────────────────────────────────────

  it("stages run in canonical order within a single loop.step()", async () => {
    const app = createLoopApp();
    await app.start();

    const order: Stage[] = [];
    // Register in a deliberately scrambled order to prove ordering is by stage,
    // not by registration order.
    app.scheduler.addSystem("render", () => {
      order.push("render");
    });
    app.scheduler.addSystem("input", () => {
      order.push("input");
    });
    app.scheduler.addSystem("update", () => {
      order.push("update");
    });

    app.loop.step();

    expect(order).toEqual(["input", "update", "render"]);

    // The observed order must agree with the scheduler's canonical stage tuple.
    const stages = app.scheduler.stages;
    const indexOf = (stage: Stage): number => stages.indexOf(stage);
    expect(indexOf("input")).toBeLessThan(indexOf("update"));
    expect(indexOf("update")).toBeLessThan(indexOf("render"));

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Deferred structural op via the command buffer.
  //
  // A spawn inside an "update" system is enqueued (iterating === true) and only
  // applied at the stage/tick boundary flush. We assert the new entity is NOT
  // visible to a query during the spawning system's run, but IS visible after
  // the tick completes — demonstrating the deferred command buffer.
  // ──────────────────────────────────────────────────────────────────────────

  it("structural spawn inside a system is deferred until the tick boundary", async () => {
    const app = createLoopApp();
    await app.start();

    const Spawned = app.ecs.defineComponent(() => ({ tag: 0 }));

    // Seed one matching entity so the system's query has a row to iterate.
    app.ecs.spawn(Spawned({ tag: 0 }));
    expect(app.ecs.query(Spawned).count()).toBe(1);

    let countDuringSystem = -1;
    let didSpawn = false;
    app.scheduler.addSystem("update", world => {
      // Run the spawn exactly once, during the first matching iteration.
      world.query(Spawned).updateEach(() => {
        if (didSpawn) return;
        didSpawn = true;
        world.spawn(Spawned({ tag: 1 }));
        // Mid-iteration: the spawn is deferred, so the count is unchanged here.
        countDuringSystem = world.query(Spawned).count();
      });
    });

    app.loop.step();

    // During iteration the deferred spawn was NOT yet visible.
    expect(countDuringSystem).toBe(1);
    // After the tick boundary flushed the command buffer, it IS visible.
    expect(app.ecs.query(Spawned).count()).toBe(2);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4b. Deferred despawn inside a system: applied after the boundary; isAlive
  //     flips false once the buffer flushes.
  // ──────────────────────────────────────────────────────────────────────────

  it("structural despawn inside a system is deferred until the tick boundary", async () => {
    const app = createLoopApp();
    await app.start();

    const Doomed = app.ecs.defineComponent(() => ({ hp: 1 }));
    const victim = app.ecs.spawn(Doomed({ hp: 1 }));
    expect(app.ecs.isAlive(victim)).toBe(true);

    let aliveDuringSystem = false;
    app.scheduler.addSystem("update", world => {
      world.query(Doomed).updateEach((_values, entity) => {
        world.despawn(entity);
        // Mid-iteration the entity is still alive — despawn is deferred.
        aliveDuringSystem = world.isAlive(entity);
      });
    });

    app.loop.step();

    expect(aliveDuringSystem).toBe(true);
    expect(app.ecs.isAlive(victim)).toBe(false);
    expect(app.ecs.query(Doomed).count()).toBe(0);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. start/stop + step interplay.
  // ──────────────────────────────────────────────────────────────────────────

  it("isRunning tracks start/stop, and step() advances regardless of run state", async () => {
    const app = createLoopApp();
    await app.start();

    let runs = 0;
    app.scheduler.addSystem("update", () => {
      runs += 1;
    });

    // autoStart:false → not running before an explicit start().
    expect(app.loop.isRunning()).toBe(false);

    app.loop.start();
    expect(app.loop.isRunning()).toBe(true);

    app.loop.stop();
    expect(app.loop.isRunning()).toBe(false);

    // step() advances a deterministic tick whether running or stopped.
    app.loop.step();
    expect(runs).toBe(1);

    app.loop.start();
    expect(app.loop.isRunning()).toBe(true);
    app.loop.step();
    expect(runs).toBe(2);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. scheduler.tick forwards dt; stages tuple is the canonical 5.
  // ──────────────────────────────────────────────────────────────────────────

  it("scheduler.tick(dt) forwards the exact dt to systems and exposes 5 canonical stages", async () => {
    const app = createLoopApp();
    await app.start();

    let capturedDt = Number.NaN;
    app.scheduler.addSystem("update", (_world, dt) => {
      capturedDt = dt;
    });

    app.scheduler.tick(0.016);

    expect(capturedDt).toBe(0.016);
    expect(app.scheduler.stages).toEqual(["input", "update", "physics", "sync", "render"]);
    expect(app.scheduler.stages).toHaveLength(5);

    await app.stop();
  });
});
