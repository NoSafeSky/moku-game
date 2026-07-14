/**
 * @file editor-bridge plugin — state factory.
 *
 * The bridge holds no dependency references — every API call resolves its deps via
 * `ctx.require(...)` at call time (the `reflection`/`scheduler` no-capture precedent). The only
 * state is the poll-on-epoch memoization cache that makes repeated `snapshot()` calls between
 * world writes cheap: `lastEpoch` seeded to `-1` and `entities` seeded `undefined` so the FIRST
 * `snapshot()` call always (re)materializes the entity tree regardless of `world.changeEpoch()`'s
 * initial value.
 */
import type { State } from "./types";

/**
 * Creates the initial editor-bridge plugin state — the memoization cache only.
 *
 * @returns The initial {@link State} — `{ lastEpoch: -1, entities: undefined }`.
 * @example
 * ```ts
 * const state = createState();
 * state.lastEpoch; // -1
 * state.entities; // undefined
 * ```
 */
export const createState = (): State => ({ lastEpoch: -1, entities: undefined });
