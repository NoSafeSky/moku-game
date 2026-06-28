/**
 * @file input plugin — API factory.
 */
import type { Api, InputContext } from "./types";

/**
 * Frozen alias map: friendly key names → canonical `KeyboardEvent.key` values.
 *
 * Covers the three aliases specified in Cycle 5:
 * - `"Space"` and `"Spacebar"` → `" "` (the real `.key` for the spacebar)
 * - `"Esc"` → `"Escape"`
 */
const KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  Space: " ",
  Spacebar: " ",
  Esc: "Escape"
});

/**
 * Normalises a friendly key alias to its canonical `KeyboardEvent.key` value.
 *
 * Known aliases (see {@link KEY_ALIASES}) are mapped to their canonical form;
 * all other keys pass through unchanged. This ensures that injection methods
 * and DOM handlers agree on the same key strings for the edge sets.
 *
 * Exported for unit-testing only — it is NOT part of the public {@link Api}.
 *
 * @param key - The raw key string to normalise (e.g. `"Space"`, `"Esc"`).
 * @returns The canonical `KeyboardEvent.key` string (e.g. `" "`, `"Escape"`).
 * @example
 * ```ts
 * normalizeKey("Space");    // " "
 * normalizeKey("Esc");      // "Escape"
 * normalizeKey("ArrowLeft"); // "ArrowLeft"
 * ```
 */
export const normalizeKey = (key: string): string => KEY_ALIASES[key] ?? key;

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
   * Cycle 5: key is normalised before touching the edge sets
   * (e.g. `"Space"` → `" "`, `"Esc"` → `"Escape"`).
   *
   * @param key - The key identifier to press (aliases accepted, e.g. `"Space"`).
   * @example
   * ```ts
   * app.input.keyDown("ArrowRight");
   * app.input.keyDown("Space"); // equivalent to keyDown(" ")
   * ```
   */
  keyDown: (key: string): void => {
    const canonical = normalizeKey(key);
    // Only flag the just-pressed edge on a genuine down transition (ignores repeats).
    if (!ctx.state.down.has(canonical)) ctx.state.pressed.add(canonical);
    ctx.state.down.add(canonical);
  },

  /**
   * Inject a key-up — mirrors the DOM keyup handler. Clears the held key and
   * records the just-released edge for the next snapshot.
   *
   * Cycle 5: key is normalised before touching the edge sets
   * (e.g. `"Space"` → `" "`, `"Esc"` → `"Escape"`).
   *
   * @param key - The key identifier to release (aliases accepted, e.g. `"Esc"`).
   * @example
   * ```ts
   * app.input.keyUp("ArrowRight");
   * app.input.keyUp("Esc"); // equivalent to keyUp("Escape")
   * ```
   */
  keyUp: (key: string): void => {
    const canonical = normalizeKey(key);
    ctx.state.down.delete(canonical);
    ctx.state.released.add(canonical);
  },

  /**
   * Inject a one-frame tap — flags both just-pressed and just-released for the
   * next snapshot without ever holding the key, so it cannot get stuck down.
   *
   * Cycle 5: key is normalised before touching the edge sets
   * (e.g. `"Space"` → `" "`, `"Esc"` → `"Escape"`).
   *
   * @param key - The key identifier to tap (aliases accepted, e.g. `"Space"`).
   * @example
   * ```ts
   * app.input.keyPress("Space"); // equivalent to keyPress(" ")
   * app.input.keyPress("Esc");   // equivalent to keyPress("Escape")
   * ```
   */
  keyPress: (key: string): void => {
    const canonical = normalizeKey(key);
    ctx.state.pressed.add(canonical);
    ctx.state.released.add(canonical);
  }
});
