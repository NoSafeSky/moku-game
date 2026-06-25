/**
 * @file mcp plugin — type definitions.
 *
 * Internal structural types (McpHandle, McpServerLike, McpApiContext) are defined
 * here alongside public Config/State/Api so types.ts and index.ts remain free of
 * any `@modelcontextprotocol/sdk` import (transport seam rule).
 */

/** mcp plugin configuration. */
export type Config = {
  /**
   * Transport(s) to expose.
   *
   * @default environment-aware: browser → ["inMemory"], Node/Bun → ["stdio"]
   */
  transports: ReadonlyArray<"stdio" | "http" | "inMemory">;
  /**
   * HTTP host (localhost by default for safety).
   *
   * @default "127.0.0.1"
   */
  httpHost: string;
  /**
   * HTTP port.
   *
   * @default 3333
   */
  httpPort: number;
  /**
   * HTTP auth mode. "none" (localhost trust) or "bearer" (require a token).
   *
   * @default "none"
   */
  httpAuth: "none" | "bearer";
  /**
   * Bearer token required when httpAuth === "bearer".
   *
   * @default ""
   */
  bearerToken: string;
  /**
   * Register mutating tools (false → read-only introspection only).
   *
   * @default true
   */
  enableMutations: boolean;
  /**
   * globalThis property name on which the in-page client transport is published
   * when the "inMemory" transport is active in a browser. `""` disables the
   * publish (the {@link Api.clientTransport} method still works).
   *
   * @default "__MOKU_GAME_MCP__"
   */
  inMemoryGlobalKey: string;
};

/** mcp plugin state. */
export type State = {
  /**
   * Frame stats sampled for the stats resource.
   * Updated each render tick by a lightweight probe system.
   */
  stats: { frame: number; lastDt: number; entityCount: number };
};

/**
 * Structural subset of the SDK `Transport` interface exposed for the in-page
 * "inMemory" client side.
 *
 * Matches the shape of `@modelcontextprotocol/sdk`'s `Transport` so a consumer
 * can hand it to an MCP `Client` without this plugin importing the SDK outside
 * `transport.ts`. Keeping it structural (no SDK import) keeps the SDK out of the
 * public `.d.ts`.
 *
 * @example
 * ```ts
 * import { Client } from "@modelcontextprotocol/sdk/client/index.js";
 * const transport = app.mcp.clientTransport();
 * if (transport) await new Client({ name: "agent", version: "0.0.0" }).connect(transport);
 * ```
 */
export type InMemoryClientTransportLike = {
  /**
   * Starts the transport (begins processing queued messages).
   *
   * @returns A Promise that resolves once the transport has started.
   */
  start(): Promise<void>;
  /**
   * Sends a JSON-RPC message to the paired server transport.
   *
   * @param message - The JSON-RPC message to send.
   * @param options - Optional send options (e.g. related request id / auth info).
   * @returns A Promise that resolves once the message has been queued/sent.
   */
  send(message: unknown, options?: unknown): Promise<void>;
  /**
   * Closes the transport and signals the paired transport to close.
   *
   * @returns A Promise that resolves once the transport is closed.
   */
  close(): Promise<void>;
  /** Invoked when the transport closes. */
  onclose?: () => void;
  /**
   * Invoked when the transport encounters an error.
   *
   * @param error - The error that occurred.
   */
  onerror?: (error: Error) => void;
  /**
   * Invoked when a message is received from the paired transport.
   *
   * @param message - The received JSON-RPC message.
   * @param extra - Optional transport-specific metadata (e.g. auth info).
   */
  onmessage?: (message: unknown, extra?: unknown) => void;
  /** Optional session id assigned by the transport. */
  sessionId?: string;
};

