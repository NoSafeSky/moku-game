# renderer

> Complex plugin — PixiJS v8 rendering backend that owns the GPU `Application` lifecycle and mirrors ECS `Transform` data into Pixi display objects.

The `renderer` plugin isolates all of PixiJS v8 behind a single Moku plugin. It creates the Pixi `Application` asynchronously in `onStart` (with `autoStart: false`, so Pixi's own ticker never fires — the `loop` plugin drives every frame), registers a `sync`-stage system that repositions attached display objects from each entity's `Transform` component, and destroys the GPU `Application` in `onStop` to guard against Pixi v8 VRAM leaks.

Pixi types never cross the plugin boundary except for the two structural handles a consumer genuinely needs: the `HTMLCanvasElement` from `getView()` and the root `Container` from `getStage()` / `attach()`. Everything else stays internal.

The plugin also **defines** a `Transform` component (`{ x, y, rotation, scaleX, scaleY }`) on the ECS world during `onStart` and exposes the token as `app.renderer.Transform`, so consumers and the `scene` plugin can spawn and mutate transformed entities against the exact same token the sync system reads.

## API

Accessed as `app.renderer.*` after `createApp()`. The full surface is defined in `types.ts` (`Api`) and built in `api.ts`.

### `Transform`

```ts
readonly Transform: Component<{ x; y; rotation; scaleX; scaleY }>
```

The `Transform` component token defined on the ECS world during `onStart`. Accessing it **before** `app.start()` throws (the token does not yet exist; minting a placeholder would diverge from the token the sync system reads).

```ts
const entity = world.spawn(
  app.renderer.Transform({ x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 })
);
```

### `attach(entity, view): void`

Attaches a Pixi `Container` (or subclass — `Sprite`, `Graphics`, …) to an entity and marks it dirty. The sync system repositions it from the entity's `Transform` on the next `sync` tick.

```ts
app.renderer.attach(entity, new Container());
```

### `detach(entity): void`

Detaches and `destroy()`s the entity's `Container`, then removes it from the views map. Idempotent — a no-op when the entity has no attached view.

### `render(): void`

Draws the current frame via the Pixi `Application`. Called by the `loop` plugin in the render stage. A safe no-op before `onStart` completes (the `Application` is `undefined`).

### `getView(): HTMLCanvasElement | undefined`

Returns the Pixi canvas for manual DOM mounting, or `undefined` before start. Use this for headless/manual mounting when `config.mount` is left `undefined`.

```ts
document.body.appendChild(app.renderer.getView()!);
```

### `getStage(): Container | undefined`

Returns the root Pixi stage `Container`, or `undefined` before start. For advanced consumers and the `scene` plugin that need to add children directly to the stage.

### `markDirty(entity): void`

Marks an entity dirty so the next `sync` tick repositions its view. Called by gameplay/scene code after writing a new `Transform` value.

```ts
app.renderer.markDirty(entity);
```

### `screenshot(): Promise<string | undefined>`

Captures the current frame as a PNG **data URL** via Pixi's `extract` system (`app.renderer.extract.base64(stage)`). Because `extract` re-renders into a target, the capture is **reliable regardless of frame timing** — it is correct even while the loop is paused (unlike reading the WebGL backbuffer, which can be blank). Resolves to `undefined` when headless / before start. Used by the `mcp` plugin's `renderer:screenshot` tool.

```ts
const dataUrl = await app.renderer.screenshot(); // "data:image/png;base64,..." | undefined
```

### `tree(): SceneNode | undefined`

Returns a JSON-serialisable snapshot of the Pixi scene graph rooted at the stage — `{ label, type, x, y, rotation, scaleX, scaleY, visible, alpha, width, height, text?, children }` (with `text` for Pixi `Text` nodes). The `type` field is a best-effort node kind, one of `"Text" | "Graphics" | "Sprite" | "Container"` — duck-typed in this order so a Pixi v8 `Graphics` (which also exposes a `texture` getter) is correctly reported as `"Graphics"` rather than mislabeled `"Sprite"`. The most direct way to read on-screen positions and text. `undefined` when headless / before start. No Pixi types leak — `SceneNode` is plain data. Used by the `mcp` plugin's `renderer:tree` tool.

```ts
const root = app.renderer.tree();
// { label: "stage", type: "Container", children: [{ label: "score", type: "Text", text: "12", x: 10, y: 8, ... }] }
```

### `attachPrimitive(entity, spec): boolean`

Builds a Pixi `Graphics` from a plain `PrimitiveSpec`, **adds it to the stage itself** (`stage.addChild`), and registers it (views + dirty) so the sync system positions it from the entity's `Transform` on the next `sync` tick. This is the one method that contrasts with `attach()`: `attach()` only records the view in the views map and leaves it to the consumer to add the display object to the stage, whereas `attachPrimitive` does the `stage.addChild` itself — so an MCP-spawned entity actually renders without the caller holding a stage handle. Returns `false` when headless / before start (no `app`) — nothing is added; `true` otherwise. Used by the `mcp` plugin to make agent-spawned entities visible. No Pixi types cross the boundary — `spec` is plain data (see `PrimitiveSpec` below).

```ts
const ok = app.renderer.attachPrimitive(entity, { shape: "circle", radius: 10, fill: 0xff0000 });
```

#### `PrimitiveSpec` / `PrimitiveStyle`

Plain, JSON-describable shape + style — no Pixi types leak. `PrimitiveSpec` is a discriminated union over `shape`, each variant carrying its own geometry plus the shared `PrimitiveStyle` fields:

```ts
type PrimitiveStyle = {
  fill?: number;        // hex int e.g. 0xff0000, or omitted for no fill
  stroke?: number;      // hex int, or omitted for no stroke
  strokeWidth?: number; // px, default 1 when stroke is set
  alpha?: number;       // 0–1, default 1
  label?: string;       // sets the Pixi node label so tree() reports it
};

type PrimitiveSpec =
  | ({ shape: "rect"; width: number; height: number } & PrimitiveStyle)
  | ({ shape: "circle"; radius: number } & PrimitiveStyle)
  | ({ shape: "line"; x2: number; y2: number } & PrimitiveStyle)
  | ({ shape: "polygon"; points: ReadonlyArray<{ x: number; y: number }> } & PrimitiveStyle);
```

| Shape | Geometry fields | Notes |
|---|---|---|
| `rect` | `width`, `height` | Drawn from the local origin `(0, 0)`. |
| `circle` | `radius` | Centred on the local origin. |
| `line` | `x2`, `y2` | From the local origin to `(x2, y2)`. Stroke only — `fill` is ignored. |
| `polygon` | `points` | A closed polygon through the given points. |

Style fields apply to every shape: `fill` (skipped for `line`), `stroke` (with `strokeWidth`, default `1`), `alpha` (default `1`), and `label` (sets the Pixi node label so `tree()` reports it).

## Lifecycle

The renderer is one of the few plugins that owns a real GPU resource, so both lifecycle hooks are load-bearing.

- **`onStart`** (`start` in `lifecycle.ts`) — constructs `new Application()`, then `await app.init({ width, height, background, antialias, autoStart: false, resolution })`. If `app.init` rejects, `app.destroy(...)` is called and the error is rethrown so no half-open GPU context is left behind. On success it: optionally appends `app.canvas` to `document.querySelector(config.mount)` (logging a warning if the selector matches nothing); defines the `Transform` component on the ECS world and stores the token in state; registers the sync system via `scheduler.addSystem("sync", …)`; writes `app` into state (for the API methods); and stashes `{ app, views }` in a module-level `WeakMap` keyed on `ctx.global`.
- **`onStop`** (`stop` in `lifecycle.ts`) — `onStop` receives a `TeardownContext` of only `{ global }` and cannot read `state`, so it reads `{ app, views }` back from the `WeakMap` via `ctx.global`. It `destroy()`s every managed `Container`, then calls `app.destroy(true, { children: true, texture: true, textureSource: true })` for full texture/VRAM cleanup, and finally deletes the `WeakMap` entry.

## Configuration

Set under `pluginConfigs.renderer`. Defaults come from `index.ts`.

| Field | Type | Default | Description |
|---|---|---|---|
| `width` | `number` | `800` | Canvas width in CSS pixels. |
| `height` | `number` | `600` | Canvas height in CSS pixels. |
| `background` | `number` | `0x000000` | Background fill color (hex number, e.g. `0x1099bb`). |
| `resolution` | `number` | `0` | Device-pixel-ratio resolution; `0` falls back to `window.devicePixelRatio` (then `1` in a headless runtime). |
| `antialias` | `boolean` | `true` | Enable antialiasing. |
| `mount` | `string \| undefined` | `undefined` | CSS selector to auto-mount the canvas into on start. `undefined` = headless / manual mounting via `getView()`. |
| `headless` | `boolean` | auto-detected (`true` when there is no DOM, i.e. `typeof document === "undefined"`) | Run without Pixi/GPU. When `true`, `onStart` skips `Application` creation/init entirely and leaves the app `undefined`, but **still** defines the `Transform` component and registers the `sync` system — so ECS/scene code is identical in both modes. `render()` / `getView()` / `getStage()` become safe no-ops (the last two return `undefined`). An explicit value always overrides auto-detection. |

## Events

None. Render and sync run on the hot path, so the renderer emits and listens to **no** kernel events. Despawn cleanup is reconciled inside the `sync` system by diffing the views map against entity liveness — there is no per-despawn event traffic.

## Usage Example

```ts
import { createApp } from "../../index";
import { Container } from "pixi.js";

const app = createApp({
  pluginConfigs: {
    renderer: {
      width: 1280,
      height: 720,
      background: 0x1099bb,
      antialias: true,
      mount: "#game-canvas" // omit for headless / manual mounting
    }
  }
});

await app.start(); // creates the Pixi Application + defines Transform

const world = app.ecs; // the ECS world

// Spawn a transformed entity and attach a display object.
const entity = world.spawn(
  app.renderer.Transform({ x: 100, y: 100, rotation: 0, scaleX: 1, scaleY: 1 })
);
app.renderer.attach(entity, new Container());

// The loop plugin drives these each frame; shown here for clarity.
app.renderer.markDirty(entity); // after mutating Transform
app.renderer.render();

await app.stop(); // destroys the Application, frees VRAM
```

## Design Notes

- **Dirty-flag sync, not per-frame scan.** `attach`/`markDirty` add the entity to `state.dirty`; each `sync` tick repositions only dirty views (`container.position`, `rotation`, `scale` from `Transform`) then clears the set — far cheaper than reading every entity's transform every frame.
- **Despawn reconciliation.** Phase 2 of the sync system iterates `state.views` and `destroy()`s any container whose entity fails `world.isAlive(...)`, removing it from the map. This replaces despawn events with a single liveness diff on the hot path (see `sync.ts`).
- **Shared `Transform` token.** The token is defined once in `onStart` and stored in `state.transformToken`; both the API getter and the sync system read it from state, so they can never diverge. The getter throws if accessed before start rather than silently minting a second token.
- **WeakMap teardown.** Because `onStop` only receives `{ global }`, the `{ app, views }` opened at start are retrieved at stop via a module-level `WeakMap<object, TeardownEntry>` keyed on the per-instance `ctx.global` — the same pattern used by the `loop` and `mcp` plugins.
- **Structural contexts.** `createApi` (`RendererContext`) and `createSyncSystem` (`SyncContext`) declare only the context fields they touch, so unit tests can supply minimal mocks — including a mocked Pixi `Application` — without wiring the full kernel or a real GPU.
- **First-class headless mode.** `config.headless` (auto-detected via `detectHeadless()` — `true` when `typeof document === "undefined"`, overridable) makes `onStart` skip Pixi entirely: no `Application` is constructed or initialised and `state.app` stays `undefined`, yet `Transform` is still defined and the `sync` system still registered, so ECS/scene code runs unchanged. `onStop` skips `app.destroy(...)` when no app was created, and the API methods (`render`/`getView`/`getStage`) are undefined-app-safe. This lets the framework run in Bun/Node (or any DOM-less host) without a GPU and without Pixi crashing. The remaining DOM surface (`document`, `devicePixelRatio`) is still probed through an optional structural `globalThis` view for the non-headless mount/resolution paths.

## Dependencies

Declared via `depends: [ecsPlugin, schedulerPlugin]` and resolved with `ctx.require`:

- **`ecs`** — `ctx.require(ecsPlugin)` returns the `World`. The renderer defines/reads the `Transform` component, reads it during sync, and checks `world.isAlive(...)` for despawn reconciliation.
- **`scheduler`** — `ctx.require(schedulerPlugin)` to `addSystem("sync", …)`, registering the transform→Pixi sync system that runs before the `loop` plugin's render stage.

Runtime package: `pixi.js@^8`. Optionally composes with `@moku-labs/web` for DOM mounting when `config.mount` is a selector.
