/**
 * @file mcp plugin — transport construction (SDK isolation seam).
 *
 * ALL `@modelcontextprotocol/sdk` imports are confined to this file.
 * Everything exported uses structural types from types.ts so no SDK namespace
 * leaks into tools.ts, resources.ts, api.ts, lifecycle.ts, or the public .d.ts.
 *
 * Node-only dependencies stay LAZY: the stdio transport (`node:process` under the
 * hood) and `node:crypto` are loaded with `await import(...)` inside their
 * respective transport branches, so a browser bundle configured for `["inMemory"]`
 * ships node-free. Only `McpServer` + `InMemoryTransport` are statically imported —
 * both are browser-safe (their static graph reaches no `node:*` builtin).
 *
 * v1 boundary: to swap the SDK (e.g. v2, browser transport) only edit this file.
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config, InMemoryClientTransportLike, McpHandle, McpServerLike } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FRAMEWORK_NAME = "game";
const FRAMEWORK_VERSION = "0.1.0";
const MCP_PATH = "/mcp";

// ─────────────────────────────────────────────────────────────────────────────
// Environment probes (pure — no SDK call in the body)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural view of a `globalThis` that may carry a published client transport
 * under an arbitrary string key. Mutating an index of `globalThis` directly is
 * disallowed by `noImplicitAny`/`noUncheckedIndexedAccess`, so the publish/unpublish
 * paths project through this record shape.
 */
type GlobalThisRecord = Record<string, unknown>;

/**
 * Structural view of `globalThis` for the DOM probe. The tsconfig omits the `dom`
 * lib, so `document` is not a declared global; reading it through this cast keeps
 * the browser check type-safe without referencing a bare undeclared identifier
 * (mirrors the renderer plugin's `GlobalWithDom` pattern).
 */
type GlobalWithDocument = {
  /** The DOM document — present only in a browser realm. */
  document?: unknown;
};

/**
 * Returns the environment-aware default transport list.
 *
 * Pure environment probe — performs NO SDK call. Returns `["inMemory"]` in a
 * browser (where `document` is defined) so a default `createApp()` runs in-page
 * without a socket; returns `["stdio"]` under Node/Bun (the existing default).
 * Suitable for computing a config default at module load time.
 *
 * @returns `["inMemory"]` when a DOM is present (`typeof document !== "undefined"`), else `["stdio"]`.
 * @example
 * ```ts
 * const transports = defaultTransports(); // ["stdio"] under Bun, ["inMemory"] in browser
 * ```
 */
export const defaultTransports = (): ReadonlyArray<"stdio" | "http" | "inMemory"> =>
  (globalThis as GlobalWithDocument).document === undefined ? ["stdio"] : ["inMemory"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the stdio transport module specifier at call time (from parts, via `join`)
 * so a browser bundler cannot constant-fold it and pull the stdio module — which
 * statically imports `node:process` — into the client bundle. Only invoked under
 * Node/Bun when the stdio transport is configured; the resulting runtime `import()`
 * resolves there and is never reached in a browser.
 *
 * @returns The `@modelcontextprotocol/sdk/server/stdio.js` module specifier.
 * @example
 * ```ts
 * const { StdioServerTransport } = await import(stdioTransportSpecifier());
 * ```
 */
const stdioTransportSpecifier = (): string =>
  ["@modelcontextprotocol", "sdk", "server", "stdio.js"].join("/");

/**
 * Constant-time string comparison for bearer-token checks.
 *
 * Compares lengths first (a length mismatch returns false immediately — this
 * only leaks the length, which is acceptable), then uses `timingSafeEqual` so a
 * matching-length-but-wrong-value token cannot be guessed via response-timing.
 *
 * @param a - First string (e.g. the incoming Authorization header).
 * @param b - Second string (e.g. the expected `Bearer <token>` value).
 * @param timingSafeEqual - `node:crypto`'s `timingSafeEqual`, injected by the caller
 *   so this module keeps `node:crypto` a lazy (HTTP-path-only) dependency.
 * @returns True when the two strings are byte-for-byte equal.
 * @example
 * ```ts
 * const { timingSafeEqual } = await import("node:crypto");
 * if (!constantTimeEqual(authHeader, expected, timingSafeEqual)) return unauthorized();
 * ```
 */
const constantTimeEqual = (
  a: string,
  b: string,
  timingSafeEqual: typeof import("node:crypto").timingSafeEqual
): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
};

// ─────────────────────────────────────────────────────────────────────────────
// Server builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options accepted by {@link buildMcpHandle}.
 */
