/**
 * @file asset-store plugin — API factory skeleton.
 *
 * Returns the six-method `app["asset-store"]` surface; every method throws until the F1 build
 * wave implements it. The factory itself must NOT throw — `createApp` builds every plugin's api
 * eagerly at compose time, so a throwing factory would break framework composition.
 */
import type { Api } from "./types";

/**
 * Placeholder API method — throws until the F1 build wave implements it.
 *
 * @throws {Error} Always, until implemented.
 * @example
 * ```ts
 * notImplemented();
 * ```
 */
const notImplemented = (): never => {
  throw new Error("not implemented");
};

/**
 * Creates the asset-store plugin API surface (inert skeleton — methods throw until built).
 *
 * @param _ctx - Plugin context (config, state, emit, log — unused in skeleton).
 * @returns The {@link Api} object; every method throws "not implemented" until the F1 build wave.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * ```
 */
export function createApi(_ctx: unknown): Api {
  return {
    import: notImplemented,
    url: notImplemented,
    has: notImplemented,
    get: notImplemented,
    entries: notImplemented,
    remove: notImplemented
  };
}
