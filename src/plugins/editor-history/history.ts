/**
 * @file editor-history plugin — pure stack helpers skeleton (no kernel).
 */
import type { Config, FieldDiff, HistoryEntry, Mutation, State } from "./types";

/**
 * Appends a step, clears redo (a new edit invalidates the redo branch), and evicts oldest past the cap.
 *
 * @param _state - The history state.
 * @param _config - The plugin config (for `maxDepth`).
 * @param _entry - The step to push.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * pushEntry(state, config, { mutations: [mutation] });
 * ```
 */
export function pushEntry(_state: State, _config: Readonly<Config>, _entry: HistoryEntry): void {
  throw new Error("not implemented");
}

/**
 * Collapses buffered gesture mutations: same-key setFields → first-`old` → last-`new`; others kept in order.
 *
 * @param _mutations - The buffered gesture mutations.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * coalesce(gestureMutations);
 * ```
 */
export function coalesce(_mutations: readonly Mutation[]): readonly Mutation[] {
  throw new Error("not implemented");
}

/**
 * Empties both stacks and drops any open gesture. Shared by `clear()` and the `commands:restored` hook.
 *
 * @param _state - The history state.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * clearHistory(state);
 * ```
 */
export function clearHistory(_state: State): void {
  throw new Error("not implemented");
}

/**
 * Reads a `setField` mutation as a `FieldDiff` (inspection/tests); `undefined` for structural mutations.
 *
 * @param _mutation - The mutation to project.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * fieldDiffOf(mutation);
 * ```
 */
export function fieldDiffOf(_mutation: Mutation): FieldDiff | undefined {
  throw new Error("not implemented");
}
