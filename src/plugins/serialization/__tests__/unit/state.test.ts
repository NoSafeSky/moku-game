/**
 * @file serialization plugin — createState unit tests.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

describe("serialization — createState", () => {
  it("seeds currentName undefined and currentVersion from config.version", () => {
    const config: Config = { storageKeyPrefix: "scene:", version: 3, migrations: {} };

    const state = createState({ global: {}, config });

    expect(state.currentName).toBeUndefined();
    expect(state.currentVersion).toBe(3);
  });

  it("seeds currentVersion at 1 for the default config", () => {
    const config: Config = { storageKeyPrefix: "scene:", version: 1, migrations: {} };

    const state = createState({ global: {}, config });

    expect(state.currentVersion).toBe(1);
  });
});
