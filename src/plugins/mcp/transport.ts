/**
 * @file mcp plugin — transport construction (SDK isolation seam).
 *
 * ALL `@modelcontextprotocol/sdk` imports are confined to this file.
 * Everything exported uses structural types from types.ts so no SDK namespace
 * leaks into tools.ts, resources.ts, api.ts, lifecycle.ts, or the public .d.ts.
 *
 * v1 boundary: to swap the SDK (e.g. v2, browser transport) only edit this file.
 */
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Config, McpHandle, McpServerLike } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FRAMEWORK_NAME = "game";
const FRAMEWORK_VERSION = "0.1.0";
const MCP_PATH = "/mcp";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constant-time string comparison for bearer-token checks.
 *
 * Compares lengths first (a length mismatch returns false immediately — this
 * only leaks the length, which is acceptable), then uses `timingSafeEqual` so a
 * matching-length-but-wrong-value token cannot be guessed via response-timing.
 *
 * @param a - First string (e.g. the incoming Authorization header).
 * @param b - Second string (e.g. the expected `Bearer <token>` value).
 * @returns True when the two strings are byte-for-byte equal.
 * @example
 * ```ts
 * if (!constantTimeEqual(authHeader, expected)) return unauthorized();
 * ```
 */
const constantTimeEqual = (a: string, b: string): boolean => {
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
    removeStatsSystem
  } = opts;

  // Build the McpServer (SDK class; stays inside this file)
  const server = new McpServer({ name: FRAMEWORK_NAME, version: FRAMEWORK_VERSION });

  // Cast via the structural interface — tools/resources never see McpServer directly
  const serverLike = server as unknown as McpServerLike;

  // Register all tools and resources via structural interface
  registerAllTools(serverLike);
  registerAllResources(serverLike);

  // Collect tool names now (before connect — list is stable after registration)
  const toolNames = extractToolNames(serverLike);

  // ── Connect configured transports (half-open-safe: on any error, close all opened) ──

  let httpEndpoint: string | undefined;
  const closers: Array<() => Promise<void>> = [];

  try {
    if (config.transports.includes("stdio")) {
      const stdioTransport = new StdioServerTransport();
      await server.connect(stdioTransport);
      closers.push(async () => {
        await stdioTransport.close();
      });
    }

    if (config.transports.includes("http")) {
      const { connectHttp, closeHttp } = await startHttpServer(server, config);
      httpEndpoint = connectHttp;
      closers.push(closeHttp);
    }
  } catch (connectError) {
    // Close all transports that successfully connected before the failure
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
   * Closes all transports and the MCP server.
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
    close
  };
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
 * Starts a Bun HTTP server wrapping the Streamable HTTP MCP transport.
 * Returns the endpoint URL and a closer function.
 *
 * @param server - The McpServer to connect the HTTP transport to.
 * @param config - Resolved mcp plugin configuration (host, port, auth).
 * @returns The HTTP endpoint URL string and a close function.
 * @example
 * ```ts
 * const { connectHttp, closeHttp } = await startHttpServer(server, config);
 * ```
 */
const startHttpServer = async (
  server: McpServer,
  config: Readonly<Config>
): Promise<{ connectHttp: string; closeHttp: () => Promise<void> }> => {
  const { WebStandardStreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
  );

  // Omit sessionIdGenerator to let SDK use its default (avoids exactOptionalPropertyTypes violation)
  const httpTransport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true
  });

  await server.connect(httpTransport);

  const bunGlobal = globalThis as GlobalWithBun;

  if (!bunGlobal.Bun) {
    throw new Error(
      "[game] HTTP transport requires Bun.serve.\n  Run the framework under Bun or use the stdio transport."
    );
  }

  const bearerToken = config.httpAuth === "bearer" ? config.bearerToken : undefined;

  const bunServer = bunGlobal.Bun.serve({
    port: config.httpPort,
    hostname: config.httpHost,
    /**
     * Handles an incoming HTTP request, applying optional bearer auth before
     * delegating to the Streamable HTTP MCP transport.
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
        if (!auth || !constantTimeEqual(auth, `Bearer ${bearerToken}`)) {
          return new Response("Unauthorized", { status: 401 });
        }
      }
      return httpTransport.handleRequest(request);
    }
  });

  const endpoint = `http://${config.httpHost}:${config.httpPort}${MCP_PATH}`;

  /**
   * Stops the Bun HTTP server.
   *
   * @returns A Promise that resolves when the server is stopped.
   * @example
   * ```ts
   * await closeHttp();
   * ```
   */
  const closeHttp = async (): Promise<void> => {
    bunServer.stop(true);
    await httpTransport.close();
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
