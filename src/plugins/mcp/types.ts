/**
 * @file mcp plugin — type definitions.
 */

/** mcp plugin configuration. */
export type Config = {
  /** Transports to expose. `@default ["stdio"]` */
  transports: ReadonlyArray<"stdio" | "http">;
  /** HTTP host (localhost by default). `@default "127.0.0.1"` */
  httpHost: string;
  /** HTTP port. `@default 3333` */
  httpPort: number;
  /** HTTP auth mode. `@default "none"` */
  httpAuth: "none" | "bearer";
  /** Bearer token (required when httpAuth==="bearer"). `@default ""` */
  bearerToken: string;
  /** Register mutating tools. `@default true` */
  enableMutations: boolean;
};

/** mcp plugin state. */
export type State = {
  /** Frame stats sampled for the stats resource. */
  stats: { frame: number; lastDt: number; entityCount: number };
};

/** mcp plugin API. */
export type Api = {
  /** Whether the MCP server is connected/listening. */
  isRunning(): boolean;
  /** The resolved HTTP endpoint, or null if HTTP transport disabled. */
  httpEndpoint(): string | null;
  /** Names of the registered MCP tools. */
  toolNames(): readonly string[];
};
