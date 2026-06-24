# mcp

> Complex plugin — first-class MCP server exposing the whole runtime to agent clients over stdio and/or Streamable HTTP.

The `mcp` plugin attaches a Model Context Protocol server to the running game framework. Agent clients (Claude, Cursor, etc.) can query live runtime state, control the game loop, spawn and despawn entities, trigger scene loads, and capture screenshots — all without touching the game code directly.

Mutations are frame-safe: every mutating tool enqueues a closure that is drained on the next `"input"` stage tick, so ECS operations never interrupt an active iteration. Read-only tools and loop controls are called directly between frames.

## API

Accessed as `app.mcp.*` after `createApp()`:

### `isRunning(): boolean`

Returns `true` when the MCP server is connected and listening on at least one transport. Returns `false` before `onStart` resolves or after `onStop` completes.

```ts
const running = app.mcp.isRunning(); // true | false
```

### `httpEndpoint(): string | undefined`

Returns the resolved HTTP endpoint URL (e.g. `http://127.0.0.1:3333/mcp`) when the `"http"` transport is active, or `undefined` when only `"stdio"` is used.

```ts
const url = app.mcp.httpEndpoint(); // "http://127.0.0.1:3333/mcp" | undefined
```

### `toolNames(): readonly string[]`

Returns the names of all registered MCP tools (useful for diagnostics and tests). The list is stable after `onStart` completes.

```ts
const names = app.mcp.toolNames();
// ["ecs:spawn", "ecs:despawn", "ecs:query", "renderer:screenshot", ...]
```

## MCP Tool Catalog

### Read-only tools (always registered)

| Tool | Description |
|---|---|
| `ecs:query` | Returns MCP-tracked entity ids and count. v1: `componentNames` filter is not applied (component tokens are opaque runtime objects). |
| `renderer:screenshot` | Returns the current frame as a raw base64 PNG string (data-URI prefix stripped). Returns an error result if the renderer has not started yet. |
| `scene:getInfo` | Returns the current scene name, or `undefined` when no scene is loaded. |

### Mutating tools (registered when `enableMutations: true`)

| Tool | Description |
|---|---|
| `ecs:spawn` | Spawns a new entity with no components. Returns `{ entity: number }`. Adds the entity to the MCP-tracked set. |
| `ecs:despawn` | Despawns an entity by numeric id. Removes the entity from the tracked set. |
| `ecs:setComponent` | v1 no-op — component tokens are not addressable by string name. Returns `{ status: "v1-noop" }`. |
| `ecs:removeComponent` | v1 no-op — same limitation as `ecs:setComponent`. Returns `{ status: "v1-noop" }`. |
| `loop:step` | Advances the loop by exactly one fixed step (deterministic tick). |
| `loop:pause` | Pauses the rAF-driven game loop. |
| `loop:resume` | Resumes the rAF-driven game loop. |
| `scene:load` | Loads a named scene (enqueued — unloads current scene first). |
| `game:reset` | Despawns all MCP-tracked entities, clears the tracked set, and calls `scene.unload()`. Deferred to the next input-stage tick. |

## MCP Resource Catalog

| URI | Description |
|---|---|
| `game://world/snapshot` | JSON snapshot of all MCP-tracked entity ids. v1: only entities spawned via `ecs:spawn`. |
| `game://systems/list` | JSON list of registered scheduler stage names. |
| `game://stats/frame` | JSON with current `frame` number, `lastDt` (seconds), and MCP-tracked `entityCount`. |
| `game://scene/current` | JSON with the `current` scene name, or `undefined` when no scene is loaded. |

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `transports` | `ReadonlyArray<"stdio" \| "http">` | `["stdio"]` | Which transports to expose. |
| `httpHost` | `string` | `"127.0.0.1"` | HTTP server bind address (localhost only by default for safety). |
| `httpPort` | `number` | `3333` | HTTP server port. |
| `httpAuth` | `"none" \| "bearer"` | `"none"` | HTTP auth mode. `"none"` trusts the local network; `"bearer"` requires a token on every request. |
| `bearerToken` | `string` | `""` | Required when `httpAuth === "bearer"`. Must be non-empty — validated at startup. |
| `enableMutations` | `boolean` | `true` | When `false`, only the three read-only tools are registered (`ecs:query`, `renderer:screenshot`, `scene:getInfo`). |

## Usage Example

```ts
import { createApp } from "./index";

const app = createApp({
  pluginConfigs: {
    mcp: {
      transports: ["stdio", "http"],
      httpPort: 3333,
      httpAuth: "bearer",
      bearerToken: process.env.MCP_TOKEN ?? "",
      enableMutations: true
    }
  }
});

await app.start();

console.log("MCP running:", app.mcp.isRunning());
console.log("HTTP endpoint:", app.mcp.httpEndpoint());
console.log("Tools:", app.mcp.toolNames());
```

## Design Notes

- **SDK isolation:** all `@modelcontextprotocol/sdk` imports are confined to `transport.ts`. Swapping the SDK version only requires editing that one file.
- **Frame-safe mutations:** mutating tools push closures into a `pending: Array<() => void>` queue that is spliced and drained on each `"input"` stage tick by a registered ECS system.
- **Tracked entities:** only entities spawned through `ecs:spawn` appear in the tracked set. The ECS world has no public enumerate-all API (v1 limitation).
- **Half-open safety:** if any transport fails to connect during startup, all already-connected transports are closed before the error propagates.
- **WeakMap pattern:** per-instance state (the `McpHandle`) is stored in a module-level `WeakMap<object, McpHandle>` keyed on `ctx.global`, mirroring the `loop` plugin's teardown pattern.
- **Tool naming (`:` separator):** tool names use a `domain:action` form (`ecs:spawn`, `loop:step`, …) per the framework spec. The MCP SDK warns that `:` is non-standard (SEP-986 permits only `A–Z a–z 0–9 _ - .`) and registration still proceeds, but a strict MCP client may reject or mis-display these names. This is a deliberate, spec-faithful choice; if you target strict clients, front them with a name-mapping adapter.
- **Bearer auth:** when `httpAuth: "bearer"`, the HTTP handler compares the `Authorization` header to the configured token in constant time (`node:crypto` `timingSafeEqual`) to avoid token-guessing via response timing. The token is validated as non-empty at startup.
