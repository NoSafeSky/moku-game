/**
 * @file scheduler plugin — type definitions.
 */
import type { Stage, System } from "../ecs/types";

/** scheduler plugin configuration. */
export type Config = {
  /** If true, addSystem with an unknown stage throws; else logs+ignores. `@default true` */
  strictStages: boolean;
};

/** scheduler plugin state — none (registry lives in the ecs world). */
export type State = Record<never, never>;

/** scheduler plugin API. */
export type Api = {
  /** The fixed, ordered execution stages. */
  readonly stages: readonly Stage[];
  /** Register a system for a stage; returns an unsubscribe fn. Forwards to world.addSystem. */
  addSystem(stage: Stage, system: System): () => void;
  /** Advance one frame: forwards to world.tick(dt). */
  tick(dt: number): void;
};

export type { Stage, System, World } from "../ecs/types";
