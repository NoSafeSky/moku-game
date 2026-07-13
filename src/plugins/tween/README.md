# tween

> Standard plugin — the **shared tweening layer**: animate the numeric properties of any **plain mutable object** (`to`/`from`), or a bare scalar (`value`), over time with **easing**, **delay**, **repeat**, and **yoyo**. Returns an opaque `TweenHandle` (`stop`/`pause`/`resume`/`active` + a `done` Promise). Re-exposes the canonical easing table + `lerp` so every juice consumer shares **one** curve source. One scheduler `"update"`-stage system advances all tweens by `dt`. Emits **no** events. **Headless-safe** and **pause-safe**. Depends on `scheduler` only. **No new package dependency** (pure math + scheduler).

`tween` is the reusable animation primitive that `vfx`, `ui`, and a future `camera` can all share (GitHub issue #5 §6). Unlike `vfx`'s ECS-native particles, a tween is **agnostic to what it animates**: it reads and writes the numeric fields of any object you hand it — a camera `{ x, y }`, a UI element's position, an audio-gain holder, a score counter. Because it is advanced by a scheduler system on the **game clock**, tweens **pause exactly when the loop pauses** (e.g. during a portal ad break) with zero coupling to `platform` or `loop`.

## Why imperative tweens over plain objects (not an ECS component)

Issue #5 §6 asks for tweening "used by `vfx`, `ui`, and camera" — and those three do **not** share one storage model (`vfx` particles are ECS entities, `ui` widgets are retained Pixi objects, a `camera` is a renderer-level holder). An ECS `Tween` component could only reach the ECS consumers and would force an `ecs` dependency this plugin does not otherwise need. The cross-consumer form is therefore an **imperative tween over any plain mutable object**: `to(target, { y: 500 }, …)` mutates `target.y` each frame. This mirrors the GSAP / tween.js object-property model arcade games already expect. A consumer who genuinely wants to tween an ECS component value reads it, tweens a scratch object, and writes it back inside `onUpdate` — a one-line escape hatch.

## Pause-safe by construction

The advance loop is registered via `scheduler.addSystem(config.updateStage, …)` and runs inside `scheduler.tick(dt)`, consuming the **same `dt`** as every other system. So tweens obey the game clock: when the loop pauses (no `scheduler.tick`), every tween freezes; when it resumes, they continue. There is no private `requestAnimationFrame`/`setInterval` that would keep running through a pause. (A future `unscaled` option for menu animations that should keep moving while gameplay is paused is a documented deferred enhancement — see Follow-ups.)

```ts
// Smooth camera pan (any plain { x, y } holder):
app.tween.to(camera, { x: 640, y: 360 }, { duration: 0.6, easing: "easeOutCubic" });

// Slide a UI card in from off-screen, then fire a callback:
app.tween.from(card, { y: -200 }, { duration: 0.4, easing: "easeOutBack", onComplete: enableInput });

// Ramp master volume during a fade-out (no target object — drive a scalar):
await app.tween.value(1, 0, { duration: 0.5, onUpdate: v => app.audio.setVolume("master", v) }).done;

// Count a score up, ping-ponging a wobble twice:
app.tween.to(hud, { score: 1000 }, { duration: 1, repeat: 1, yoyo: true, easing: "linear" });
```

## API

Accessed as `app.tween.*` after `createApp()`. Every creator is a guarded no-op **before `app.start()`** and **over the `maxActive` cap** — it warns via `ctx.log` and returns a **dead handle** (inert methods, `active: false`, an already-resolved `done`) rather than throwing on the hot path.

### `to(target, props, opts?): TweenHandle`

Tween the numeric props of `target` **to** the given values. Each property's **start value is captured at creation time** (a `delay` does not defer capture). A non-finite start or end value skips that one property (debug-logged).

### `from(target, props, opts?): TweenHandle`

Tween the numeric props **from** the given values to their current values. The "from" values are written to `target` **immediately** at creation, then the tween animates back to the captured originals.

### `value(from, to, opts): TweenHandle`

Tween a bare scalar `from → to`, driving `opts.onUpdate(value)` each frame. `onUpdate` is **required** (there is no target object to mutate).

### `killAll()`

Stop and drop **every** active tween (scene teardown). `onComplete` does **not** fire; each `done` settles.

### `count(): number`

The number of currently-active tweens (diagnostics / tests).

### `easing` / `lerp(a, b, t)`

The frozen easing-curve table (`app.tween.easing`) and linear interpolation (`app.tween.lerp`) — the canonical source shared across the framework's juice.

### `TweenHandle`

| Member | Description |
|---|---|
| `stop()` | Cancel now; does **not** fire `onComplete`; settles `done`. Idempotent. |
| `pause()` / `resume()` | Freeze / unfreeze advancement (dt no longer consumed). Idempotent. |
| `active` | `true` while the tween is still registered. |
| `done` | A Promise that resolves when the tween settles — **completes OR is stopped**. Never rejects, never hangs. |

### Tween options

| Field | Type | Default | Description |
|---|---|---|---|
| `duration` | `number` | `config.defaultDuration` | Duration of one iteration, in seconds. |
| `easing` | `EasingName \| (t) => number` | `config.defaultEasing` | Named built-in curve or a custom easing function. |
| `delay` | `number` | `0` | Seconds to wait before interpolation begins (start values are still captured at creation). |
| `repeat` | `number` | `0` | Extra iterations after the first (`Infinity` allowed). |
| `yoyo` | `boolean` | `false` | Reverse the curve on alternate iterations (ping-pong). |
| `onUpdate` | `(progress) => void` | — | Called each frame after the target/value updates (eased progress 0..1; the interpolated value for `value`). |
| `onComplete` | `() => void` | — | Called once on natural completion (never on `stop`/`killAll`). |

## Configuration

Per-plugin config under `pluginConfigs.tween`.

| Field | Type | Default | Description |
|---|---|---|---|
| `defaultDuration` | `number` | `0.3` | Duration (s) used when a tween omits `duration`. |
| `defaultEasing` | `EasingName` | `"easeOutCubic"` | Easing used when a tween omits `easing`. |
| `updateStage` | `Stage` | `"update"` | Scheduler stage the advance system runs in (validated by `scheduler.addSystem`). |
| `maxActive` | `number` | `2048` | Cap on concurrent active tweens; over-cap creators warn + return a dead handle. |

## Easing curves

`app.tween.easing` is a frozen table of pure `f(t): [0,1] → [0,1]` curves: `linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeOutCubic`, `easeOutBack` (springy overshoot), `easeOutElastic` (wobble). Any curve beyond these is available immediately by passing a custom `(t) => number` as `easing`. `camera` reuses this table via `app.tween.lerp`. This is the **same 7-curve set** `vfx` ships — de-duplicating vfx onto this table is deferred (see Follow-ups).

## Events

**None.** Tweening is callback-driven (`onUpdate` / `onComplete` / the `done` Promise) per-frame hot-path work with no discrete milestone worth a kernel event — the same stance as `ecs`, `renderer`, `scheduler`, `loop`, and `vfx`.

## Lifecycle

`onStart` is justified as **deps-ready wiring** (annotated `@no-resource-check`): after `scheduler` has started, it registers the single advance system (`scheduler.addSystem(config.updateStage, …)`) and flips `started` so the API creators leave their before-start no-op guard.

There is **no `onStop`**: tweens are plain GC-able data in `state.tweens`, and the scheduler system holds no external resource (no socket, timer, listener, or Pixi view). When the app stops, the world/scheduler and the state are discarded together (the `vfx` precedent).

## Headless-safe

The plugin touches no DOM, canvas, or Pixi API — it is pure math over plain objects driven by `dt`. It runs identically headless.

## Dependencies

- **`scheduler`** — `addSystem(config.updateStage, advanceSystem)` (a **real** dependency edge, wired in `onStart`); `dt` arrives via the `(world, dt)` system signature.
- **Not `ecs` / not `renderer` / not `loop`** — the plugin operates on plain objects (no SoA storage), builds no views, and never calls the loop (the loop already drives `scheduler.tick`, which is exactly why a paused loop freezes tweens for free).
- **Core `ctx.log`** (Layer 1) — before-start / over-cap / non-finite-property diagnostics. No raw `console.*`; no `process.env`.
- **No package dependency** — pure math plus the scheduler.

## Follow-ups (non-blocking)

- **Dedupe `vfx` → `tween`** *(deferred — issue #6)* — `vfx` still ships its own identical `easing.ts`. The correct de-dup is NOT a bare `export … from "../tween/easing"` (a cross-plugin internal import that violates plugin encapsulation, spec/15 §8) but a `depends: [tweenPlugin]` + `ctx.require(tweenPlugin)` edge sourcing `easing`/`lerp` from the tween API — exactly how `camera` reuses this table. Deferred as a ~12-file refactor vs. a minor cleanup; the identical 7-curve set makes it behavior-preserving whenever it lands.
- **Unscaled / real-time tweens** — an `unscaled?: boolean` option backed by a real-time (rAF/`performance.now`) source so menu/overlay animations run while the game loop is paused. Requires a second, resource-owning update path (hence an `onStop`) — deferred until a concrete need.
- **Richer easing table** — the in/out variants (cubic/quart/sine/expo/bounce) if consumers ask; a custom `(t) => number` covers any gap today.
- **`camera` plugin** — the other issue #5 §6 optional sibling; a follow/shake/parallax camera would consume `app.tween` for smooth pans.
