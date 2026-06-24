/**
 * @file assets plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial assets plugin state.
 *
 * The `loaded` Set tracks every alias that has been successfully loaded this
 * session. Pixi's internal asset cache is owned by the Pixi `Application` in the
 * renderer plugin, so this state records only the alias strings, not the textures.
 *
 * @param _ctx - Minimal context (unused beyond type-checking by the framework).
 * @param _ctx.global - Global plugin registry (unused by assets state).
 * @param _ctx.config - Resolved plugin configuration (unused by assets state).
 * @returns The initial assets plugin state with an empty `loaded` Set.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: { basePath: "", manifest: {}, throwOnError: true } });
 * state.loaded; // Set {}
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  loaded: new Set<string>()
});
