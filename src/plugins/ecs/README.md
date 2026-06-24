# ecs

> Complex plugin — the data/runtime core: generational entities, archetype object-SoA component storage, typed variadic queries, a deferred command buffer, and `world.tick(dt)`.

The `ecs` plugin is the foundation of the framework — a Koota-inspired Entity-Component-System. It owns generational entity handles, archetype object-SoA component storage behind a per-component storage-strategy seam, typed variadic queries (per-arity overloads 1–8), a deferred command buffer (the only mutation path that is safe during iteration), and `world.tick(dt)`, which runs the ordered execution stages and flushes the command buffer between them.

It is **headless-capable**: it holds only in-memory data with no DOM, GPU, sockets, or timers. The frame loop is owned by the `loop` plugin (a kernel-bypassing hot path) via `loop → scheduler.tick(dt) → world.tick(dt)`. The plugin API surface **is** the `World` facade — `app.ecs` returns the single `World` instance directly; there is no wrapper layer.

## API

Accessed as `app.ecs.*` after `createApp()`. The API object is the `World` facade.

### Components

#### `defineComponent<T>(create, opts?): Component<T>`

Registers a component type with a default-value factory and returns its typed token. Storage defaults to `"archetype"` (cache-coherent). Call once at module scope.

```ts
const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));
const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }), { storage: "sparse" });
```

#### `defineTag(opts?): Tag`

Registers a zero-data, presence-only marker component. Storage defaults to `"sparse"` (well suited to high-churn tags).

```ts
const Dead = app.ecs.defineTag();
```

#### Calling a token — `Component<T>(value): ComponentInit`

Each token is itself callable: binding a value produces a `ComponentInit` spawn payload. Pass these — never the bare token — to `spawn`.

```ts
const init = Position({ x: 10, y: 5 }); // ComponentInit
```

### Entities

| Method | Signature | Description |
|---|---|---|
| `spawn` | `spawn(...parts: ComponentInit[]): Entity` | Create an entity from component initializers; returns its handle immediately. |
| `despawn` | `despawn(entity: Entity): void` | Destroy an entity and recycle its slot (generation bumped). No-op if already dead. |
| `isAlive` | `isAlive(entity: Entity): boolean` | True if the handle refers to a currently live entity. |

```ts
const e = app.ecs.spawn(Position({ x: 10, y: 5 }), Velocity({ dx: 1, dy: 0 }));
```

### Components on entities

| Method | Signature | Description |
|---|---|---|
| `add` | `add<T>(entity, component, value?: Partial<T>): void` | Add a component, merging `value` over the component default. No-op if the entity is dead. |
| `remove` | `remove(entity, component): void` | Remove a component (migrates the entity to a smaller archetype). |
| `has` | `has(entity, component): boolean` | True if the entity currently has the component (archetype or sparse). |
| `get` | `get<T>(entity, component): T \| undefined` | Read the component value; `undefined` if absent or the entity is dead. |
| `set` | `set<T>(entity, component, value: Partial<T>): void` | Shallow-merge a patch into an existing component value in place. |

```ts
app.ecs.add(e, Velocity, { dx: 5 });
app.ecs.set(e, Position, { x: 20 });
const pos = app.ecs.get(e, Position); // { x: 20, y: 5 } | undefined
```

### Queries

#### `query(...components): Query<Values>`

Builds a typed query over entities that have **all** the given components. Overloads cover arities 1–8, so the value tuple is precisely inferred (not `any`). A query visits every archetype that is a superset of the requested signature.

The returned `Query` exposes:

| Member | Signature | Description |
|---|---|---|
| `updateEach` | `updateEach(cb: (values, entity) => void): void` | Iterate matches; mutating a ref mutates storage. Structural ops inside are deferred. |
| `count` | `count(): number` | Number of currently matching live entities. |
| `first` | `first(): Entity \| undefined` | First matching live entity, or `undefined`. |
| `[Symbol.iterator]` | `(): Iterator<Entity>` | Iterate the matching entity handles (e.g. in `for...of`). |

```ts
app.ecs.query(Position, Velocity).updateEach(([p, v], entity) => {
  p.x += v.dx;
  p.y += v.dy;
});

for (const entity of app.ecs.query(Dead)) app.ecs.despawn(entity);
```

