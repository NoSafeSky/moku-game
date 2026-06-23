/**
 * @file scheduler plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial scheduler plugin state.
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
