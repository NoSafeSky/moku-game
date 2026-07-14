/**
 * @file editor-history plugin — createApi unit tests.
 *
 * Drives `createApi` against a fake `commands` API (`../fake-commands`), covering
 * applyTracked/undo/redo record-and-replay, gesture coalescing, ring-buffer
 * eviction through the public surface, and `clear()`. The real `commands` plugin
 * is never imported — only its `Command`/`CommandResult` types.
 */
import { describe, expect, it } from "vitest";
import type { EditorHistoryApiContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";
import { asEditorId, fieldOf, makeFakeCommands, makeLog } from "../fake-commands";

const defaultConfig: Config = { maxDepth: 100 };

/** Build a fresh editor-history api + ctx wired to a fake `commands` double. */
const makeApi = (configOverrides?: Partial<Config>) => {
  const config: Config = { ...defaultConfig, ...configOverrides };
  const state = createState({ global: {}, config });
  const log = makeLog();
  const commands = makeFakeCommands();
  const ctx: EditorHistoryApiContext = {
    config,
    state,
    log,
    require: () => commands
  };
  return { api: createApi(ctx), ctx, state, log, commands };
};

const setField = (id: number, field: string, value: number) => ({
  kind: "setField" as const,
  id: asEditorId(id),
  component: "Position",
  field,
  value
});

// ─────────────────────────────────────────────────────────────────────────────
// applyTracked
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history applyTracked", () => {
  it("on ok pushes one step, returns the result, and applies via commands.apply", () => {
    const { api, commands } = makeApi();

    const result = api.applyTracked(setField(1, "x", 5));

    expect(result.ok).toBe(true);
    expect(api.canUndo()).toBe(true);
    expect(commands.apply).toHaveBeenCalledTimes(1);
    expect(commands.applyRaw).not.toHaveBeenCalled();
  });

  it("records the step synchronously — canUndo() is true immediately, no tick needed", () => {
    const { api } = makeApi();

    expect(api.canUndo()).toBe(false);
    api.applyTracked(setField(1, "x", 5));
    expect(api.canUndo()).toBe(true);
  });

  it("on a rejected command records nothing and returns the failure", () => {
    const { api, state, commands } = makeApi();
    commands.rejectNextApply(true);

    const result = api.applyTracked(setField(1, "x", 5));

    expect(result.ok).toBe(false);
    expect(state.undo).toHaveLength(0);
    expect(api.canUndo()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// undo / redo — record-and-replay round trip
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history undo/redo", () => {
  it("a round-trip applyTracked -> undo -> redo leaves the model where forward left it", () => {
    const { api, commands } = makeApi();
    const id = asEditorId(1);
    commands.fields.set(commands.fieldKey(id, "Position", "x"), 0);

    api.applyTracked(setField(1, "x", 5));
    expect(commands.fields.get(commands.fieldKey(id, "Position", "x"))).toBe(5);

    expect(api.undo()).toBe(true);
    expect(commands.fields.get(commands.fieldKey(id, "Position", "x"))).toBe(0);
    expect(api.canRedo()).toBe(true);

    expect(api.redo()).toBe(true);
    expect(commands.fields.get(commands.fieldKey(id, "Position", "x"))).toBe(5);
  });

  it("undo replays via commands.applyRaw, never commands.apply (no re-record)", () => {
    const { api, commands } = makeApi();
    api.applyTracked(setField(1, "x", 5));
    commands.apply.mockClear();

    api.undo();

    expect(commands.applyRaw).toHaveBeenCalledTimes(1);
    expect(commands.apply).not.toHaveBeenCalled();
  });

  it("undo replays a multi-mutation step's inverses in reverse order", () => {
    const { api, commands } = makeApi();
    api.beginGesture();
    api.applyTracked(setField(1, "x", 1));
    api.applyTracked(setField(1, "y", 2));
    api.endGesture();
    commands.applyRawCalls.length = 0;

    api.undo();

    expect(commands.applyRawCalls.map(command => fieldOf(command))).toEqual(["y", "x"]);
  });

  it("undo/redo on an empty stack return false and call no applyRaw", () => {
    const { api, commands } = makeApi();

    expect(api.undo()).toBe(false);
    expect(api.redo()).toBe(false);
    expect(commands.applyRaw).not.toHaveBeenCalled();
  });

  it("clears redo when a fresh tracked edit is recorded", () => {
    const { api } = makeApi();
    api.applyTracked(setField(1, "x", 1));
    api.undo();
    expect(api.canRedo()).toBe(true);

    api.applyTracked(setField(1, "x", 2));

    expect(api.canRedo()).toBe(false);
  });

  it("undo/redo never re-record — stack lengths reflect only the original step", () => {
    const { api, state } = makeApi();
    api.applyTracked(setField(1, "x", 1));

    api.undo();
    api.redo();
    api.undo();
    api.redo();

    expect(state.undo).toHaveLength(1);
    expect(state.redo).toHaveLength(0);
  });

  it("logs an error but continues when a replayed inverse is rejected", () => {
    const { api, commands, log } = makeApi();
    api.applyTracked(setField(1, "x", 1));
    commands.applyRaw.mockReturnValueOnce({ ok: false, error: "boom" });

    const undone = api.undo();

    expect(undone).toBe(true);
    expect(log.error).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gesture coalescing
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history gesture coalescing", () => {
  it("a burst of same-field edits collapses to one undo entry", () => {
    const { api, state } = makeApi();
    api.beginGesture();
    for (let value = 1; value <= 5; value++) api.applyTracked(setField(1, "x", value));

    expect(api.canUndo()).toBe(false);

    api.endGesture();

    expect(state.undo).toHaveLength(1);
    expect(state.undo[0]?.mutations).toHaveLength(1);
  });

  it("a single undo after a coalesced gesture reverts to the pre-gesture value", () => {
    const { api, commands } = makeApi();
    const id = asEditorId(1);
    commands.fields.set(commands.fieldKey(id, "Position", "x"), 0);

    api.beginGesture();
    for (let value = 1; value <= 5; value++) api.applyTracked(setField(1, "x", value));
    api.endGesture();

    api.undo();

    expect(commands.fields.get(commands.fieldKey(id, "Position", "x"))).toBe(0);
  });

  it("a gesture with no edits pushes no entry", () => {
    const { api, state } = makeApi();
    api.beginGesture();
    api.endGesture();

    expect(state.undo).toHaveLength(0);
  });

  it("a nested beginGesture warns and keeps the open buffer", () => {
    const { api, state, log } = makeApi();
    api.beginGesture();
    api.applyTracked(setField(1, "x", 1));

    api.beginGesture();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(state.gesture).toHaveLength(1);
    expect(state.gestureActive).toBe(true);
  });

  it("endGesture with no open gesture warns and no-ops", () => {
    const { api, state, log } = makeApi();

    api.endGesture();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(state.undo).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// maxDepth eviction (public API)
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history maxDepth eviction", () => {
  it("evicts the oldest step once undo.length exceeds maxDepth", () => {
    const { api, state } = makeApi({ maxDepth: 2 });

    api.applyTracked(setField(1, "x", 1));
    api.applyTracked(setField(1, "x", 2));
    api.applyTracked(setField(1, "x", 3));

    expect(state.undo).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clear
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history clear", () => {
  it("empties both stacks and drops any open gesture", () => {
    const { api, state } = makeApi();
    api.applyTracked(setField(1, "x", 1));
    api.undo();
    api.beginGesture();

    api.clear();

    expect(state.undo).toHaveLength(0);
    expect(state.redo).toHaveLength(0);
    expect(state.gesture).toBeUndefined();
    expect(state.gestureActive).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canUndo / canRedo
// ─────────────────────────────────────────────────────────────────────────────

describe("editor-history canUndo/canRedo", () => {
  it("are pure reads valid at any time", () => {
    const { api } = makeApi();

    expect(api.canUndo()).toBe(false);
    expect(api.canRedo()).toBe(false);
  });
});
