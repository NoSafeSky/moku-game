/**
 * @file Cross-plugin integration — Cycle 2 world resources end-to-end (ecs +
 *       context + loop + scene).
 *
 * Boots the REAL framework (real plugins + real createCore/createApp/createPlugin
 * factory) with only the headless surfaces mocked: PixiJS (no GPU context) and
 * globalThis.window (the default DOM EventTarget, absent in node) so the plugins
 * boot under the node test runner.
 *
 * Exercises the new "world resources" feature surface introduced in Cycle 2:
 *  1. ECS RESOURCES — defineResource/setResource/getResource round-trip,
 *     `resource()` throwing an actionable error when unset with no factory, and
 *     the lazy-factory init + memoize + remove → re-init semantics, all through a
 *     real booted app's world (`app.ecs` IS the World facade).
 *  2. CONTEXT BINDING — after `app.start()` a real scheduler/ecs system reads
 *     `world.resource(Assets)` (the live assets API) and `world.resource(GameContext)`
 *     ({ log, emit, env }) when `bindGameContext` defaults true; with it set false,
 *     GameContext is unbound while Assets stays bound. `app.context` exposes the tokens.
 *  3. LOOP TIME — a system reads `world.resource(Time)` and observes frame / elapsed /
 *     dt advance across deterministic `app.loop.step()` calls (loop: autoStart false).
 *  4. SCENE DELEGATION — the scene tracking world (handed to a scene's `setup`)
 *     delegates all 6 resource methods to the underlying ecs world: a resource set
 *     inside `setup` is visible on the real `app.ecs` world.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Headless DOM EventTarget (node has no real window). Assigned BEFORE any plugin
// import so plugins that resolve a default DOM target pick it up.
// ─────────────────────────────────────────────────────────────────────────────

const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
Object.assign(globalThis, { window: mockEventTarget });

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted PixiJS mock — Application/Container/Sprite are CLASSES; Assets is an
// object. No GPU context exists in the node test runner.
// ─────────────────────────────────────────────────────────────────────────────

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

// ─── Framework imports AFTER the mocks ──
import { coreConfig } from "../../src/config";
import { assetsPlugin } from "../../src/plugins/assets";
import type { Api as AssetsApi } from "../../src/plugins/assets/types";
import { contextPlugin } from "../../src/plugins/context";
import { Assets, GameContext } from "../../src/plugins/context/resources";
import type { GameContextValue } from "../../src/plugins/context/types";
import { ecsPlugin } from "../../src/plugins/ecs";
import { loopPlugin } from "../../src/plugins/loop";
import { Time } from "../../src/plugins/loop/resources";
import type { TimeState } from "../../src/plugins/loop/types";
import { rendererPlugin } from "../../src/plugins/renderer";
import { scenePlugin } from "../../src/plugins/scene";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factories — each subset includes exactly the plugins it needs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context-focused app: context depends on ecs + assets; assets depends on
 * renderer, and renderer depends on scheduler — so the full set is
 * ecs + scheduler + renderer + assets + context. Used for both raw ECS-resource
 * scenarios and the context binding scenarios.
 *
 * @param pluginConfigs - Optional plugin config overrides (e.g. context.bindGameContext).
 * @param pluginConfigs.context - Context plugin config overrides.
 * @param pluginConfigs.context.bindGameContext - Whether to bind the GameContext resource at start.
 * @returns A freshly created (not yet started) App instance.
 * @example
 * ```ts
 * const app = createContextApp();
 * await app.start();
 * app.ecs.resource(app.context.assets);
 * ```
 */
const createContextApp = (pluginConfigs?: { context?: { bindGameContext?: boolean } }) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, contextPlugin]
  });
  return pluginConfigs === undefined ? createApp() : createApp({ pluginConfigs });
};

/**
 * Loop-focused app: loop needs scheduler + renderer + ecs; renderer needs
 * scheduler. `autoStart:false` so each scenario advances deterministically via
 * `app.loop.step()`.
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

/**
 * Scene-focused app: scene needs ecs + renderer + assets; renderer needs
 * scheduler. Matches the existing scene integration test's plugin set.
 *
 * @returns A freshly created (not yet started) App instance.
 * @example
 * ```ts
 * const app = createSceneApp();
 * await app.start();
 * await app.scene.load("level");
 * ```
 */
const createSceneApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin, scenePlugin]
  });
  return createApp();
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-plugin: world resources (ecs + context + loop + scene)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.loadBundle.mockResolvedValue({});
    pixiMocks.assetsState.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. ECS resources — defineResource + setResource + getResource round-trip.
  // ──────────────────────────────────────────────────────────────────────────

  describe("ecs resources end-to-end", () => {
    it("defineResource → setResource → getResource/resource round-trips through the real world", async () => {
      const app = createContextApp();
      await app.start();

      const Score = app.ecs.defineResource<{ value: number; combo: number }>();

      // Unset until written: getResource is undefined, hasResource is false.
      expect(app.ecs.getResource(Score)).toBeUndefined();
      expect(app.ecs.hasResource(Score)).toBe(false);

      app.ecs.setResource(Score, { value: 100, combo: 3 });

      expect(app.ecs.hasResource(Score)).toBe(true);
      expect(app.ecs.getResource(Score)).toEqual({ value: 100, combo: 3 });
      // resource() returns the same live object (never undefined once set).
      expect(app.ecs.resource(Score)).toBe(app.ecs.getResource(Score));

      // Overwrite replaces the stored value.
      app.ecs.setResource(Score, { value: 250, combo: 7 });
      expect(app.ecs.resource(Score)).toEqual({ value: 250, combo: 7 });

      await app.stop();
    });

    it("resource() throws the actionable 'is not set' error when unset and no factory", async () => {
      const app = createContextApp();
      await app.start();

      const Missing = app.ecs.defineResource<{ n: number }>();

      // getResource degrades to undefined; resource() throws a guidance-rich error.
      expect(app.ecs.getResource(Missing)).toBeUndefined();
      expect(() => app.ecs.resource(Missing)).toThrow(/is not set/);
      expect(() => app.ecs.resource(Missing)).toThrow(/setResource/);

      await app.stop();
    });

    it("a defineResource(factory) lazily inits and memoizes — factory runs once across reads", async () => {
      const app = createContextApp();
      await app.start();

      let factoryCalls = 0;
      const Lazy = app.ecs.defineResource(() => {
        factoryCalls += 1;
        return { seed: 42 };
      });

      // hasResource is true even before the first read (a factory is registered).
      expect(app.ecs.hasResource(Lazy)).toBe(true);
      expect(factoryCalls).toBe(0);

      const first = app.ecs.getResource(Lazy);
      const second = app.ecs.resource(Lazy);
      const third = app.ecs.getResource(Lazy);

      // Memoized: the factory ran exactly once and every read sees the same object.
      expect(factoryCalls).toBe(1);
      expect(first).toEqual({ seed: 42 });
      expect(second).toBe(first);
      expect(third).toBe(first);

      await app.stop();
    });

    it("removeResource clears the value; a factory re-inits on the next read", async () => {
      const app = createContextApp();
      await app.start();

      let factoryCalls = 0;
      const Tick = app.ecs.defineResource(() => {
        factoryCalls += 1;
        return { count: factoryCalls };
      });

      const initial = app.ecs.resource(Tick);
      expect(initial).toEqual({ count: 1 });
      expect(factoryCalls).toBe(1);

      // Remove clears the stored value, but the factory registration survives.
      app.ecs.removeResource(Tick);
      expect(app.ecs.hasResource(Tick)).toBe(true); // factory still makes a read succeed

      const reinit = app.ecs.resource(Tick);
      expect(factoryCalls).toBe(2); // re-initialised
      expect(reinit).toEqual({ count: 2 });
      expect(reinit).not.toBe(initial);

      // A factoryless resource is gone after remove (hasResource false).
      const Plain = app.ecs.defineResource<{ x: number }>();
      app.ecs.setResource(Plain, { x: 1 });
      app.ecs.removeResource(Plain);
      expect(app.ecs.hasResource(Plain)).toBe(false);
      expect(app.ecs.getResource(Plain)).toBeUndefined();

      await app.stop();
    });

    it("resource ops are immediate even mid-iteration (bypass the command buffer)", async () => {
      const app = createContextApp();
      await app.start();

      const Marker = app.ecs.defineComponent(() => ({ hit: false }));
      app.ecs.spawn(Marker({ hit: false }));

      const Flag = app.ecs.defineResource<{ set: boolean }>();
      let seenDuringIteration: { set: boolean } | undefined;

      // A system mutates a resource mid-updateEach; resource reads/writes are
      // immediate (the `iterating` flag is ignored for resources), unlike spawns.
      app.ecs.addSystem("update", world => {
        world.query(Marker).updateEach(() => {
          world.setResource(Flag, { set: true });
          seenDuringIteration = world.getResource(Flag);
        });
      });

      app.ecs.tick(1 / 60);

      expect(seenDuringIteration).toEqual({ set: true });
      expect(app.ecs.resource(Flag)).toEqual({ set: true });

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Context binding — Assets always, GameContext gated by config.
  // ──────────────────────────────────────────────────────────────────────────

  describe("context resource binding", () => {
    it("a system reads the live Assets API and {log,emit,env} GameContext after start (defaults)", async () => {
      const app = createContextApp();
      await app.start();

      // app.context exposes the same well-known tokens as the module imports.
      expect(app.context.assets).toBe(Assets);
      expect(app.context.game).toBe(GameContext);

      let seenAssets: AssetsApi | undefined;
      let seenGame: GameContextValue | undefined;
      app.ecs.addSystem("update", world => {
        seenAssets = world.resource(Assets);
        seenGame = world.resource(GameContext);
      });

      app.ecs.tick(1 / 60);

      // Live assets API.
      expect(typeof seenAssets?.get).toBe("function");
      expect(typeof seenAssets?.load).toBe("function");
      // Reading via the app-exposed token returns the same value.
      expect(seenAssets).toBe(app.ecs.resource(app.context.assets));

      // Curated game context: { log, emit, env } and no kernel escape hatch.
      expect(typeof seenGame?.log.info).toBe("function");
      expect(typeof seenGame?.emit).toBe("function");
      expect(typeof seenGame?.env.get).toBe("function");
      expect(seenGame).not.toHaveProperty("require");

      await app.stop();
    });

    it("with bindGameContext:false, GameContext is unbound while Assets stays bound", async () => {
      const app = createContextApp({ context: { bindGameContext: false } });
      await app.start();

      // Assets is ALWAYS bound regardless of the flag.
      expect(app.ecs.hasResource(Assets)).toBe(true);
      expect(typeof app.ecs.resource(Assets).get).toBe("function");

      // GameContext was skipped: no value, no factory → has is false, read throws.
      expect(app.ecs.hasResource(GameContext)).toBe(false);
      expect(app.ecs.getResource(GameContext)).toBeUndefined();
      expect(() => app.ecs.resource(GameContext)).toThrow(/is not set/);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Loop Time resource — advances across deterministic step() calls.
  // ──────────────────────────────────────────────────────────────────────────

  describe("loop Time resource", () => {
    it("a system observes frame / elapsed / dt advance across app.loop.step() calls", async () => {
      const app = createLoopApp();
      await app.start();

      // app.loop.time is the same Time token published by the loop plugin.
      expect(app.loop.time).toBe(Time);

      // The fixed step the loop is configured with (loop default fixedDt = 1/60).
      const fixedDt = 1 / 60;

      const samples: TimeState[] = [];
      app.ecs.addSystem("update", world => {
        const t = world.resource(Time);
        // Snapshot a copy — the loop mutates the backing object in place.
        samples.push({ dt: t.dt, elapsed: t.elapsed, frame: t.frame });
      });

      const K = 3;
      for (let i = 0; i < K; i += 1) app.loop.step();

      expect(samples).toHaveLength(K);
      // dt is always the fixed step; frame increments; elapsed accumulates.
      for (const [i, sample] of samples.entries()) {
        expect(sample.dt).toBeCloseTo(fixedDt, 10);
        expect(sample.frame).toBe(i + 1);
        expect(sample.elapsed).toBeCloseTo(fixedDt * (i + 1), 10);
      }

      // After K steps the live resource reflects the final clock values.
      const finalTime = app.ecs.resource(Time);
      expect(finalTime.frame).toBe(K);
      expect(finalTime.dt).toBeCloseTo(fixedDt, 10);
      expect(finalTime.elapsed).toBeCloseTo(fixedDt * K, 10);

      await app.stop();
    });

    it("Time is bound at start (frame 0) before any step advances it", async () => {
      const app = createLoopApp();
      await app.start();

      // Bound at onStart with a zeroed clock; not yet advanced.
      expect(app.ecs.hasResource(Time)).toBe(true);
      const t0 = app.ecs.resource(Time);
      expect(t0.frame).toBe(0);
      expect(t0.elapsed).toBe(0);

      app.loop.step();
      expect(app.ecs.resource(Time).frame).toBe(1);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Scene tracking-world delegates the 6 resource methods to the ecs world.
  // ──────────────────────────────────────────────────────────────────────────

  describe("scene tracking-world resource delegation", () => {
    it("a resource defined + set inside scene.setup is visible on the underlying ecs world", async () => {
      const app = createSceneApp();
      await app.start();

      // The token is defined on the real world up front so the test holds the
      // exact handle the scene's setup will write through its tracking world.
      const Difficulty = app.ecs.defineResource<{ level: number }>();

      let setupWorldHadResourceMethods = false;
      app.scene.define("level", {
        setup: world => {
          // The tracking world exposes all 6 resource methods (delegation).
          setupWorldHadResourceMethods =
            typeof world.defineResource === "function" &&
            typeof world.setResource === "function" &&
            typeof world.getResource === "function" &&
            typeof world.resource === "function" &&
            typeof world.hasResource === "function" &&
            typeof world.removeResource === "function";

          // Write through the tracking world — must delegate to the real world.
          world.setResource(Difficulty, { level: 9 });
          // And a token minted via the tracking world's defineResource also lands
          // on the underlying world (round-trip within setup).
          const Local = world.defineResource<{ ok: boolean }>();
          world.setResource(Local, { ok: true });
          expect(world.resource(Local)).toEqual({ ok: true });
        }
      });

      await app.scene.load("level");

      expect(setupWorldHadResourceMethods).toBe(true);
      // The delegated write is visible on the real app.ecs world after load.
      expect(app.ecs.hasResource(Difficulty)).toBe(true);
      expect(app.ecs.resource(Difficulty)).toEqual({ level: 9 });

      await app.stop();
    });
  });
});
