# loop

> Standard plugin — the fixed-timestep `requestAnimationFrame` game loop that drives `scheduler.tick(dt)` then `renderer.render()` each frame.

The `loop` plugin owns the frame. On start it begins a `requestAnimationFrame` loop built around a **fixed-timestep accumulator**: each frame it measures the real elapsed time, clamps it (spiral-of-death guard), and steps `scheduler.tick(fixedDt)` zero-or-more times — advancing the simulation in fixed increments — then calls `renderer.render()` exactly once.

This is the framework's **kernel-bypassing hot path**. Moku Core has no built-in per-frame tick, so the loop drives `scheduler.tick` → `world.tick` directly without round-tripping through the kernel's event bus. The rAF id and DOM listener live in a module-level `WeakMap` keyed on the frozen per-instance `ctx.global`, so the loop can be torn down cleanly from `onStop` (whose `TeardownContext` exposes only `{ global }`).

Pausing is just stopping: `app.loop.stop()` cancels the pending frame and `app.loop.start()` resumes it. For determinism, `app.loop.step()` runs exactly one fixed tick + render with no real-time accumulation — this is what the mcp `loop:step` tool drives.

## Fixed-timestep model

Each rAF frame the driver:

1. Computes the real delta in seconds from successive rAF timestamps (the first frame only seeds `lastTime` and skips ticking).
2. Clamps the delta to `maxFrameDelta` — caps catch-up after a tab-hide or breakpoint so the simulation never tries to replay seconds of time in one frame (spiral-of-death guard).
3. Adds the clamped delta to `accumulator`, then runs `scheduler.tick(fixedDt)` while `accumulator >= fixedDt`, up to `maxStepsPerFrame` times. Each step subtracts `fixedDt`; leftover time is carried to the next frame.
4. Calls `renderer.render()` once.
5. Re-schedules itself via `requestAnimationFrame` (unless `stop()` cleared `running` in the meantime).

A `visibilitychange` listener resets `accumulator` and `lastTime` when the tab returns to the foreground, so a backgrounded tab does not produce a huge catch-up burst on return.

## API

Accessed as `app.loop.*` after `createApp()`:

### `start(): void`

Begins the rAF loop. No-op if already running. Resets `accumulator` and `lastTime` so a fresh `stop` → `start` cycle does not carry stale time into the first frame. Also serves as **resume** (the mcp `loop:resume` tool calls this).

```ts
app.loop.start();
```

### `stop(): void`

Cancels the pending frame via `cancelAnimationFrame` and sets `running` to `false`. No-op if not running. Also serves as **pause** (the mcp `loop:pause` tool calls this).

```ts
app.loop.stop();
```

### `isRunning(): boolean`

Returns `true` while the loop is running, `false` otherwise.

```ts
if (app.loop.isRunning()) app.loop.stop();
```

### `step(): void`

Advances exactly one fixed step and renders once — calls `scheduler.tick(fixedDt)` then `renderer.render()` with **no real-time accumulation**. Deterministic; intended for tests, frame-stepping tools, and the mcp `loop:step` command. Works whether the loop is running or stopped.

```ts
app.loop.stop();   // pause
app.loop.step();   // advance one deterministic frame
app.loop.step();   // ...and another
app.loop.start();  // resume real-time
```

## Lifecycle

The loop owns real resources (a pending rAF and a DOM listener), so it uses `onStart` / `onStop`:

- **`onStart`** — captures `scheduler.tick` and `renderer.render` via `ctx.require`, builds the fixed-timestep frame callback, registers the `visibilitychange` reset listener, and stores a `LoopRuntime` in the module `WeakMap` keyed on `ctx.global`. If `config.autoStart` is `true`, it schedules the first frame immediately; otherwise it waits for an explicit `app.loop.start()`.
- **`onStop`** — reads the runtime from the `WeakMap` via `ctx.global`, cancels the pending rAF, removes the `visibilitychange` listener, sets `running` to `false`, and deletes the `WeakMap` entry. Idempotent: a second call with the same `ctx.global` is a safe no-op. This prevents a **zombie rAF** from continuing to tick after stop.

