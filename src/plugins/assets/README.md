# assets plugin

> Standard tier — Thin wrapper over Pixi v8's `Assets` loader.

Loads and caches textures/spritesheets by alias, builds `Sprite`s from loaded
textures, and emits the coarse `assets:loaded` event when a load completes.

The renderer plugin must be booted first (declared via `depends: [rendererPlugin]`).
Each API method lazily calls `ctx.require(rendererPlugin)` to guarantee the Pixi
`Application` (and therefore the shared Assets/texture GPU context) is running
before any load operation.

## No onStart / onStop

The Pixi `Assets` API is a singleton tied to the running `Application` — it does
not own an independent lifecycle resource. The `Application` is created and
destroyed by the renderer plugin (`onStart` / `onStop`). Because the assets
plugin borrows that context rather than owning it, adding `onStart`/`onStop` here
would be a no-op and is intentionally omitted.

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `basePath` | `string` | `""` | Base URL/path prepended to every resolved URL. |
| `manifest` | `Readonly<Record<string, string>>` | `{}` | Map of alias → URL. Aliases found here are preferred over the raw alias string. |
| `throwOnError` | `boolean` | `true` | When `true`, load errors are rethrown. When `false`, errors are logged via `ctx.log.error` and `load()` resolves `undefined`. |

## API (`app.assets`)

| Method | Signature | Description |
|---|---|---|
| `load` | `(alias: string) => Promise<Texture>` | Load one asset by alias; records the alias in `state.loaded` and emits `assets:loaded` with `kind: "asset"` on success. |
| `loadUrl` | `(alias: string, url: string) => Promise<Texture>` | Load a texture from an explicit URL and cache it under `alias` via Pixi v8 object-form `Assets.load({ alias, src: url })` — the cache key is the stable `alias`, not the URL. Records `alias` in `state.loaded` and emits `assets:loaded` with `kind: "asset"`. Same `throwOnError` behavior as `load`. |
| `loadBundle` | `(bundle: string, entries: Readonly<Record<string, string>>) => Promise<Record<string, Texture>>` | Register (`Assets.addBundle`) + load (`Assets.loadBundle`); records every entry alias and emits `assets:loaded` once with `kind: "bundle"`. |
| `get` | `(alias: string) => Texture \| undefined` | Return an already-loaded texture from the Pixi cache, or `undefined`. Does NOT trigger a load. |
| `sprite` | `(alias: string) => Promise<Sprite>` | Return a new Pixi `Sprite` from the texture — reuses the cached texture, loading only on a cache miss. |
| `isLoaded` | `(alias: string) => boolean` | Return `true` if the alias has been loaded this session (backed by `state.loaded`, not the Pixi cache). |

### URL resolution

For each alias the URL passed to Pixi is resolved as follows:

1. If `manifest[alias]` exists → use that URL.
2. Otherwise → treat the alias itself as the URL.

In both cases, `basePath` is prepended when non-empty.

```ts
// basePath: "assets/", manifest: { ship: "sprites/ship.png" }
app.assets.load("ship"); // → Assets.load("assets/sprites/ship.png")

// basePath: "assets/", no manifest entry
app.assets.load("tank.png"); // → Assets.load("assets/tank.png")
```

`loadUrl(alias, url)` bypasses this resolution entirely — it always loads the given
`url` and caches it under the given `alias` (Pixi object form `Assets.load({ alias,
src: url })`), never resolving `manifest`/`basePath`. This is the seam that lets an
`asset-store` `blob:` URL be cached under the store's stable alias rather than the
ephemeral blob URL string:

```ts
// Turns a store-owned blob: URL into a Pixi-cached texture keyed on the stable alias.
await app.assets.loadUrl("imported-ship", "blob:http://localhost/9f2c...");
app.assets.get("imported-ship"); // Texture (not "blob:http://localhost/9f2c...")
```

## Events

| Event | Payload | When |
|---|---|---|
| `assets:loaded` | `{ alias: string; kind: "asset" \| "bundle" }` | After `load()` or `loadBundle()` succeeds. For a bundle, `alias` is the bundle name. |

`assets:loaded` is a coarse milestone event — it is emitted once per call, not
once per individual texture in a bundle. It is appropriate for the `scene` plugin
and consumers that need to react when loading completes.

## Usage Example

```ts
import { createApp } from "../../index";

const app = createApp({
  pluginConfigs: {
    assets: {
      basePath: "assets/",
      manifest: { ship: "sprites/ship.png" }
    }
  }
});

await app.start();

// Load a texture by alias (resolves to "assets/sprites/ship.png").
const texture = await app.assets.load("ship");

// Build a Sprite — reuses the texture just loaded above (no second load).
const sprite = await app.assets.sprite("ship");
app.renderer.getStage()?.addChild(sprite);

console.log(app.assets.isLoaded("ship")); // true
```

React to load completion from a consumer plugin via the `assets:loaded` hook:

```ts
import { createPlugin } from "../../index";
import { assetsPlugin } from "./index";

const myPlugin = createPlugin("myPlugin", {
  depends: [assetsPlugin],
  hooks: _ctx => ({
    "assets:loaded": ({ alias, kind }) => {
      console.log(`${kind} "${alias}" ready`);
    }
  })
});
```

## Design Notes

- **No lifecycle (`onStart`/`onStop`):** the plugin borrows the renderer's Pixi
  `Application` context (which owns the Assets/GPU cache) rather than owning a
  resource of its own — see [No onStart / onStop](#no-onstart--onstop).
- **Lazy renderer require:** every method calls `ctx.require(rendererPlugin)`
  before touching Pixi `Assets`, guaranteeing the `Application` is started first.
  The return value is unused — the call exists purely for its ordering side-effect.
- **Cache-hit reuse in `sprite()`:** `sprite()` checks `get(alias)` first and only
  calls `load()` on a cache miss, so a repeat `sprite()` call does NOT re-trigger a
  load or re-emit `assets:loaded`.
- **Coarse `assets:loaded`:** emitted once per `load()`/`loadBundle()` call, never
  per-texture. A bundle of N textures emits exactly one event keyed on the bundle name.
- **`throwOnError: false` escape hatch:** on a `load()` failure the error is logged
  via `ctx.log.error` and the promise resolves `undefined` (typed as `Texture` for
  ergonomics — do not rely on the value). With `throwOnError: true` (default) the
  error is rethrown unchanged.
- **`isLoaded` vs `get`:** `isLoaded()` consults the session `state.loaded` Set,
  while `get()` reads the Pixi cache — they answer slightly different questions.

## Dependencies

- `rendererPlugin` — must be started first; owns the Pixi `Application` that
  Assets uses for its GPU context.
