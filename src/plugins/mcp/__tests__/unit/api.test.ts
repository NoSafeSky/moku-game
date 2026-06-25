/**
 * @file mcp plugin — unit tests for api.ts, state.ts, and config validation.
 *
 * Tests that:
 * - createState returns correct initial shape
 * - createApi reads from the WeakMap correctly (isRunning, httpEndpoint, toolNames)
 * - Config validation: bearer-without-token throws
 */
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { createApi } from "../../api";
import { mcpRegistry, validateConfig } from "../../lifecycle";
import { createState } from "../../state";
import type { Config, InMemoryClientTransportLike, McpHandle } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (outer scope — unicorn/consistent-function-scoping)
// ─────────────────────────────────────────────────────────────────────────────

const makeHandle = (overrides?: Partial<McpHandle>): McpHandle => ({
  running: false,
  httpEndpoint: undefined,
  toolNames: [],
  pending: [],
  removeDrainSystem: () => {
    /* no-op */
  },
  removeStatsSystem: () => {
    /* no-op */
  },
  close: () => Promise.resolve(),
  ...overrides
});

/** A minimal structural in-page client transport for clientTransport() assertions. */
const makeClientTransport = (): InMemoryClientTransportLike => ({
  start: () => Promise.resolve(),
  send: () => Promise.resolve(),
  close: () => Promise.resolve()
});

