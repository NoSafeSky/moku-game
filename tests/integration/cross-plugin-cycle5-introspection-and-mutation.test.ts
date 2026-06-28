/**
 * @file Cross-plugin integration — Cycle 5 introspection + mutation surfaces.
 *
 * Boots the REAL framework (real plugins + real createCore/createApp/createPlugin
 * factory). Only the headless surfaces are mocked: PixiJS (no GPU context) and
 * globalThis.window (the input plugin's default DOM EventTarget, absent in node).
 *
 * Exercises the Cycle 5 public API end-to-end, preferring scenarios that span
 * MULTIPLE plugins together:
 *  1. ecs `componentByName` resolving a named token used by a real system, and the
 *     scene `ownedEntities` / `sceneNames` introspection observing those entities.
 *  2. loop `step()` returning a `{ frame, elapsed, dt }` snapshot that agrees with
 *     the `Time` resource a system reads during the same tick.
 *  3. input alias normalization (`keyDown("Space")` === `keyDown(" ")`, `keyPress("Esc")`
 *     === `keyPress("Escape")`) observed by a system reading the per-frame snapshot.
 *  4. renderer `attachPrimitive` honouring the headless contract (→ false, no app).
 *  5. mcp `game:reset` event reachable via the framework: a consumer plugin listens
 *     and the tool catalog declares `game:reset`.
 *
 * The loop never auto-drives frames in node (rAF is absent), so every scenario that
 * advances the simulation uses `app.loop.step()` (one fixed tick + render).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Headless DOM EventTarget for the input plugin (node has no real window).
// Assigned BEFORE any plugin import so input's resolveTarget() picks it up.
// ─────────────────────────────────────────────────────────────────────────────

const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
Object.assign(globalThis, { window: mockEventTarget });

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted PixiJS mock state — Application/Container/Sprite are CLASSES; Assets is
// an object. No GPU context exists in the node test runner.
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

// ── Framework imports AFTER the mocks ──
import { coreConfig } from "../../src/config";
import { assetsPlugin } from "../../src/plugins/assets";
import { ecsPlugin } from "../../src/plugins/ecs";
import { inputPlugin } from "../../src/plugins/input";
import { loopPlugin } from "../../src/plugins/loop";
import { mcpPlugin } from "../../src/plugins/mcp";
import { rendererPlugin } from "../../src/plugins/renderer";
import { scenePlugin } from "../../src/plugins/scene";
import { schedulerPlugin } from "../../src/plugins/scheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full 8-plugin app with the MCP plugin configured for stdio only (no real HTTP
 * listener) and open ("none") auth. The loop is configured not to auto-drive so
 * every scenario advances deterministically via `app.loop.step()`.
 *
 * @returns A freshly created (not yet started) full App instance.
 */
const createFullApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [
      ecsPlugin,
      schedulerPlugin,
      rendererPlugin,
      assetsPlugin,
      inputPlugin,
      loopPlugin,
      scenePlugin,
      mcpPlugin
    ]
  });
  return createApp({
    pluginConfigs: {
      loop: { autoStart: false },
      mcp: { transports: ["stdio"], httpAuth: "none" }
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-plugin: Cycle 5 introspection + mutation", () => {
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
  // 1. ecs.componentByName + scene introspection
  // ──────────────────────────────────────────────────────────────────────────

  describe("ecs.componentByName + scene ownership introspection", () => {
    it("resolves a named component token that a real update system reads and mutates", async () => {
      const app = createFullApp();
      await app.start();

      // Define a NAMED component, then forget the original token — resolve it by name.
      app.ecs.defineComponent(() => ({ hp: 100 }), { name: "Health" });

      const Health = app.ecs.componentByName("Health");
      expect(Health).toBeDefined();
      if (!Health) throw new Error("componentByName('Health') should resolve");

      // The resolved token is usable with spawn / get and by a real system.
      const entity = app.ecs.spawn(Health({ hp: 100 }));
      app.scheduler.addSystem("update", world => {
        const token = world.componentByName("Health");
        if (!token) return;
        world.query(token).updateEach(([health]) => {
          (health as { hp: number }).hp -= 10;
        });
      });

      app.loop.step();

      expect((app.ecs.get(entity, Health!) as { hp: number } | undefined)?.hp).toBe(90);

      await app.stop();
    });

    it("returns undefined for unknown and anonymous components; first-wins on duplicate names", async () => {
      const app = createFullApp();
      await app.start();

      // Unknown name → undefined.
      expect(app.ecs.componentByName("Nope")).toBeUndefined();

      // Anonymous component (no opts.name) is not discoverable by name.
      app.ecs.defineComponent(() => ({ x: 0 }));
      expect(app.ecs.componentByName("")).toBeUndefined();

      // First registration wins when two components share a name.
      const first = app.ecs.defineComponent(() => ({ tag: "first" }), { name: "Dup" });
      app.ecs.defineComponent(() => ({ tag: "second" }), { name: "Dup" });
      expect(app.ecs.componentByName("Dup")).toBe(first);

      await app.stop();
    });

    it("scene.sceneNames is [] before define and ownedEntities snapshots the loaded scene", async () => {
      const app = createFullApp();
      await app.start();

      // Before any define, the registry is empty.
      expect(app.scene.sceneNames()).toEqual([]);
      // Before any load, nothing is owned.
      expect(app.scene.ownedEntities()).toEqual([]);

      // Named component resolved by name and spawned inside scene setup.
      app.ecs.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

      app.scene.define("menu", { setup: vi.fn() });
      app.scene.define("level", {
        setup: world => {
          const Position = world.componentByName("Position");
          if (!Position) throw new Error("Position not resolvable in setup");
          world.spawn(Position({ x: 1, y: 2 }));
          world.spawn(Position({ x: 3, y: 4 }));
        }
      });

      // sceneNames preserves registration order.
      expect(app.scene.sceneNames()).toEqual(["menu", "level"]);

      await app.scene.load("level");

      // ownedEntities is a snapshot of the entities spawned during setup.
      const owned = app.scene.ownedEntities();
      expect(owned).toHaveLength(2);
      for (const entity of owned) {
        expect(app.ecs.isAlive(entity)).toBe(true);
      }

      // The snapshot is a fresh copy — mutating it does not affect the live set.
      (owned as unknown[]).push(999);
      expect(app.scene.ownedEntities()).toHaveLength(2);

      // After unload the snapshot is empty again.
      app.scene.unload();
      expect(app.scene.ownedEntities()).toEqual([]);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. loop.step() returns a Time snapshot consumed by a system
  // ──────────────────────────────────────────────────────────────────────────

  describe("loop.step() snapshot ↔ Time resource", () => {
    it("returns { frame, elapsed, dt } that matches the Time resource read inside a system", async () => {
      const app = createFullApp();
      await app.start();

      let seen: { frame: number; elapsed: number; dt: number } | undefined;
      app.scheduler.addSystem("update", world => {
        const clock = world.resource(app.loop.time);
        seen = { frame: clock.frame, elapsed: clock.elapsed, dt: clock.dt };
      });

      const result = app.loop.step();

      // The step() return value reports the just-advanced frame clock.
      expect(result.frame).toBe(1);
      expect(result.dt).toBeGreaterThan(0);
      expect(result.elapsed).toBeCloseTo(result.dt);

      // A system that read the Time resource during the tick saw the same values.
      expect(seen).toEqual(result);

      // A second step advances frame and accumulates elapsed.
      const second = app.loop.step();
      expect(second.frame).toBe(2);
      expect(second.elapsed).toBeCloseTo(result.dt * 2);
      expect(second.dt).toBeCloseTo(result.dt);

      await app.stop();
    });

    it("returns { 0, 0, 0 } before start() (no runtime) and does not throw", () => {
      const app = createFullApp();

      // Before app.start() the loop runtime has not been created.
      expect(app.loop.step()).toEqual({ frame: 0, elapsed: 0, dt: 0 });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. input alias normalization observed in a system's snapshot read
  // ──────────────────────────────────────────────────────────────────────────

  describe("input alias normalization in a gameplay system", () => {
    it('keyDown("Space") is observed as the canonical " " key after the input stage ticks', async () => {
      const app = createFullApp();
      await app.start();

      // Inject the friendly alias; the canonical key is " " (the spacebar's .key).
      app.input.keyDown("Space");

      let downSpaceAlias = false;
      let downCanonical = false;
      app.scheduler.addSystem("update", () => {
        const snap = app.input.snapshot();
        downCanonical = snap.isDown(" ");
        downSpaceAlias = snap.isDown("Space");
      });

      app.loop.step(); // input stage rolls the live state into the snapshot

      // The snapshot stores the CANONICAL key, not the alias.
      expect(downCanonical).toBe(true);
      expect(downSpaceAlias).toBe(false);

      // Reading via the alias on the public snapshot is still false — only " " resolves.
      expect(app.input.snapshot().isDown(" ")).toBe(true);
      expect(app.input.snapshot().isDown("Space")).toBe(false);

      await app.stop();
    });

    it('keyPress("Esc") behaves as keyPress("Escape") — a one-frame edge on the canonical key', async () => {
      const app = createFullApp();
      await app.start();

      app.input.keyPress("Esc");

      app.loop.step(); // frame 1: the tap edge is visible on "Escape"

      const frame1 = app.input.snapshot();
      expect(frame1.justPressed("Escape")).toBe(true);
      expect(frame1.justReleased("Escape")).toBe(true);
      // The alias is NOT a key on the snapshot — only the canonical form resolves.
      expect(frame1.justPressed("Esc")).toBe(false);
      // A tap never sticks down.
      expect(frame1.isDown("Escape")).toBe(false);

      app.loop.step(); // frame 2: the one-frame edge has cleared

      const frame2 = app.input.snapshot();
      expect(frame2.justPressed("Escape")).toBe(false);
      expect(frame2.justReleased("Escape")).toBe(false);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. renderer.attachPrimitive headless contract
  // ──────────────────────────────────────────────────────────────────────────

  describe("renderer.attachPrimitive headless contract", () => {
    it("returns false in a headless test env (no Pixi app) for every primitive shape", async () => {
      // No renderer config override → auto-detects headless (typeof document === "undefined").
      const app = createFullApp();
      await app.start();

      const entity = app.ecs.spawn();

      // Each PrimitiveSpec shape returns false when headless — nothing is staged.
      expect(app.renderer.attachPrimitive(entity, { shape: "rect", width: 10, height: 20 })).toBe(
        false
      );
      expect(
        app.renderer.attachPrimitive(entity, { shape: "circle", radius: 5, fill: 0xff_00_00 })
      ).toBe(false);
      expect(app.renderer.attachPrimitive(entity, { shape: "line", x2: 100, y2: 0 })).toBe(false);
      expect(
        app.renderer.attachPrimitive(entity, {
          shape: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 }
          ],
          stroke: 0x00_ff_00,
          strokeWidth: 2
        })
      ).toBe(false);

      await app.stop();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. mcp game:reset event reachable through the framework
  // ──────────────────────────────────────────────────────────────────────────

  describe("mcp game:reset event", () => {
    it("declares the game:reset tool and lets a consumer plugin subscribe to game:reset", async () => {
      const received: Array<{ reason: string }> = [];

      const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
        plugins: [
          ecsPlugin,
          schedulerPlugin,
          rendererPlugin,
          assetsPlugin,
          inputPlugin,
          loopPlugin,
          scenePlugin,
          mcpPlugin
        ]
      });

      // A consumer plugin that depends on mcp and listens for the declared event.
      const resetListener = createPlugin("game-reset-listener", {
        depends: [mcpPlugin],
        hooks: _ctx => ({
          "game:reset": payload => {
            received.push(payload);
          }
        })
      });

      const app = createApp({
        plugins: [resetListener],
        pluginConfigs: {
          loop: { autoStart: false },
          mcp: { transports: ["stdio"], httpAuth: "none" }
        }
      });
      await app.start();

      // The mcp plugin registers the game:reset tool in the default catalog.
      expect(app.mcp.toolNames()).toContain("game:reset");

      // Wiring the game:reset listener does not break the deterministic loop.
      expect(() => {
        for (let i = 0; i < 3; i += 1) app.loop.step();
      }).not.toThrow();

      // game:reset only fires from the mcp tool call (not reachable without an MCP
      // client), so normal stepping must NOT emit it — the listener stays empty.
      expect(received).toHaveLength(0);

      await app.stop();
    });
  });
});
