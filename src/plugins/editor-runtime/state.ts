/**
 * @file editor-runtime plugin — state factory.
 *
 * Creates the initial mutable editor-runtime state: seeded in author (`"edit"`) mode, no
 * pre-play snapshot, and `started: false` (the API's before-start guard no-ops every mutator
 * until `onStart` applies the initial stage gate and flips this flag).
 */
import type { State } from "./types";

/**
 * Creates the initial editor-runtime plugin state.
 *
 * @returns The initial {@link State} — `{ mode: "edit", preplaySnapshot: undefined, started: false }`.
 * @example
 * ```ts
 * const state = createState();
 * state.mode; // "edit"
 * state.preplaySnapshot; // undefined
 * state.started; // false
 * ```
 */
export const createState = (): State => ({
  mode: "edit",
  preplaySnapshot: undefined,
  started: false
});
