# scene

> Standard plugin — named scene lifecycle with entity-ownership tracking, clean-slate transitions, and bundle pre-load.

A **scene** is a registered `setup(world)` function that spawns the entities for one screen or level of the game — a menu, a level, a game-over splash. You `define` scenes by name and `load` them by name; the plugin owns the bookkeeping of which entities belong to the active scene so that switching scenes leaves a clean slate.

The crux is **entity-ownership tracking**. During a scene's `setup`, the plugin hands the setup function a thin wrapper around the ECS world whose `spawn` is intercepted — every entity created is recorded in the active scene's owned set. When you transition to another scene (or call `unload`), each owned entity has its renderer view detached and is then despawned from the ECS world, so no stray entities or Pixi views leak between scenes.

If a scene declares an asset `bundle`, that bundle is **pre-loaded via the assets plugin before `setup` runs**, so the setup code can rely on textures already being in the cache. After a scene finishes loading, the plugin emits the coarse milestone event `scene:loaded`.

## API (`app.scene`)

Accessed as `app.scene.*` after `createApp()`.

### `define(name, definition): void`

Register a named scene. `definition` is a `SceneDefinition` (`setup` + optional `bundle`). Re-defining an existing name overwrites it. Registration alone runs nothing — call `load(name)` to activate it.

```ts
app.scene.define("menu", { setup: (world) => { world.spawn(); } });
```

