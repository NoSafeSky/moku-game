# commands

> Standard plugin — the single validated **write-authority** for editor-driven ECS mutation, and the owner of the save-durable **`EditorId`**.

Every editor mutation funnels through `commands`: build a serializable, discriminated-union `Command` (`spawn` / `despawn` / `setField` / `addComponent` / `removeComponent`) and pass it to `apply` (returns the **inverse**, for one-shot revertable callers) or `applyRaw` (the primitive `editor-history` wraps). Both go through **one** internal validated mutator that (1) structurally validates (target alive via `world.isAlive`, component known via `world.componentByName`, value structurally sound), (2) runs an optional **injected** rich validator, and (3) applies through the ECS command surface while atomically updating the two `EditorId` maps.

`commands` owns a stable, save-durable `EditorId` per editor entity because ECS `Entity` handles are generational and recycle on despawn — a saved `Entity` is not durable. `resolve(id)` therefore **validates against `world.isAlive` before returning** and prunes stale mappings (the recycled-id corruption guard). Serialization, undo targeting, selection persistence, and the (fast-follow) MCP mirror all key on `EditorId`.

Depends on **`ecs` only** — the rich validator is *injected* via `setValidator` (wired to `reflection.validate` by a higher plugin), never imported, so the write-authority stays decoupled from the schema registry. Headless-safe and renderer-free (pure ECS data authority — no Pixi, no DOM, no timers). No `onInit`/`onStart`/`onStop` (the world is reached via `ctx.require(ecsPlugin)` at call time; the two maps + counter are plain state).

## API

Accessed as `app.commands.*` after `createApp()`:

### `apply(command: Command): CommandResult`
Validate + apply a command, returning the **inverse** command on success (`{ ok: true, inverse }`) or `{ ok: false, error }`. Keep the inverse to undo a one-shot operation.

### `applyRaw(command: Command): RawResult`
Validate + apply without computing an inverse — the primitive `editor-history.applyTracked` wraps. Returns `{ ok: true, id }` or `{ ok: false, error }`.

### `restore(entities: readonly RestoreEntity[], source: RestoreSource): void`
Non-undoable bulk reseed used by scene load and exit-play revert: despawn every editor-owned entity, respawn re-binding each saved `EditorId`, advance the mint counter past the highest restored id, and emit `commands:restored`. `source` is `"reload"` | `"exit-play"`.

### `resolve(id: EditorId): Entity | undefined`
Resolve a stable `EditorId` to its live `Entity`, validating against `world.isAlive` and pruning a stale mapping. `undefined` if retired or recycled.

### `editorIdOf(entity: Entity): EditorId | undefined`
The stable `EditorId` for a live `Entity`, or `undefined` if it is not editor-owned / not alive.

### `setValidator(validate: FieldValidator | undefined): void`
Inject the optional rich field validator (the reflection-decoupling seam); pass `undefined` to clear back to structural-only validation. Wire with `app.commands.setValidator(app.reflection.validate)`.

### `count(): number`
The number of live editor-owned entities (the `EditorId` map size).

## Commands

A `Command` is serializable plain data, discriminated on `kind`; components are addressed by **name**:

```ts
| { kind: "spawn"; components: Record<string, unknown>; id?: EditorId }
| { kind: "despawn"; id: EditorId }
| { kind: "setField"; id: EditorId; component: string; field: string; value: unknown }
| { kind: "addComponent"; id: EditorId; component: string; value?: Record<string, unknown> }
| { kind: "removeComponent"; id: EditorId; component: string }
```

## Events

### `commands:restored { source: "reload" | "exit-play" }`
Emitted after a non-undoable `restore()` reseeds the world + `EditorId` map. Coarse — scene-load / exit-play frequency, **not** a per-command RPC. `editor-history` listens and clears its undo/redo stacks (a scene reload must never be undoable). There is deliberately **no** `command:applied` / per-command event: undo is recorded by *wrapping* the synchronous funnel, not by listening.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `maxIdWarn` | `number` | `100000` | Soft ceiling on the live editor-owned entity count. Crossing it logs a one-time `ctx.log.warn` (an entity-leak smell). `0` disables the check. |

## Dependencies

`ecs` (#1) — the only dependency. Uses `spawn` / `despawn` / `isAlive` / `add` / `set` / `remove` / `get` / `componentByName` / `componentsOf`, all via `ctx.require(ecsPlugin)` at call time. `reflection` is **not** a dependency — its `validate` is injected through `setValidator`.

## Example

```ts
import { createApp } from "game";

const app = createApp();
await app.start();

// Spawn from named components; keep the inverse to undo.
const result = app.commands.apply({
  kind: "spawn",
  components: { Position: { x: 10, y: 5 } }
});
if (result.ok) {
  const spawnedId = (result.inverse as { id: EditorId }).id; // the despawn inverse carries the id
  const entity = app.commands.resolve(spawnedId);            // the live Entity, or undefined
}

// Wire reflection's rich validation (from a plugin that has both):
app.commands.setValidator(app.reflection.validate);
```