/** mcp plugin API — small surface, the rich functionality is the MCP tool/resource catalog. */
export type Api = {
  /**
   * Whether the MCP server is connected/listening.
   *
   * @returns True when the server is running.
   */
  isRunning(): boolean;
  /**
   * The resolved HTTP endpoint (e.g. http://127.0.0.1:3333/mcp), or undefined if HTTP transport disabled.
   *
   * @returns The endpoint URL string, or undefined.
   */
  httpEndpoint(): string | undefined;
  /**
   * Names of the registered MCP tools (for diagnostics/tests).
   *
   * @returns Read-only array of tool names.
   */
  toolNames(): readonly string[];
  /**
   * The in-page MCP client transport (paired with the connected server) when the
   * "inMemory" transport is active, else undefined.
   *
   * Pass it to an SDK MCP `Client` to drive the live runtime from in-page agent
   * code with no socket. The return type is structural — no SDK dependency leaks
   * into the public surface. Before start or after stop (no handle) → undefined.
   *
   * @returns The in-page client transport, or undefined.
   */
  clientTransport(): InMemoryClientTransportLike | undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal structural types (transport seam — no SDK imports here)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structural subset of McpServer methods used by tools.ts and resources.ts.
 * This allows tool/resource code to be tested against a fake without importing the SDK.
 */
export type McpServerLike = {
  /**
   * Register a tool on the server.
   *
   * @param name - Tool name.
   * @param config - Tool metadata.
   * @param config.title - Human-readable display title (optional).
   * @param config.description - Description shown to agent clients (optional).
   * @param config.inputSchema - Zod-based input schema as a record (optional).
   * @param config.annotations - Behavioural hints for the client (optional).
   * @param config.annotations.readOnlyHint - True if the tool only reads state (optional).
   * @param config.annotations.destructiveHint - True if the tool mutates state (optional).
   * @param config.annotations.openWorldHint - True if tool affects external resources (optional).
   * @param config.annotations.idempotentHint - True if repeated calls are safe (optional).
   * @param config.annotations.title - Display title inside annotations (optional).
   * @param handler - Async handler returning CallToolResult-compatible object.
   */
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        openWorldHint?: boolean;
        idempotentHint?: boolean;
        title?: string;
      };
    },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult
  ): void;
  /**
   * Register a resource on the server.
   *
   * @param name - Resource name.
   * @param uri - Resource URI string.
   * @param config - Resource metadata.
   * @param config.title - Human-readable display title (optional).
   * @param config.description - Description shown to agent clients (optional).
   * @param config.mimeType - MIME type of the resource content (optional).
   * @param readCallback - Callback returning resource contents.
   */
  registerResource(
    name: string,
    uri: string,
    config: { title?: string; description?: string; mimeType?: string },
    readCallback: (uri: URL) => Promise<McpResourceResult> | McpResourceResult
  ): void;
};

/**
 * Result shape returned by MCP tool handlers.
 * Matches CallToolResult from the SDK.
 */
export type McpToolResult = {
  /** Content items returned to the client. */
  content: Array<{ type: "text"; text: string }>;
  /** Whether the tool invocation resulted in an error. */
  isError?: boolean;
};

/**
 * Result shape returned by MCP resource read callbacks.
 * Matches ReadResourceResult from the SDK.
 */
export type McpResourceResult = {
  /** Resource content items. */
  contents: Array<{ uri: string; mimeType?: string; text: string }>;
};

/**
 * Per-instance handle stored in the module-level WeakMap keyed on ctx.global.
 * Mirrors the LoopRuntime pattern from the loop plugin.
 */
export type McpHandle = {
  /** Whether the MCP server is running (connected). */
  running: boolean;
  /** The HTTP endpoint URL, or undefined if HTTP transport not active. */
  httpEndpoint: string | undefined;
  /** Names of all registered tools (for toolNames() API). */
  toolNames: string[];
  /** Pending mutations to be drained on the next input-stage tick. */
  pending: Array<() => void>;
  /** Unsubscribe function for the drain system registered on the input stage. */
  removeDrainSystem: () => void;
  /** Unsubscribe function for the stats probe system registered on the render stage. */
  removeStatsSystem: () => void;
  /**
   * The in-page client transport paired with the connected server when the
   * "inMemory" transport is active, else undefined. Retained for the
   * {@link Api.clientTransport} method.
   */
  clientTransport?: InMemoryClientTransportLike | undefined;
  /**
   * The `globalThis` key on which the client transport was published, or
   * undefined when nothing was published (key was `""` or not in a browser).
   * Lets teardown delete the published global key idempotently.
   */
  publishedGlobalKey?: string | undefined;
  /** Closes the MCP server, every transport (HTTP + inMemory pair), and removes any published global key. */
  close: () => Promise<void>;
};

/**
 * Structural context type required by createApi (api.ts).
 * Only declares fields actually accessed — unit tests supply a minimal mock.
 */
export type McpApiContext = {
  /** Global plugin registry — key for the module-level WeakMap. */
  readonly global: object;
};
