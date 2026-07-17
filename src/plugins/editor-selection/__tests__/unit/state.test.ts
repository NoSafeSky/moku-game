/**
 * @file editor-selection plugin — state factory unit tests.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";

const defaultConfig: Config = { pickLayer: "world", multiSelect: false, marquee: true };

describe("editor-selection — state", () => {
  it("starts not-started, disabled, with an empty selection and zeroed pointer edge", () => {
    const state = createState({ global: {}, config: defaultConfig });

    expect(state.started).toBe(false);
    expect(state.enabled).toBe(false);
    expect(state.selected).toBeInstanceOf(Set);
    expect(state.selected.size).toBe(0);
    expect(state.prevButtons).toBe(0);
  });

  it("leaves every captured dep handle undefined until onStart / enable()", () => {
    const state = createState({ global: {}, config: defaultConfig });

    expect(state.world).toBeUndefined();
    expect(state.renderer).toBeUndefined();
    expect(state.camera).toBeUndefined();
    expect(state.input).toBeUndefined();
    expect(state.pickLayer).toBeUndefined();
    expect(state.canvas).toBeUndefined();
    expect(state.detach).toBeUndefined();
  });

  it("leaves the marquee overlay chrome + drag session undefined until onStart / a drag", () => {
    const state = createState({ global: {}, config: defaultConfig });

    expect(state.stage).toBeUndefined();
    expect(state.marqueeOverlay).toBeUndefined();
    expect(state.marqueeGraphics).toBeUndefined();
    expect(state.marquee).toBeUndefined();
    expect(state.marqueeDetach).toBeUndefined();
  });

  it("returns a fresh Set instance per call (no shared mutable state across plugin instances)", () => {
    const a = createState({ global: {}, config: defaultConfig });
    const b = createState({ global: {}, config: defaultConfig });
    expect(a.selected).not.toBe(b.selected);
  });
});
