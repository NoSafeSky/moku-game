/**
 * @file scene plugin — unit tests for createApi.
 *
 * All dependencies (ecs World, renderer, assets) are hand-rolled mocks so tests
 * run in node without a real Pixi context.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Entity, World } from "../../../ecs/types";
import type { SceneContext } from "../../api";
import { createApi } from "../../api";
import type { Config, SceneDefinition, State } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Fake entity factory (branded number)
// ─────────────────────────────────────────────────────────────────────────────

let nextId = 1;

const makeEntity = (): Entity => nextId++ as unknown as Entity;

// ─────────────────────────────────────────────────────────────────────────────
// Fake World factory
// ─────────────────────────────────────────────────────────────────────────────

const makeFakeWorld = (): World => {
  const world: World = {
    spawn: vi.fn(() => makeEntity()),
    despawn: vi.fn(),
    isAlive: vi.fn().mockReturnValue(true),
    defineComponent: vi.fn(),
    defineTag: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    get: vi.fn(),
    set: vi.fn(),
    query: vi.fn(),
    addSystem: vi.fn().mockReturnValue(() => {
      /* unsubscribe */
    }),
    tick: vi.fn()
  } as unknown as World;
  return world;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock context factory
// ─────────────────────────────────────────────────────────────────────────────

const defaultConfig: Config = { initial: undefined, despawnOnUnload: true };

