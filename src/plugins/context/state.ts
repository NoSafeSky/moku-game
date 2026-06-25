/**
 * @file context plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates initial context plugin state (none — empty record).
 *
 * @param _ctx - Minimal context with global and config.
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The empty state object.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { bindGameContext: true } });
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {};
}
