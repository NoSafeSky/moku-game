/**
 * @file platform plugin — state unit tests.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";

describe("platform: createState", () => {
  it("seeds portal 'none', not ad-playing, and no last interstitial", () => {
    expect(createState()).toEqual({ portal: "none", adPlaying: false, lastInterstitialAt: 0 });
  });

  it("returns a fresh object each call", () => {
    expect(createState()).not.toBe(createState());
  });
});
