/**
 * @file editor-runtime plugin — state unit tests.
 *
 * Verifies `createState`'s initial shape: seeded `"edit"` mode, no pre-play snapshot, and the
 * `started` guard flag off (onStart flips it once dependencies are ready).
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";

describe("editor-runtime createState", () => {
  it('seeds mode as "edit"', () => {
    const state = createState();
    expect(state.mode).toBe("edit");
  });

  it("seeds preplaySnapshot as undefined", () => {
    const state = createState();
    expect(state.preplaySnapshot).toBeUndefined();
  });

  it("seeds started as false", () => {
    const state = createState();
    expect(state.started).toBe(false);
  });

  it("returns a fresh object on every call (no shared mutable state)", () => {
    const a = createState();
    const b = createState();
    expect(a).not.toBe(b);
    a.mode = "play";
    expect(b.mode).toBe("edit");
  });
});