Both hooks are annotated `@no-resource-check` in `index.ts` — the rAF/listener pair is the managed resource, tracked through the WeakMap rather than the kernel's resource ledger.

## Configuration

Per-plugin config under `pluginConfigs.loop`:

| Field | Type | Default | Description |
|---|---|---|---|
| `fixedDt` | `number` | `1 / 60` | Fixed simulation step in seconds. Each `scheduler.tick` receives this value. |
| `maxFrameDelta` | `number` | `0.25` | Max real delta (seconds) consumed per frame before clamping. Spiral-of-death guard for tab-return / breakpoint spikes. |
| `maxStepsPerFrame` | `number` | `5` | Hard cap on fixed steps simulated per frame, even after delta clamping. |
| `autoStart` | `boolean` | `true` | Whether to schedule the first frame in `onStart`. When `false`, the consumer calls `app.loop.start()`. |

## Events

None. The per-frame hot path is intentionally **not** emitted as kernel events — emitting an event every frame (and per fixed step) would defeat the purpose of bypassing the kernel for performance. The loop drives `scheduler` and `renderer` directly.

## Usage Example

```ts
import { createApp } from "./index";

const app = createApp({
  pluginConfigs: {
    loop: {
      fixedDt: 1 / 60,      // 60 Hz simulation
      maxFrameDelta: 0.25,  // clamp catch-up at 250 ms
      maxStepsPerFrame: 5,  // at most 5 fixed steps per frame
      autoStart: false      // start manually below
    }
  }
});

await app.start();

// Drive the loop by hand.
app.loop.start();
console.log("running:", app.loop.isRunning()); // → true

// Pause, single-step for debugging, then resume.
app.loop.stop();
app.loop.step();   // one deterministic tick + render
app.loop.step();
app.loop.start();
```

## Design Notes

- **Fixed-timestep accumulator:** real time is accumulated and consumed in fixed `fixedDt` slices, so simulation behaviour is independent of frame rate. Leftover sub-step time carries to the next frame.
- **Spiral-of-death clamp:** the per-frame delta is clamped to `maxFrameDelta` and the step loop is hard-capped at `maxStepsPerFrame`, so a slow frame or a returning background tab can never trigger an unbounded catch-up.
- **Deterministic single-step:** `step()` calls `scheduler.tick(fixedDt)` + `renderer.render()` directly, ignoring real time entirely — reproducible frames for tests and the mcp `loop:step` tool.
- **Kernel-bypass hot loop:** the frame callback invokes bound `tickFunction` / `renderFunction` references captured at start, with no event-bus dispatch on the per-frame path.
- **WeakMap per-instance state:** the `rafId`, `visibilitychange` handler, and bound tick/render functions live in `loopRegistry` (a module-level `WeakMap<object, LoopRuntime>`) keyed on the frozen `ctx.global`. This gives `onStop` and `api.ts` a stable, per-instance key without a shared mutable that would break multiple app instances — and lets `start`/`stop`/`step` reach the runtime even though they only receive a partial context.
- **Graceful headless degradation:** `requestAnimationFrame`, `cancelAnimationFrame`, and `document` are read structurally off `globalThis` as optional. In a non-browser runtime they are simply absent, so scheduling is a no-op while `step()` still works for deterministic ticking.
- **First-frame seeding:** the first rAF callback only records `lastTime` and re-schedules; ticking begins on the second frame, avoiding a bogus large delta from the initial timestamp.

## Dependencies

- **`scheduler`** — required via `ctx.require(schedulerPlugin)`. The loop calls `tick(dt)` once per fixed step to advance the staged systems (`world.tick`).
- **`renderer`** — required via `ctx.require(rendererPlugin)`. The loop calls `render()` once per frame, after all fixed steps for that frame have run.

No package dependencies beyond `@moku-labs/core` (rAF / DOM types come from the TS lib).