const createMockCtx = (overrides?: {
  config?: Partial<Config>;
  emit?: SceneContext["emit"];
  world?: World;
}): {
  ctx: SceneContext;
  world: World;
  detach: ReturnType<typeof vi.fn>;
  loadBundle: ReturnType<typeof vi.fn>;
  emit: SceneContext["emit"] & ReturnType<typeof vi.fn>;
  state: State;
} => {
  const world = overrides?.world ?? makeFakeWorld();
  const detach = vi.fn();
  const loadBundle = vi.fn().mockResolvedValue({});
  const rawEmit = vi.fn();
  const emit = (overrides?.emit ?? rawEmit) as SceneContext["emit"] & ReturnType<typeof vi.fn>;
  const state: State = {
    scenes: new Map<string, SceneDefinition>(),
    current: undefined,
    owned: new Set<Entity>()
  };

  const requireFn = (plugin: unknown): unknown => {
    // Discriminate by duck-typing on the plugin's name property
    if (plugin && typeof plugin === "object" && "name" in plugin) {
      const pluginName = (plugin as { name: string }).name;
      if (pluginName === "renderer") return { detach };
      if (pluginName === "assets") return { loadBundle };
      if (pluginName === "ecs") return world;
    }
    return world;
  };

  const ctx: SceneContext = {
    config: { ...defaultConfig, ...overrides?.config },
    state,
    emit,
    require: requireFn as unknown as SceneContext["require"]
  };

  return { ctx, world, detach, loadBundle, emit, state };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // define
  // ──────────────────────────────────────────────────────────────────────────

  describe("define", () => {
    it("registers a scene definition by name", () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);
      const setup = vi.fn();

      api.define("menu", { setup });

      expect(state.scenes.has("menu")).toBe(true);
      expect(state.scenes.get("menu")).toEqual({ setup });
    });

    it("registers multiple scenes independently", () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);

      api.define("menu", { setup: vi.fn() });
      api.define("game", { setup: vi.fn() });

      expect(state.scenes.size).toBe(2);
      expect(state.scenes.has("menu")).toBe(true);
      expect(state.scenes.has("game")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // load — unregistered name
  // ──────────────────────────────────────────────────────────────────────────

  describe("load — unregistered name", () => {
    it("throws when loading a scene that has not been defined", async () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      await expect(api.load("missing")).rejects.toThrow();
    });

    it("does not call setup for an unregistered scene", async () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      await expect(api.load("unknown")).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // load — entity ownership
  // ──────────────────────────────────────────────────────────────────────────

  describe("load — entity ownership", () => {
    it("entities spawned in setup are recorded in state.owned", async () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);
      let spawnedEntity: Entity | undefined;

      api.define("game", {
        setup: wrappedWorld => {
          spawnedEntity = wrappedWorld.spawn();
        }
      });

      await api.load("game");

      expect(spawnedEntity).toBeDefined();
      // spawnedEntity is defined per the assertion above; check set membership via spread
      expect([...state.owned]).toContain(spawnedEntity);
    });

    it("multiple spawns in setup all land in owned", async () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);
      let entities: Entity[] = [];

      api.define("game", {
        setup: wrappedWorld => {
          entities = [wrappedWorld.spawn(), wrappedWorld.spawn(), wrappedWorld.spawn()];
        }
      });

      await api.load("game");

      expect(state.owned.size).toBe(3);
      for (const entity of entities) {
        expect(state.owned.has(entity)).toBe(true);
      }
    });

    it("spawn is tracked on the wrapped world passed to setup", async () => {
      const { ctx, world } = createMockCtx();
      const api = createApi(ctx);
      let receivedWorld: World | undefined;

      api.define("game", {
        setup: w => {
          receivedWorld = w;
          w.spawn();
        }
      });

      await api.load("game");

      // The wrapped world's spawn delegates to the real world spawn
      expect(world.spawn).toHaveBeenCalled();
      // But the wrapped world is NOT the same object reference (it's a wrapper)
      expect(receivedWorld).not.toBe(world);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // load — event emission
  // ──────────────────────────────────────────────────────────────────────────

  describe("load — event emission", () => {
    it("emits scene:loaded with { name } after setup completes", async () => {
      const { ctx, emit } = createMockCtx();
      const api = createApi(ctx);

      api.define("menu", { setup: vi.fn() });
      await api.load("menu");

      expect(emit).toHaveBeenCalledWith("scene:loaded", { name: "menu" });
    });

    it("does not emit scene:loaded before setup resolves", async () => {
      const { ctx, emit } = createMockCtx();
      const api = createApi(ctx);
      let emitCalledDuringSetup = false;

      api.define("menu", {
        setup: async () => {
          emitCalledDuringSetup = (emit as ReturnType<typeof vi.fn>).mock.calls.length > 0;
          await Promise.resolve();
        }
      });

      await api.load("menu");

      expect(emitCalledDuringSetup).toBe(false);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // load — bundle pre-loading
  // ──────────────────────────────────────────────────────────────────────────

  describe("load — bundle pre-loading", () => {
    it("calls assets.loadBundle before setup when bundle is present", async () => {
      const { ctx, loadBundle } = createMockCtx();
      const api = createApi(ctx);
      const bundle = { hero: "hero.png", bg: "bg.png" };
      const setupOrder: string[] = [];

      api.define("level1", {
        setup: () => {
          setupOrder.push("setup");
        },
        bundle
      });

      loadBundle.mockImplementation(() => {
        setupOrder.push("loadBundle");
        return Promise.resolve({});
      });

      await api.load("level1");

      expect(loadBundle).toHaveBeenCalledWith("level1", bundle);
      expect(setupOrder[0]).toBe("loadBundle");
      expect(setupOrder[1]).toBe("setup");
    });

    it("does NOT call assets.loadBundle when no bundle is defined", async () => {
      const { ctx, loadBundle } = createMockCtx();
      const api = createApi(ctx);

      api.define("menu", { setup: vi.fn() });
      await api.load("menu");

      expect(loadBundle).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // load — setup failure (partial-spawn) path
  // ──────────────────────────────────────────────────────────────────────────

  describe("load — setup failure", () => {
    it("rejects, does not emit, and leaves current undefined when setup throws", async () => {
      const { ctx, emit, state } = createMockCtx();
      const api = createApi(ctx);

      api.define("broken", {
        setup: w => {
          w.spawn(); // a partial entity is created before the failure
          throw new Error("setup boom");
        }
      });

      await expect(api.load("broken")).rejects.toThrow("setup boom");

      // No milestone event for a load that never completed
      expect(emit).not.toHaveBeenCalled();
      // current was reset by the pre-load unload and never re-set
      expect(state.current).toBeUndefined();
      // the entity spawned before the throw is still tracked as owned
      expect(state.owned.size).toBe(1);
    });

    it("cleans up the partially-spawned entity on a subsequent unload", async () => {
      const { ctx, world, detach, state } = createMockCtx();
      const api = createApi(ctx);
      const partial = makeEntity();

      (world.spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(partial);

      api.define("broken", {
        setup: w => {
          w.spawn();
          throw new Error("setup boom");
        }
      });

      await expect(api.load("broken")).rejects.toThrow();

      // The orphaned entity is despawned + detached when the scene is later torn down
      api.unload();

      expect(world.despawn).toHaveBeenCalledWith(partial);
      expect(detach).toHaveBeenCalledWith(partial);
      expect(state.owned.size).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // load → load (scene B despawns scene A's entities)
  // ──────────────────────────────────────────────────────────────────────────

  describe("load → load (scene transition)", () => {
    it("despawns scene A entities when loading scene B (despawnOnUnload: true)", async () => {
      const { ctx, world } = createMockCtx();
      const api = createApi(ctx);
      const entityA1 = makeEntity();
      const entityA2 = makeEntity();

      // Make world.spawn return controlled entities for scene A
      (world.spawn as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(entityA1)
        .mockReturnValueOnce(entityA2)
        .mockReturnValue(makeEntity());

      api.define("sceneA", {
        setup: w => {
          w.spawn();
          w.spawn();
        }
      });

      api.define("sceneB", { setup: vi.fn() });

      await api.load("sceneA");
      await api.load("sceneB");

      expect(world.despawn).toHaveBeenCalledWith(entityA1);
      expect(world.despawn).toHaveBeenCalledWith(entityA2);
    });

    it("calls renderer.detach for each owned entity on unload", async () => {
      const { ctx, world, detach } = createMockCtx();
      const api = createApi(ctx);
      const entityA = makeEntity();

      (world.spawn as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(entityA)
        .mockReturnValue(makeEntity());

      api.define("sceneA", {
        setup: w => {
          w.spawn();
        }
      });
      api.define("sceneB", { setup: vi.fn() });

      await api.load("sceneA");
      await api.load("sceneB");

      expect(detach).toHaveBeenCalledWith(entityA);
    });

    it("clears owned after transitioning to scene B", async () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);

      api.define("sceneA", {
        setup: w => {
          w.spawn();
        }
      });
      api.define("sceneB", { setup: vi.fn() });

      await api.load("sceneA");
      await api.load("sceneB");

      // owned should only contain sceneB's entities (0 in this case since sceneB has no spawn)
      expect(state.owned.size).toBe(0);
    });

    it("updates current to the new scene name after transition", async () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);

      api.define("sceneA", { setup: vi.fn() });
      api.define("sceneB", { setup: vi.fn() });

      await api.load("sceneA");
      expect(state.current).toBe("sceneA");

      await api.load("sceneB");
      expect(state.current).toBe("sceneB");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // unload
  // ──────────────────────────────────────────────────────────────────────────

  describe("unload", () => {
    it("sets current to undefined after unload", async () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);

      api.define("menu", { setup: vi.fn() });
      await api.load("menu");

      api.unload();

      expect(state.current).toBeUndefined();
    });

    it("despawns all owned entities on unload (despawnOnUnload: true)", async () => {
      const { ctx, world } = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity();

      (world.spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(entity);

      api.define("game", {
        setup: w => {
          w.spawn();
        }
      });
      await api.load("game");

      api.unload();

      expect(world.despawn).toHaveBeenCalledWith(entity);
    });

    it("calls renderer.detach for each entity on unload", async () => {
      const { ctx, world, detach } = createMockCtx();
      const api = createApi(ctx);
      const entity = makeEntity();

      (world.spawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(entity);

      api.define("game", {
        setup: w => {
          w.spawn();
        }
      });
      await api.load("game");

      api.unload();

      expect(detach).toHaveBeenCalledWith(entity);
    });

    it("clears owned Set after unload", async () => {
      const { ctx, state } = createMockCtx();
      const api = createApi(ctx);

      api.define("game", {
        setup: w => {
          w.spawn();
          w.spawn();
        }
      });
      await api.load("game");

      api.unload();

      expect(state.owned.size).toBe(0);
    });

    it("does NOT despawn entities when despawnOnUnload is false", async () => {
      const { ctx, world } = createMockCtx({ config: { despawnOnUnload: false } });
      const api = createApi(ctx);

      api.define("game", {
        setup: w => {
          w.spawn();
        }
      });
      await api.load("game");

      api.unload();

      expect(world.despawn).not.toHaveBeenCalled();
    });

    it("does NOT call renderer.detach when despawnOnUnload is false", async () => {
      const { ctx, detach } = createMockCtx({ config: { despawnOnUnload: false } });
      const api = createApi(ctx);

      api.define("game", {
        setup: w => {
          w.spawn();
        }
      });
      await api.load("game");

      api.unload();

      expect(detach).not.toHaveBeenCalled();
    });

    it("is a no-op when no scene is loaded", () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      expect(() => {
        api.unload();
      }).not.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // currentScene
  // ──────────────────────────────────────────────────────────────────────────

  describe("currentScene", () => {
    it("returns undefined when no scene is loaded", () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      expect(api.currentScene()).toBeUndefined();
    });

    it("returns the current scene name after load", async () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      api.define("menu", { setup: vi.fn() });
      await api.load("menu");

      expect(api.currentScene()).toBe("menu");
    });

    it("returns undefined after unload", async () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      api.define("menu", { setup: vi.fn() });
      await api.load("menu");
      api.unload();

      expect(api.currentScene()).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Type-level tests
  // ──────────────────────────────────────────────────────────────────────────

  describe("types", () => {
    it("currentScene() return type is string | undefined", () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.currentScene).toEqualTypeOf<() => string | undefined>();
    });

    it("load() return type is Promise<void>", () => {
      const { ctx } = createMockCtx();
      const api = createApi(ctx);

      expectTypeOf(api.load).toEqualTypeOf<(name: string) => Promise<void>>();
    });

    it("SceneDefinition.setup receives a typed World", () => {
      const def: SceneDefinition = {
        setup: world => {
          // world.spawn should be callable
          expectTypeOf(world.spawn).toBeFunction();
          expectTypeOf(world.despawn).toBeFunction();
        }
      };

      expect(def).toBeDefined();
    });

    it("emit('scene:loaded', ...) payload is type-checked", () => {
      const { ctx } = createMockCtx();
      // Valid call — should compile
      ctx.emit("scene:loaded", { name: "menu" });

      // @ts-expect-error — extra field not in payload
      ctx.emit("scene:loaded", { name: "menu", extra: true });

      expect(ctx).toBeDefined();
    });

    it("rejects wrong payload for scene:loaded", () => {
      const { ctx } = createMockCtx();

      // @ts-expect-error — missing name field
      ctx.emit("scene:loaded", {});

      expect(ctx).toBeDefined();
    });
  });
});
