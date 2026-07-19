# graphics-2d

> Standard plugin — the render-component library. Defines the `SpriteRenderer` + `Shape` components, registers their reflection schemas + component-registry catalog entries, runs a `changeEpoch`-gated `sync`-stage system that reconciles those components into Pixi views via the renderer's public API, and injects a store-aware `assets` + `asset-store` → renderer texture resolver (an imported store alias renders via a just-in-time `blob:`-url load, re-attached by a pending-texture retry once the load lands). "The component IS the renderable." No `pixi.js` import.

Adding a `Shape` or `SpriteRenderer` to an entity is what makes that entity render. Nothing else is required — no island reaches into the renderer, no view is built by hand. `graphics-2d` owns the two authorable render components and one system that keeps their values and the renderer's views in agreement.

The plugin owns **no external resource**: its views are renderer-owned scene data (the renderer disposes them on despawn and destroys the Pixi `Application` on its own stop), so there is **no `onStop`** and **no `reset()`**. It emits no events and declares no hooks.

## Pixi isolation

`graphics-2d` never imports `pixi.js`. It touches the render backend **only** through the renderer's plain-data surface — `attachPrimitive` / `attachSprite` / `detach` / `markDirty` / `setTextureResolver`. Specs go in as plain data (`{ shape: "rect", width, height, fill: 0xff0000 }`); `boolean`/`void` come back.

The one render-backend value that flows *through* this plugin is the result of `assets.get(alias)` / `assets.loadUrl(alias, url)`. It is passed **straight into** the renderer's texture resolver as an opaque `TextureHandle` — never dereferenced, never named as a Pixi type. The seams are typed narrowly for exactly this reason:

```ts
// types.ts — naming the concrete texture type would mean naming a Pixi type.
export type TextureLookup = {
  get(alias: string): object | undefined;
  loadUrl(alias: string, url: string): Promise<object>;
};
// the asset-store contributes only a URL string — no blob, no Pixi type.
export type StoreLookup = {
  url(alias: string): string | undefined;
  has(alias: string): boolean;
};
```

The real `assets` and `asset-store` APIs satisfy those structurally, so the resolver needs no `pixi.js` import to bridge `assets` + `asset-store` → `renderer`.

## API

Accessed as `app["graphics-2d"].*` after `createApp()`. The surface is exactly two component tokens — both **throw before `app.start()`** (the `renderer.Transform` precedent): the token is only valid once `onStart` has defined it on the world, and minting one early would diverge from the token the render-sync system queries.

### `SpriteRenderer: Component<SpriteRendererValue>`

The `SpriteRenderer` component token. Adding it makes an entity render a textured sprite.

```ts
const entity = app.ecs.spawn(
  app.renderer.Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
  app["graphics-2d"].SpriteRenderer({
    sprite: "ship",        // asset alias, resolved through the injected texture resolver
    tint: "#ffffff",       // #rrggbb ("#ffffff" = untinted)
    flipX: false,
    sortingLayer: "Default",
    orderInLayer: 0
  })
);
```

### `Shape: Component<ShapeValue>`

The `Shape` component token. Adding it makes an entity render a vector primitive.

```ts
app.ecs.add(entity, app["graphics-2d"].Shape, { kind: "circle", radius: 8, fill: "#ff0000" });
```

