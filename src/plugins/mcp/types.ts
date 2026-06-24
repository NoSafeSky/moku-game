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
   * Transports to expose.
   *
   * @default ["stdio"]
   */
  transports: ReadonlyArray<"stdio" | "http">;
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
};

/** mcp plugin state. */
export type State = {
  /**
   * Frame stats sampled for the stats resource.
   * Updated each render tick by a lightweight probe system.
   */
  stats: { frame: number; lastDt: number; entityCount: number };
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
  /** Closes the MCP server and HTTP listener. */
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
