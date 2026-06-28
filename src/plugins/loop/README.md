# loop

> Standard plugin — the fixed-timestep `requestAnimationFrame` game loop that drives `scheduler.tick(dt)` then `renderer.render()` each frame, and publishes the `Time` ECS world resource (the canonical frame clock).

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

### `step(): TimeStepResult`

Advances exactly one fixed step and renders once — updates the `Time` resource (`dt = fixedDt`, `elapsed += fixedDt`, `frame += 1`) immediately before `scheduler.tick(fixedDt)`, then calls `renderer.render()`, with **no real-time accumulation**. Deterministic; intended for tests, frame-stepping tools, and the mcp `loop:step` command. Works whether the loop is running or stopped.

Returns a `TimeStepResult` — a snapshot `{ frame, elapsed, dt }` of the just-advanced clock, reflecting the values systems saw during that step. A no-runtime call (before `start()` / after `stop()`) returns `{ frame: 0, elapsed: 0, dt: 0 }`. **Cycle 5:** widening the return from `void` to an object is non-breaking — existing callers that ignore the return value are unaffected.

```ts
app.loop.stop();   // pause
app.loop.step();   // advance one deterministic frame
app.loop.step();   // ...and another
app.loop.start();  // resume real-time

// The return value is the just-advanced frame clock.
const { frame, elapsed, dt } = app.loop.step();
// After one step from zero: { frame: 1, elapsed: 0.016, dt: 0.016 }
```

### `time: Resource<TimeState>`

The well-known `Time` resource token (see [Time resource](#time-resource) below). Read-only property — pass it to `world.resource(...)` from any ECS system to read the current frame clock.

```ts
const clock = world.resource(app.loop.time); // → { dt, elapsed, frame }
```

## Time resource

The loop is the **sole writer of frame time**, so it publishes a first-class **`Time`** ECS world resource — the canonical frame clock. ECS systems have the signature `(world, dt)`; the `dt` argument is the fixed step, but a system that also needs the running total or the frame count reads them from `Time` via `world.resource(Time)` rather than threading extra arguments. Time lives in the loop (not in `context`) precisely because a single owner avoids two plugins mutating one clock object.

On `onStart` the loop calls `world.setResource(Time, { dt: 0, elapsed: 0, frame: 0 })` and caches that same object on its per-instance `LoopRuntime`. Each fixed step it mutates the cached object **in place** immediately before `scheduler.tick(fixedDt)` — so a system running that step already sees the updated clock. Because the world's resource registry holds the same reference, `world.resource(Time)` reflects every update with **no per-frame allocation** and no repeated `setResource` call.

The token is exported two ways — both refer to the same resource:

- `import { Time } from "./resources"` (or `"../loop/resources"` from another plugin) — the module-level token.
- `app.loop.time` — the same token surfaced on the loop's public API, for app/consumer code.

### `TimeState` fields

`world.resource(Time)` returns a `TimeState`. All fields are `readonly` to consumers — systems should never write the clock; the loop owns it.

| Field | Type | Description |
|---|---|---|
| `dt` | `number` | Fixed timestep of the current step, in **seconds**. Always equals `config.fixedDt` — every step advances by the same amount. |
| `elapsed` | `number` | Total simulated time since the loop started, in **seconds**. The sum of all fixed steps executed so far. |
| `frame` | `number` | Number of fixed steps simulated since the loop started — a count, not seconds (1-based during a step, incremented once per fixed-step tick). |

Per fixed step the loop applies, immediately before `scheduler.tick(fixedDt)`:

```ts
runtime.time.dt = config.fixedDt;       // current step length (seconds)
runtime.time.elapsed += config.fixedDt; // running total (seconds)
runtime.time.frame += 1;                // step counter
```

This happens both inside the fixed-step `while` loop of the rAF frame callback (`lifecycle.ts`) and inside `step()` (`api.ts`), so deterministic single-stepping advances `Time` exactly as a real frame would.

### `TimeStepResult` (Cycle 5)

`step()` returns a **`TimeStepResult`** — a snapshot of the just-advanced clock, equivalent to `Pick<TimeState, "frame" | "elapsed" | "dt">`:

```ts
export type TimeStepResult = Pick<TimeState, "frame" | "elapsed" | "dt">;
// { frame: number; elapsed: number; dt: number }
```

The snapshot is taken immediately after `step()` advances `Time` and calls `render()`, so it carries the same `frame` / `elapsed` / `dt` values systems observed during that step. A no-runtime call (before `start()` / after `stop()`) returns `{ frame: 0, elapsed: 0, dt: 0 }`. Widening the previous `void` return to this object is non-breaking — callers that ignore the value are unaffected.

### Reading `Time` from a system

```ts
import { Time } from "./resources";
import type { World } from "../ecs/types";

// Register an "update"-stage system that reads the frame clock.
app.scheduler.addSystem("update", (world: World, dt: number) => {
  const t = world.resource(Time); // → { dt, elapsed, frame }

  // `t.dt` === the `dt` argument === config.fixedDt (seconds).
  // Use the running total and the frame counter the param alone can't give you.
  if (t.frame % 60 === 0) {
    console.log(`elapsed: ${t.elapsed.toFixed(2)}s (frame ${t.frame})`);
  }
});
```

`app.loop.time` resolves to the same token, so consumer code outside a system reads the clock the same way:

```ts
const clock = world.resource(app.loop.time);
// → e.g. { dt: 0.016, elapsed: 1.23, frame: 74 }
```

## Lifecycle

The loop owns real resources (a pending rAF and a DOM listener), so it uses `onStart` / `onStop`:

- **`onStart`** — captures `scheduler.tick`, `renderer.render`, and the ECS `world` via `ctx.require`, **binds the `Time` resource** onto the world (`world.setResource(Time, { dt: 0, elapsed: 0, frame: 0 })`) and caches that object on the `LoopRuntime` for hot-path mutation, builds the fixed-timestep frame callback, registers the `visibilitychange` reset listener, and stores the `LoopRuntime` in the module `WeakMap` keyed on `ctx.global`. If `config.autoStart` is `true`, it schedules the first frame immediately; otherwise it waits for an explicit `app.loop.start()`.
- **`onStop`** — reads the runtime from the `WeakMap` via `ctx.global`, cancels the pending rAF, removes the `visibilitychange` listener, sets `running` to `false`, and deletes the `WeakMap` entry. Idempotent: a second call with the same `ctx.global` is a safe no-op. This prevents a **zombie rAF** from continuing to tick after stop. The `Time` resource needs no explicit teardown — its value is released together with the ECS world.

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
- **Single-writer frame clock:** the `Time` resource (`{ dt, elapsed, frame }`) is owned and mutated only by the loop. It is bound once via `world.setResource(Time, …)` and updated in place each fixed step — the same object reference the world's registry holds — so `world.resource(Time)` is allocation-free on the hot path and there is never a second writer to race with.

## Dependencies

- **`scheduler`** — required via `ctx.require(schedulerPlugin)`. The loop calls `tick(dt)` once per fixed step to advance the staged systems (`world.tick`).
- **`renderer`** — required via `ctx.require(rendererPlugin)`. The loop calls `render()` once per frame, after all fixed steps for that frame have run.
- **`ecs`** — required via `ctx.require(ecsPlugin)`. On start the loop calls `world.setResource(Time, …)` to publish the frame clock; thereafter it mutates the cached object in place each fixed step (no further `setResource` calls). This is the only new dependency in Cycle 2; there is no cycle, since `ecs` depends on nothing.

No package dependencies beyond `@moku-labs/core` (rAF / DOM types come from the TS lib).