export type BuildHandleOptions = {
  /** Resolved mcp plugin configuration. */
  config: Readonly<Config>;
  /** Function that registers all tools on the server (provided by lifecycle.ts). */
  registerAllTools: (server: McpServerLike) => void;
  /** Function that registers all resources on the server (provided by lifecycle.ts). */
  registerAllResources: (server: McpServerLike) => void;
  /** Pending mutation queue — written to by tool handlers, drained by the tick system. */
  pending: Array<() => void>;
  /** Drain system unsubscribe fn (stored in the handle for onStop). */
  removeDrainSystem: () => void;
  /** Stats probe system unsubscribe fn (stored in the handle for onStop). */
  removeStatsSystem: () => void;
  /**
   * Warning callback (threaded from lifecycle's `ctx.log.warn`). Invoked when a
   * requested transport is unavailable in the current environment (e.g. stdio in
   * a browser) so the skip is observable instead of a silent or opaque SDK throw.
   *
   * @param message - The warning message to surface.
   */
  warn: (message: string) => void;
};

/**
 * Builds the MCP server, registers tools and resources, connects the configured
 * transports (stdio and/or Streamable HTTP), and returns a {@link McpHandle}.
 *
 * All `@modelcontextprotocol/sdk` usage is confined here (transport seam).
 *
 * @param opts - Build options providing config, registrars, and system teardown hooks.
 * @returns A Promise resolving to the fully connected {@link McpHandle}.
 * @throws {Error} If the HTTP transport cannot bind or if the SDK throws on connect.
 * @example
 * ```ts
 * const handle = await buildMcpHandle({ config, registerAllTools, registerAllResources, ... });
 * ```
 */
export const buildMcpHandle = async (opts: BuildHandleOptions): Promise<McpHandle> => {
  const {
    config,
    registerAllTools,
    registerAllResources,
    pending,
    removeDrainSystem,
    removeStatsSystem,
    warn
  } = opts;

  /**
   * Build a fresh McpServer with the full tool + resource catalog registered.
   *
   * Used for the long-lived stdio / inMemory server AND per request in the
   * stateless HTTP path (the Streamable HTTP transport is single-use). The
   * registrars close over the shared world/queue, so every server routes
   * mutations to the same runtime.
   *
   * @returns A newly constructed, fully-registered McpServer.
   * @example
   * ```ts
   * const server = buildServer(); // tools + resources registered
   * ```
   */
  const buildServer = (): McpServer => {
    const built = new McpServer({ name: FRAMEWORK_NAME, version: FRAMEWORK_VERSION });
    // Cast via the structural interface — tools/resources never see McpServer directly.
    const builtLike = built as unknown as McpServerLike;
    registerAllTools(builtLike);
    registerAllResources(builtLike);
    return built;
  };

  // The long-lived server backing stdio / inMemory; also the source of toolNames.
  const server = buildServer();

  // Collect tool names now (list is stable after registration).
  const toolNames = extractToolNames(server as unknown as McpServerLike);

  // ── Connect configured transports (half-open-safe: on any error, close all opened) ──

  let httpEndpoint: string | undefined;
  let clientTransport: InMemoryClientTransportLike | undefined;
  let publishedGlobalKey: string | undefined;
  const closers: Array<() => Promise<void>> = [];

  try {
    if (config.transports.includes("stdio")) {
      // Guard before constructing StdioServerTransport: `process` may be wholly
      // undefined in a true browser, so probe `typeof process` first. Without
      // process.stdin the SDK throws `Cannot read properties of undefined
      // (reading 'on')` — skip + warn instead. (`&&` already coerces to boolean,
      // so no explicit Boolean() wrapper is needed.)
      if (typeof process !== "undefined" && process?.stdin) {
        // Lazy + bundler-opaque: the stdio transport statically pulls `node:process`
        // (no browser polyfill for its default export), so the specifier is assembled at
        // runtime — a browser bundler cannot statically follow it into the graph. This
        // branch only runs under Node/Bun when stdio is configured (browser apps use
        // `["inMemory"]`), so the runtime import resolves there and is never reached in
        // a browser.
        const stdioSpecifier = stdioTransportSpecifier();
        // The `typeof import(...)` annotation is type-only (erased at emit — it does NOT
        // add a static import), so it restores precise typing over the opaque specifier.
        const { StdioServerTransport } = (await import(
          stdioSpecifier
        )) as typeof import("@modelcontextprotocol/sdk/server/stdio.js");
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);
        closers.push(async () => {
          await stdioTransport.close();
        });
      } else {
        warn(
          '[mcp] stdio transport unavailable (no process.stdin) — skipping. Use "inMemory" or "http" in this environment.'
        );
      }
    }

    if (config.transports.includes("inMemory")) {
      const inMemory = await connectInMemory(server, config);
      clientTransport = inMemory.clientTransport;
      publishedGlobalKey = inMemory.publishedGlobalKey;
      closers.push(inMemory.closeInMemory);
    }

    if (config.transports.includes("http")) {
      // Pass the factory (not the long-lived server) — HTTP builds a fresh
      // server + transport per request (stateless-correct; see startHttpServer).
      const { connectHttp, closeHttp } = await startHttpServer(buildServer, config);
      httpEndpoint = connectHttp;
      closers.push(closeHttp);
    }
  } catch (connectError) {
    // Close all transports that successfully connected before the failure
    // (this also unpublishes the global key / closes the inMemory pair if that
    // branch ran before a later transport threw).
    for (const closer of closers) {
      await closer().catch(() => {
        /* ignore close errors during error-path teardown */
      });
    }
    await server.close().catch(() => {
      /* ignore server.close error during error-path teardown */
    });
    throw connectError;
  }

  /**
   * Closes all transports (HTTP listener and/or in-memory pair), deletes any
   * published `globalThis` key, then closes the MCP server.
   *
   * @returns A Promise that resolves once all transports are closed.
   * @example
   * ```ts
   * await handle.close();
   * ```
   */
  const close = async (): Promise<void> => {
    for (const closer of closers) {
      await closer();
    }
    await server.close();
  };

  return {
    running: true,
    httpEndpoint,
    toolNames,
    pending,
    removeDrainSystem,
    removeStatsSystem,
    clientTransport,
    publishedGlobalKey,
    close
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// inMemory transport (in-page browser support — no socket)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connects the server over an in-memory transport pair and (in a browser, when
 * `inMemoryGlobalKey` is non-empty) publishes the client side on `globalThis`.
 *
 * Uses `InMemoryTransport.createLinkedPair()`: the server side is connected via
 * `server.connect(serverTransport)`; the client side is retained and projected
 * to the structural {@link InMemoryClientTransportLike} so no SDK type escapes
 * this file. The returned closer closes BOTH transports of the pair and removes
 * the published global key (idempotently).
 *
 * @param server - The McpServer to connect the in-memory server transport to.
 * @param config - Resolved mcp plugin configuration (reads `inMemoryGlobalKey`).
 * @returns The structural client transport, the published key (or undefined), and a closer.
 * @example
 * ```ts
 * const { clientTransport, publishedGlobalKey, closeInMemory } = await connectInMemory(server, config);
 * ```
 */
