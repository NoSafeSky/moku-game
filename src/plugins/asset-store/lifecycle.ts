/**
 * @file asset-store plugin — onStart / onStop lifecycle skeleton.
 *
 * start (F1): open the backend + list() persisted records + URL.createObjectURL each into
 *        state.urls/meta (re-mint session URLs so imported aliases survive a reload).
 * stop (F1):  URL.revokeObjectURL every minted URL + clear maps + backend.close() (owned resources).
 *        onStop receives only the teardown context ({ global }) — NOT state — so the F1 build wave
 *        reaches the live urls/backend via a module registry keyed on ctx.global (audio's pattern).
 *
 * Skeleton: both are inert no-ops so the framework starts/stops cleanly; the F1 wave adds the real
 * (async) resource work.
 */
import type { State } from "./types";

/**
 * Opens the backend and re-mints blob: URLs for every persisted asset (inert no-op in the skeleton).
 *
 * @param _ctx - Plugin context (state, log — unused in skeleton).
 * @param _ctx.state - The asset-store plugin state.
 * @example
 * ```ts
 * start(ctx);
 * ```
 */
export function start(_ctx: { readonly state: State }): void {
  // F1 build wave: open the backend + re-mint blob: URLs into state.urls/meta.
}

/**
 * Revokes every minted blob: URL and closes the backend connection (inert no-op in the skeleton).
 *
 * @param _ctx - Teardown context providing only the global registry (no state).
 * @param _ctx.global - Global plugin registry (key for the live-store module registry).
 * @example
 * ```ts
 * stop(ctx);
 * ```
 */
export function stop(_ctx: { readonly global: object }): void {
  // F1 build wave: revoke minted URLs + clear maps + close the backend.
}
