# mcp

> Complex plugin — first-class MCP server exposing the whole runtime to agent clients over stdio, Streamable HTTP, and/or an in-page `inMemory` transport.

The `mcp` plugin attaches a Model Context Protocol server to the running game framework. Agent clients (Claude, Cursor, etc.) can **read live game state** (every entity's named components, the Pixi scene graph), **inject input to play** (`input:key`), control the game loop, **perform real ECS mutations** (spawn with components, set/remove components), **attach visible primitives** so spawned entities actually render, trigger scene loads, and capture **reliable screenshots** — all without touching the game code directly.

Mutating tools return **honest results**: inputs are validated up front, so an unknown component name, a dead entity, or an unknown scene name comes back as an MCP error (`isError`) or `{ changed: false }` rather than an optimistic success. When a component name is unknown, the error lists the known names.

The default transport is **environment-aware**: under Node/Bun it is `["stdio"]`; in a browser (where `document` is present) it is `["inMemory"]`, so a default `createApp().start()` runs in-page without a socket and never crashes on a missing `process.stdin`.

Mutations are frame-safe: every mutating tool enqueues a closure that is drained on the next `"input"` stage tick, so ECS operations never interrupt an active iteration. Read-only tools and loop controls are called directly between frames.

## API

Accessed as `app.mcp.*` after `createApp()`:

### `isRunning(): boolean`

Returns `true` when the MCP server is connected and listening on at least one transport. Returns `false` before `onStart` resolves or after `onStop` completes.

```ts
const running = app.mcp.isRunning(); // true | false
```

### `httpEndpoint(): string | undefined`

Returns the resolved HTTP endpoint URL (e.g. `http://127.0.0.1:3333/mcp`) when the `"http"` transport is active, or `undefined` when only `"stdio"`/`"inMemory"` is used.

```ts
const url = app.mcp.httpEndpoint(); // "http://127.0.0.1:3333/mcp" | undefined
```

### `toolNames(): readonly string[]`

Returns the names of all registered MCP tools (useful for diagnostics and tests). The list is stable after `onStart` completes.

```ts
const names = app.mcp.toolNames();
// ["ecs:spawn", "ecs:despawn", "ecs:query", "renderer:screenshot", ...]
```

### `clientTransport(): InMemoryClientTransportLike | undefined`

Returns the in-page MCP client transport paired with the connected server when the `"inMemory"` transport is active, or `undefined` otherwise (and before `onStart` / after `onStop`). Pass it to an SDK MCP `Client` to drive the live runtime from in-page agent code. The return type is a **structural** subset of the SDK `Transport` interface, so no `@modelcontextprotocol/sdk` dependency leaks into the public surface.

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

const transport = app.mcp.clientTransport();
if (transport) {
  const client = new Client({ name: "in-page-agent", version: "0.0.0" });
  await client.connect(transport); // drive the live runtime in-page, no socket
}
```

When the `"inMemory"` transport is active in a browser and `inMemoryGlobalKey` is non-empty, this same client transport is also published on `globalThis[inMemoryGlobalKey]` (default `"__MOKU_GAME_MCP__"`) so an out-of-page bridge can reach it without an app reference. The key is removed on `onStop`.

## MCP Tool Catalog

The server registers **15 tools**: **4 read-only** (always registered) and **11 mutation/play tools** (registered only when `enableMutations: true`, the default). Tool names use a `domain:action` form with a `:` separator (see the *Tool naming* design note re SEP-986).

### Read-only tools (always registered)

| Tool | Description |
|---|---|
| `ecs:query` | Queries **all** live entities, optionally filtered to those having every name in `componentNames` (empty/omitted = all). Returns `{ entities: [{ id, components: [{ name, value }] }], count }`. An unknown name returns an error listing the known component names. Only components defined with `{ name }` are queryable (the renderer's `Transform` is named by default). |
| `renderer:screenshot` | Returns the current frame as a raw base64 PNG (data-URI prefix stripped) via Pixi's `extract` system — **reliable regardless of frame timing**, including while paused. Not-available result when headless / not started. |
| `renderer:tree` | Returns the Pixi scene graph rooted at the stage — `{ label, type, x, y, rotation, scaleX, scaleY, visible, alpha, width, height, text?, children }` where `type` is one of `Container`/`Sprite`/`Text`/`Graphics`. The most direct way to read on-screen positions and text. Not-available result when headless. |
| `scene:getInfo` | Returns `{ current, scenes, owned }` — the current scene name (or `undefined`), all registered scene names (`scene.sceneNames()`), and the entity handles owned by the current scene (`scene.ownedEntities()`). |

### Mutation / play tools (registered when `enableMutations: true`)

| Tool | Description |
|---|---|
| `ecs:spawn` | Spawns an entity, optionally with components: `{ components?: Record<string, Record<string, unknown>> }` (component name → partial value). All names are validated first via `world.componentByName()` — **any** unknown name aborts the spawn before creating anything (error lists known names). Returns `{ entity }`, or `{ entity, components }` when components were applied. Adds the entity to the MCP-tracked set. |
| `ecs:despawn` | Despawns an entity by id. Returns `{ despawned: id, changed }` — `changed` is `false` when the entity was already dead (no optimistic success). Removes the entity from the tracked set. |
| `ecs:setComponent` | **Real upsert.** `{ id, component, value }`. Resolves `component` via `componentByName` (unknown → error listing known names) and validates the entity is alive (dead → error). Then shallow-merges with `world.set` if present, or adds (default-merged with `value`) via `world.add` if absent. Returns `{ id, component, changed: true, value }`. |
| `ecs:removeComponent` | **Real removal.** `{ id, component }`. Same name + liveness validation as `ecs:setComponent`. Returns `{ id, component, changed }` — `changed` is `false` when the component was not present. |
| `renderer:attach` | Attaches a **visible primitive** to an entity so a spawned entity actually renders: `{ id, spec }` where `spec` is a `PrimitiveSpec` (`shape: "rect" \| "circle" \| "line" \| "polygon"` + geometry + optional `fill` / `stroke` / `strokeWidth` / `alpha` / `label`). Validates the entity is alive, then calls `renderer.attachPrimitive(entity, spec)` so the sync system positions the Graphics from the entity's `Transform`. Returns `{ id, attached: true }`, or an error when the renderer is headless / not started. |
| `input:key` | Injects a key so an agent can play: `{ key, action: "down" \| "up" \| "press" }`. `down` holds, `up` releases, `press` is a one-frame tap. Applied immediately (not command-buffered); the next `loop:step`/tick observes it. `"Space"` is normalised to the real spacebar (`KeyboardEvent.key === " "`) by the input plugin. |
| `loop:step` | Advances the loop by exactly one fixed step and renders once (deterministic). Returns the frame clock snapshot `{ stepped: true, frame, elapsed, dt }` for the just-advanced step. |
| `loop:pause` | Pauses the rAF-driven game loop. |
| `loop:resume` | Resumes the rAF-driven game loop. |
| `scene:load` | Loads a named scene (unloads current scene first). The name is validated against `scene.sceneNames()` before scheduling — an unknown name returns an error listing known scenes (nothing scheduled). Returns `{ scheduled: name }`; the async load is fire-and-forget, so poll `game://scene/current` for completion. |
| `game:reset` | Hard reset: despawns all MCP-tracked entities, clears the tracked set, calls `scene.unload()`, then **emits the `game:reset` event** (see [Events](#events)). Deferred to the next input-stage tick. Engine-internal — does not touch consumer state. |

## MCP Resource Catalog

| URI | Description |
|---|---|
| `game://world/snapshot` | JSON snapshot of **every live entity** with its named component values: `{ entities: [{ id, components: [{ name, value }] }], count }`. |
| `game://systems/list` | JSON list of registered scheduler **stage names only** — systems are anonymous functions with no names, so per-stage system names/counts are not tracked. Returns `{ stages: [...] }`. |
| `game://stats/frame` | JSON with current `frame` number, `lastDt` (seconds), and the **true live** `entityCount`. |
| `game://scene/current` | JSON with the `current` scene name, or `undefined` when no scene is loaded. |

## Events

The plugin declares one typed event:

| Event | Payload | When it fires |
|---|---|---|
| `game:reset` | `{ reason: "mcp" }` | Emitted **after** the `game:reset` tool's hard-reset closure runs — i.e. once all MCP-tracked entities have been despawned and the current scene has been unloaded. |

`game:reset` is **engine-internal**: the reset itself only despawns MCP-tracked entities and unloads the scene; it does **not** touch consumer state (scores, flags, UI). Consumers listen to this event to re-initialise their own state after a reset — for example, re-loading a default scene or clearing a scoreboard:

```ts
ctx.on(mcpPlugin, "game:reset", ({ reason }) => {
  // reason === "mcp"
  scene.load("menu"); // re-establish a known starting state
});
```

The tool threads the plugin's `ctx.emit` in as an `emitReset()` closure (tool code has no `ctx`), so the event is emitted on the plugin event bus right after cleanup completes.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `transports` | `ReadonlyArray<"stdio" \| "http" \| "inMemory">` | env-aware: `["inMemory"]` in a browser, `["stdio"]` under Node/Bun | Which transports to expose. `"inMemory"` is in-page only (no socket). |
| `httpHost` | `string` | `"127.0.0.1"` | HTTP server bind address (localhost only by default for safety). |
| `httpPort` | `number` | `3333` | HTTP server port. |
| `httpAuth` | `"none" \| "bearer"` | `"none"` | HTTP auth mode. `"none"` trusts the local network; `"bearer"` requires a token on every request. |
| `bearerToken` | `string` | `""` | Required when `httpAuth === "bearer"`. Must be non-empty — validated at startup. |
| `enableMutations` | `boolean` | `true` | When `false`, only the four read-only tools are registered (`ecs:query`, `renderer:tree`, `renderer:screenshot`, `scene:getInfo`). |
| `inMemoryGlobalKey` | `string` | `"__MOKU_GAME_MCP__"` | `globalThis` property name on which the in-page client transport is published when `"inMemory"` is active in a browser. Set to `""` to disable the publish (the `clientTransport()` API still works). |

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

- **SDK isolation:** all `@modelcontextprotocol/sdk` imports are confined to `transport.ts`. Swapping the SDK version only requires editing that one file. `defaultTransports()` lives there too but is a pure environment probe with no SDK call.
- **Environment-aware default + `inMemory` transport:** `defaultTransports()` selects `["inMemory"]` in a browser and `["stdio"]` under Node/Bun, so the same `createApp()` works in both. The `inMemory` transport is built on the SDK's `InMemoryTransport.createLinkedPair()` — the server side is connected, the client side is retained on the handle and exposed via `clientTransport()`. It is in-page only (reachable solely by code in the same realm), so it carries no network surface.
- **stdio guard:** before constructing the stdio transport the plugin checks `typeof process !== "undefined" && process.stdin`; in a browser (no `process.stdin`) it skips stdio and emits a `ctx.log.warn` rather than letting the SDK throw an opaque `reading 'on'` error.
- **Frame-safe mutations:** every mutating tool that touches ECS structure or scene state (`ecs:spawn`, `ecs:despawn`, `ecs:setComponent`, `ecs:removeComponent`, `renderer:attach`, `scene:load`, `game:reset`) pushes a closure into a `pending: Array<() => void>` queue drained on each `"input"` stage tick, so mutations never interrupt an active world iteration. `input:key` is the exception — it mutates the input edge-sets **directly** (between frames, exactly like a real DOM event); draining it would run *after* the input-stage snapshot system and garble edge timing. `loop:*` controls and the read-only tools also call directly between frames.
- **Honest results / input validation:** mutating tools validate inputs **before** enqueuing — unknown component names (`world.componentByName` miss) and dead entities (`!world.isAlive`) return an `isError` result, and unknown scene names (`scene.sceneNames()` miss) return an error listing known scenes. Errors that list known names give an agent an actionable next step instead of a silent or falsely-successful response. Tools that may legitimately no-op report `{ changed: false }` (e.g. despawning a dead id, removing an absent component).
- **Real ECS mutation triad:** `ecs:spawn` (with `components`), `ecs:setComponent`, and `ecs:removeComponent` perform genuine, command-buffered ECS mutations, resolving component names to tokens through the ECS `componentByName` resolver. `ecs:setComponent` upserts (shallow-merge via `world.set` when present, default-merged `world.add` when absent). `renderer:attach` complements them so a spawned entity can be made visible (`spawn → setComponent(Transform) → renderer:attach → it renders`).
- **Reading state:** `ecs:query`, `game://world/snapshot`, and `entityCount` use the ECS introspection facet (`liveEntities`/`entityCount`/`componentsOf`) — they cover the **whole** live world, not just MCP-spawned entities. Components are visible by name only when defined with `{ name }` (the renderer names its `Transform`). For positions/text of arbitrary Pixi objects, use `renderer:tree`.
- **Reliable screenshots:** `renderer:screenshot` calls `renderer.screenshot()` → `app.renderer.extract.base64(stage)`, which re-renders into an extract target, so a capture taken while paused is never blank (unlike reading the WebGL backbuffer).
- **Stateless HTTP:** the `"http"` transport builds a fresh MCP server + transport **per request** (the SDK's Streamable HTTP transport is single-use), so repeated requests no longer throw *"Stateless transport cannot be reused across requests."* `stdio`/`inMemory` keep one long-lived server.
- **Scene must be defined at boot for agent control:** an agent can only `scene:load` scenes that have been `define()`d. **Define (and, if appropriate, load) scenes at startup — do not gate `define`/`load` behind a DOM menu** — otherwise an agent driving the page through the `inMemory` bridge cannot start a match.
- **Half-open safety:** if any transport fails to connect during startup, all already-connected transports are closed before the error propagates.
- **WeakMap pattern:** per-instance state (the `McpHandle`) is stored in a module-level `WeakMap<object, McpHandle>` keyed on `ctx.global`, mirroring the `loop` plugin's teardown pattern.
- **Tool naming (`:` separator):** tool names use a `domain:action` form (`ecs:spawn`, `loop:step`, …) per the framework spec. The MCP SDK warns that `:` is non-standard (SEP-986 permits only `A–Z a–z 0–9 _ - .`) and registration still proceeds, but a strict MCP client may reject or mis-display these names. This is a deliberate, spec-faithful choice; if you target strict clients, front them with a name-mapping adapter.
- **Bearer auth:** when `httpAuth: "bearer"`, the HTTP handler compares the `Authorization` header to the configured token in constant time (`node:crypto` `timingSafeEqual`) to avoid token-guessing via response timing. The token is validated as non-empty at startup.
