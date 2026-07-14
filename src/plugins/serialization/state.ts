/**
 * @file serialization plugin — state factory.
 *
 * Tiny in-memory bookkeeping only — the name/version of the most recently (de)serialized or
 * saved scene. No external resource: persistence lives in `storage`, and ECS data lives in the
 * world + `commands`' id maps.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial serialization plugin state.
 *
 * `currentName` starts `undefined` ("no scene yet" — a fresh `serialize()` then falls back to
 * `"untitled"`); `currentVersion` seeds from `config.version` so a consumer that never saves or
 * loads still reports a sensible "live" scene version.
 *
 * @param ctx - Minimal context with global and config.
 * @param ctx.global - Global plugin registry (unused — state has no cross-plugin deps).
 * @param ctx.config - Resolved plugin configuration.
 * @returns The initial {@link State}.
 * @example
 * ```ts
 * const state = createState({
 *   global: {},
 *   config: { storageKeyPrefix: "scene:", version: 1, migrations: {} }
 * });
 * // → { currentName: undefined, currentVersion: 1 }
 * ```
 */
export function createState(ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    currentName: undefined,
    currentVersion: ctx.config.version
  };
}
