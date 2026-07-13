import { describe, expect, it } from "vitest";

import { createState } from "../../state";

describe("reflection — createState", () => {
  it("returns an empty schemas map and an empty inferred map", () => {
    const state = createState({ global: {}, config: { humanizeLabels: true } });

    expect(state.schemas.size).toBe(0);
    expect(state.inferred.size).toBe(0);
    expect(state.schemas instanceof Map).toBe(true);
    expect(state.inferred instanceof Map).toBe(true);
  });

  it("mutating schemas does not affect inferred", () => {
    const state = createState({ global: {}, config: { humanizeLabels: true } });

    state.schemas.set("Enemy", []);

    expect(state.schemas.size).toBe(1);
    expect(state.inferred.size).toBe(0);
  });

  it("mutating inferred does not affect schemas", () => {
    const state = createState({ global: {}, config: { humanizeLabels: true } });

    state.inferred.set("Enemy", []);

    expect(state.inferred.size).toBe(1);
    expect(state.schemas.size).toBe(0);
  });

  it("returns fresh maps on each call (no shared state across instances)", () => {
    const first = createState({ global: {}, config: { humanizeLabels: true } });
    const second = createState({ global: {}, config: { humanizeLabels: true } });

    first.schemas.set("Enemy", []);

    expect(second.schemas.size).toBe(0);
  });
});
