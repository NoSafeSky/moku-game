/**
 * @file input plugin — state factory.
 */
import type { Config, InputSnapshot, State } from "./types";

/**
 * Creates the initial input plugin state.
 *
 * All edge sets start empty, the pointer is at origin, and the initial
 * snapshot reflects the empty sets so reads before the first tick are safe.
 *
 * @param _ctx - Minimal context with global and config (unused — state has no
 *   config-derived fields at init time).
 * @param _ctx.global - Global plugin registry.
 * @param _ctx.config - Resolved plugin configuration.
 * @returns The mutable InputState with empty sets and a zero-origin pointer.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.down.size; // 0
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => {
  const down = new Set<string>();
  const pressed = new Set<string>();
  const released = new Set<string>();
  const pointer = { x: 0, y: 0, buttons: 0 };
  const wheel = { deltaX: 0, deltaY: 0 };

  const initialSnapshot: InputSnapshot = {
    /**
     * Returns true if the key is currently held.
     *
     * @param key - The key identifier string.
     * @returns True when the key is in the down set.
     * @example
     * ```ts
     * snap.isDown("Space"); // false initially
     * ```
     */
    isDown: (key: string) => down.has(key),

    /**
     * Returns true only on the frame the key first went down.
     *
     * @param key - The key identifier string.
     * @returns True only on the frame the key transitioned to down.
     * @example
     * ```ts
     * snap.justPressed("Space"); // false initially
     * ```
     */
    justPressed: (key: string) => pressed.has(key),

    /**
     * Returns true only on the frame the key went up.
     *
     * @param key - The key identifier string.
     * @returns True only on the frame the key transitioned to released.
     * @example
     * ```ts
     * snap.justReleased("Space"); // false initially
     * ```
     */
    justReleased: (key: string) => released.has(key),

    pointer,
    wheel
  };

  return {
    down,
    pressed,
    released,
    pointer,
    wheel,
    snapshot: initialSnapshot,
    listeners: []
  };
};
