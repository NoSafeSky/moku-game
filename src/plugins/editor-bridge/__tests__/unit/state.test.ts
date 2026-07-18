/**
 * @file editor-bridge plugin — state unit tests.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";

describe("editor-bridge createState", () => {
  it("seeds lastEpoch as -1", () => {
    expect(createState().lastEpoch).toBe(-1);
  });

  it("seeds entities as undefined", () => {
    expect(createState().entities).toBeUndefined();
  });

  it("seeds roots as undefined", () => {
    expect(createState().roots).toBeUndefined();
  });

  it("returns a fresh object on every call (no shared mutable state)", () => {
    const a = createState();
    const b = createState();
    expect(a).not.toBe(b);
    a.lastEpoch = 5;
    expect(b.lastEpoch).toBe(-1);
  });
});
