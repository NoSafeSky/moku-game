/**
 * @file scene plugin — API factory.
 *
 * Implements define/load/unload/currentScene with entity-ownership tracking.
 * The ownership crux: during a scene's setup, `world.spawn` is intercepted by
 * a thin wrapper so every spawned Entity is recorded in `state.owned`. On
 * unload (or when loading the next scene), owned entities are detached from
 * the renderer and then despawned from the ECS world.
 *
 * No onStart/onStop — scene owns no long-lived resource. Dependencies are
 * required lazily inside each API method (they are guaranteed started by then).
 */

import type { Texture } from "pixi.js";
import type { assetsPlugin } from "../assets";
import { assetsPlugin as assetsPluginReference } from "../assets";
import type { ecsPlugin } from "../ecs";
import { ecsPlugin as ecsPluginReference } from "../ecs";
import type { Entity, World } from "../ecs/types";
import type { rendererPlugin } from "../renderer";
import { rendererPlugin as rendererPluginReference } from "../renderer";
import type { Api, Config, Events, SceneDefinition, State } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Dependency API shapes (structural — only the methods this plugin calls)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal renderer API surface used by the scene plugin. */
type RendererApi = {
  /** Detach and dispose an entity's Pixi view. Idempotent. */
  detach(entity: Entity): void;
};

/** Minimal assets API surface used by the scene plugin. */
type AssetsApi = {
  /** Register and load a named bundle. Return value is awaited but not consumed by scene. */
  loadBundle(
    bundle: string,
    entries: Readonly<Record<string, string>>
  ): Promise<Record<string, Texture>>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural context type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural context type required by createApi.
 *
 * Only the fields the API factory actually accesses are included, so unit tests
 * can supply a minimal mock without wiring the full kernel. Mirrors the
 * AssetsContext / RendererContext pattern used across this framework.
 */
export type SceneContext = {
  /** Resolved scene plugin configuration. */
  readonly config: Readonly<Config>;
  /** Scene plugin mutable state (scenes map, current name, owned entity set). */
  readonly state: State;
  /**
   * Emit a framework event. Typed to the declared `scene:loaded` event only
   * so `createApi` cannot accidentally widen to unknown events.
   */
  emit: <K extends keyof Events>(event: K, payload: Events[K]) => void;
  /**
   * Require a dependency's API by plugin instance. Overloaded so callers
   * receive properly-typed returns.
   */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof assetsPlugin) => AssetsApi);
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a thin wrapper around the ECS world that intercepts `spawn` so every
 * entity created during a scene's `setup` is recorded in `owned`.
 *
 * All other World methods delegate to the real world unchanged. A plain object
 * wrapper is used (not a JS Proxy) to stay lint-safe and readable.
 *
 * @param world - The real ECS world from `ctx.require(ecsPlugin)`.
 * @param owned - The mutable Set to record spawned entities into.
 * @returns A World-shaped wrapper whose spawn records into `owned`.
 * @example
 * ```ts
 * const wrapped = makeTrackingWorld(world, state.owned);
 * await definition.setup(wrapped); // every spawn() is tracked
 * ```
 */
const makeTrackingWorld = (world: World, owned: Set<Entity>): World => ({
  // Intercept spawn — record returned entity into the ownership set
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  spawn: (...parts) => {
    const entity = world.spawn(...parts);
    owned.add(entity);
    return entity;
  },
  // Delegate all other methods to the real world unchanged
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  despawn: entity => world.despawn(entity),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  isAlive: entity => world.isAlive(entity),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  defineComponent: (create, opts) => world.defineComponent(create, opts),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  defineTag: opts => world.defineTag(opts),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  add: (entity, component, value) => world.add(entity, component, value),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  remove: (entity, component) => world.remove(entity, component),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  has: (entity, component) => world.has(entity, component),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  get: (entity, component) => world.get(entity, component),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  set: (entity, component, value) => world.set(entity, component, value),
  // query has 8 overloads — delegate via unknown cast to avoid overload-capture issues
  query: ((...args: unknown[]) =>
    (world.query as (...a: unknown[]) => unknown)(...args)) as World["query"],
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  addSystem: (stage, system) => world.addSystem(stage, system),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  tick: dt => world.tick(dt),
  // NEW (Cycle 4) — introspection delegations: forward the read-only facet so a
  // tracked scene `setup` (and any tooling reading the world during setup) sees the
  // whole live world, not a partial wrapper.
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  liveEntities: () => world.liveEntities(),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  entityCount: () => world.entityCount(),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  componentNames: () => world.componentNames(),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  componentsOf: entity => world.componentsOf(entity),
  // NEW (Cycle 5) — name→token resolver delegation: forward so tooling reading the
  // tracked world during setup can resolve components by name.
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  componentByName: name => world.componentByName(name),
  // NEW (Cycle 2) — resource delegations: forward the six world-resource methods
  // straight through so the tracked wrapper remains a complete `World` and a scene
  // `setup` can read/write resources (e.g. `world.resource(app.context.assets)`).
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  defineResource: create => world.defineResource(create),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  setResource: (resource, value) => world.setResource(resource, value),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  getResource: resource => world.getResource(resource),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  resource: resource => world.resource(resource),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  hasResource: resource => world.hasResource(resource),
  // eslint-disable-next-line jsdoc/require-jsdoc -- delegation property
  removeResource: resource => world.removeResource(resource)
});

