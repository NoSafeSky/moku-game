/**
 * @file context plugin — API factory.
 */
import { Assets, GameContext } from "./resources";
import type { Api, Config } from "./types";

/**
 * Creates the context plugin API surface — the well-known resource tokens. The tokens are
 * fixed-key module consts, so the API is static (valid before start); the context plugin's
 * onStart binds their VALUES onto the ECS world.
 *
 * @param _ctx - Plugin context (unused — the API is the static token set).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The context API: the Assets + GameContext resource tokens.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * world.resource(api.assets); // the assets API, once bound at start
 * ```
 */
export function createApi(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): Api {
  return { assets: Assets, game: GameContext };
}
