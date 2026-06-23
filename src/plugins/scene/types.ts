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
  /** Currently loaded scene name, or null. */
  current: string | null;
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
  /** The currently loaded scene name, or null. */
  currentScene(): string | null;
};
