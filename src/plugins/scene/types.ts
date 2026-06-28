/**
 * @file scene plugin — type definitions.
 */
import type { Entity, World } from "../ecs/types";

/** scene plugin event contract. */
export type Events = {
  /** Emitted after a scene's setup completes. */
  "scene:loaded": { name: string };
};

/** A registered scene definition. */
export type SceneDefinition = {
  /** Spawns the scene's entities; may load a bundle first. */
  setup: (world: World) => void | Promise<void>;
  /** Optional asset bundle (alias→url) loaded before setup. */
  bundle?: Readonly<Record<string, string>>;
};

/** scene plugin configuration. */
export type Config = {
  /** Scene to load on start, or undefined for none. `@default undefined` */
  initial: string | undefined;
  /** Despawn a scene's entities on unload. `@default true` */
  despawnOnUnload: boolean;
};

/** scene plugin state. */
export type State = {
  /** Registered scenes by name. */
  readonly scenes: Map<string, SceneDefinition>;
  /** Currently loaded scene name, or undefined. */
  current: string | undefined;
  /** Entities created by the current scene. */
  readonly owned: Set<Entity>;
};

/** scene plugin API. */
export type Api = {
  /** Register a named scene. */
  define(name: string, definition: SceneDefinition): void;
  /** Unload current, load `name` (pre-loading its bundle), run setup, emit scene:loaded. */
  load(name: string): Promise<void>;
  /** Unload the current scene. */
  unload(): void;
  /** The currently loaded scene name, or undefined. */
  currentScene(): string | undefined;
  /**
   * Return the names of all registered scenes in registration order.
   * Equivalent to `[...state.scenes.keys()]`. Returns `[]` before any `define`.
   *
   * @returns A readonly array of registered scene names.
   * @example
   * ```ts
   * api.define("menu", { setup });
   * api.define("game", { setup });
   * api.sceneNames(); // ["menu", "game"]
   * ```
   */
  sceneNames(): readonly string[];
  /**
   * Return a readonly snapshot of the entity handles owned by the current scene.
   * Equivalent to `[...state.owned]`. Returns `[]` after `unload`.
   * Mutating the returned array does NOT affect `state.owned`.
   *
   * @returns A readonly snapshot array of owned entity handles.
   * @example
   * ```ts
   * await api.load("game");
   * api.ownedEntities(); // [42, 43, 44] (entity handles spawned in setup)
   * api.unload();
   * api.ownedEntities(); // []
   * ```
   */
  ownedEntities(): readonly Entity[];
};
