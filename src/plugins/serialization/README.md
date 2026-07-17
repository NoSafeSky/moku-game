# serialization

> Complex plugin — the scene (de)serializer: the bridge between the in-memory ECS world and durable, versioned save data.

`serialize()` walks `world.liveEntities()` and, for each **editor-owned** entity (one that `commands.editorIdOf` maps to a stable `EditorId`), captures its **named** components via `world.componentsOf` into a plain-data `SceneEntity`, producing a versioned `SceneDocument = { version; name; entities }`. Only named components serialize (anonymous ones have no stable on-disk key), and every entity is keyed by its save-durable `EditorId`, never by the generational `Entity` handle (which recycles on despawn).

`deserialize(doc)` is **atomic**: (1) upgrade a stale document through a migration chain that reuses the `storage` plugin's `Migration`/`Snapshot`/`runMigrations` primitives (one migration contract in the whole framework); (2) validate **every** component value through `reflection.validate` and abort the whole load on the first failure (untrusted data never reaches SoA storage); (3) route the batch through **`commands.restore(doc.entities, "reload")`** — the single non-undoable reseed that clears editor-owned entities, respawns them re-binding their saved `EditorId`s, and rebuilds the id maps; (4) emit the coarse `serialization:loaded`. Because validation runs first and `restore` is atomic, a bad document leaves the current world untouched.

A `SceneDocument` captures **ECS data only** — non-ECS ghost state (in-flight tween/vfx timers, camera follow/shake, renderer views) is deliberately **not** serialized; it re-derives from the reseeded ECS on the next frame, and `editor-runtime` clears the rest via each plugin's `reset()`. Headless-safe and renderer-free — pure data plumbing, no Pixi/DOM/timers. Emits only the coarse `serialization:loaded` (never per-entity).

## API

Accessed as `app.serialization.*` after `createApp()`:

### `serialize(): SceneDocument`
Capture the live editor-owned world as a versioned `SceneDocument` (named components only).

### `deserialize(doc: SceneDocument): void`
Atomically reseed the world from a document: migrate → validate → `commands.restore` → emit `serialization:loaded`. Aborts (logging) on a validation failure, leaving the world untouched.

### `save(name: string): boolean`
Serialize + persist under `${storageKeyPrefix}${name}` via `storage`. Returns storage's success flag; never throws.

### `load(name: string): boolean`
Load + deserialize the scene saved under `name`. Returns `false` if absent (no world change); never throws.

### `list(): string[]`
The names of every saved scene in this prefix (the `storageKeyPrefix` stripped).

### `export(): string`
Serialize the live world to a JSON string — the storage-free export (clipboard / file / AI hand-off).

### `import(json: string): void`
Parse a JSON scene string and deserialize it (migrate + validate + restore). Aborts, logging, on malformed or invalid input. Because it bypasses `storage`, `import` runs the migration chain itself.

## Events

### `serialization:loaded { name: string; entityCount: number }`
Emitted after a document is deserialized and the scene named `name` is live. Coarse — scene-load frequency, never per-entity. Distinct from the lower-level `commands:restored { source: "reload" }` that `commands.restore` fires (which `editor-history` clears on): a HUD / editor-bridge poll reacts to `serialization:loaded`.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `storageKeyPrefix` | `string` | `"scene:"` | Sub-prefix within the `storage` namespace under which each scene is saved (`${prefix}${name}`). |
| `version` | `number` | `2` | Current scene-schema version. `serialize`/`save` stamp at this version; a lower document is upgraded on `load`/`import`. |
| `migrations` | `Readonly<Record<number, Migration>>` | `{ 2: identityMigration }` | Migration chain: `migrations[n]` upgrades a `v(n-1)` document to `vn`. Reuses `storage`'s `Migration = (Snapshot) => Snapshot` contract. The `v2` entry is a version-stamp passthrough — the hierarchy `Node` rides as a plain named component, so a v1 document needs no data transform. |

## Dependencies

`ecs` (#1, the world it reads), `storage` (#11, JSON persistence + migration primitives), `commands` (#17, the `EditorId` + the `restore` reseed), `reflection` (#18, field validation). No dependency on `tween`/`vfx`/`camera`/`renderer` — ghost-state reset is `editor-runtime`'s job.

## Example

```ts
import { createApp } from "game";

const app = createApp();
await app.start();

// ... author a scene via app.commands ...

app.serialization.save("level1");          // persist through storage
const json = app.serialization.export();   // or export as a portable string

app.serialization.load("level1");          // migrate + validate + atomic restore
// app.on("serialization:loaded", ({ name, entityCount }) => updateHud(name, entityCount));
```