`kind` selects which fields matter: `radius` for `"circle"`, `width`/`height` for `"rect"`. `fill`/`stroke` are `#rrggbb` strings (converted to the renderer's hex ints at reconcile time); `stroke` is only drawn when `strokeWidth > 0`. A malformed color degrades to `0` (black) rather than throwing — colors come from inspector-editable data, so a half-typed value must not break the render tick.

## Configuration

None. `Config` is `Record<string, never>` — this is a fixed component library with no tunable knobs.

## Events

None. Component add/remove/change is observed by consumers via **poll-on-epoch** (`world.changeEpoch()`), owned by `editor-bridge` / the inspector — never a per-frame `emit`.

## Render-sync system

Registered in the `sync` stage at `onStart`, on the ecs `world.addSystem("sync", …)` directly (the world facade is already required, so no `scheduler` dependency edge is added).

Reactivity is **poll-on-epoch**: the system early-outs when `world.changeEpoch()` has not advanced since its last run, so in edit mode — where most ticks carry no write — a tick costs one integer compare and allocates nothing. When the epoch advances it reconciles in three passes:

1. **Shapes** — attach on add (`attachPrimitive`), rebuild on a changed per-entity value **signature**.
2. **SpriteRenderers** — the same, via `attachSprite({ alias, tint, flipX })`.
3. **Removals** — `detach` + untrack any view whose entity died, or whose backing component was removed.

A **rebuild** is `detach` + attach + `markDirty`, not an in-place edit: a `kind` flip (rect↔circle) or an alias change needs a *different* backing object, and detaching first keeps the renderer's one-view-per-entity registry correct and disposes the old view (no VRAM leak).

**Headless-tolerant.** `attachPrimitive`/`attachSprite` return `false` when headless; the reconciler still records the signature so it does not retry every epoch, and `detach`/`markDirty` are safe no-ops. No throw, no view — inert but well-formed.

**One renderable per entity (P1).** `renderer.views` is keyed by entity, so an entity carrying both `Shape` and `SpriteRenderer` collides to a single view. Sprites are processed after shapes, so the **sprite wins**; an entity is expected to carry at most one renderable.

## Texture resolution (assets + asset-store)

The injected resolver widens what a `SpriteRenderer.sprite` alias can reach without any island touching the renderer. It resolves an alias in three steps:

1. `assets.get(alias)` present → return it (a manifest asset, or a store asset already loaded — the fast path; unchanged from before).
2. else the `asset-store` holds a live `blob:` url for the alias → fire-and-forget `assets.loadUrl(alias, url)` (caches the texture under the **stable alias**) and return `undefined`, so the renderer draws its placeholder until the load lands.
3. else → `undefined` (unknown alias → placeholder).

The resolver stays a pure `alias → handle` function. Because a just-in-time load completes **out of band** — bumping no change epoch — the render-sync system runs a **pending-texture retry** *before* its epoch gate: when a sprite reconciles with an alias that `assets.get` misses but `store.has` hits, the entity is recorded in `state.pending`; each subsequent tick re-checks it, and once `assets.get(alias)` resolves the sprite is re-attached (`detach` + `attachSprite` + `markDirty`) and dropped from pending. Once `pending` drains, the system returns to the pure epoch-gated early-out — so an imported store alias renders as soon as its texture is ready, at zero steady-state cost, with the app never pre-loading. `SpriteRenderer.sprite` stays a plain alias string; the store's blob and `blob:` url are never serialized.

## Reflection + catalog registration

At `onStart` the plugin registers a typed schema per component, so `reflection.describe` returns typed descriptors (registered always wins over inference) and `reflection.validate` — wired into `commands.setValidator` by `editor-bridge` — rejects a bad write *before* it reaches SoA storage:

```ts
app.reflection.describe("SpriteRenderer"); // sprite → "asset-ref", tint → "color", …
app.reflection.validate("Shape", { width: -1 }); // { ok: false, errors: [{ key: "width", … }] }
```

`SpriteRenderer.sprite` uses the `asset-ref` field kind, so the inspector renders an asset picker rather than a free-text box — inference could never originate that kind, since a bare `string` is ambiguous between free text and an alias.

It also registers three **Add-Component catalog entries** into `component-registry`: `Transform` (`addable: false` — every object implicitly has one), `SpriteRenderer`, and `Shape` (both `category: "Rendering"`). Each entry's `defaults` **is** the component's `create()` shape, so a component added through the picker is seeded exactly as the world would have created it.

## Dependencies

`[ecs, renderer, reflection, component-registry, assets, asset-store]` — exactly six, all live edges:

| Plugin | Used for |
| --- | --- |
| `ecs` | `defineComponent`; the sync system's `query`/`get`/`has`/`isAlive`/`changeEpoch`/`addSystem` |
| `renderer` | `attachPrimitive`/`attachSprite`/`detach`/`markDirty` + `setTextureResolver` |
| `reflection` | `register("SpriteRenderer"/"Shape", …)` and the `field.*` builders |
| `component-registry` | `register(entry)` for the three catalog entries |
| `assets` | `get(alias)` (fast path) + `loadUrl(alias, url)` (JIT store load) inside the injected resolver |
| `asset-store` | `url(alias)` / `has(alias)` (synchronous) inside the resolver + the pending-texture retry |

There is **no edge to `hierarchy`**, though this plugin's `sync` system is meant to run after hierarchy's world-transform system. That ordering comes from **registration order** (`graphics-2d` is assembled after `hierarchy`), not a dependency edge — graphics-2d calls nothing on hierarchy, so an edge would be dead. Correctness does not depend on it either: both systems only *mark entities dirty*, and the renderer composes world-space position by **pulling** the current transforms at position time.

> The framework plugin array must keep `graphics2dPlugin` **after** `hierarchyPlugin` **and after** `assetStorePlugin` (its texture resolver reads `store.url(alias)`), each with an inline breadcrumb comment at that call site, so a future reorder is a conscious choice rather than a silent regression.

## Usage Example

```ts
const app = createApp();
await app.start();

// A red circle at (100, 50) — no renderer call, no view construction.
app.ecs.spawn(
  app.renderer.Transform({ x: 100, y: 50, rotation: 0, scaleX: 1, scaleY: 1 }),
  app["graphics-2d"].Shape({
    kind: "circle",
    width: 100,
    height: 100,
    radius: 20,
    fill: "#ff0000",
    stroke: "#000000",
    strokeWidth: 0
  })
);

app.scheduler.tick(1 / 60); // the sync system attaches the view
```

## Roadmap

- **Sorting-layer z-order application** — `sortingLayer`/`orderInLayer` are authored + serialized now, but not yet applied to view z-order (the renderer has no per-entity z seam yet).
- **Composite / multiple renderables per entity** — lift the one-view-per-entity rule once the renderer keys views by `(entity, slot)`.
- **Animation / tilemap / text render components** — more library components following the same "component IS the renderable" reconciler pattern.
- **In-place sprite update** — a tint/flipX-only change without a full `detach` + `attachSprite` rebuild, once the renderer exposes a view-local mutate seam.
