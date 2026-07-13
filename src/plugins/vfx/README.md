# vfx

> Complex plugin — the **game-juice / visual-feedback** layer: **ECS-native particle emitters**, **trauma-based screen shake**, **Transform scale-pop**, **hit-flash tint**, **floating damage/score text**, and a set of **pure easing helpers**. Every effect runs as a scheduler system over ordinary ECS entities. Emits **no** events (per-frame hot path). **Headless-safe**. Depends on `ecs`, `scheduler`, and `renderer`. **No new package dependency** (Pixi comes in via `renderer`).

The `vfx` plugin adds the "juice" that makes hits, pickups, and score changes *feel* good. It is a pure **API that your own game code calls** — `app.vfx.burst()` / `shake()` / `pop()` / `flash()` / `floatText()` from your collision and scoring systems — so vfx never couples to any specific gameplay event. Because effects are modelled as ECS entities driven by systems (not a third-party emitter running outside the world), every particle and emitter is queryable through `world.query(...)` and introspectable by name through the `mcp` plugin out of the box.

## ECS-native particles (no `@pixi/particle-emitter`)

An emitter is an **entity** carrying a named `Emitter` component; a particle is an **entity** carrying `renderer.Transform` + a named `Particle`. The emit system spawns particles inside the `"update"` stage; because the ECS command buffer flushes before the `"sync"` stage, an emitted particle is **visible the same frame**. Particles are drawn via `renderer.attachPrimitive` (a Pixi `Graphics`), so the **renderer owns their entire view lifecycle** — stage-add, per-tick sync from Transform, and disposal on despawn. vfx keeps no per-particle handle.

Particles **fade by scaling out** (`startScale → endScale ≈ 0`) rather than by alpha, so they render straight through the renderer's primitive path with zero new dependency. This keeps the issue-#5 load budget (`<10 s` load / `<20 MB` build) intact and matches the framework's ECS/MCP-first ethos. A `ParticleContainer`-backed batch path for *thousands* of particles is a documented deferred optimization; the target here is the issue's "hundreds at 60 fps".

```ts
// In a collision system, on an enemy hit:
app.vfx.burst(hit.x, hit.y, { count: 16, speed: 220, lifetime: 0.5, color: 0xffcc00, radius: 3 });
app.vfx.pop(enemy, { scale: 1.4, duration: 0.12 });   // squash-pop the sprite
app.vfx.flash(enemy, { color: 0xffffff, duration: 0.12 }); // white hit-flash the sprite
app.vfx.floatText(hit.x, hit.y - 20, "+50", { color: 0xffffff });
app.vfx.shake(0.5, 0.3);                               // punchy screen shake

// A persistent trail emitter following the player:
const trail = app.vfx.createEmitter({ rate: 80, speed: 40, spread: 0.3, lifetime: 0.6, color: 0x66ccff });
app.ecs.set(trail, app.renderer.Transform, { x: player.x, y: player.y }); // move it each frame
```

## Effects