// ─────────────────────────────────────────────────────────────────────────────
// createState tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createState", () => {
  const defaultConfig: Config = {
    transports: ["stdio"],
    httpHost: "127.0.0.1",
    httpPort: 3333,
    httpAuth: "none",
    bearerToken: "",
    enableMutations: true,
    inMemoryGlobalKey: "__MOKU_GAME_MCP__"
  };

  it("returns stats with zero initial values", () => {
    const state = createState({ global: {}, config: defaultConfig });
    expect(state.stats.frame).toBe(0);
    expect(state.stats.lastDt).toBe(0);
    expect(state.stats.entityCount).toBe(0);
  });

  it("stats object is plain (not frozen)", () => {
    const state = createState({ global: {}, config: defaultConfig });
    state.stats.frame = 1;
    expect(state.stats.frame).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createApi tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createApi", () => {
  let globalKey: object;

  beforeEach(() => {
    globalKey = {};
  });

  it("isRunning() returns false when no handle in registry", () => {
    const api = createApi({ global: globalKey });
    expect(api.isRunning()).toBe(false);
  });

  it("isRunning() returns true when handle.running is true", () => {
    mcpRegistry.set(globalKey, makeHandle({ running: true }));
    const api = createApi({ global: globalKey });
    expect(api.isRunning()).toBe(true);
  });

  it("isRunning() returns false when handle.running is false", () => {
    mcpRegistry.set(globalKey, makeHandle({ running: false }));
    const api = createApi({ global: globalKey });
    expect(api.isRunning()).toBe(false);
  });

  it("httpEndpoint() returns undefined when no handle in registry", () => {
    const api = createApi({ global: globalKey });
    expect(api.httpEndpoint()).toBeUndefined();
  });

  it("httpEndpoint() returns undefined when HTTP transport not active", () => {
    mcpRegistry.set(globalKey, makeHandle({ httpEndpoint: undefined }));
    const api = createApi({ global: globalKey });
    expect(api.httpEndpoint()).toBeUndefined();
  });

  it("httpEndpoint() returns the endpoint string when HTTP active", () => {
    mcpRegistry.set(globalKey, makeHandle({ httpEndpoint: "http://127.0.0.1:3333/mcp" }));
    const api = createApi({ global: globalKey });
    expect(api.httpEndpoint()).toBe("http://127.0.0.1:3333/mcp");
  });

  it("toolNames() returns empty array when no handle", () => {
    const api = createApi({ global: globalKey });
    expect(api.toolNames()).toEqual([]);
  });

  it("toolNames() returns the registered tool names", () => {
    const names = ["ecs:spawn", "ecs:query", "renderer:screenshot"];
    mcpRegistry.set(globalKey, makeHandle({ toolNames: names }));
    const api = createApi({ global: globalKey });
    expect(api.toolNames()).toEqual(names);
  });

  // ── clientTransport() (Cycle 3) ─────────────────────────────────────────────

  it("clientTransport() returns undefined when no handle in registry", () => {
    const api = createApi({ global: globalKey });
    expect(api.clientTransport()).toBeUndefined();
  });

  it("clientTransport() returns undefined when the handle has no client transport", () => {
    mcpRegistry.set(globalKey, makeHandle({ clientTransport: undefined }));
    const api = createApi({ global: globalKey });
    expect(api.clientTransport()).toBeUndefined();
  });

  it("clientTransport() returns the handle's clientTransport when present", () => {
    const transport = makeClientTransport();
    mcpRegistry.set(globalKey, makeHandle({ clientTransport: transport }));
    const api = createApi({ global: globalKey });
    expect(api.clientTransport()).toBe(transport);
  });

  // ── Type-level ─────────────────────────────────────────────────────────────

  describe("types", () => {
    it("isRunning is typed as () => boolean", () => {
      const api = createApi({ global: {} });
      expectTypeOf(api.isRunning).toEqualTypeOf<() => boolean>();
    });

    it("httpEndpoint is typed as () => string | undefined", () => {
      const api = createApi({ global: {} });
      expectTypeOf(api.httpEndpoint).toEqualTypeOf<() => string | undefined>();
    });

    it("toolNames is typed as () => readonly string[]", () => {
      const api = createApi({ global: {} });
      expectTypeOf(api.toolNames).toEqualTypeOf<() => readonly string[]>();
    });

    it("clientTransport is typed as () => InMemoryClientTransportLike | undefined", () => {
      const api = createApi({ global: {} });
      expectTypeOf(api.clientTransport).toEqualTypeOf<
        () => InMemoryClientTransportLike | undefined
      >();
    });

    it("InMemoryClientTransportLike is SDK-free (structural, assignable from a plain object)", () => {
      const transport: InMemoryClientTransportLike = {
        start: () => Promise.resolve(),
        send: () => Promise.resolve(),
        close: () => Promise.resolve()
      };
      expectTypeOf(transport.start).toEqualTypeOf<() => Promise<void>>();
      expectTypeOf(transport.send).parameter(0).toEqualTypeOf<unknown>();
    });

    it("rejects a transports value outside the stdio | http | inMemory union", () => {
      const ok: Config["transports"] = ["stdio", "http", "inMemory"];
      expectTypeOf(ok).toEqualTypeOf<ReadonlyArray<"stdio" | "http" | "inMemory">>();
      // @ts-expect-error — "websocket" is not in the transports union
      const bad: Config["transports"] = ["websocket"];
      expect(bad).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig tests (config validation from lifecycle.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("validateConfig", () => {
  it("does not throw for valid config with httpAuth=none", () => {
    const config: Config = {
      transports: ["stdio"],
      httpHost: "127.0.0.1",
      httpPort: 3333,
      httpAuth: "none",
      bearerToken: "",
      enableMutations: true,
      inMemoryGlobalKey: "__MOKU_GAME_MCP__"
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("does not throw for bearer with a non-empty token", () => {
    const config: Config = {
      transports: ["http"],
      httpHost: "127.0.0.1",
      httpPort: 3333,
      httpAuth: "bearer",
      bearerToken: "secret-token",
      enableMutations: true,
      inMemoryGlobalKey: "__MOKU_GAME_MCP__"
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  it("throws when httpAuth=bearer and bearerToken is empty", () => {
    const config: Config = {
      transports: ["http"],
      httpHost: "127.0.0.1",
      httpPort: 3333,
      httpAuth: "bearer",
      bearerToken: "",
      enableMutations: true,
      inMemoryGlobalKey: "__MOKU_GAME_MCP__"
    };
    expect(() => validateConfig(config)).toThrow();
  });
});
