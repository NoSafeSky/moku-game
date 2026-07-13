/**
 * @file reflection plugin — state factory.
 *
 * The reflection plugin owns two plain maps: registered typed schemas and a memoized inference
 * cache, both keyed by component name. No other runtime resource is held.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial reflection plugin state: two empty maps for registered schemas and
 * memoized inference results.
 *
 * @param _ctx - Minimal context with global and config. Unused; present for compatibility with
 *   the Moku `createState` signature — reflection's state does not depend on config.
 * @param _ctx.global - Global plugin registry (unused).
 * @param _ctx.config - Resolved plugin configuration (unused).
 * @returns Fresh reflection plugin state with empty `schemas` and `inferred` maps.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { humanizeLabels: true } });
 * state.schemas.size; // 0
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return { schemas: new Map(), inferred: new Map() };
}
