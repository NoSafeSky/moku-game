/**
 * @file editor-history plugin — pure stack helpers (no kernel).
 *
 * Plain functions over `State`/`Config` so `api.ts` and `handlers.ts` share ONE
 * definition and unit tests need no kernel (no mock ctx, no `createApp`).
 */
import type { Command } from "../commands/types";
import type { Config, FieldDiff, HistoryEntry, Mutation, State } from "./types";

/**
 * Evicts the oldest undo entries past `config.maxDepth`, clamped to a minimum of 1.
 *
 * @param state - The history state (mutated in place).
 * @param config - The plugin config, read for `maxDepth`.
 * @example
 * ```ts
 * evictExcess(state, config); // shifts the oldest entries off state.undo while over cap
 * ```
 */
function evictExcess(state: State, config: Readonly<Config>): void {
  const cap = Math.max(1, config.maxDepth);
  while (state.undo.length > cap) state.undo.shift();
}

/**
 * Appends a step to the undo stack, clears the redo stack (a fresh edit invalidates
 * the redo branch), and evicts the oldest undo entry past `config.maxDepth`.
 *
 * @param state - The history state (mutated in place).
 * @param config - The plugin config, read for `maxDepth`.
 * @param entry - The step to push.
 * @example
 * ```ts
 * pushEntry(state, config, { mutations: [mutation] });
 * ```
 */
export function pushEntry(state: State, config: Readonly<Config>, entry: HistoryEntry): void {
  state.redo.length = 0;
  state.undo.push(entry);
  evictExcess(state, config);
}

/**
 * Pushes a step back onto the undo stack (with the same eviction cap as
 * {@link pushEntry}) WITHOUT touching the redo stack. Used only by `redo()`: the
 * entry being pushed was just popped off `redo`, so clearing `redo` here would
 * wrongly drop any deeper redo entries the user has not yet replayed.
 *
 * @param state - The history state (mutated in place).
 * @param config - The plugin config, read for `maxDepth`.
 * @param entry - The step to push back onto undo.
 * @example
 * ```ts
 * pushUndoAfterRedo(state, config, entry); // redo() pushing a redone step back
 * ```
 */
export function pushUndoAfterRedo(
  state: State,
  config: Readonly<Config>,
  entry: HistoryEntry
): void {
  state.undo.push(entry);
  evictExcess(state, config);
}

/**
 * Builds the coalescing key for a `setField` mutation: mutations sharing a key
 * merge into one in {@link coalesce}.
 *
 * @param command - A `setField`-kind command whose id/component/field addresses the target.
 * @returns A string key unique to `(editorId, component, field)`.
 * @example
 * ```ts
 * keyOf({ kind: "setField", id, component: "Position", field: "x", value: 1 }); // "1:Position:x"
 * ```
 */
function keyOf(command: Extract<Command, { kind: "setField" }>): string {
  return `${command.id}:${command.component}:${command.field}`;
}

/**
 * Collapses buffered gesture mutations: same-key `setField` mutations merge into
 * ONE — the first mutation's `inverse` (gesture-start `old`) paired with the last
 * mutation's `command` (gesture-end `new`) — while non-`setField` mutations, and
 * every distinct `setField` key, are kept in first-appearance order.
 *
 * @param mutations - The buffered gesture mutations, in application order.
 * @returns The coalesced mutations, in first-appearance order.
 * @example
 * ```ts
 * coalesce(gestureMutations); // a 50-write drag on one field -> one Mutation
 * ```
 */
export function coalesce(mutations: readonly Mutation[]): readonly Mutation[] {
  const result: Mutation[] = [];
  const indexByKey = new Map<string, number>();

  for (const mutation of mutations) {
    if (mutation.command.kind !== "setField" || mutation.inverse.kind !== "setField") {
      result.push(mutation);
      continue;
    }

    const key = keyOf(mutation.command);
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(mutation);
      continue;
    }

    const first = result[existingIndex];
    if (first) result[existingIndex] = { command: mutation.command, inverse: first.inverse };
  }

  return result;
}

/**
 * Empties both stacks and drops any open gesture. Shared by the public `clear()`
 * API method and the `commands:restored` hook.
 *
 * @param state - The history state (mutated in place).
 * @example
 * ```ts
 * clearHistory(state);
 * ```
 */
export function clearHistory(state: State): void {
  state.undo.length = 0;
  state.redo.length = 0;
  state.gesture = undefined;
  state.gestureActive = false;
}

/**
 * Reads a `setField` mutation as a {@link FieldDiff} (inspection/tests); `undefined`
 * for a structural mutation (`spawn`/`despawn`/`addComponent`/`removeComponent`).
 *
 * @param mutation - The mutation to project.
 * @returns The field diff, or `undefined` when `mutation` is not a `setField` pair.
 * @example
 * ```ts
 * fieldDiffOf(mutation); // { editorId, component, field, old, new } | undefined
 * ```
 */
export function fieldDiffOf(mutation: Mutation): FieldDiff | undefined {
  if (mutation.command.kind !== "setField" || mutation.inverse.kind !== "setField") {
    return undefined;
  }

  return {
    editorId: mutation.command.id,
    component: mutation.command.component,
    field: mutation.command.field,
    old: mutation.inverse.value,
    new: mutation.command.value
  };
}
