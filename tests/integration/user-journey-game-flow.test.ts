/**
 * @file USER-JOURNEY integration tests — realistic end-to-end flows a consumer
 * game would run against the `game` framework.
 *
 * Each test boots the REAL framework (real ecs/scheduler/renderer/input/loop/
 * assets/scene/mcp plugins via the real factory chain). Only the headless
 * surfaces are mocked: PixiJS (no GPU), the MCP stdio transport (no process
 * I/O), and `globalThis.window` (no DOM in node). Frames are advanced
 * deterministically with `app.loop.step()`, which runs `scheduler.tick(fixedDt)`
 * then `renderer.render()` once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Headless DOM EventTarget for the input plugin (node has no real window).
// Assign BEFORE any plugin import so input's resolveTarget() picks it up.
// `addEventListener` only RECORDS handlers — §5 pulls them back out to simulate
// keyboard events through the real input system.
// ─────────────────────────────────────────────────────────────────────────────
const mockEventTarget = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn()
};
Object.assign(globalThis, { window: mockEventTarget });

// ─────────────────────────────────────────────────────────────────────────────
// Mock PixiJS — no GPU context in tests. Application/Container/Sprite are
// CLASSES; Assets is an object whose results we drive from pixiMocks.
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
import type { Texture } from "pixi.js";
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
// Test app factory — full 8-plugin app, matching the shipped wiring. mcp is
// configured stdio-only so onStart never opens an HTTP listener.
// ─────────────────────────────────────────────────────────────────────────────
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
  // autoStart: false → no rAF auto-driving (irrelevant in node, but explicit);
  // we drive frames deterministically with app.loop.step().
  return createApp({
    pluginConfigs: {
      mcp: { transports: ["stdio"], httpAuth: "none" },
      loop: { fixedDt: 1 / 60, autoStart: false }
    }
  });
};

// The fixed step the loop drives each app.loop.step() (matches loop config above).
const DT = 1 / 60;

// A truthy fake texture for asset-driven journeys.
const fakeTexture = { source: {} } as unknown as Texture;

// Pull a recorded DOM handler back out of the input plugin's listener set so we
// can simulate keyboard events through the real input system (harness §5).
const getKeyHandler = (type: "keydown" | "keyup"): ((e: { key: string }) => void) => {
  const call = mockEventTarget.addEventListener.mock.calls.find(([t]) => t === type);
  if (!call) throw new Error(`no ${type} handler registered`);
  return call[1] as (e: { key: string }) => void;
};

describe("user journey — game flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixiMocks.appState.init.mockResolvedValue(undefined);
    pixiMocks.assetsState.loadBundle.mockResolvedValue({});
    pixiMocks.assetsState.load.mockResolvedValue(fakeTexture);
    pixiMocks.assetsState.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Movement simulation — a scene spawns a player with Transform + Velocity;
  //    an "update" system advances x by v.dx * dt each tick. The system reads dt
  //    from the scheduler (the real updateEach signature is `([t, v], entity) =>`),
  //    so the per-tick delta comes from the system's `dt`, not from updateEach.
  // ──────────────────────────────────────────────────────────────────────────
  it("1. advances a player by velocity * dt over several fixed steps", async () => {
    const app = createFullApp();
    await app.start();

    const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }));
    const Transform = app.renderer.Transform;

    const captured: { player?: ReturnType<typeof app.ecs.spawn> } = {};
    app.scene.define("play", {
      setup: world => {
        captured.player = world.spawn(
          Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
          Velocity({ dx: 60, dy: 0 })
        );
      }
    });

    // Movement system: dt is supplied by the scheduler; iterate the query inside it.
    app.scheduler.addSystem("update", (world, dt) => {
      world.query(Transform, Velocity).updateEach(([t, v]) => {
        t.x += v.dx * dt;
      });
    });

    await app.scene.load("play");
    const player = captured.player;
    expect(player).toBeDefined();

    // Player starts at x = 0.
    expect(app.ecs.get(player as ReturnType<typeof app.ecs.spawn>, Transform)?.x).toBeCloseTo(0, 5);

    // Run 10 fixed steps → x advances by 60 * (1/60) * 10 = 10.
    const steps = 10;
    for (let i = 0; i < steps; i++) app.loop.step();

    const x = app.ecs.get(player as ReturnType<typeof app.ecs.spawn>, Transform)?.x ?? 0;
    expect(x).toBeCloseTo(60 * DT * steps, 5);
    expect(x).toBeGreaterThan(0);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Input-driven movement — hold ArrowRight, step N times (player moves right
  //    while the key is down), then release and step again (movement stops).
  // ──────────────────────────────────────────────────────────────────────────
  it("2. moves the player while ArrowRight is held and stops after release", async () => {
    const app = createFullApp();
    await app.start();

    const Transform = app.renderer.Transform;
    const player = app.ecs.spawn(Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));

    const SPEED = 120;
    app.scheduler.addSystem("update", (world, dt) => {
      const input = app.input.snapshot();
      if (!input.isDown("ArrowRight")) return;
      world.query(Transform).updateEach(([t]) => {
        t.x += SPEED * dt;
      });
    });

    // Hold ArrowRight (call the recorded keydown handler), then step a few frames.
    getKeyHandler("keydown")({ key: "ArrowRight" });
    const heldSteps = 5;
    for (let i = 0; i < heldSteps; i++) app.loop.step();

    const xAfterHold = app.ecs.get(player, Transform)?.x ?? 0;
    expect(xAfterHold).toBeCloseTo(SPEED * DT * heldSteps, 5);
    expect(xAfterHold).toBeGreaterThan(0);

    // Release the key, then keep stepping — x must not change anymore.
    getKeyHandler("keyup")({ key: "ArrowRight" });
    // First step processes the keyup in the input stage (isDown still might be
    // true for the residual frame? No — keyup mutates `down` immediately and the
    // input stage refreshes the snapshot before update runs), so movement halts.
    for (let i = 0; i < 5; i++) app.loop.step();

    const xAfterRelease = app.ecs.get(player, Transform)?.x ?? 0;
    expect(xAfterRelease).toBeCloseTo(xAfterHold, 5);
    expect(app.input.snapshot().isDown("ArrowRight")).toBe(false);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Scene A → B transition mid-play — load A (spawns enemies), step a few
  //    frames, load B (spawns a boss); A's entities die, B's lives, current = B.
  // ──────────────────────────────────────────────────────────────────────────
  it("3. transitions A→B mid-play, despawning A and spawning B", async () => {
    const app = createFullApp();
    await app.start();

    const Transform = app.renderer.Transform;
    const Enemy = app.ecs.defineTag();
    const Boss = app.ecs.defineTag();

    const enemies: Array<ReturnType<typeof app.ecs.spawn>> = [];
    let boss: ReturnType<typeof app.ecs.spawn> | undefined;

    app.scene.define("A", {
      setup: world => {
        enemies.push(
          world.spawn(Transform({ x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), Enemy({})),
          world.spawn(Transform({ x: 20, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), Enemy({}))
        );
      }
    });
    app.scene.define("B", {
      setup: world => {
        boss = world.spawn(Transform({ x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }), Boss({}));
      }
    });

    await app.scene.load("A");
    expect(app.scene.currentScene()).toBe("A");
    for (const e of enemies) expect(app.ecs.isAlive(e)).toBe(true);

    // Play a few frames before the transition.
    for (let i = 0; i < 3; i++) app.loop.step();
    for (const e of enemies) expect(app.ecs.isAlive(e)).toBe(true);

    // Transition to B — A's entities are despawned, B's boss is spawned.
    await app.scene.load("B");
    expect(app.scene.currentScene()).toBe("B");
    for (const e of enemies) expect(app.ecs.isAlive(e)).toBe(false);
    expect(boss).toBeDefined();
    expect(app.ecs.isAlive(boss as ReturnType<typeof app.ecs.spawn>)).toBe(true);
    expect(app.ecs.has(boss as ReturnType<typeof app.ecs.spawn>, Boss)).toBe(true);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Asset + sprite in a scene — assets.get/load return a truthy texture; a
  //    scene setup loads a sprite and attaches it to a transformed entity.
  //    Asserts the Sprite was created with the texture and attach did not throw.
  // ──────────────────────────────────────────────────────────────────────────
  it("4. loads a sprite in a scene setup and attaches it to an entity", async () => {
    pixiMocks.assetsState.get.mockReturnValue(fakeTexture);
    pixiMocks.assetsState.load.mockResolvedValue(fakeTexture);

    const app = createFullApp();
    await app.start();

    const Transform = app.renderer.Transform;
    const captured: {
      hero?: ReturnType<typeof app.ecs.spawn>;
      sprite?: { texture: unknown };
    } = {};

    let attachThrew = false;
    app.scene.define("arena", {
      setup: async world => {
        const hero = world.spawn(Transform({ x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 }));
        const spr = await app.assets.sprite("hero");
        try {
          app.renderer.attach(hero, spr as unknown as Parameters<typeof app.renderer.attach>[1]);
        } catch {
          attachThrew = true;
        }
        captured.hero = hero;
        captured.sprite = spr as unknown as { texture: unknown };
      }
    });

    await expect(app.scene.load("arena")).resolves.toBeUndefined();

    // Sprite mock was created from the (truthy) cached texture.
    expect(captured.sprite).toBeDefined();
    expect(captured.sprite?.texture).toBe(fakeTexture);

    // The entity is alive and the sprite attached without throwing.
    // NOTE: a full app.loop.step() would run the renderer sync stage, which calls
    // `container.position.set(...)` — the harness Sprite mock intentionally omits
    // position/scale (it carries only `texture`/`destroy`), so we assert on attach
    // success rather than stepping a sync against the incomplete display-object mock.
    const hero = captured.hero as ReturnType<typeof app.ecs.spawn>;
    expect(attachThrew).toBe(false);
    expect(app.ecs.isAlive(hero)).toBe(true);

    // getView() exposes the (mocked) canvas surface, confirming the renderer is live.
    expect(app.renderer.getView()).toBe(pixiMocks.appState.canvas);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Many entities, one system — spawn 3 movers with distinct velocities; a
  //    single query(...).updateEach advances all of them consistently per tick.
  // ──────────────────────────────────────────────────────────────────────────
  it("5. advances three movers with one system over K steps", async () => {
    const app = createFullApp();
    await app.start();

    const Transform = app.renderer.Transform;
    const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }));

    const speeds = [30, 60, 90];
    const movers = speeds.map(dx =>
      app.ecs.spawn(
        Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
        Velocity({ dx, dy: 0 })
      )
    );

    let updatedCount = 0;
    app.scheduler.addSystem("update", (world, dt) => {
      world.query(Transform, Velocity).updateEach(([t, v]) => {
        t.x += v.dx * dt;
        updatedCount++;
      });
    });

    expect(app.ecs.query(Transform, Velocity).count()).toBe(3);

    const K = 6;
    for (let i = 0; i < K; i++) app.loop.step();

    // Each mover advanced by its own dx * dt * K.
    for (const [i, m] of movers.entries()) {
      const speed = speeds[i] as number;
      const x = app.ecs.get(m, Transform)?.x ?? -1;
      expect(x).toBeCloseTo(speed * DT * K, 5);
    }

    // The single system visited all 3 entities on each of K ticks.
    expect(updatedCount).toBe(3 * K);

    await app.stop();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Reset-and-reload journey — load a scene (entities spawned), unload it
  //    (current undefined, owned entities dead), then load a fresh scene and
  //    confirm it works (new entities alive, currentScene set).
  // ──────────────────────────────────────────────────────────────────────────
  it("6. unloads a scene then loads a fresh one cleanly", async () => {
    const app = createFullApp();
    await app.start();

    const Transform = app.renderer.Transform;

    const firstEntities: Array<ReturnType<typeof app.ecs.spawn>> = [];
    let secondEntity: ReturnType<typeof app.ecs.spawn> | undefined;

    app.scene.define("first", {
      setup: world => {
        firstEntities.push(
          world.spawn(Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })),
          world.spawn(Transform({ x: 5, y: 5, rotation: 0, scaleX: 1, scaleY: 1 }))
        );
      }
    });
    app.scene.define("second", {
      setup: world => {
        secondEntity = world.spawn(Transform({ x: 42, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
      }
    });

    // Load + run a couple of frames.
    await app.scene.load("first");
    expect(app.scene.currentScene()).toBe("first");
    for (const e of firstEntities) expect(app.ecs.isAlive(e)).toBe(true);
    for (let i = 0; i < 2; i++) app.loop.step();

    // Reset: unload → no current scene, owned entities despawned.
    app.scene.unload();
    expect(app.scene.currentScene()).toBeUndefined();
    for (const e of firstEntities) expect(app.ecs.isAlive(e)).toBe(false);

    // Reload a fresh scene — it works: new entity alive, current set.
    await app.scene.load("second");
    expect(app.scene.currentScene()).toBe("second");
    expect(secondEntity).toBeDefined();
    expect(app.ecs.isAlive(secondEntity as ReturnType<typeof app.ecs.spawn>)).toBe(true);
    expect(app.ecs.get(secondEntity as ReturnType<typeof app.ecs.spawn>, Transform)?.x).toBe(42);

    // The fresh scene keeps running.
    expect(() => app.loop.step()).not.toThrow();

    await app.stop();
  });
});