- **Emitters** — persistent particle sources. `createEmitter` spawns an emitter entity; reconfigure it live with `configureEmitter`, pause/resume with `setEmitterEnabled`, and tear it down (with its live particles) via `removeEmitter`. Emission honours a fractional accumulator, so `rate = 60` yields ≈1 particle per 1/60 s tick with no double-spawn.
- **Burst** — one-shot `burst(x, y, spec)` for hit sparks, explosions, and pickups. No persistent entity is retained; particles default to a full-circle spread.
- **Screen shake** — trauma-based. `shake(amplitude, duration)` banks trauma (0..1); the render-stage system offsets the Pixi stage root by `trauma² · shakeMaxOffset` in a random direction and decays trauma by `shakeDecay` each second, snapping back to (0, 0) at rest. `stopShake()` clears it immediately.
- **Pop** — `pop(entity, { scale, duration })` gives any entity's Transform a squash-and-return scale pulse (a smooth base → apex → base curve). It captures and restores the entity's **exact** base scale, and re-calling refreshes the pop without recapturing a mid-pop scale.
- **Hit-flash** — `flash(entity, { color, duration })` tints the entity's view to `color` (default white) then eases it back to the captured base tint over `duration` (default 0.12 s), restoring it **exactly**; re-calling refreshes without recapturing a mid-flash tint. It reads the entity's view via the renderer's `getEntityView` and writes `view.tint` directly (tint is a view-local property, not a Transform channel). Headless / view-less entities age the effect out with no tint write.
- **Floating text** — `floatText(x, y, text, opts)` spawns a rising, alpha-fading `Text` (e.g. `"+50"` damage numbers). vfx retains this one handle to fade its alpha each frame (the renderer's sync system positions it but never touches alpha); it despawns itself at end of life.
- **Easing** — `app.vfx.easing` is a frozen table of pure `f(t): [0,1]→[0,1]` curves (`linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeOutCubic`, `easeOutBack`, `easeOutElastic`) plus `app.vfx.lerp`. Reused internally and exported for your own juice (and a future `tween` plugin).

## Global particle cap

A single `maxParticles` budget spans every emitter and burst. When the live count is at the cap, further emission is **dropped** (debug-logged once per over-budget frame) — emitters never back up an unbounded queue.

## API

Accessed as `app.vfx.*` after `createApp()`. Every effectful method is a guarded no-op before `app.start()` (returning a dead entity handle where it must return one) and on dead / wrong-type entities.

### `createEmitter(spec: EmitterSpec): Entity`

Spawn a persistent emitter entity (`Emitter` + `Transform` at `spec.x`/`spec.y`). Move it later by writing its Transform. Required: `rate`, `speed`, `lifetime`; everything else has a sane default.

### `configureEmitter(emitter, patch)` / `setEmitterEnabled(emitter, enabled)`

Shallow-merge new emission parameters (position moves via the Transform, not here), or pause/resume emission while keeping existing particles alive.

### `removeEmitter(emitter)`

Despawn an emitter **and only its own live particles** (a per-particle owner back-reference scopes the sweep — burst particles are untouched).

### `burst(x, y, spec: BurstSpec): void`

Emit `spec.count` particles instantly at `(x, y)`. Required: `count`, `speed`, `lifetime`.

### `shake(amplitude, duration)` / `stopShake()`

Add screen-shake trauma (`amplitude` sets minimum intensity; `duration` banks enough trauma to persist roughly that long), or clear it and reset the stage offset immediately.

### `pop(entity, opts?)`

Scale-pop an entity's Transform to `opts.scale`× (default 1.3) over `opts.duration` (default 0.15 s) and back. No-op without a Transform.

### `flash(entity, opts?)`

Hit-flash an entity's view: snap its `tint` to `opts.color` (default white) then ease it back to the captured base tint over `opts.duration` (default 0.12 s), restored exactly. Requires the entity to be alive; the tint is only visible when the entity has an attached view (headless → the effect ages out with no tint write). Re-calling refreshes the flash while preserving the originally-captured base tint.

### `floatText(x, y, text, opts?): Entity`

Spawn a rising, alpha-fading floating number/text. Returns its entity handle.

### `easing` / `lerp(a, b, t)`

The frozen easing-curve table and linear interpolation.

## Configuration

Per-plugin config under `pluginConfigs.vfx`.

| Field | Type | Default | Description |
|---|---|---|---|
| `maxParticles` | `number` | `1000` | Global cap on simultaneously-live particles across every emitter + burst. |
| `shakeDecay` | `number` | `1.8` | Screen-shake trauma decay in units/second (trauma is 0..1). |
| `shakeMaxOffset` | `number` | `24` | Maximum stage offset in pixels at trauma = 1 (offset scales with trauma²). |
| `defaultColor` | `number` | `0xffffff` | Fallback particle/text color when a spec omits `color`. |

## Events

**None.** Particle emission, shake, pop, and floating text are per-frame hot-path work with no discrete, rare milestone worth a kernel event — the same stance as `ecs`, `renderer`, `scheduler`, and `loop`. Compose vfx with other plugins at the app layer (e.g. `vfx.burst()` + `audio.play()` on the same hit).

## Lifecycle

`onStart` is justified as **deps-ready wiring** (the renderer's own onStart shape — not a per-frame or resource-owning path): after `ecs`/`scheduler`/`renderer` have started, it (1) captures `renderer.Transform` (reading it earlier throws), (2) defines the five named components (`Emitter`/`Particle`/`Pop`/`Flash`/`FloatingText`) so they exist before any spawn and are MCP-introspectable by name, and (3) registers the six effect systems (emit/particle/pop/flash/floating in `"update"`, shake in `"render"`).

There is **no `onStop`**: vfx owns no external OS/GPU resource of its own. Every view it builds is registered with the renderer — particle `Graphics` via `attachPrimitive`, floating-text `Text` via `attach` — so the renderer disposes them (its `onStop` destroys all managed views, and its per-tick despawn reconciliation destroys a view when its entity dies). vfx's own state (the `Text` handle map, `trauma`, `particleCount`) is plain GC-able data.

## Headless-safe

Every system is registered and runs identically headless; entities simulate with no visual. Only Pixi *view creation* guards on `renderer.getStage()` being defined — headless particles never build a `Graphics`, headless floating text never builds a `Text`, and the shake system decays trauma without writing the (absent) stage. Nothing throws.

## Design Notes

- **ECS-native over `@pixi/particle-emitter`** — a third-party emitter adds a runtime dependency and a second particle lifecycle *outside* the world (invisible to `world.query`, MCP introspection, and scene-unload reconciliation). vfx instead owns a small emit/integrate/despawn system set and reuses the renderer's draw path — deps-light and fully queryable.
- **Easing here (`tween` dedupe deferred)** — vfx ships the pure easing curves + `lerp` it needs and exports them (`app.vfx.easing`/`app.vfx.lerp`), but **not** a general property-tween scheduler — that is `tween`'s job. The `tween` plugin ships the identical 7-curve table (and `camera` reuses it); de-duplicating vfx onto `tween` is **deferred** — the correct form is a `depends: [tweenPlugin]` + `ctx.require` edge (as `camera` does), not a bare cross-plugin import.
- **Particle owner reference** — `ParticleValue` carries an `emitter` handle (the sentinel dead handle for burst particles). This is what lets `removeEmitter` despawn an emitter together with only *its* particles without a separate ownership map.

## Dependencies

- **`ecs`** — `defineComponent` (the four named components), `spawn`/`despawn`, `query(...).updateEach`, `add`/`remove`/`get`/`set`/`has`/`isAlive`. Structural ops inside systems route through the command buffer.
- **`scheduler`** — `addSystem(stage, system)` to register the emit/particle/pop/flash/floating systems (`"update"`) and the shake system (`"render"`); `dt` arrives via the `(world, dt)` system signature.
- **`renderer`** — the `Transform` token (captured in onStart); `attachPrimitive` (particle `Graphics`, renderer-owned); `attach` + `getStage` (floating-text `Text` handles vfx retains to fade alpha); `markDirty` (repaint after a Transform write); `getEntityView` (read an entity's view to write `tint` for `flash`).
- **Not `loop` / not `audio`** — vfx never calls the loop (dt flows through the system signature; the loop already drives `scheduler.tick`) and does not cross-wire audio (a title composes them at the app layer).
- **Core `ctx.log`** (Layer 1) — the once-per-over-budget-frame particle-cap notice. No raw `console.*`.
- **No package dependency** — Pixi `Graphics`/`Text` come from `pixi.js`, already a direct dependency via `renderer`; Pixi imports are confined to vfx's domain files.
