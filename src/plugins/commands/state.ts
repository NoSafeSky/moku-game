/**
 * @file commands plugin — state factory.
 *
 * The two EditorId maps (`byId`/`byEntity`), the monotonic mint counter, the
 * optional injected rich validator, and the one-shot `maxIdWarn` latch. All
 * live in-memory; commands owns no external resource.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial commands plugin state.
 *
 * `nextId` starts at 1 (never 0, so a falsy check never masks a valid id).
 * Both id maps start empty; the rich validator starts unset (structural
 * validation only); `warned` starts false so the `maxIdWarn` notice can fire
 * at most once per session.
 *
 * @param _ctx - Minimal context with global and config (unused — state has no config deps).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The initial {@link State}.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { maxIdWarn: 100000 } });
 * // → { byId: Map(0), byEntity: Map(0), nextId: 1, validate: undefined, warned: false }
 * ```
 */
export function createState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    byId: new Map(),
    byEntity: new Map(),
    nextId: 1,
    validate: undefined,
    warned: false
  };
}
