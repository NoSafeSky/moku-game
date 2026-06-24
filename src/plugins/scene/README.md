# scene

Standard tier plugin — named scene lifecycle with entity ownership tracking.

A scene is a registered `setup(world)` function that spawns its entities into the ECS world.
The plugin wraps `world.spawn` during `setup` so every entity created belongs to the active scene.
On `unload` (or when transitioning to a new scene), owned entities are detached from the renderer
and despawned from the ECS world, producing a clean slate.

Emits `scene:loaded` (COARSE milestone event) after each scene finishes loading.

## API (`app.scene`)

| Method | Description |
|---|---|
| `define(name, definition)` | Register a named scene (`setup` + optional `bundle`). |
| `load(name): Promise<void>` | Unload current scene, pre-load bundle (if any), run `setup`, emit `scene:loaded`. |
| `unload(): void` | Despawn owned entities (when `despawnOnUnload: true`), reset current to `undefined`. |
| `currentScene(): string \| undefined` | Name of the active scene, or `undefined`. |

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `initial` | `string \| undefined` | `undefined` | Scene to load automatically on start. |
| `despawnOnUnload` | `boolean` | `true` | When true, owned entities are despawned and detached on unload. |

## Events

| Event | Payload | When |
|---|---|---|
| `scene:loaded` | `{ name: string }` | After a scene's `setup` completes. |

## Dependencies

Depends on `ecsPlugin` (spawn/despawn), `rendererPlugin` (detach views), and `assetsPlugin` (bundle pre-load).
