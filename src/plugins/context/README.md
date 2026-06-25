# context

> Standard tier — binds the framework's well-known ECS world resources (`Assets`, `GameContext`) at start so systems reach framework services through the `world` they already receive.

ECS systems have the signature `(world, dt)` — they never see the plugin `ctx`.
The `context` plugin closes that gap: at framework start it registers two
**well-known world resources** onto the ECS world, so any system can reach
framework services via `world.resource(token)` with no closure over `app`:

1. **`Assets`** — the `assets` plugin API (`load` / `loadBundle` / `get` /
   `sprite` / `isLoaded`). Always bound.
2. **`GameContext`** — a curated, hot-path-safe facade `{ log, emit, env }` built
   from this plugin's own `ctx`. Bound only when `config.bindGameContext` is `true`.

The plugin owns no per-frame logic and stores no domain data (`State` is the
empty record `Record<never, never>`). Its entire job is the start-time binding —
it is a thin wiring + facade plugin sitting **above** both `ecs` and `assets`.

## The `onStart` binding

Unlike the `assets` plugin (which has no lifecycle), `context` **does** use
`onStart` — and only `onStart` (no `onInit`, no `onStop`). The managed concern is
the **well-known resource bindings on the world**: cross-plugin wiring that must
be in place before the first frame. `onStart` is the right hook because binding
needs the *started* `assets` API and the live world, which `ctx.require` resolves
at start (not at init).

`start(ctx)` (in `lifecycle.ts`) does three things:

1. `const world = ctx.require(ecsPlugin)` — acquire the ECS world.
2. `world.setResource(Assets, ctx.require(assetsPlugin))` — bind the assets API.
   **Always** runs, regardless of `bindGameContext`.
3. If `ctx.config.bindGameContext`, bind the curated facade:
   `world.setResource(GameContext, { log: ctx.log, emit: ctx.emit, env: ctx.env })`.

The `onStart` reference in `index.ts` carries a `// @no-resource-check` comment.
The "no lifecycle without a resource" rule is satisfied here by the *world-level
binding* itself — the start-time setup of a world resource, mirroring how
`renderer.onStart` mints the shared `Transform` token. It is **not** an OS-level
resource (socket / timer / listener), so there is nothing to tear down: the
bindings are released with the world on stop, hence no `onStop`.

**Ordering is safe regardless of plugin-array position.** `context.onStart` is
guaranteed to run after `assets.onStart` by its `depends: [ecsPlugin, assetsPlugin]`
(start runs in dependency order), and the loop's first tick fires on the *next*
animation frame — after `app.start()` has awaited every plugin's `onStart` — so
`Assets` / `GameContext` are always bound before any system runs.

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `bindGameContext` | `boolean` | `true` | When `true`, bind the curated `GameContext` resource (`{ log, emit, env }`) at start. `Assets` is bound either way. Disable only if a consumer wants to provide its own game-context resource. |

## API (`app.context`)

The plugin's API surface is **static** — it exposes the two well-known resource
**tokens**, not the values. The tokens are fixed-key module consts (in
`resources.ts`), so the API is valid even before `start`; `onStart` binds their
*values* onto the world.

| Member | Type | Description |
|---|---|---|
| `assets` | `Resource<AssetsApi>` | Token for the assets API. `__key === "ctx:assets"`. Read in a system: `world.resource(assets)`. |
| `game` | `Resource<GameContextValue>` | Token for the curated game context. `__key === "ctx:game"`. Read in a system: `world.resource(game)`. |

These map to the exported consts in `resources.ts`:

```ts
import { Assets, GameContext } from "./resources";

// Assets:      Resource<AssetsApi>        — { __key: "ctx:assets" }
// GameContext: Resource<GameContextValue> — { __key: "ctx:game" }
```

`app.context.assets` is the same token object as `Assets`, and
`app.context.game` is the same as `GameContext`.

### `GameContextValue`

The value bound to the `GameContext` token is a curated, escape-hatch-free facade:

