/**
 * @file asset-store plugin — state factory unit tests.
 *
 * `createState` seeds the default backend + empty `urls`/`meta` maps, mirrors `config.accept`, and
 * starts `ready: false`.
 */
import { describe, expect, it } from "vitest";

import { createState } from "../../state";
import type { Config } from "../../types";

const config: Config = { dbName: "moku-assets", storeName: "assets", accept: ["image/"] };

describe("asset-store: createState", () => {
  it("seeds empty urls/meta maps and ready: false", () => {
    const state = createState({ global: {}, config });

    expect(state.urls).toBeInstanceOf(Map);
    expect(state.urls.size).toBe(0);
    expect(state.meta).toBeInstanceOf(Map);
    expect(state.meta.size).toBe(0);
    expect(state.ready).toBe(false);
  });

  it("mirrors config.accept", () => {
    const custom: Config = { dbName: "d", storeName: "s", accept: ["image/", "audio/"] };
    const state = createState({ global: {}, config: custom });

    expect(state.accept).toEqual(["image/", "audio/"]);
  });

  it("seeds a default backend that never throws when probed synchronously", () => {
    const state = createState({ global: {}, config });

    expect(state.backend).toBeDefined();
    expect(typeof state.backend.persistent).toBe("boolean");
  });

  it("builds independent state per call (no shared maps across instances)", () => {
    const a = createState({ global: {}, config });
    const b = createState({ global: {}, config });

    a.urls.set("x", "blob:x");
    expect(b.urls.has("x")).toBe(false);
  });
});
