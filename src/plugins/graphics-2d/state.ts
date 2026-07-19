/**
 * @file graphics-2d plugin — state factory.
 *
 * State is the two component tokens (defined at onStart), the per-entity view tracker, the
 * change-epoch watermark that gates the render-sync system, and the (Phase 2) pending-texture set
 * for sprites whose store-backed alias is still loading.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial graphics-2d state (no tokens, empty view tracker, `lastEpoch: -1` so the first
 * post-start tick always reconciles).
 *
 * @param _ctx - Minimal context with global and config. Unused; present for compatibility with
 *   the Moku `createState` signature — initial state does not depend on config.
 * @param _ctx.global - Global plugin registry (unused).
 * @param _ctx.config - Resolved plugin configuration (unused — Config is empty).
 * @returns Fresh graphics-2d state (unstarted, undefined tokens, empty `tracked` map, `lastEpoch: -1`,
 *   empty `pending` set).
 * @example
 * ```ts
 * const state = createState({ global: {}, config: {} });
 * state.lastEpoch; // -1
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  started: false,
  spriteToken: undefined,
  shapeToken: undefined,
  tracked: new Map(),
  lastEpoch: -1,
  pending: new Set()
});
