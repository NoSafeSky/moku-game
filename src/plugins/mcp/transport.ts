/**
 * @file mcp plugin — transport construction (isolates `@modelcontextprotocol/sdk`).
 */

/**
 * Creates the MCP server and wires the configured transports (stdio / Streamable HTTP).
 * All `@modelcontextprotocol/sdk` types stay isolated here; the public signature is structural.
 *
 * @param _opts - Resolved transport options (host, port, auth, transports).
 * @example
 * ```ts
 * const server = createServer({ httpHost: "127.0.0.1", httpPort: 3333 });
 * ```
 */
export function createServer(_opts: unknown): unknown {
  throw new Error("not implemented");
}
