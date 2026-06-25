/**
 * @file mcp plugin — unit tests for transport.ts (the SDK isolation seam).
 *
 * Mocks the three `@modelcontextprotocol/sdk` entry points and `Bun.serve` so
 * buildMcpHandle can be exercised without a real MCP server or HTTP listener.
 * Covers what the stdio-only integration test cannot:
 * - stdio: returns a running handle, extracts tool names, close() tears down
 * - http: binds Bun.serve, sets the endpoint, close() stops the server
 * - bearer auth: the fetch gate rejects missing / wrong / wrong-length tokens
 *   (this is the only coverage of the constant-time compare) and delegates a
 *   correct token to the transport
 * - half-open safety: a failed connect closes the server and rethrows; an
 *   already-connected transport is closed when a later transport fails
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted SDK mock state (shared by the mock classes below)
// ─────────────────────────────────────────────────────────────────────────────

const sdk = vi.hoisted(() => {
  const state = {
    /** When set, McpServer.connect rejects with this error. */
    connectReject: undefined as Error | undefined,
    servers: [] as Array<{
      close: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
      _registeredTools: Record<string, unknown>;
    }>,
    stdioTransports: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
    httpTransports: [] as Array<{
      handleRequest: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }>,
    /** Linked in-memory transport pairs created via createLinkedPair(). */
    inMemoryPairs: [] as Array<{
      client: { close: ReturnType<typeof vi.fn> };
      server: { close: ReturnType<typeof vi.fn> };
    }>,
    /**
     * Shared connect implementation for the mock McpServer. Defined at the
     * hoisted-state scope (closing over `state` to honour a per-test
     * connectReject) rather than as a class-field arrow, so
     * unicorn/consistent-function-scoping is satisfied; the class still wraps it
     * in vi.fn() so per-instance call assertions keep working.
     */
    serverConnect(_transport: unknown): Promise<void> {
      return state.connectReject ? Promise.reject(state.connectReject) : Promise.resolve();
    }
  };
  return state;
});

// Methods (registerTool/registerResource) are class methods, not arrow fields, so
// unicorn/consistent-function-scoping leaves them alone; connect is a vi.fn() spy
// wrapping the hoisted serverConnect impl so inMemory tests can assert the call.
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    _registeredTools: Record<string, unknown> = {};
    close = vi.fn().mockResolvedValue(undefined);
    // Spy wrapping the shared impl — tracks every transport passed to connect()
    // so inMemory tests can assert the server connected to the paired transport.
    connect = vi.fn(sdk.serverConnect);
    constructor() {
      sdk.servers.push(this);
    }
    registerTool(name: string): void {
      this._registeredTools[name] = {};
    }
    registerResource(): void {
      /* no-op — resources are not asserted here */
    }
  }
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    close = vi.fn().mockResolvedValue(undefined);
    constructor() {
      sdk.stdioTransports.push(this);
    }
  }
}));

vi.mock("@modelcontextprotocol/sdk/inMemory.js", () => ({
  InMemoryTransport: class {
    close = vi.fn().mockResolvedValue(undefined);
    /** Creates a linked client/server transport pair, recording it for assertions. */
    static createLinkedPair(): [unknown, unknown] {
      const client = { close: vi.fn().mockResolvedValue(undefined) };
      const server = { close: vi.fn().mockResolvedValue(undefined) };
      sdk.inMemoryPairs.push({ client, server });
      return [client, server];
    }
  }
}));

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    close = vi.fn().mockResolvedValue(undefined);
    constructor() {
      sdk.httpTransports.push(this);
    }
  }
}));

import type { BuildHandleOptions } from "../../transport";
import { buildMcpHandle, defaultTransports } from "../../transport";
import type { Config, InMemoryClientTransportLike, McpServerLike } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Bun.serve stub (set per-test on globalThis where the http path is exercised)
// ─────────────────────────────────────────────────────────────────────────────