const connectInMemory = async (
  server: McpServer,
  config: Readonly<Config>
): Promise<{
  clientTransport: InMemoryClientTransportLike;
  publishedGlobalKey: string | undefined;
  closeInMemory: () => Promise<void>;
}> => {
  const [clientPair, serverPair] = InMemoryTransport.createLinkedPair();
  await server.connect(serverPair);

  // Project the SDK client transport to the structural type (sanctioned seam cast).
  const clientTransport = clientPair as unknown as InMemoryClientTransportLike;

  // Publish on globalThis only in a browser AND when a non-empty key is set.
  const inBrowser = (globalThis as GlobalWithDocument).document !== undefined;
  const shouldPublish = inBrowser && config.inMemoryGlobalKey !== "";
  const publishedGlobalKey = shouldPublish ? config.inMemoryGlobalKey : undefined;

  if (publishedGlobalKey !== undefined) {
    (globalThis as GlobalThisRecord)[publishedGlobalKey] = clientTransport;
  }

  /**
   * Closes both transports of the in-memory pair and deletes the published
   * global key (when one was published). Idempotent.
   *
   * @returns A Promise that resolves once both transports are closed.
   * @example
   * ```ts
   * await closeInMemory();
   * ```
   */
  const closeInMemory = async (): Promise<void> => {
    if (publishedGlobalKey !== undefined) {
      delete (globalThis as GlobalThisRecord)[publishedGlobalKey];
    }
    await serverPair.close();
    await clientPair.close();
  };

  return { clientTransport, publishedGlobalKey, closeInMemory };
};

// ─────────────────────────────────────────────────────────────────────────────
// HTTP transport (Bun.serve-based, uses WebStandardStreamableHTTPServerTransport)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape of the globalThis with Bun.serve available (structural — avoids direct Bun namespace).
 */
