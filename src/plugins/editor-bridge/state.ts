/**
 * @file editor-bridge plugin — state factory.
 *
 * The bridge holds no dependency references — every API call resolves its deps via
 * `ctx.require(...)` at call time (the `reflection`/`scheduler` no-capture precedent). The only
 * state is the poll-on-epoch memoization cache that makes repeated `snapshot()` calls between
 * world writes cheap: `lastEpoch` seeded to `-1` and `entities`/`roots` seeded `undefined` so the
 * FIRST `snapshot()` call always (re)materializes the STRUCTURAL tree regardless of
 * `world.changeEpoch()`'s initial value. `roots` is structural (invalidated in lockstep with
 * `entities`), so it is seeded and invalidated together, never as an independent cache.
 */
import type { State } from "./types";

/**
 * Creates the initial editor-bridge plugin state — the memoization cache only.
 *
 * @returns The initial {@link State} — `{ lastEpoch: -1, entities: undefined, roots: undefined }`.
 * @example
 * ```ts
 * const state = createState();
 * state.lastEpoch; // -1
 * state.entities; // undefined
 * state.roots; // undefined
 * ```
 */
export const createState = (): State => ({ lastEpoch: -1, entities: undefined, roots: undefined });