type FetchHandler = (request: Request) => Promise<Response> | Response;
// Standalone shape (not intersected with typeof globalThis, which carries the real
// @types/bun overloads) — cast through `unknown`, mirroring transport.ts's own seam.
type GlobalWithBun = {
  Bun?: {
    serve: (opts: { port: number; hostname: string; fetch: FetchHandler }) => {
      stop: (force?: boolean) => void;
    };
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// document stub (browser detection — set/restored per test)
// ─────────────────────────────────────────────────────────────────────────────

/** Standalone view of globalThis carrying an optional `document` (DOM probe). */
type GlobalWithDocument = { document?: unknown };

const stubDocument = (): void => {
  (globalThis as GlobalWithDocument).document = {};
};

const removeDocument = (): void => {
  delete (globalThis as GlobalWithDocument).document;
};

let capturedFetch: FetchHandler | undefined;
const bunStop = vi.fn();
const bunServe = vi.fn((opts: { port: number; hostname: string; fetch: FetchHandler }) => {
  capturedFetch = opts.fetch;
  return { stop: bunStop };
});

const installBun = (): void => {
  (globalThis as unknown as GlobalWithBun).Bun = { serve: bunServe };
};

const removeBun = (): void => {
  delete (globalThis as unknown as GlobalWithBun).Bun;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeConfig = (overrides?: Partial<Config>): Config => ({
  transports: ["stdio"],
  httpHost: "127.0.0.1",
  httpPort: 3333,
  httpAuth: "none",
  bearerToken: "",
  enableMutations: true,
  inMemoryGlobalKey: "__MOKU_GAME_MCP__",
  ...overrides
});

const makeOpts = (config: Config): BuildHandleOptions => ({
  config,
  registerAllTools: vi.fn((server: McpServerLike) => {
    server.registerTool("ecs:spawn", {}, async () => ({ content: [] }));
    server.registerTool("ecs:query", {}, async () => ({ content: [] }));
  }),
  registerAllResources: vi.fn(),
  pending: [],
  removeDrainSystem: vi.fn(),
  removeStatsSystem: vi.fn(),
  warn: vi.fn()
});

const lastServer = () => sdk.servers.at(-1);

/** Builds an http handle with bearer auth and returns the captured fetch handler. */
const buildWithBearer = async (token: string): Promise<FetchHandler> => {
  await buildMcpHandle(
    makeOpts(makeConfig({ transports: ["http"], httpAuth: "bearer", bearerToken: token }))
  );
  if (!capturedFetch) throw new Error("fetch handler was not captured");
  return capturedFetch;
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  sdk.connectReject = undefined;
  sdk.servers.length = 0;
  sdk.stdioTransports.length = 0;
  sdk.httpTransports.length = 0;
  sdk.inMemoryPairs.length = 0;
  capturedFetch = undefined;
  removeBun();
});

afterEach(() => {
  removeBun();
});

// ─────────────────────────────────────────────────────────────────────────────
// stdio transport
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMcpHandle — stdio transport", () => {
  it("connects and returns a running handle with the registered tool names", async () => {
    const opts = makeOpts(makeConfig());

    const handle = await buildMcpHandle(opts);

    expect(handle.running).toBe(true);
    expect(handle.httpEndpoint).toBeUndefined();
    expect(handle.toolNames).toEqual(["ecs:spawn", "ecs:query"]);
    expect(handle.pending).toBe(opts.pending);
    expect(handle.removeDrainSystem).toBe(opts.removeDrainSystem);
    expect(handle.removeStatsSystem).toBe(opts.removeStatsSystem);
    expect(opts.registerAllTools).toHaveBeenCalledOnce();
    expect(opts.registerAllResources).toHaveBeenCalledOnce();
    expect(sdk.stdioTransports).toHaveLength(1);
  });

  it("reports no tool names when none are registered", async () => {
    const opts: BuildHandleOptions = { ...makeOpts(makeConfig()), registerAllTools: vi.fn() };

    const handle = await buildMcpHandle(opts);

    expect(handle.toolNames).toEqual([]);
  });

  it("close() closes the stdio transport and the server", async () => {
    const handle = await buildMcpHandle(makeOpts(makeConfig()));

    await handle.close();

    expect(sdk.stdioTransports[0]?.close).toHaveBeenCalledOnce();
    expect(lastServer()?.close).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// http transport
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMcpHandle — http transport", () => {
  beforeEach(installBun);

  it("binds Bun.serve on the configured host/port and sets the endpoint", async () => {
    const handle = await buildMcpHandle(makeOpts(makeConfig({ transports: ["http"] })));

    expect(handle.httpEndpoint).toBe("http://127.0.0.1:3333/mcp");
    expect(bunServe).toHaveBeenCalledOnce();
    const serveOpts = bunServe.mock.calls[0]?.[0];
    expect(serveOpts?.port).toBe(3333);
    expect(serveOpts?.hostname).toBe("127.0.0.1");
    expect(sdk.httpTransports).toHaveLength(1);
  });

  it("close() stops the Bun server and closes the http transport", async () => {
    const handle = await buildMcpHandle(makeOpts(makeConfig({ transports: ["http"] })));

    await handle.close();

    expect(bunStop).toHaveBeenCalledWith(true);
    expect(sdk.httpTransports[0]?.close).toHaveBeenCalledOnce();
  });

  it("throws a helpful error and closes the server when Bun.serve is unavailable", async () => {
    removeBun();

    await expect(buildMcpHandle(makeOpts(makeConfig({ transports: ["http"] })))).rejects.toThrow(
      /Bun\.serve/
    );
    expect(lastServer()?.close).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bearer auth gate (the only coverage of the constant-time compare)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMcpHandle — http bearer auth", () => {
  beforeEach(installBun);

  it("rejects a request with no Authorization header (401)", async () => {
    const handler = await buildWithBearer("secret-token");

    const response = await handler(new Request("http://127.0.0.1:3333/mcp"));

    expect(response.status).toBe(401);
    expect(sdk.httpTransports[0]?.handleRequest).not.toHaveBeenCalled();
  });

  it("rejects a request with a wrong same-length token (401)", async () => {
    const handler = await buildWithBearer("secret-token");

    const response = await handler(
      new Request("http://127.0.0.1:3333/mcp", {
        headers: { authorization: "Bearer wrong-tokenn" }
      })
    );

    expect(response.status).toBe(401);
  });

  it("rejects a request with a wrong-length token (401)", async () => {
    const handler = await buildWithBearer("secret-token");

    const response = await handler(
      new Request("http://127.0.0.1:3333/mcp", { headers: { authorization: "Bearer x" } })
    );

    expect(response.status).toBe(401);
  });

  it("delegates to the transport when the token matches", async () => {
    const handler = await buildWithBearer("secret-token");

    const response = await handler(
      new Request("http://127.0.0.1:3333/mcp", {
        headers: { authorization: "Bearer secret-token" }
      })
    );

    expect(sdk.httpTransports[0]?.handleRequest).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });

  it("delegates every request when httpAuth=none", async () => {
    await buildMcpHandle(makeOpts(makeConfig({ transports: ["http"], httpAuth: "none" })));
    if (!capturedFetch) throw new Error("fetch handler was not captured");

    const response = await capturedFetch(new Request("http://127.0.0.1:3333/mcp"));

    expect(sdk.httpTransports[0]?.handleRequest).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// half-open safety
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMcpHandle — half-open safety", () => {
  it("closes the server and rethrows when a transport connect fails", async () => {
    sdk.connectReject = new Error("connect boom");

    await expect(buildMcpHandle(makeOpts(makeConfig()))).rejects.toThrow("connect boom");
    expect(lastServer()?.close).toHaveBeenCalledOnce();
  });

  it("closes an already-connected transport when a later transport fails", async () => {
    // stdio connects (closer pushed), then the http branch throws (no Bun.serve)
    removeBun();

    await expect(
      buildMcpHandle(makeOpts(makeConfig({ transports: ["stdio", "http"] })))
    ).rejects.toThrow(/Bun\.serve/);

    expect(sdk.stdioTransports[0]?.close).toHaveBeenCalledOnce();
    expect(lastServer()?.close).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// defaultTransports — pure env probe (Cycle 3)
// ─────────────────────────────────────────────────────────────────────────────

describe("defaultTransports", () => {
  afterEach(() => {
    removeDocument();
  });

  it('returns ["inMemory"] when document is present (browser)', () => {
    stubDocument();
    expect(defaultTransports()).toEqual(["inMemory"]);
  });

  it('returns ["stdio"] when document is absent (Node/Bun)', () => {
    removeDocument();
    expect(defaultTransports()).toEqual(["stdio"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stdio guard (Cycle 3) — skip + warn when process.stdin is unavailable
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMcpHandle — stdio guard", () => {
  let originalStdin: typeof process.stdin | undefined;

  beforeEach(() => {
    originalStdin = process.stdin;
  });

  afterEach(() => {
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      configurable: true
    });
  });

  it("skips stdio and invokes warn when process.stdin is undefined", async () => {
    Object.defineProperty(process, "stdin", { value: undefined, configurable: true });

    const opts = makeOpts(makeConfig({ transports: ["stdio"] }));
    const handle = await buildMcpHandle(opts);

    // stdio was skipped — no transport constructed, no connect
    expect(sdk.stdioTransports).toHaveLength(0);
    expect(opts.warn).toHaveBeenCalledOnce();
    expect(vi.mocked(opts.warn).mock.calls[0]?.[0]).toMatch(/stdio/);
    // Handle still returned (no throw)
    expect(handle.running).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inMemory transport (Cycle 3)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMcpHandle — inMemory transport", () => {
  afterEach(() => {
    removeDocument();
    delete (globalThis as Record<string, unknown>).__MOKU_GAME_MCP__;
  });

  it("connects the server to the paired server transport and exposes a clientTransport", async () => {
    const handle = await buildMcpHandle(makeOpts(makeConfig({ transports: ["inMemory"] })));

    expect(sdk.inMemoryPairs).toHaveLength(1);
    // server.connect was called with the server side of the pair
    const serverPair = sdk.inMemoryPairs[0]?.server;
    expect(lastServer()?.connect).toHaveBeenCalledWith(serverPair);
    // The client side is retained on the handle
    expect(handle.clientTransport).toBe(sdk.inMemoryPairs[0]?.client);
  });

  it("publishes the client transport on globalThis[key] in a browser and removes it on close", async () => {
    stubDocument();
    const key = "__MOKU_GAME_MCP__";

    const handle = await buildMcpHandle(
      makeOpts(makeConfig({ transports: ["inMemory"], inMemoryGlobalKey: key }))
    );

    expect((globalThis as Record<string, unknown>)[key]).toBe(handle.clientTransport);
    expect(handle.publishedGlobalKey).toBe(key);

    await handle.close();
    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
  });

  it("does NOT publish when inMemoryGlobalKey is empty", async () => {
    stubDocument();
    const key = "__MOKU_GAME_MCP__";

    const handle = await buildMcpHandle(
      makeOpts(makeConfig({ transports: ["inMemory"], inMemoryGlobalKey: "" }))
    );

    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
    expect(handle.publishedGlobalKey).toBeUndefined();
  });

  it("does NOT publish when not in a browser even with a non-empty key", async () => {
    removeDocument();
    const key = "__MOKU_GAME_MCP__";

    const handle = await buildMcpHandle(
      makeOpts(makeConfig({ transports: ["inMemory"], inMemoryGlobalKey: key }))
    );

    expect((globalThis as Record<string, unknown>)[key]).toBeUndefined();
    expect(handle.publishedGlobalKey).toBeUndefined();
  });

  it("close() closes both transports of the in-memory pair", async () => {
    const handle = await buildMcpHandle(makeOpts(makeConfig({ transports: ["inMemory"] })));

    await handle.close();

    expect(sdk.inMemoryPairs[0]?.server.close).toHaveBeenCalledOnce();
    expect(sdk.inMemoryPairs[0]?.client.close).toHaveBeenCalledOnce();
  });

  it("clientTransport conforms structurally to InMemoryClientTransportLike", async () => {
    const handle = await buildMcpHandle(makeOpts(makeConfig({ transports: ["inMemory"] })));

    expectTypeOf(handle.clientTransport).toEqualTypeOf<InMemoryClientTransportLike | undefined>();
  });
});