type GlobalWithBun = {
  Bun?: {
    serve(opts: {
      port: number;
      hostname: string;
      fetch: (req: Request) => Promise<Response> | Response;
    }): { stop(force?: boolean): void };
  };
};

/**
 * Starts a Bun HTTP server that builds a fresh MCP server + Streamable HTTP
 * transport per request (stateless-correct). Returns the endpoint URL and a closer.
 *
 * @param buildServer - Factory that constructs a fully-registered McpServer per request.
 * @param config - Resolved mcp plugin configuration (host, port, auth).
 * @returns The HTTP endpoint URL string and a close function.
 * @example
 * ```ts
 * const { connectHttp, closeHttp } = await startHttpServer(buildServer, config);
 * ```
 */
const startHttpServer = async (
  buildServer: () => McpServer,
  config: Readonly<Config>
): Promise<{ connectHttp: string; closeHttp: () => Promise<void> }> => {
  const { WebStandardStreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
  );
  // Lazy: `node:crypto` is only needed for bearer-token constant-time compare on the
  // (Bun-only) HTTP path — loading it here keeps it off the browser bundle graph.
  const { timingSafeEqual } = await import("node:crypto");

  const bunGlobal = globalThis as GlobalWithBun;

  if (!bunGlobal.Bun) {
    throw new Error(
      "[game] HTTP transport requires Bun.serve.\n  Run the framework under Bun or use the stdio transport."
    );
  }

  const bearerToken = config.httpAuth === "bearer" ? config.bearerToken : undefined;

  /**
   * Handle one HTTP request with a FRESH server + transport, then dispose both.
   *
   * The SDK's Streamable HTTP transport is stateless and single-use — reusing one
   * across requests throws "Stateless transport cannot be reused across requests."
   * So each request gets its own transport (and a fresh McpServer from `buildServer`,
   * whose tool closures still target the shared world/queue). With
   * `enableJsonResponse`, `handleRequest` returns a fully-buffered Response, so
   * closing the transport/server afterwards is safe.
   *
   * @param request - The incoming HTTP Request.
   * @returns A Promise resolving to the HTTP Response.
   * @example
   * ```ts
   * const response = await handleOneRequest(request);
   * ```
   */
  const handleOneRequest = async (request: Request): Promise<Response> => {
    const perRequestServer = buildServer();
    // Omit sessionIdGenerator to let the SDK use its stateless default.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await perRequestServer.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await transport.close();
      await perRequestServer.close();
    }
  };

  const bunServer = bunGlobal.Bun.serve({
    port: config.httpPort,
    hostname: config.httpHost,
    /**
     * Applies optional bearer auth, then delegates to a fresh per-request transport.
     *
     * @param request - The incoming HTTP Request object.
     * @returns A Promise resolving to the HTTP Response.
     * @example
     * ```ts
     * // Handled automatically by Bun.serve — not called directly.
     * ```
     */
    fetch: async (request: Request): Promise<Response> => {
      // Bearer auth gate — constant-time compare to avoid token-guessing via timing
      if (bearerToken !== undefined) {
        const auth = request.headers.get("authorization");
        if (!auth || !constantTimeEqual(auth, `Bearer ${bearerToken}`, timingSafeEqual)) {
          return new Response("Unauthorized", { status: 401 });
        }
      }
      return handleOneRequest(request);
    }
  });

  const endpoint = `http://${config.httpHost}:${config.httpPort}${MCP_PATH}`;

  /**
   * Stops the Bun HTTP server. Per-request transports are already closed in
   * {@link handleOneRequest}, so there is no long-lived transport to tear down.
   *
   * @returns A Promise that resolves when the server is stopped.
   * @example
   * ```ts
   * await closeHttp();
   * ```
   */
  const closeHttp = async (): Promise<void> => {
    bunServer.stop(true);
  };

  return { connectHttp: endpoint, closeHttp };
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts registered tool names from the structural McpServerLike.
 * Uses a duck-typed cast: the real McpServer stores tools in `_registeredTools`
 * as a plain object (keyed by tool name) in SDK 1.29.0.
 *
 * @param server - The structural server interface (actually McpServer under the hood).
 * @returns Array of registered tool name strings.
 * @example
 * ```ts
 * const names = extractToolNames(serverLike);
 * ```
 */
const extractToolNames = (server: McpServerLike): string[] => {
  // SDK 1.29.0: _registeredTools is a plain object { [toolName]: RegisteredTool }
  const raw = server as unknown as { _registeredTools?: Record<string, unknown> };
  if (raw._registeredTools) {
    return Object.keys(raw._registeredTools);
  }
  return [];
};
