# scheduler

> Standard plugin — a thin, typed facade over the ECS world's stage/system registry and per-frame tick.

The `scheduler` plugin owns the framework's explicitly-ordered **stage contract**. It exposes the public scheduling surface — `addSystem(stage, fn)`, `tick(dt)`, and the read-only ordered `stages` tuple — and forwards every call to the `ecs` world's `world.addSystem` / `world.tick`.

Keeping scheduling as a separate plugin (rather than folding it into `ecs`) follows the framework's split-first guidance: `ecs` stays focused on data, storage, and queries, while `scheduler` owns the ordered stage contract that `loop`, `renderer`, and `input` register their systems into. The plugin is headless-capable, stores no state of its own, and emits no events.

Systems registered into a stage run in canonical order on every `tick(dt)`. The `loop` plugin drives `tick` once per fixed step; `world.tick` runs all stages in order and flushes the ECS command buffer between them, so structural operations queued during one stage are applied before the next stage begins.

## API

Accessed as `app.scheduler.*` after `createApp()`:

### `stages: readonly Stage[]`

The fixed, ordered execution stages as a readonly tuple — `["input", "update", "physics", "sync", "render"]`. The `Stage` type is owned by `ecs`; the scheduler re-exports it for consumer convenience and validates stage names against this tuple.

```ts
app.scheduler.stages; // readonly ["input", "update", "physics", "sync", "render"]
```

### `addSystem(stage: Stage, system: System): () => void`

Registers a `system` to run during `stage` on every tick, and returns an unsubscribe function that deregisters it. Forwards to `world.addSystem`.

When `stage` is **not** one of the canonical stages, behavior depends on the `strictStages` config:

- `strictStages: true` (default) — throws an `Error` listing the valid stages.
- `strictStages: false` — logs a warning via `ctx.log.warn`, registers nothing, and returns a no-op unsubscribe.

A `System` is typed `(world: World, dt: number) => void`.

```ts
const remove = app.scheduler.addSystem("update", (world, dt) => {
  world.query(Velocity).updateEach(([v]) => {
    v.x += dt;
  });
});

remove(); // deregisters the system from the "update" stage
```

### `tick(dt: number): void`

Advances the simulation by one frame. Forwards to `world.tick(dt)`, which runs every registered system in canonical stage order and flushes the ECS command buffer between stages. `dt` is delta-time in seconds. Normally called by the `loop` plugin once per fixed step.

```ts
app.scheduler.tick(1 / 60); // advance one frame at 60 fps
```

## Stages

The canonical `Stage` order is defined in `ecs` (`../ecs/types`) and mirrored by the scheduler's internal `STAGES` tuple, which is also the source of validation in `addSystem`:

| Order | Stage | Typical use |
|---|---|---|
| 1 | `input` | Apply queued input and externally-enqueued mutations (e.g. the `mcp` plugin drains its pending mutations here). |
| 2 | `update` | Game logic / gameplay systems. |
| 3 | `physics` | Movement and physics integration. |
| 4 | `sync` | Reconcile simulation state into render-facing data. |
| 5 | `render` | Renderer-facing systems. |

The command buffer is flushed between stages, so structural operations queued in one stage are visible to the next.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `strictStages` | `boolean` | `true` | When `true`, `addSystem` with an unknown stage throws. When `false`, it logs a warning via `ctx.log` and ignores the system (returns a no-op unsubscribe). |

## Events

None. The scheduler emits and listens to no kernel events — per-frame work is intentionally kept off the event bus and on the hot path.

## Usage Example

```ts
import { createApp } from "./index";

const app = createApp({
  pluginConfigs: {
    scheduler: { strictStages: true }
  }
});

await app.start();

// Define components on the ecs world.
const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));
const Velocity = app.ecs.defineComponent(() => ({ dx: 1, dy: 0 }));
app.ecs.spawn(Position({ x: 0, y: 0 }), Velocity({ dx: 1, dy: 0 }));

// Register a movement system into the "physics" stage.
const stop = app.scheduler.addSystem("physics", (world, dt) => {
  world.query(Position, Velocity).updateEach(([p, v]) => {
    p.x += v.dx * dt;
    p.y += v.dy * dt;
  });
});

// Drive one frame (the loop plugin does this each rAF step).
app.scheduler.tick(1 / 60);

console.log(app.scheduler.stages); // ["input", "update", "physics", "sync", "render"]

stop(); // remove the movement system
```

## Design Notes

- **Pure facade, no state:** `createState` returns an empty record (`Record<never, never>`). The system registry lives entirely in the `ecs` world; the scheduler only forwards to it.
- **Single source of stage order:** the `STAGES` tuple in `api.ts` (`["input", "update", "physics", "sync", "render"]`) is both the value exposed as `stages` and the allow-list used by the internal `isKnownStage` predicate.
- **Structural context pattern:** `createApi` accepts a minimal structural `SchedulerContext` (only `config`, `state`, `log`, and `require`) rather than the full kernel context, so unit tests can supply a lightweight mock without wiring the whole framework.
- **Lazy world resolution:** the ecs world is fetched lazily inside `addSystem` / `tick` via `ctx.require(ecsPlugin)`, so the dependency resolves after init rather than at API-construction time.
- **Strict vs. lenient stages:** unknown stages fail fast by default; flipping `strictStages` to `false` downgrades the failure to a logged warning and a no-op, useful for tolerant/headless setups.
- **No lifecycle hooks:** the scheduler owns no runtime resource — no `onInit`, `onStart`, or `onStop`. The frame is driven externally by the `loop` plugin.

## Dependencies

- **`ecs`** — declared via `depends: [ecsPlugin]` and resolved with `ctx.require(ecsPlugin)`. The scheduler forwards to `world.addSystem` and `world.tick`, and reuses the `Stage`, `System`, and `World` types from `../ecs/types`. No package dependencies beyond `@moku-labs/core`.
