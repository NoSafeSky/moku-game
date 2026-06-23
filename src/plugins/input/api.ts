/**
 * @file input plugin — API factory.
 */
import type { Api, InputContext } from "./types";

/**
 * Creates the input plugin API surface.
 *
 * Returns a single `snapshot()` method that returns the current frame's
 * immutable InputSnapshot. The snapshot is stable within a frame — the
 * input-stage system replaces `state.snapshot` once per tick.
 *
 * @param ctx - Plugin context providing config and state.
 * @param ctx.config - Resolved input configuration (unused at API call time).
 * @param ctx.state - Input plugin state containing the current snapshot.
 * @param ctx.require - Kernel require (unused at API call time).
 * @returns The input API object with `snapshot()`.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * const snap = api.snapshot();
 * if (snap.justPressed("Space")) player.jump();
 * ```
 */
export const createApi = (ctx: InputContext): Api => ({
  /**
   * Returns the current frame's immutable input snapshot.
   *
   * @returns The stable InputSnapshot produced by the input-stage system.
   * @example
   * ```ts
   * const snap = app.input.snapshot();
   * if (snap.isDown("ArrowRight")) move(dt);
   * ```
   */
  snapshot: () => ctx.state.snapshot
});
