/**
 * @file scheduler plugin — state factory.
 *
 * The scheduler owns no runtime state. All system registry data lives
 * inside the ecs World. `createState` returns an empty record.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial scheduler plugin state.
 *
 * The scheduler delegates all storage to the ecs world via `ctx.require`,
 * so its own state is an empty record.
 *
 * @param _ctx - Minimal context (global + config). Unused; present for
 *   compatibility with the Moku `createState` signature.
 * @param _ctx.global - Global plugin registry (unused).
 * @param _ctx.config - Resolved plugin configuration (unused).
 * @returns An empty state record.
 * @example
 * ```ts
 * const state = createState(ctx);
 * // => an empty record (Record<never, never>)
 * ```
 */
export const createState = (_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State => ({
  /* no scheduler state — the system registry lives in the ecs world */
});
