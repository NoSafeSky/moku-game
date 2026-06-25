/**
 * @file Advanced / headless core assembly — root integration tests.
 *
 * Exercises the framework-entry escape hatches re-exported from `game` for advanced /
 * headless composition (Cycle 3, issue #1):
 *   - `createCore(carrier, { plugins })` — assemble a custom core from a SUBSET of the
 *     framework's own plugins, booted fully headless (renderer `headless: true` — no Pixi/GPU).
 *   - `createCoreConfig(id, { config })` — the raw `@moku-labs/core` Layer-1 factory, re-exported,
 *     used to build a bespoke core config + minimal app from scratch.
 *
 * `createApp` remains the default path (covered by core-framework-lifecycle.test.ts); these
 * tests pin the advanced exports and the headless renderer contract. PixiJS is mocked (no GPU);
 * the headless renderer never constructs an Application, so the mock is only an import stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock PixiJS — the headless renderer never news up Application, but the renderer modules
// import pixi.js at load, so this stub keeps the import isomorphic under node.
vi.mock("pixi.js", () => ({
  Application: class {
    init = vi.fn().mockResolvedValue(undefined);
    render = vi.fn();
    destroy = vi.fn();
    canvas = {} as unknown as HTMLCanvasElement;
    stage = {};
  },
  Container: class {
    position = { set: vi.fn() };
    rotation = 0;
    scale = { set: vi.fn() };
    destroy = vi.fn();
    addChild = vi.fn();
    removeChild = vi.fn();
  },
  Assets: { load: vi.fn(), addBundle: vi.fn(), loadBundle: vi.fn(), get: vi.fn() },
  Sprite: class {
    destroy = vi.fn();
  }
}));

// ── Framework-entry re-exports under test, imported AFTER the mock ──
import { createCore, createCoreConfig, createPlugin } from "../../src/index";
import { ecsPlugin } from "../../src/plugins/ecs";
import { rendererPlugin } from "../../src/plugins/renderer";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Helper — assemble a headless ecs + scheduler + renderer core via the re-exported
// createCore, passing the { createPlugin } carrier form documented in config.ts.
// ─────────────────────────────────────────────────────────────────────────────

const createHeadlessCore = () => {
  const { createApp } = createCore(
    { createPlugin },
    { plugins: [ecsPlugin, schedulerPlugin, rendererPlugin] }
  );
  return createApp({ pluginConfigs: { renderer: { headless: true } } });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("advanced / headless core assembly (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Scenario 1: the advanced exports exist on the framework entry ───────────

  it("re-exports createCore and createCoreConfig as callable functions from the framework entry", () => {
    expect(typeof createCore).toBe("function");
    expect(typeof createCoreConfig).toBe("function");
  });

  // ── Scenario 2: createCore boots a headless subset with no GPU ──────────────

  it("createCore assembles a headless ecs+scheduler+renderer subset that boots with no Pixi/GPU", async () => {
    const app = createHeadlessCore();

    await expect(app.start()).resolves.toBeUndefined();

    // Only the assembled subset is mounted — no input/loop/assets/scene/mcp/context.
    expect(app.ecs).toBeDefined();
    expect(app.scheduler).toBeDefined();
    expect(app.renderer).toBeDefined();

    // Headless renderer contract: Transform is still defined (a callable token), but the
    // GPU surfaces are undefined and render() is a safe no-op (no Application was created).
    expect(typeof app.renderer.Transform).toBe("function");
    expect(app.renderer.getView()).toBeUndefined();
    expect(app.renderer.getStage()).toBeUndefined();
    expect(() => app.renderer.render()).not.toThrow();

    await app.stop();
  });

  // ── Scenario 3: the headless core runs real ECS + a sync system end to end ──

  it("runs real ECS systems (and the renderer's sync stage) headless, end to end", async () => {
    const app = createHeadlessCore();
    await app.start();

    // Transform is defined headless, so ECS/scene code is identical to the GPU path.
    const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = app.ecs.spawn(
      app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
      Velocity({ dx: 5, dy: 0 })
    );

    app.scheduler.addSystem("update", (world, dt) => {
      world.query(app.renderer.Transform, Velocity).updateEach(([t, v]) => {
        t.x += v.dx * dt;
      });
    });

    // One tick at dt=1 runs the update stage then the headless-safe sync stage (no views).
    app.scheduler.tick(1);

    expect(app.ecs.get(entity, app.renderer.Transform)?.x).toBe(5);

    await app.stop();
  });

  // ── Scenario 4: createCoreConfig builds a bespoke Layer-1 config from scratch ─

  it("createCoreConfig builds a bespoke core config and assembles a minimal app", async () => {
    const bespoke = createCoreConfig("advanced-core", { config: {} });

    const soloPlugin = bespoke.createPlugin("solo", {
      createState: () => ({ count: 0 }),
      api: ctx => ({
        ping: () => "pong",
        bump: () => {
          ctx.state.count += 1;
          return ctx.state.count;
        }
      })
    });

    const { createApp } = bespoke.createCore(bespoke, { plugins: [soloPlugin] });
    const app = createApp({});

    await app.start();

    expect(app.solo.ping()).toBe("pong");
    expect(app.solo.bump()).toBe(1);
    expect(app.solo.bump()).toBe(2);

    await app.stop();
  });

  // ── Scenario 5: createCore's returned createPlugin grafts a consumer plugin ──

  it("createCore returns a bound createPlugin that grafts a consumer plugin onto the subset", async () => {
    const { createApp, createPlugin: boundCreatePlugin } = createCore(
      { createPlugin },
      { plugins: [ecsPlugin] }
    );

    const probePlugin = boundCreatePlugin("probe", {
      depends: [ecsPlugin],
      api: ctx => ({
        spawnOne: () => ctx.require(ecsPlugin).spawn()
      })
    });

    const app = createApp({ plugins: [probePlugin] });
    await app.start();

    const spawned = app.probe.spawnOne();
    expect(app.ecs.isAlive(spawned)).toBe(true);

    await app.stop();
  });
});
