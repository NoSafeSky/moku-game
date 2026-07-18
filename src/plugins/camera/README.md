# camera

> Standard plugin — a **2D game camera**: **follow** a moving target with per-frame exponential smoothing; **pan / zoom / rotate** instantly (`setPosition` / `setZoom` / `setRotation`) or **animated over time** (`moveTo` / `zoomTo` / `rotateTo`, delegating to `app.tween`); apply a decaying **screen shake** (`shake`, also `app.tween`-driven); render **parallax** across one or more world-space **layer containers it owns** (`world` / `addLayer` / `layer`); map points between screen and world space (`screenToWorld` / `worldToScreen`); and — for editor tooling — drive **instant, input-driven viewport controls** (`focus` / `zoomAt` / `panBy`, plus an opt-in cursor-anchored wheel-zoom + drag-pan system gated by `editorControls`). A single `"sync"`-stage scheduler system eases the centre toward the follow target, writes each layer's `pivot` / `position` / `scale` / `rotation`, and adds the shake offset. Emits **no** events. **Headless-safe** and **pause-safe**. Depends on `renderer` + `scheduler` + `tween` + `input` (the `input` edge is **inert** unless `editorControls` is on). **No new package dependency** (`pixi.js` is already direct via `renderer`).

`camera` is the missing "where the viewport looks" layer (GitHub issue #5 §6). It realizes tween Follow-up **T4** — the follow / shake / parallax camera that **consumes `app.tween`** for smooth, pause-safe pans, zooms, and shake decay, and shares the tween plugin's canonical `lerp` for its follow smoothing.

## World-vs-screen split — the camera transforms LAYER containers it owns, not the root stage

The camera creates a default **`world` `Container`** and parents it at the **bottom** of the renderer stage (`stage.addChildAt(world, 0)`), plus any number of named **parallax layers** via `addLayer(name, factor)`. It transforms **these** containers each frame — **never** the root stage. So:

- **Game / world content** goes into `camera.world` (or a layer) and rides the camera transform.
- The **`ui` plugin's overlay** and anything else on the stage root stay **screen-fixed** (the HUD does not pan with the world).
- **Parallax** works because each layer is its own transformed plane — a single stage is a single plane.

This composes cleanly with the renderer's `"sync"` system: that system writes each entity view's position in its **parent's** local space, so the parent (a camera layer) carries the *camera* transform while the child carries its *entity* `Transform` — the two multiply correctly with no coordination.

```ts
const app = createApp({ pluginConfigs: { camera: { width: 1280, height: 720 } } });
await app.start();

// Put world content under the camera; the HUD stays screen-fixed on the stage root.
app.camera.world?.addChild(playerSprite);
const far = app.camera.addLayer("far", 0.3); // slow-scrolling background (parallax)
far?.addChild(mountains);

// Follow the player (any live { x, y } — a sprite, an entity Transform value, a bare point):
app.camera.follow(playerSprite);

// Animated pan / zoom (pause-safe via app.tween):
await app.camera.moveTo(640, 360, { duration: 0.6, easing: "easeOutCubic" }).done;
app.camera.zoomTo(1.5, { duration: 0.4 });

// Screen shake on impact (magnitude decays to 0 over 0.4 s):
app.camera.shake(16, 0.4);

// Place a UI marker over a world object:
const screen = app.camera.worldToScreen({ x: enemy.x, y: enemy.y });
```

> **Limitation (documented, not a bug):** content added via `renderer.attachPrimitive` **self-parents to the stage root**, so it is **not** camera-transformed. The camera path is `renderer.attach(entity, view)` (which does not parent the view) followed by `camera.world.addChild(view)` (or a layer).

## Follow target is a structural `{ x, y }` — no `ecs` dependency

`follow(target?)` stores the reference; the apply system reads `target.x` / `target.y` **live each frame** and eases the centre toward it. A Pixi `Container` (`.x` / `.y` getters), an entity's `Transform` **value object** (`{ x, y, rotation, scaleX, scaleY }`), and a bare `{ x, y }` **all** satisfy the structural type — so the camera follows *anything* without importing an ECS/renderer token. Smoothing reuses **`app.tween.lerp`** (the single canonical `lerp`). Because the loop is fixed-timestep, a constant per-step factor (`center = lerp(center, target, followLerp)`) is frame-rate-stable. Call `follow()` with no argument to stop following.

> The target must expose **live** `x` / `y` (a snapshot object won't move). `followLerp ∈ [0,1]`: `1` snaps to the target each step, smaller is laggier. Deadzone / lookahead / bounds-clamping are deferred follow-ups (F1–F2).

## Animated moves + shake decay consume `app.tween`

`moveTo` tweens the centre, `zoomTo` / `rotateTo` tween the scalar holders, and `shake(intensity, duration)` runs `app.tween.value(intensity, 0, …)` so the shake **magnitude decays on the game clock**. This is precisely **why** the camera depends on `tween`: smooth, **pause-safe** pans / zooms / shakes reuse the shared tweening layer (they freeze with the loop during a portal ad break, for free) instead of re-implementing easing or a decay timer. Every animated method returns the tween's `TweenHandle`, so callers can `await handle.done` or `handle.stop()`.

- Starting a `moveTo` **clears `follow`** (an explicit pan overrides continuous follow).
- Instant setters (`setPosition` / `setZoom` / `setRotation`) bypass tween.
- `shake` **replaces** any in-flight shake (the prior handle is stopped) so overlapping shakes don't stack unbounded.
- `MoveOptions` intentionally omits `repeat` / `yoyo` (a repeating camera pan is nonsensical).

## Editor controls — `focus` / `zoomAt` / `panBy` + an opt-in input-driven system

Three **instant** methods (no tween, mutate only numeric state — so like `setPosition` / `setZoom` they are valid **before start** and headless) frame the world the way an editor viewport does. All three **clear `follow`** (an explicit editor gesture overrides continuous follow):

- **`focus(target, opts?)`** — snap the centre to a world `target` and optionally set `zoom` (clamped).
- **`zoomAt(screen, factor)`** — cursor-anchored zoom: scale `zoom` by `factor` (clamped) while keeping the world point under `screen` fixed (computed via `screenToWorld` before/after).
- **`panBy(dxScreen, dyScreen)`** — free-pan by a screen-pixel delta converted to world space (rotation-aware, `÷ zoom`) and subtracted from the centre (a drag moves the view opposite the pointer).

Setting **`config.editorControls: true`** additionally makes `onStart` capture `app.input` and register an **editor-control system** in the `"update"` stage that reads `input.snapshot()` every frame and drives those gestures directly:

- **Mouse wheel → cursor-anchored zoom** — when `snapshot().wheel.deltaY !== 0`, calls `zoomAt(pointer, Math.exp(-deltaY * sensitivity))`; scrolling up (negative `deltaY`) zooms in, keeping the world point under the cursor fixed.
- **Middle-button or space drag → pan** — panning is active while the middle button is held (`pointer.buttons & 4`) **or** space is held (`isDown(" ")`); while active it calls `panBy` with the frame-to-frame pointer delta. Releasing and re-pressing starts a **fresh** drag (no jump).

This is why `camera` declares an **`input`** dependency edge. When `editorControls` is `false` (the default) the edge is **declared-but-inert**: no input API is captured, no editor-control system is registered, and `input.snapshot()` is never read — non-editor apps see **zero** behaviour change. There is no dependency cycle: `input` depends only on `scheduler`, so `camera → input → scheduler → ecs` is acyclic.

```ts
// Editor app: opt into input-driven viewport controls.
const app = createApp({
  pluginConfigs: { camera: { editorControls: true, width: 1280, height: 720 } }
});
await app.start();

// The viewport now responds to input each frame — no per-island wiring needed:
//   • Mouse wheel               → cursor-anchored zoom (world point under the pointer stays put)
//   • Middle-drag / Space+drag   → free-pan

// Programmatic editor gestures (instant, tween-free, follow-clearing):
app.camera.focus({ x: 100, y: 50 }, { zoom: 2 }); // frame + zoom onto a world point
app.camera.zoomAt({ x: pointerX, y: pointerY }, 1.1); // zoom in 10 %, cursor-anchored
app.camera.panBy(dx, dy); // pan by a screen-pixel delta
```

## API

Accessed as `app.camera.*` after `createApp()`. Mutating + animated methods are guarded no-ops **before `app.start()`** (they warn via `ctx.log`; animated methods return a **dead handle** — inert controls, `active: false`, a resolved `done`). The pure readers (`getPosition` / `getZoom` / `getRotation` / `screenToWorld` / `worldToScreen`) and the instant editor gestures (`focus` / `zoomAt` / `panBy`) plus `reset` work before start (they only read / mutate numeric state).

| Member | Description |
|---|---|
| `world` | The default world layer `Container` (factor 1), or `undefined` when headless. |
| `addLayer(name, factor)` | Create (or return the existing) named parallax layer. Idempotent by name; `undefined` headless. |
| `layer(name)` | Look up a previously-added layer `Container`; `undefined` if absent or headless. |
| `follow(target?)` | Continuously ease toward `target.x` / `target.y`; omit `target` to stop. |
| `setPosition(x, y)` | Snap the centre immediately (clears follow). |
| `moveTo(x, y, opts?)` | Animated pan via `app.tween` (clears follow). Returns a `TweenHandle`. |
| `getPosition()` | The current centre in world space (a fresh copy). |
| `setZoom(zoom)` | Set zoom immediately, clamped to `[minZoom, maxZoom]`. |
| `zoomTo(zoom, opts?)` | Animated zoom via `app.tween` (final value clamped). Returns a `TweenHandle`. |
| `getZoom()` | The current zoom. |
| `setRotation(radians)` | Set rotation (radians) immediately. |
| `rotateTo(radians, opts?)` | Animated rotate via `app.tween`. Returns a `TweenHandle`. |
| `getRotation()` | The current rotation in radians. |
| `shake(intensity, duration, opts?)` | Additive screen shake decaying to 0 over `duration` s via `app.tween`. Replaces any in-flight shake. |
| `focus(target, opts?)` | **Editor:** snap the centre to a world `target` and optionally set `zoom` (clamped). Instant; clears follow. |
| `zoomAt(screen, factor)` | **Editor:** cursor-anchored zoom — scale `zoom` by `factor` (clamped) keeping the world point under `screen` fixed. Instant; clears follow. |
| `panBy(dxScreen, dyScreen)` | **Editor:** free-pan by a screen-pixel delta (rotation-aware, `÷ zoom`). Instant; clears follow. |
| `reset()` | Recentre to `(0, 0)`, `zoom → config.zoom`, `rotation → 0`, clear follow, stop any shake. Layers + captured tween stay intact. |
| `screenToWorld(point)` | Map a screen-space point to world space (picking). |
| `worldToScreen(point)` | Map a world-space point to screen space (place UI over a world object). |

`MoveOptions` = `duration` / `easing` / `delay` / `onComplete` / `onUpdate` (a `Pick` of the tween options). `ShakeOptions` = `{ easing? }` (the decay curve; default `"linear"`). `Point` = `{ x: number; y: number }`.

> **`reset()`** realizes Follow-up F4 and is invoked by `editor-runtime.stop()` on **exit-play** (the `reset()` Retrofit Convention) to clear transient camera runtime between play sessions.

## Configuration

Per-plugin config under `pluginConfigs.camera`.

| Field | Type | Default | Description |
|---|---|---|---|
| `zoom` | `number` | `1` | Initial (and `reset`) zoom — screen units per world unit; must be > 0. |
| `minZoom` | `number` | `0.1` | Lower clamp for zoom (`setZoom` / `zoomTo` / `zoomAt` are clamped). |
| `maxZoom` | `number` | `10` | Upper clamp for zoom. |
| `followLerp` | `number` | `0.15` | Per-fixed-step follow smoothing in `[0,1]`: 1 = snap, smaller = laggier. |
| `width` | `number` | `800` | Reference viewport width — screen centre is `width / 2`. |
| `height` | `number` | `600` | Reference viewport height — screen centre is `height / 2`. |
| `updateStage` | `Stage` | `"sync"` | Scheduler stage the apply system runs in (validated by `scheduler.addSystem`). |
| `editorControls` | `boolean` | `false` | When `true`, capture `app.input` and register a `"update"`-stage system for cursor-anchored wheel-zoom + middle/space drag-pan. Adds an (otherwise inert) `input` dependency edge. |

> **`width` / `height` rationale** (the `ui` plugin's accepted extension): the renderer exposes only `getStage()` — no canvas dimensions — on its API, so the camera takes a **reference viewport** for centering and for the `screenToWorld` / `worldToScreen` math. A consumer whose canvas differs from 800×600 sets these to match.

## Events

**None.** Camera control is imperative (method calls), with no discrete milestone worth a kernel event — the same stance as `ecs`, `renderer`, `scheduler`, `loop`, `tween`, `ui`, and `vfx`. Downstream reactivity (UI reading `getPosition` / `getZoom`) is **pull**, owned by the consumer.

## Lifecycle

`onStart` is justified as **deps-ready wiring** (annotated `@no-resource-check`): after `renderer` / `scheduler` / `tween` / `input` have started, it captures the tween API, seeds `zoom` from config, builds the default `world` layer under the renderer stage (when present), registers the `"sync"`-stage apply system, and — **only when `config.editorControls`** — captures the `input` API and registers the `"update"`-stage editor-control system, then flips `started`. When `editorControls` is `false`, that fourth step is skipped entirely (no input captured, no extra system).

There is **no `onStop`**: every `Container` the camera creates is parented under the **renderer-owned** stage, so the renderer disposes the whole subtree on its own `onStop`; the apply / editor-control systems hold no external resource (no socket / timer / listener); and `state.tween` / `state.input` are captured API references, not owned (the `ui` / `vfx` / `tween` precedent).

## Headless-safe

With no renderer stage, the layer containers are never created and every container write is a guarded no-op — **but** the numeric camera state (centre / zoom / rotation) still updates, so logic, `screenToWorld` / `worldToScreen`, and the editor gestures (`focus` / `zoomAt` / `panBy`) keep working. The plugin runs identically headless.

## Pause-safe

The apply system and the tweens it starts all ride the loop's `scheduler.tick(dt)`, so a paused loop (e.g. a portal ad break) freezes camera motion for free — exactly like `tween`, with **no** `platform` / `loop` dependency edge.

## Dependencies

- **`renderer`** — `getStage()` to build the world / parallax layer containers (a **real** edge, wired in `onStart`).
- **`scheduler`** — `addSystem(config.updateStage, applySystem)` always, plus `addSystem("update", editorControlSystem)` when `editorControls` (a **real** edge, wired in `onStart`); `dt` arrives via the `(world, dt)` system signature.
- **`tween`** — `to` / `value` back `moveTo` / `zoomTo` / `rotateTo` / `shake`, and `lerp` backs the follow smoothing (all **real** edges; the API is captured once in `onStart`).
- **`input`** — captured in `onStart` **only when `editorControls`**; the editor-control system reads `snapshot().wheel` (cursor-anchored `zoomAt`) and `snapshot().pointer` / `isDown(" ")` (middle/space drag → `panBy`). A **declared-but-inert** edge when `editorControls` is `false`. **No cycle** (`input → scheduler → ecs`).
- **Not `ecs` / not `loop`** — the follow target is a structural `{ x, y }` (no ECS token), and the apply system + its tweens ride `scheduler.tick` (a paused loop freezes camera motion for free).
- **Core `ctx.log`** (Layer 1) — before-start no-op diagnostics. No raw `console.*`; no `process.env`.
- **No package dependency** — `pixi.js` is already direct via `renderer` and is runtime-imported for `new Container()` exactly as `ui` does.

## Follow-ups (non-blocking)

- **F1 — follow deadzone / lookahead:** a `deadzone` rectangle and velocity-based `lookahead`, additive options on `follow`.
- **F2 — world bounds clamping:** a `setBounds(rect)` clamping the centre so the viewport never shows outside the level.
- **F3 — trauma-based shake (vfx parity):** swap the linear intensity decay for `vfx`'s `trauma²` falloff.
- **F5 — `mcp` camera introspection:** expose `game://camera/state` + a `camera:moveTo` tool so an agent can drive the viewport.

> **F4 — `reset()`** shipped this cycle (see the `reset()` row in [API](#api)).
