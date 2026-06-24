/**
 * @file scene plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial scene plugin state.
 *
 * Produces an empty scene registry, no active scene, and an empty owned-entity
 * Set. The scenes Map and owned Set are held by reference so the API can mutate
 * them in-place; State declares them `readonly` to prevent reassignment.
 *
 * @param _ctx - Minimal context (unused beyond type-checking by the framework).
 * @param _ctx.global - Global plugin registry (unused by scene state).
 * @param _ctx.config - Resolved plugin configuration (unused by scene state).
 * @returns The initial scene plugin state.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { initial: undefined, despawnOnUnload: true } });
 * state.scenes; // Map {}
 * state.current; // undefined
 * state.owned;   // Set {}
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  scenes: new Map(),
  current: undefined,
  owned: new Set()
});
