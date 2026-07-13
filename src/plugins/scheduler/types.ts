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
  /**
   * Gate which stages `tick` runs; forwards to `world.setActiveStages`. `undefined` (the default
   * + sentinel) runs all stages. `editor-runtime` sets `["input","sync","render"]` for edit mode
   * (gates OFF `update`/`physics`) and `undefined` for play.
   */
  setActiveStages(stages: readonly Stage[] | undefined): void;
  /** The stages currently active for `tick`, or `undefined` for all. Forwards to `world.activeStages`. */
  activeStages(): readonly Stage[] | undefined;
};

export type { Stage, System, World } from "../ecs/types";
