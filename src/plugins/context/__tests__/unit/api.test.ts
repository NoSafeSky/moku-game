/**
 * @file context plugin — api unit tests.
 *
 * Verifies that the api factory returns the two well-known resource tokens
 * (Assets and GameContext) with the expected fixed keys.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Api as AssetsApi } from "../../../assets/types";
import type { Resource } from "../../../ecs/types";
import { createApi } from "../../api";
import { Assets, GameContext } from "../../resources";
import type { GameContextValue } from "../../types";

// ─── minimal mock ctx (unused by createApi but required by the function signature) ───

const mockCtx = {
  global: {},
  config: { bindGameContext: true },
  state: {},
  log: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined
  },
  emit: () => undefined,
  env: { get: () => undefined }
} as const;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("context api — token exposure", () => {
  it("createApi returns an object with assets and game tokens", () => {
    const api = createApi(mockCtx);
    expect(api.assets).toBeDefined();
    expect(api.game).toBeDefined();
  });

  it("api.assets is the Assets fixed-key token (ctx:assets)", () => {
    const api = createApi(mockCtx);
    expect(api.assets).toBe(Assets);
    expect(api.assets.__key).toBe("ctx:assets");
  });

  it("api.game is the GameContext fixed-key token (ctx:game)", () => {
    const api = createApi(mockCtx);
    expect(api.game).toBe(GameContext);
    expect(api.game.__key).toBe("ctx:game");
  });

  it("Assets module const has __key === 'ctx:assets'", () => {
    expect(Assets.__key).toBe("ctx:assets");
  });

  it("GameContext module const has __key === 'ctx:game'", () => {
    expect(GameContext.__key).toBe("ctx:game");
  });

  it("tokens are stable references — same object across multiple createApi calls", () => {
    const a = createApi(mockCtx);
    const b = createApi(mockCtx);
    expect(a.assets).toBe(b.assets);
    expect(a.game).toBe(b.game);
  });

  // ── Type-level tests (inline, using expectTypeOf) ────────────────────────

  it("api.assets is typed as Resource<AssetsApi>", () => {
    const api = createApi(mockCtx);
    expectTypeOf(api.assets).toEqualTypeOf<Resource<AssetsApi>>();
  });

  it("api.game is typed as Resource<GameContextValue>", () => {
    const api = createApi(mockCtx);
    expectTypeOf(api.game).toEqualTypeOf<Resource<GameContextValue>>();
  });
});
