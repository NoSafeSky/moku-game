/**
 * @file vfx plugin — state factory.
 *
 * Creates the initial mutable vfx state. Component tokens are absent until
 * onStart defines them on the ECS world (and captures the renderer's Transform);
 * `trauma`/`particleCount` start at zero; `views` holds only the vfx-owned
 * floating-text handles.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial vfx plugin state.
 *
 * @param _ctx - Minimal context providing global registry and resolved config.
 * @param _ctx.global - Global plugin registry (unused; required by the kernel).
 * @param _ctx.config - Resolved vfx configuration (unused at creation; defaults apply in onStart).
 * @returns The initial vfx state with no tokens, empty views, and zeroed counters.
 * @example
 * ```ts
 * const state = createState({ global: {}, config: defaultConfig });
 * state.trauma;        // 0
 * state.particleCount; // 0
 * state.views;         // Map {}
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  transform: undefined,
  Emitter: undefined,
  Particle: undefined,
  Pop: undefined,
  Flash: undefined,
  FloatingText: undefined,
  views: new Map(),
  trauma: 0,
  particleCount: 0
});