> **Define scenes at startup for agent control.** `scene:load` (and the `mcp` plugin's `scene:load` tool) can only load scenes that have already been `define`d. If a consumer gates `define`/`load` behind a DOM menu (e.g. only defining a level once a button is clicked), an MCP agent driving the page through the in-page bridge cannot start a match. **Define your scenes at boot** (and load an initial one if appropriate); keep DOM affordances as *triggers* for already-defined scenes, not as the place definition happens.

### `load(name): Promise<void>`

Load a previously-defined scene. Throws an `Error` if `name` was never `define`d. The ordered steps are:

1. **Unload current** — despawn the previous scene's owned entities and detach their renderer views (subject to `despawnOnUnload`), then reset `current`.
2. **Pre-load bundle** — if `definition.bundle` is set, `await assets.loadBundle(name, bundle)` (the bundle is keyed by the scene name).
3. **Run setup** — call `definition.setup(wrappedWorld)` and await it; every `spawn` on `wrappedWorld` is tracked as owned by this scene.
4. **Commit + emit** — set `current = name` and emit `scene:loaded` with `{ name }`.

```ts
await app.scene.load("level1");
```

### `unload(): void`

Unload the current scene. When `despawnOnUnload` is `true` (default) and entities are owned, each owned entity's renderer view is detached and the entity is despawned. The owned set is cleared and `current` is reset to `undefined`. Safe to call when no scene is loaded (no-op). Does **not** emit `scene:loaded`.

### `currentScene(): string | undefined`

Returns the active scene name, or `undefined` before the first load and after `unload`.

### `sceneNames(): readonly string[]`

Read-only introspection — returns the names of all registered scenes in **registration (insertion) order**, equivalent to `[...state.scenes.keys()]`. Returns `[]` before any `define`. Useful for tooling (and the `mcp` plugin) that needs to enumerate what scenes are available to `load`.

```ts
app.scene.define("menu", { setup });
app.scene.define("game", { setup });
app.scene.sceneNames(); // ["menu", "game"]
```

### `ownedEntities(): readonly Entity[]`

Read-only introspection — returns a **snapshot** of the entity handles owned by the current scene, equivalent to `[...state.owned]`. Because it spreads into a fresh array, mutating the returned value does **not** affect the internal `state.owned` set. Returns `[]` after `unload` (or before any `load`).

```ts
await app.scene.load("game");
app.scene.ownedEntities(); // [42, 43, 44] (entity handles spawned in setup)
app.scene.unload();
app.scene.ownedEntities(); // []
```

### `SceneDefinition` shape

```ts
type SceneDefinition = {
  setup: (world: World) => void | Promise<void>; // spawns the scene's entities; may be async
  bundle?: Readonly<Record<string, string>>;     // optional alias→url bundle, pre-loaded before setup
};
```

`setup` receives a `World`-shaped value; in practice it is the tracking wrapper, so spawns are auto-owned. The wrapper is internal — `SceneContext` (the structural context type in `api.ts`) is not part of the public `.d.ts`.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `initial` | `string \| undefined` | `undefined` | Reserved field for the scene to load on start. Declared on the config but **not auto-loaded** in this version — call `app.scene.load(...)` after `app.start()` to load a starting scene. |
| `despawnOnUnload` | `boolean` | `true` | When `true`, owned entities are detached + despawned on unload. When `false`, ownership is still cleared and `current` reset, but entities are left alive in the world. |

## Events

| Event | Payload | When |
|---|---|---|
| `scene:loaded` | `{ name: string }` | After a scene's `setup` completes during `load`. |

`scene:loaded` is a **coarse milestone event** — it fires once per successful `load`, not on `unload` and not per spawned entity. It is the signal consumers use to react to a completed scene transition.

## Usage Example

```ts
import { createApp } from "../../index";

const app = createApp({
  pluginConfigs: {
    // `initial` is reserved (not auto-loaded) — load the first scene manually below.
    scene: { despawnOnUnload: true }
  }
});

// Menu scene: a couple of entities, no assets.
app.scene.define("menu", {
  setup: (world) => {
    world.spawn();
    world.spawn();
  }
});

// Level scene: pre-loads a bundle before spawning.
app.scene.define("level2", {
  bundle: { hero: "hero.png", bg: "bg.png" },
  setup: async (world) => {
    world.spawn(); // textures from the bundle are already cached here
  }
});

await app.start();

await app.scene.load("menu");
console.log(app.scene.currentScene()); // "menu"

// Transition: "menu" entities are despawned + detached, then "level2" loads.
await app.scene.load("level2");
console.log(app.scene.currentScene()); // "level2"
```

## Design Notes

- **Spawn-wrapping for ownership:** `load` builds a plain-object `World` wrapper (`makeTrackingWorld`) whose `spawn` calls the real `world.spawn`, records the returned entity into `state.owned`, and returns it. Every other `World` method delegates unchanged. A plain wrapper is used instead of a JS `Proxy` to stay lint-safe and readable.
- **Partial-spawn failure path:** entities are added to `owned` as each `spawn` returns, so even if `setup` throws part-way through, the already-spawned entities are recorded. The next `load` (or an `unload`) runs `performUnload`, which despawns and detaches everything in `owned` — so a failed setup does not leak entities once a transition occurs.
- **Renderer view detach on despawn:** during unload each owned entity is passed to `renderer.detach(entity)` (idempotent) before `world.despawn(entity)`, ensuring the Pixi view is disposed and removed from the stage, not just the ECS record.
- **`despawnOnUnload` semantics:** when `false`, `performUnload` skips the detach/despawn loop entirely but still clears the owned set and resets `current` — useful when another system manages entity lifetimes and the scene plugin should only track the active-scene name.
- **No `onStart` / `onStop`:** the scene plugin owns no long-lived resource. It holds only in-memory state (the scenes map, current name, owned set), so there is nothing to start or tear down.
- **Lazy dependency require:** ecs, renderer, and assets APIs are obtained via `ctx.require(...)` inside the methods that need them (not at construction), so they are guaranteed started by the time a method runs.

## Dependencies

- **`ecs`** — provides the `World`; the plugin wraps its `spawn` for ownership tracking and calls `despawn` on unload.
- **`renderer`** — `detach(entity)` is called for each owned entity on unload so its Pixi view is disposed alongside the ECS despawn.
- **`assets`** — `loadBundle(name, bundle)` pre-loads a scene's declared `bundle` before `setup`, so textures are cached before entities are spawned.
