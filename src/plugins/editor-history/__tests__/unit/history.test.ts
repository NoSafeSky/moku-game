/**
 * @file editor-history plugin — pure stack helpers unit tests.
 *
 * Drives `pushEntry` / `pushUndoAfterRedo` / `coalesce` / `clearHistory` / `fieldDiffOf`
 * with hand-built `State`/`Config`/`Mutation` values — no kernel, no mock ctx.
 */
import { describe, expect, it } from "vitest";
import { clearHistory, coalesce, fieldDiffOf, pushEntry, pushUndoAfterRedo } from "../../history";
import type { Config, HistoryEntry, Mutation, State } from "../../types";
import { asEditorId } from "../fake-commands";

const makeState = (): State => ({
  undo: [],
  redo: [],
  gesture: undefined,
  gestureActive: false
});

const setFieldMutation = (
  id: number,
  component: string,
  field: string,
  oldValue: unknown,
  newValue: unknown
): Mutation => ({
  command: { kind: "setField", id: asEditorId(id), component, field, value: newValue },
  inverse: { kind: "setField", id: asEditorId(id), component, field, value: oldValue }
});

const spawnMutation = (id: number): Mutation => ({
  command: { kind: "spawn", components: {}, id: asEditorId(id) },
  inverse: { kind: "despawn", id: asEditorId(id) }
});

// ─────────────────────────────────────────────────────────────────────────────
// pushEntry
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history pushEntry", () => {
  it("appends a step to undo and clears the redo stack", () => {
    const state = makeState();
    state.redo.push({ mutations: [spawnMutation(9)] });
    const config: Config = { maxDepth: 100 };
    const entry: HistoryEntry = { mutations: [spawnMutation(1)] };

    pushEntry(state, config, entry);

    expect(state.undo).toEqual([entry]);
    expect(state.redo).toEqual([]);
  });

  it("evicts the oldest entry once undo.length exceeds maxDepth", () => {
    const state = makeState();
    const config: Config = { maxDepth: 3 };
    const entries: HistoryEntry[] = [1, 2, 3, 4].map(id => ({ mutations: [spawnMutation(id)] }));

    for (const entry of entries) pushEntry(state, config, entry);

    expect(state.undo).toHaveLength(3);
    expect(state.undo).toEqual([entries[1], entries[2], entries[3]]);
  });

  it("clamps a maxDepth < 1 to 1", () => {
    const state = makeState();
    const config: Config = { maxDepth: 0 };

    pushEntry(state, config, { mutations: [spawnMutation(1)] });
    pushEntry(state, config, { mutations: [spawnMutation(2)] });

    expect(state.undo).toHaveLength(1);
    expect(state.undo[0]).toEqual({ mutations: [spawnMutation(2)] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pushUndoAfterRedo
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history pushUndoAfterRedo", () => {
  it("pushes onto undo with eviction, without touching redo", () => {
    const state = makeState();
    state.redo.push({ mutations: [spawnMutation(9)] });
    const config: Config = { maxDepth: 100 };

    pushUndoAfterRedo(state, config, { mutations: [spawnMutation(1)] });

    expect(state.undo).toHaveLength(1);
    expect(state.redo).toHaveLength(1);
  });

  it("still evicts the oldest entry past maxDepth", () => {
    const state = makeState();
    const config: Config = { maxDepth: 1 };

    pushUndoAfterRedo(state, config, { mutations: [spawnMutation(1)] });
    pushUndoAfterRedo(state, config, { mutations: [spawnMutation(2)] });

    expect(state.undo).toHaveLength(1);
    expect(state.undo[0]).toEqual({ mutations: [spawnMutation(2)] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// coalesce
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history coalesce", () => {
  it("returns an empty array for an empty buffer", () => {
    expect(coalesce([])).toEqual([]);
  });

  it("collapses same-key setField mutations into one: first old, last new", () => {
    const mutations = [
      setFieldMutation(1, "Position", "x", 0, 1),
      setFieldMutation(1, "Position", "x", 1, 2),
      setFieldMutation(1, "Position", "x", 2, 3)
    ];

    const result = coalesce(mutations);

    expect(result).toEqual([setFieldMutation(1, "Position", "x", 0, 3)]);
  });

  it("coalesces two different fields into two mutations", () => {
    const mutations = [
      setFieldMutation(1, "Position", "x", 0, 1),
      setFieldMutation(1, "Position", "y", 10, 11),
      setFieldMutation(1, "Position", "x", 1, 2)
    ];

    const result = coalesce(mutations);

    expect(result).toEqual([
      setFieldMutation(1, "Position", "x", 0, 2),
      setFieldMutation(1, "Position", "y", 10, 11)
    ]);
  });

  it("preserves an interleaved non-setField mutation in order", () => {
    const mutations = [
      setFieldMutation(1, "Position", "x", 0, 1),
      spawnMutation(2),
      setFieldMutation(1, "Position", "x", 1, 2)
    ];

    const result = coalesce(mutations);

    expect(result).toEqual([setFieldMutation(1, "Position", "x", 0, 2), spawnMutation(2)]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearHistory
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history clearHistory", () => {
  it("empties both stacks and resets the gesture fields", () => {
    const state = makeState();
    state.undo.push({ mutations: [spawnMutation(1)] });
    state.redo.push({ mutations: [spawnMutation(2)] });
    state.gesture = [spawnMutation(3)];
    state.gestureActive = true;

    clearHistory(state);

    expect(state.undo).toEqual([]);
    expect(state.redo).toEqual([]);
    expect(state.gesture).toBeUndefined();
    expect(state.gestureActive).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fieldDiffOf
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history fieldDiffOf", () => {
  it("maps a setField mutation to a FieldDiff", () => {
    const mutation = setFieldMutation(1, "Position", "x", 0, 5);

    expect(fieldDiffOf(mutation)).toEqual({
      editorId: asEditorId(1),
      component: "Position",
      field: "x",
      old: 0,
      new: 5
    });
  });

  it("returns undefined for a spawn/despawn mutation", () => {
    expect(fieldDiffOf(spawnMutation(1))).toBeUndefined();
  });
});
