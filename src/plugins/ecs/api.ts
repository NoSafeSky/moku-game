/**
 * @file ecs plugin — API factory.
 *
 * The ecs plugin API surface IS the World facade — `createApi` simply returns
 * `ctx.state.world`. No wrapper, no additional methods: `Api = World` (spec §API).
 */
import type { Api, State } from "./types";

/**
 * Creates the ecs plugin API by returning the World instance from state.
 *
 * The World facade (`app.ecs`) provides `defineComponent`, `defineTag`, `spawn`,
 * `despawn`, `isAlive`, `add`, `remove`, `has`, `get`, `set`, `query`, `addSystem`,
 * and `tick`. All structural mutations route through the command buffer during iteration.
 *
 * @param ctx - Plugin context providing access to `ctx.state.world`.
 * @param ctx.state - The ecs plugin state (holds the World instance).
 * @returns The World facade as the plugin API.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const Position = api.defineComponent(() => ({ x: 0, y: 0 }));
 * const entity = api.spawn(Position({ x: 10, y: 5 }));
 * ```
 */
export function createApi(ctx: { readonly state: State }): Api {
  return ctx.state.world;
}