// ─────────────────────────────────────────────────────────────────────────────
// API factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the scene plugin API surface.
 *
 * Implements `define`, `load`, `unload`, and `currentScene`. The ownership
 * pattern is the crux: during `load`, a thin `makeTrackingWorld` wrapper
 * intercepts `world.spawn` so every entity created in a scene's `setup` is
 * automatically recorded in `state.owned`. On `unload` (or when loading the
 * next scene), owned entities are detached from the renderer and despawned
 * from the ECS world, cleanly removing the prior scene.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved scene plugin configuration.
 * @param ctx.state - Plugin state holding scenes map, current name, owned set.
 * @param ctx.emit - Typed emit for `scene:loaded`.
 * @param ctx.require - Kernel require for ecs, renderer, and assets APIs.
 * @returns The scene plugin API object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.define("menu", { setup: (world) => { world.spawn(); } });
 * await api.load("menu"); // despawns previous, runs setup, emits scene:loaded
 * ```
 */
export const createApi = (ctx: SceneContext): Api => {
  /**
   * Despawn all entities owned by the current scene and detach their renderer
   * views, then clear the ownership set and reset current to undefined.
   * No-op when `config.despawnOnUnload` is false (ownership set still cleared).
   *
   * @example
   * ```ts
   * performUnload(); // idempotent — safe when owned set is empty
   * ```
   */
  const performUnload = (): void => {
    if (ctx.config.despawnOnUnload && ctx.state.owned.size > 0) {
      // Obtain dependency APIs (guaranteed started at this point)
      const renderer = ctx.require(rendererPluginReference);
      const world = ctx.require(ecsPluginReference);

      for (const entity of ctx.state.owned) {
        renderer.detach(entity);
        world.despawn(entity);
      }
    }

    ctx.state.owned.clear();
    ctx.state.current = undefined;
  };

  return {
    /**
     * Register a named scene definition. Subsequent calls to `load(name)` will
     * use this definition to run the scene's setup and track its entities.
     *
     * @param name - The unique scene identifier.
     * @param definition - Scene definition with `setup` (required) and optional `bundle`.
     * @example
     * ```ts
     * api.define("menu", { setup: (world) => { world.spawn(Player()); } });
     * ```
     */
    define(name: string, definition: SceneDefinition): void {
      ctx.state.scenes.set(name, definition);
    },

    /**
     * Load a named scene. Sequence:
     * 1. Unload the current scene (despawn owned entities, detach renderer views).
     * 2. If the scene has a `bundle`, pre-load it via `assets.loadBundle(name, bundle)`.
     * 3. Run `definition.setup(wrappedWorld)` — entities spawned here are tracked.
     * 4. Set `state.current = name` and emit `scene:loaded` with `{ name }`.
     *
     * @param name - The scene to load (must be previously defined via `define`).
     * @returns A Promise that resolves once setup and event emission are complete.
     * @throws {Error} If `name` has not been registered with `define`.
     * @example
     * ```ts
     * await api.load("level1");
     * ```
     */
    async load(name: string): Promise<void> {
      // Guard: scene must be registered before it can be loaded
      const definition = ctx.state.scenes.get(name);
      if (!definition) {
        throw new Error(
          `[game] scene.load("${name}") failed — scene is not defined.\n  Call scene.define("${name}", { setup }) before loading it.`
        );
      }

      // Step 1: unload the previous scene before starting the new one
      performUnload();

      // Step 2: pre-load the scene's asset bundle when one is declared
      if (definition.bundle) {
        const assets = ctx.require(assetsPluginReference);
        await assets.loadBundle(name, definition.bundle);
      }

      // Step 3: run setup with a tracking world so all spawned entities are owned
      const world = ctx.require(ecsPluginReference);
      const wrappedWorld = makeTrackingWorld(world, ctx.state.owned);
      await definition.setup(wrappedWorld);

      // Step 4: record the active scene and emit the coarse milestone event
      ctx.state.current = name;
      ctx.emit("scene:loaded", { name });
    },

    /**
     * Unload the current scene. When `config.despawnOnUnload` is true (default),
     * every owned entity has its renderer view detached and is then despawned
     * from the ECS world. The owned set is cleared and current is reset to
     * `undefined`. Safe to call when no scene is loaded.
     *
     * @example
     * ```ts
     * api.unload(); // despawns all owned entities, clears current
     * ```
     */
    unload(): void {
      performUnload();
    },

    /**
     * Return the name of the currently loaded scene, or `undefined` if no
     * scene is active (before the first load, or after unload).
     *
     * @returns The current scene name, or `undefined`.
     * @example
     * ```ts
     * api.currentScene(); // "menu" after load("menu"), undefined after unload()
     * ```
     */
    currentScene(): string | undefined {
      return ctx.state.current;
    },

    /**
     * Return the names of all registered scenes in registration order.
     * Reads `state.scenes.keys()` and materialises them into a fresh array.
     * Returns `[]` before any `define` call has been made.
     *
     * @returns A readonly array of registered scene names in insertion order.
     * @example
     * ```ts
     * api.define("menu", { setup });
     * api.define("game", { setup });
     * api.sceneNames(); // ["menu", "game"]
     * ```
     */
    sceneNames(): readonly string[] {
      return [...ctx.state.scenes.keys()];
    },

    /**
     * Return a readonly snapshot of the entity handles owned by the current
     * scene. Spreads `state.owned` into a new array so mutations to the
     * returned array cannot affect the ownership set. Returns `[]` after
     * `unload` (or before any `load`).
     *
     * @returns A readonly snapshot array of owned entity handles.
     * @example
     * ```ts
     * await api.load("game");
     * api.ownedEntities(); // [42, 43, 44] — handles spawned in setup
     * api.unload();
     * api.ownedEntities(); // []
     * ```
     */
    ownedEntities(): readonly Entity[] {
      return [...ctx.state.owned];
    }
  };
};
