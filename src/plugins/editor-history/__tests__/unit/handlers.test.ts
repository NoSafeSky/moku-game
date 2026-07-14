/**
 * @file editor-history plugin — commands:restored hook unit tests.
 */
import { describe, expect, it } from "vitest";
import { createRestoredHooks } from "../../handlers";
import type { State } from "../../types";
import { asEditorId, makeLog } from "../fake-commands";

const makePopulatedState = (): State => ({
  undo: [
    {
      mutations: [
        {
          command: { kind: "despawn", id: asEditorId(1) },
          inverse: { kind: "spawn", components: {}, id: asEditorId(1) }
        }
      ]
    }
  ],
  redo: [
    {
      mutations: [
        {
          command: { kind: "despawn", id: asEditorId(2) },
          inverse: { kind: "spawn", components: {}, id: asEditorId(2) }
        }
      ]
    }
  ],
  gesture: [],
  gestureActive: true
});

describe("editor-history commands:restored hook", () => {
  it("clears the undo/redo stacks and drops any open gesture on a reload", () => {
    const state = makePopulatedState();
    const log = makeLog();
    const hooks = createRestoredHooks({ state, log });

    hooks["commands:restored"]({ source: "reload" });

    expect(state.undo).toEqual([]);
    expect(state.redo).toEqual([]);
    expect(state.gesture).toBeUndefined();
    expect(state.gestureActive).toBe(false);
  });

  it("also clears on an exit-play revert", () => {
    const state = makePopulatedState();
    const log = makeLog();
    const hooks = createRestoredHooks({ state, log });

    hooks["commands:restored"]({ source: "exit-play" });

    expect(state.undo).toEqual([]);
    expect(state.redo).toEqual([]);
  });

  it("logs a debug diagnostic naming the source", () => {
    const state = makePopulatedState();
    const log = makeLog();
    const hooks = createRestoredHooks({ state, log });

    hooks["commands:restored"]({ source: "reload" });

    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("reload"));
  });
});
