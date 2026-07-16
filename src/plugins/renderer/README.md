# renderer

> Complex plugin — PixiJS v8 rendering backend that owns the GPU `Application` lifecycle and mirrors ECS `Transform` data into Pixi display objects.

The `renderer` plugin isolates all of PixiJS v8 behind a single Moku plugin. It creates the Pixi `Application` asynchronously in `onStart` (with `autoStart: false`, so Pixi's own ticker never fires — the `loop` plugin drives every frame), registers a `sync`-stage system that repositions attached display objects from each entity's `Transform` component, and destroys the GPU `Application` in `onStop` to guard against Pixi v8 VRAM leaks.

Pixi types never cross the plugin boundary except for the two structural handles a consumer genuinely needs: the `HTMLCanvasElement` from `getView()` and the root `Container` from `getStage()` / `attach()`. Everything else stays internal.

The plugin also **defines** a `Transform` component (`{ x, y, rotation, scaleX, scaleY }`) on the ECS world during `onStart` and exposes the token as `app.renderer.Transform`, so consumers and the `scene` plugin can spawn and mutate transformed entities against the exact same token the sync system reads.

**Phase-1 (Wave F1)** adds a starter render surface for the editor — `attachSprite` (texture-alias sprites with a load-time placeholder), two injected **resolver seams** (`setTextureResolver`, `setWorldTransformResolver`) that let `graphics-2d`/`hierarchy` push texturing + world-space positioning in without the renderer importing them, a `Node.enabled` view bridge (`setEntityVisible`), and an editor grid overlay (`setGridVisible`). See [Phase-1 additions](#phase-1-additions-wave-f1) below. `TextureHandle` joins `HTMLCanvasElement`/`Container` as the only opaque handles crossing the plugin boundary — Pixi's `Texture`/`Sprite`/`Graphics` types never do.

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

### `getEntityView(entity): Container | undefined`

Returns the Pixi view attached to an entity (via `attach`/`attachPrimitive`), or `undefined` when the entity has no view / before start / headless. Exposes the per-entity view registry so effect plugins can read/write **view-local** visual state the `Transform` sync does not manage — notably `tint` and `alpha`. Positioning still flows through `Transform` + the sync system; this accessor is only for view-local properties (e.g. the `vfx` plugin's `flash` reads it to write `view.tint`).

```ts
const view = app.renderer.getEntityView(entity);
if (view) view.tint = 0xff0000;
```

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
| `rect` | `width`, `height` | Drawn CENTERED on the local origin `(0, 0)`. |
| `circle` | `radius` | Centred on the local origin. |
| `line` | `x2`, `y2` | From the local origin to `(x2, y2)`. Stroke only — `fill` is ignored. |
| `polygon` | `points` | A closed polygon through the given points, in the entity's local space. |

Style fields apply to every shape: `fill` (skipped for `line`), `stroke` (with `strokeWidth`, default `1`), `alpha` (default `1`), and `label` (sets the Pixi node label so `tree()` reports it).

#### Primitive anchor contract

Every shape is drawn relative to the local origin `(0, 0)` — the point the entity's
`Transform { x, y }` places in world space — but shapes differ in *where* that origin
sits relative to their own geometry (Cycle 6, issue #4):

- **`rect`** — CENTERED on the origin. `Transform` is the rect's CENTER, so
  `{ shape: "rect", width: 40, height: 20 }` spans `x: -20..20`, `y: -10..10` in
  local space.
- **`circle`** — CENTERED on the origin. `Transform` is the circle's CENTER.
- **`polygon`** — `points` are already in the entity's local space; the origin
  (`Transform`) sits wherever the caller's own coordinates place it — there is no
  implicit centering.
- **`line`** — drawn FROM the origin (`Transform`) TO `(x2, y2)`; `Transform` is
  the line's start point, not its midpoint.

`rect` and `circle` share the same centered contract so same-size shapes are
interchangeable without an offset correction (prior to Cycle 6, `rect` was drawn
top-left-anchored, which diverged from `circle`).

## Phase-1 additions (Wave F1)

Five additive API methods plus two injected **resolver seams**, backing the `hierarchy`
(world-space positioning) and `graphics-2d` (sprite texturing) plugins **without the
renderer importing either** — the same DI inversion as `commands.setValidator`. The
renderer stays the sole Pixi owner; `depends: [ecs, scheduler]` is unchanged. Every
addition is a safe no-op headless / before start, and a flat app that never calls these
methods sees byte-identical behavior to before Phase-1.

### `attachSprite(entity, spec): boolean`

Builds a Pixi `Sprite` from the injected texture resolver (`setTextureResolver`):
resolves `spec.alias` to an opaque `TextureHandle`, casts it internally back to a Pixi
`Texture`, and constructs the sprite. When the alias is **unresolved** (no resolver
installed, or the resolver returns `undefined`) it builds a **placeholder `Graphics`**
box instead (sized from `spec.width`/`spec.height`, or a default 32×32 box), so the
entity stays visible while its texture loads. Like `attachPrimitive`, it self-parents
to the stage (`stage.addChild`) and registers the view (`views` + `dirty`). Returns
`false` when headless / before start (no `app`) — nothing is added.

The built view is a **wrapper `Container`** whose single child holds the sprite or
placeholder. `tint`, `flipX` (mirrored via the child's `scale.x = -1`), and explicit
`width`/`height` are applied to the **child**, never the wrapper — because the
Transform/world sync only ever writes the wrapper's `position`/`rotation`/`scale`, these
view-local visuals survive every sync tick untouched.

```ts
app.renderer.setTextureResolver(alias => assets.resolveTexture(alias));
const ok = app.renderer.attachSprite(entity, { alias: "player", tint: 0xff0000, flipX: true });
```

#### `SpriteSpec`

```ts
type SpriteSpec = {
  alias: string;           // resolved through the injected TextureResolver
  tint?: number | string;  // hex int or "#rrggbb"; default: no tint (0xffffff)
  flipX?: boolean;         // mirror horizontally; default: false
  width?: number;          // explicit display width in px
  height?: number;         // explicit display height in px
};
```

### `setTextureResolver(resolve): void`

Installs (or clears with `undefined`) the alias→texture seam on `state.textureResolver`.
`TextureResolver = (alias: string) => TextureHandle | undefined`. `TextureHandle` is an
**opaque internal brand** (`{ readonly __textureHandle: unique symbol }`) — a caller
(e.g. `graphics-2d` over `assets`) hands back a resolved texture as this opaque handle,
and the renderer casts it internally. Pixi's `Texture` type never crosses the public
boundary. `graphics-2d` installs this at its `onStart`.

### `setWorldTransformResolver(resolve): void`

Installs (or clears with `undefined`) the entity→world-transform seam on
`state.worldResolver`. `WorldTransformResolver = (entity: Entity) => TransformValue |
undefined`. The `hierarchy` plugin injects `e => worldOf(e)` at its `onStart` so the sync
system positions parented entities in **world space** instead of their local `Transform`.
With no resolver installed (every non-editor / flat app) the sync's fallback —
`worldResolver?.(entity) ?? world.get(entity, Transform)` — is **byte-identical** to the
pre-Phase-1 behavior.

```ts
app.renderer.setWorldTransformResolver(e => hierarchy.worldOf(e));
app.renderer.setWorldTransformResolver(undefined); // back to local-Transform positioning
```

### `setEntityVisible(entity, visible): void`

Toggles the entity's attached view's `visible` flag — the render-side bridge for
`Node.enabled` (a disabled node hides its view). **No-op** (never throws) when the
entity has no view — headless, not attached, or already despawned.

### `setGridVisible(visible, spec?): void`

Shows/updates or hides an **editor grid overlay** — a renderer-owned `Graphics` drawing
hairlines every `size` px across the canvas extent, inserted at **stage index 0** so it
renders beneath every entity view. Lazily builds/reuses `state.grid`; `spec` restyles it
on each show. **Headless-tolerant**: a no-op when there is no `app`. The overlay is a
stage child, so it is disposed automatically by `app.destroy(true, { children: true })`
on `onStop` — no separate teardown entry is needed.

```ts
app.renderer.setGridVisible(true, { size: 16, color: 0x334155 });
app.renderer.setGridVisible(false); // hide (grid instance is kept, not destroyed)
```

#### `GridSpec`

```ts
type GridSpec = {
  size?: number;  // grid cell size in world px; default: 32
  color?: number; // line color as a hex int; default: a slate hairline
};
```

### Sync change (backward-compatible)

`repositionFromTransform` (in `sync.ts`) now reads its position source as
`state.worldResolver?.(entity) ?? world.get(entity, transformToken)` — WORLD space when
a resolver is injected, the local `Transform` otherwise. This is the **only** change to
the sync system in Phase-1; despawn reconciliation is unchanged.

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
- **DI seams, not imports (Phase-1).** `setTextureResolver`/`setWorldTransformResolver` are the same inversion as `commands.setValidator` (spec/11 §2.8): `graphics-2d` and `hierarchy` sit ABOVE the renderer in the dependency order, so instead of the renderer importing them, they push behavior in by calling the setters at their own `onStart`. `depends` stays `[ecs, scheduler]` — no new edges. `sprites.ts` (wrapper+child construction for `attachSprite`) and `grid.ts` (hairline drawing for `setGridVisible`) are new domain files that keep this construction logic out of `api.ts`, mirroring `primitives.ts`.
- **Wrapper/child split for view-local visuals.** `attachSprite`'s wrapper `Container` is the ONLY node the sync writes to; `tint`/`flipX`/`width`/`height` live on its one child (a `Sprite` or a placeholder `Graphics`). This is the same visual-isolation trick `getEntityView` documents for `vfx`'s `flash` — except here it is structural (a dedicated wrapper) rather than by convention.

## Dependencies

Declared via `depends: [ecsPlugin, schedulerPlugin]` and resolved with `ctx.require`:

- **`ecs`** — `ctx.require(ecsPlugin)` returns the `World`. The renderer defines/reads the `Transform` component, reads it during sync, and checks `world.isAlive(...)` for despawn reconciliation.
- **`scheduler`** — `ctx.require(schedulerPlugin)` to `addSystem("sync", …)`, registering the transform→Pixi sync system that runs before the `loop` plugin's render stage.

No new dependency edges in Phase-1 — `hierarchy`/`graphics-2d`/`assets` are never imported; they inject behavior through `setWorldTransformResolver`/`setTextureResolver` instead (see [Phase-1 additions](#phase-1-additions-wave-f1)).

Runtime package: `pixi.js@^8`. Optionally composes with `@moku-labs/web` for DOM mounting when `config.mount` is a selector.
