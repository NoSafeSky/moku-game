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
  snapshot: () => ctx.state.snapshot,

  /**
   * Inject a key-down — mirrors the DOM keydown handler. The next input-stage
   * snapshot observes the held key (and the just-pressed edge if it was not
   * already down). Mutates live state directly between frames (not buffered).
   *
   * @param key - The key identifier to press.
   * @example
   * ```ts
   * app.input.keyDown("ArrowRight");
   * ```
   */
  keyDown: (key: string): void => {
    // Only flag the just-pressed edge on a genuine down transition (ignores repeats).
    if (!ctx.state.down.has(key)) ctx.state.pressed.add(key);
    ctx.state.down.add(key);
  },

  /**
   * Inject a key-up — mirrors the DOM keyup handler. Clears the held key and
   * records the just-released edge for the next snapshot.
   *
   * @param key - The key identifier to release.
   * @example
   * ```ts
   * app.input.keyUp("ArrowRight");
   * ```
   */
  keyUp: (key: string): void => {
    ctx.state.down.delete(key);
    ctx.state.released.add(key);
  },

  /**
   * Inject a one-frame tap — flags both just-pressed and just-released for the
   * next snapshot without ever holding the key, so it cannot get stuck down.
   *
   * @param key - The key identifier to tap.
   * @example
   * ```ts
   * app.input.keyPress("Space");
   * ```
   */
  keyPress: (key: string): void => {
    ctx.state.pressed.add(key);
    ctx.state.released.add(key);
  }
});