```ts
type GameContextValue = {
  /** Structured logger (ctx.log from the common logPlugin). */
  readonly log: LogApi;
  /** Emit a coarse framework event (assets:loaded | scene:loaded). */
  readonly emit: EmitFn<FrameworkEvents>;
  /** Validated environment accessor (ctx.env from the common envPlugin). */
  readonly env: EnvApi;
};
```

`log` and `env` are the *same references* as `ctx.log` / `ctx.env`; `emit`
forwards to `ctx.emit`. The facade deliberately **excludes** the kernel escape
hatches (`require` / `has` / `global`) — calling the kernel inside a per-frame
system is an anti-pattern. Frame time is delivered separately as the `loop`
plugin's `Time` resource, not here.

## Events

None. The `context` plugin declares and emits no events of its own. It does hand
systems a typed `emit` inside `GameContext`, but that emitter forwards the
framework's global `Events` (`assets:loaded` | `scene:loaded`) — it is not an
event surface owned by this plugin.

## Usage Example

Capture the tokens once from `app.context`, then read their values inside any
system via the `world` it receives:

```ts
import { createApp } from "../../index";

const app = createApp();
await app.start();

// Capture the well-known resource tokens once (like component tokens).
const { assets, game } = app.context;

// The ecs World API is exposed as `app.ecs`; systems receive `(world, dt)`.
app.ecs.addSystem("render", (world, _dt) => {
  const a = world.resource(assets); // AssetsApi — first-class, no `app` capture
  const g = world.resource(game);   // { log, emit, env }

  const ship = a.get("ship");
  if (!ship) g.log.warn("ship texture not loaded");
});

app.ecs.tick(1 / 60);
```

`world.resource(token)` throws the ecs "resource is not set" error if read
**before** `start` (the tokens are valid immediately, but their values are unset
until `onStart` binds them).

With `bindGameContext: false`, `Assets` is still bound but reading `game` throws:

```ts
import { createApp } from "../../index";

const app = createApp({
  pluginConfigs: { context: { bindGameContext: false } }
});
await app.start();

app.ecs.resource(app.context.assets);     // ok — Assets is always bound
app.ecs.resource(app.context.game);       // throws: "resource ... is not set"
```

## Design Notes

- **`onStart`-only lifecycle:** the single managed concern is the world-resource
  bindings, set up once before the first frame — see
  [The `onStart` binding](#the-onstart-binding). No `onInit` (binding needs the
  started `assets` API + world, resolved by `ctx.require` at start) and no
  `onStop` (the bindings are released with the world).
- **Fixed-key tokens, late values:** `Assets` (`"ctx:assets"`) and `GameContext`
  (`"ctx:game"`) are plain module consts, so they are valid to reference and
  capture immediately — only their *values* are unset until `start`. This differs
  from `world.defineResource`, which mints auto-keyed (`"res:N"`) tokens.
- **Curated, hot-path-safe `GameContext`:** exactly `{ log, emit, env }` — no
  kernel escape hatches (`require` / `has` / `global`). Systems get logging,
  coarse framework events, and validated env without a way to re-enter the kernel
  mid-frame.
- **`Assets` always, `GameContext` opt-out:** `Assets` is bound unconditionally;
  `GameContext` is gated on `bindGameContext` so a consumer can substitute its own.
- **No `scene` dependency for `emit`:** the global `Events` declared in
  `createCoreConfig` are visible to every plugin's `ctx.emit`, so `scene:loaded`
  is emittable through the `GameContext.emit` here without depending on `scene` —
  avoiding a runtime-unused dependency. `depends` is `[ecs, assets]` only.
- **Static API, no state:** `createApi` returns the two token consts and
  `createState` returns `{}`; nothing per-instance lives in the plugin — the
  values live in the ECS world's resource registry.

## Dependencies

- `ecsPlugin` — required via `ctx.require(ecsPlugin)`; its `world.setResource`
  binds both resources at start, and systems read them back with `world.resource`.
- `assetsPlugin` — required via `ctx.require(assetsPlugin)`; the started assets
  API is the value bound to the `Assets` resource.
