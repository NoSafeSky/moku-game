/**
 * @file editor-gizmos plugin — state factory unit tests.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";

const config: Config = { overlayLayer: "editor-gizmos", snap: 0, translateOnly: true };

describe("editor-gizmos — state — createState", () => {
  it("starts not-started, disabled, translate mode, no snap, no drag, no gesture sink", () => {
    const state = createState({ global: {}, config });

    expect(state.started).toBe(false);
    expect(state.enabled).toBe(false);
    expect(state.mode).toBe("translate");
    expect(state.snap).toBe(0);
    expect(state.drag).toBeUndefined();
    expect(state.gestureSink).toBeUndefined();
  });

  it("defaults space to 'global' and pivot to 'pivot' (matching pre-update behaviour)", () => {
    const state = createState({ global: {}, config });

    expect(state.space).toBe("global");
    expect(state.pivot).toBe("pivot");
  });

  it("has no captured chrome or dependency handles until onStart runs", () => {
    const state = createState({ global: {}, config });

    expect(state.overlay).toBeUndefined();
    expect(state.handle).toBeUndefined();
    expect(state.stage).toBeUndefined();
    expect(state.renderer).toBeUndefined();
    expect(state.camera).toBeUndefined();
    expect(state.selection).toBeUndefined();
    expect(state.commands).toBeUndefined();
  });

  it("does not seed snap from config (onStart re-seeds it, per spec)", () => {
    const state = createState({ global: {}, config: { ...config, snap: 32 } });
    expect(state.snap).toBe(0);
  });

  it("produces an independent state object per call", () => {
    const a = createState({ global: {}, config });
    const b = createState({ global: {}, config });
    expect(a).not.toBe(b);
    a.mode = "rotate";
    expect(b.mode).toBe("translate");
  });
});
