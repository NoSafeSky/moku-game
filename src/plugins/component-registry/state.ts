/**
 * @file component-registry plugin — state factory.
 *
 * The registry owns exactly one runtime structure: the catalog map. It is created empty and
 * populated at runtime by domain plugins' `register` calls — never from config.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial component-registry state (an empty catalog map, populated at runtime by
 * domain plugins' `register` calls).
 *
 * @param _ctx - Minimal context with global and config. Unused; present for compatibility with
 *   the Moku `createState` signature — the catalog never derives from config.
 * @param _ctx.global - Global plugin registry (unused).
 * @param _ctx.config - Resolved plugin configuration (unused — Config is empty).
 * @returns Fresh component-registry state with an empty `catalog` map.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: {} });
 * state.catalog.size; // 0
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  catalog: new Map()
});
