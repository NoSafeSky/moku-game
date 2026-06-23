import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/** Default scheduler config used by makeCtx when no override is provided. */
const DEFAULT_CONFIG: Config = { strictStages: true };

/**
 * Build a minimal context for createState.
 *
 * @param config - Scheduler config to pass as ctx.config.
 * @returns A minimal context object.
 */
const makeCtx = (config: Config = DEFAULT_CONFIG) => ({
  global: {},
  config
});

// ─── createState ──────────────────────────────────────────────

describe("createState", () => {
  it("returns an empty object (no scheduler state)", () => {
    const state = createState(makeCtx());

    expect(state).toStrictEqual({});
  });

  it("returns an empty object regardless of strictStages config", () => {
    const state = createState(makeCtx({ strictStages: false }));

    expect(state).toStrictEqual({});
  });

  it("returns a new object each call (no shared reference)", () => {
    const ctx = makeCtx();
    const stateA = createState(ctx);
    const stateB = createState(ctx);

    expect(stateA).not.toBe(stateB);
  });
});
