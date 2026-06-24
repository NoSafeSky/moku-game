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
| `load` | `(alias: string) => Promise<Texture>` | Load one asset by alias; emits `assets:loaded` with `kind: "asset"` on success. |
| `loadBundle` | `(bundle: string, entries: Readonly<Record<string,string>>) => Promise<Record<string,Texture>>` | Register + load a bundle; emits `assets:loaded` once with `kind: "bundle"`. |
| `get` | `(alias: string) => Texture \| undefined` | Return an already-loaded texture from the Pixi cache, or `undefined`. |
| `sprite` | `(alias: string) => Promise<Sprite>` | Load (or use cached) texture and return a new Pixi `Sprite`. |
| `isLoaded` | `(alias: string) => boolean` | Return `true` if the alias has been loaded this session. |

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

## Events

| Event | Payload | When |
|---|---|---|
| `assets:loaded` | `{ alias: string; kind: "asset" \| "bundle" }` | After `load()` or `loadBundle()` succeeds. |

`assets:loaded` is a coarse milestone event — it is emitted once per call, not
once per individual texture in a bundle. It is appropriate for the `scene` plugin
and consumers that need to react when loading completes.

```ts
const { createApp, createPlugin } = coreConfig.createCore(coreConfig, {
  plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, assetsPlugin]
});

const myPlugin = createPlugin("myPlugin", {
  depends: [assetsPlugin],
  hooks: _ctx => ({
    "assets:loaded": ({ alias, kind }) => {
      console.log(`${kind} "${alias}" ready`);
    }
  })
});
```

## Dependencies

- `rendererPlugin` — must be started first; owns the Pixi `Application` that
  Assets uses for its GPU context.