### Systems & ticking

| Method | Signature | Description |
|---|---|---|
| `addSystem` | `addSystem(stage, system): () => void` | Register a system for a `Stage`; returns an unsubscribe function. |
| `tick` | `tick(dt: number): void` | Advance one frame: run each stage's systems in fixed order, flushing the command buffer between stages. |

Stages run in fixed order: `"input" → "update" → "physics" → "sync" → "render"`. `dt` is the frame delta in seconds.

```ts
const remove = app.ecs.addSystem("update", (w, dt) => {
  w.query(Position, Velocity).updateEach(([p, v]) => {
    p.x += v.dx * dt;
    p.y += v.dy * dt;
  });
});

app.ecs.tick(1 / 60);
```

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `initialCapacity` | `number` | `1024` | Pre-allocated entity index slots. The slot table and component columns grow automatically; tuning this only avoids early reallocations. |
| `maxStructuralOpsWarn` | `number` | `0` | Warn (via `ctx.log`) past this many structural ops in one flush, to catch runaway spawn storms. `0` disables the warning. |

## Events

None. The ECS hot path deliberately emits **no** kernel events and registers **no** hooks — structural changes are not kernel events (per the hot-path / kernel-bypass principle). Coarse domain events such as `assets:loaded` and `scene:loaded` belong to the `assets` / `scene` plugins.

## Usage Example

```ts
import { createApp } from "../../index";

const app = createApp();
await app.start();

const Position = app.ecs.defineComponent(() => ({ x: 0, y: 0 }));
const Velocity = app.ecs.defineComponent(() => ({ dx: 0, dy: 0 }));

// Spawn an entity with both components.
const e = app.ecs.spawn(Position({ x: 0, y: 0 }), Velocity({ dx: 2, dy: 1 }));

// A movement system that runs every "update" stage.
app.ecs.addSystem("update", (w, dt) => {
  w.query(Position, Velocity).updateEach(([p, v]) => {
    p.x += v.dx * dt;
    p.y += v.dy * dt;
  });
});

// Advance one fixed frame (loop/scheduler normally drive this).
app.ecs.tick(1 / 60);

console.log(app.ecs.get(e, Position)); // { x: ~0.033, y: ~0.017 }
```

## Design Notes

- **Generational entities:** an `Entity` is a branded number packing a 16-bit index and 16-bit generation as `(generation << 16) | index`. `despawn` bumps the slot's generation, so stale handles are detectably dead via `isAlive` (use-after-free guard).
- **Index recycling:** freed slot indices go onto a `freeList` and are reused on the next allocation; slot arrays grow past `initialCapacity` automatically.
- **Archetype object-SoA storage:** entities sharing the same sorted component signature live in one archetype with parallel columns (one `entities` column plus one per component) for cache-friendly iteration. Despawn uses **swap-remove** to keep columns dense (O(1)); `add` / `remove` migrate the entity between archetypes.
- **Storage seam:** each component picks `"archetype"` (default, cache-coherent) or `"sparse"` (a per-component `Map<Entity, value>`) — ideal for high-churn tags/timers that would otherwise thrash archetypes. Queries return identical results across both strategies.
- **Deferred command buffer:** while `iterating` is true (inside `updateEach` or any system), `spawn` / `despawn` / `add` / `remove` are enqueued rather than applied mid-iteration. `spawn` still returns a usable `Entity` synchronously (its index/generation are reserved immediately; archetype insertion is deferred). The buffer is drained at each stage boundary inside `tick`. Outside iteration, ops apply immediately. This is the only structural-mutation path safe during iteration — and the path all `mcp` mutating tools use.
- **Eager world construction:** the single `World` is built in `createState` (not lazily), so `app.ecs` is available synchronously from plugin init. There are no `onStart` / `onStop` lifecycle hooks — there is no resource to open or tear down.

## Dependencies

None. `ecs` is plugin #1 and the foundation of the framework — it depends on no other plugin and uses only `ctx.config`, `ctx.state`, and `ctx.log`. Its only package dependency is `@moku-labs/core` (via the framework's `config.ts`).
