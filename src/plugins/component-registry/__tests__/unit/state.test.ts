/**
 * @file component-registry plugin — state unit tests.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";

describe("component-registry: createState", () => {
  it("seeds an empty catalog map", () => {
    const state = createState({ global: {}, config: {} });

    expect(state.catalog).toBeInstanceOf(Map);
    expect(state.catalog.size).toBe(0);
  });

  it("returns a fresh Map reference on each call (no shared mutable state across instances)", () => {
    const first = createState({ global: {}, config: {} });
    const second = createState({ global: {}, config: {} });

    expect(first.catalog).not.toBe(second.catalog);
  });
});
