# hierarchy

> Complex plugin — the scene-graph Node component ({ parent, order, name, enabled }) + a sync-stage world-transform system (worldOf composes local Transform up the parent chain, root-healing unresolvable parents at read time). Self-registers the Node reflection schema; injects the renderer world-transform resolver. Hierarchy is an ordinary component, so serialization is unchanged and reparent is a setField burst.

## Design

`hierarchy` owns exactly one component — `Node` — and one system. Parentage rides as an ordinary
field (`Node.parent: EditorId | undefined`), never as a structural graph the world or
`serialization` must understand. This means:

- `SceneDocument` stays FLAT (`{ version; name; entities: { id; components }[] }`) — `Node`
  serializes exactly like `Transform` or any other component.
- Reparent / reorder / delete-subtree / duplicate are **bursts of existing `Command` primitives**
  (`beginGesture` → `setField Transform` (preserve-world local) + `setField Node.parent` +
  `setField Node.order` → `endGesture`), composed by `editor-bridge` — **not** a new `Command`
  kind. Undo falls out for free because each `setField`'s inverse captures its own old value.

`worldOf(entity)` is a **pull** resolver: it composes the entity's local `renderer.Transform` up
the `Node.parent` chain on every read, resolving each parent via `commands.resolve`. An
unresolvable parent (despawned / recycled EditorId) makes the entity a **root at that link** —
root-healing at READ time, so a dangling parent never throws or corrupts the chain. Recursion is
depth-capped at `config.maxDepth` (defensive against a pathological/cyclic chain).

The `sync`-stage system this plugin registers does narrower work than positioning: the renderer's
OWN `sync` system positions views in world space by pulling through the injected
`WorldTransformResolver` (`renderer.setWorldTransformResolver(e => worldOf(e))`). Hierarchy's
system instead recomputes the *affected set* and calls `renderer.markDirty` +
`renderer.setEntityVisible(entity, effectiveEnabled)` for each — where `effectiveEnabled` is
`Node.enabled` AND every ancestor's `enabled` (a disabled parent hides its whole subtree). In
**edit** mode (`world.activeStages()` returns a gated list) this recompute is gated on
`world.changeEpoch()` having advanced since the last tick — no write, no work. In **play** mode
(`activeStages() === undefined`) it recomputes unconditionally every tick (the Unity-DOTS-validated
choice — gameplay can move transforms without bumping structural epoch in a way the gate could
rely on).

At `onStart`, `hierarchy` **self-registers** the `Node` reflection schema —
`reflection.register("Node", buildNodeSchema(reflection.field))` — exactly like `graphics-2d`
self-registers `SpriteRenderer`/`Shape`. `Node.parent` is authored as `field.entityRef()` (the
`entity-ref` kind `reflection` originates), so `serialization`'s on-load `reflection.validate`
validates it like every other component field, in ANY app that includes `hierarchy` +
`serialization` — no `editor-bridge` composer involvement required.

## API

`app.hierarchy`:

- **`Node`** — the `Node` component token defined by `onStart`. Throws if read before
  `app.start()` (mirrors `renderer.Transform`).
- **`worldOf(entity)`** — the entity's WORLD transform (local `Transform` composed up the parent
  chain; root-heals an unresolvable parent).
- **`parentOf(entity)`** — the entity's parent `EditorId`, or `undefined` for a scene root.
- **`childrenOf(id)`** — the id's direct children as `EditorId[]`, ordered by `Node.order`.
- **`roots()`** — the top-level (`parent === undefined`) nodes as `EditorId[]`, ordered by
  `Node.order`.
- **`depth(entity)`** — the entity's depth (`0` for a root), capped at `maxDepth`.
- **`canReparent(childId, newParentId)`** — rejects a self-reparent, a cycle (`newParentId` inside
  `childId`'s subtree), or a move that would push the deepest carried descendant past `maxDepth`.
- **`computeLocalForPreserveWorld(childId, newParentId)`** — the local `Transform` `childId` must
  adopt under `newParentId` to keep its current WORLD transform unchanged.
- **`orderBetween(parentId, before, after)`** — a fractional `Node.order` sort-key between two
  siblings (either may be `undefined` for drop-at-start/end).

`hierarchy` performs **no** world mutation itself — every write still terminates at
`commands.apply`/`applyRaw` (the single write-authority); `hierarchy` only exposes the read + math
helpers `editor-bridge` composes into gesture bursts.

## Configuration

```ts
export type Config = {
  /** Maximum ancestor depth. Bounds worldOf recursion and canReparent's depth ceiling. @default 64 */
  maxDepth: number;
};
```

Defaults: `{ maxDepth: 64 }` — matches the renderer's own scene-graph walk cap.

## Dependencies

Four real edges:

- **`ecs`** — `defineComponent` (the Node token), `get`/`query` (read Node/Transform, enumerate
  nodes), `addSystem("sync", …)`, `changeEpoch()` / `activeStages()` (the recompute gate).
- **`renderer`** — `Transform` (the local token `worldOf` composes), `setWorldTransformResolver`,
  `markDirty` + `setEntityVisible` (the system's per-affected-entity outputs).
- **`commands`** — `resolve` (`EditorId` → live `Entity`, with the recycled-id root-heal guard)
  and `editorIdOf` (`Entity` → `EditorId`).
- **`reflection`** — `field` (the builders authoring the `Node` schema) + `register` (self-registered
  at `onStart`).

**Not** a dependency: `scheduler` — the system is registered directly via `world.addSystem` on the
`ecs` facade.

## Lifecycle

- **`onInit`** — not used (no config-time work; the Node token needs a live ECS world).
- **`onStart`** — defines the Node token, captures renderer/commands + the Transform token into a
  tight closure (no per-call `ctx.require` — this closure backs the resolver the renderer calls
  once per view every frame), self-registers the Node reflection schema, registers the sync-stage
  world-transform system, and injects the renderer's world-transform resolver.
- **`onStop`** — not used. `hierarchy` owns no external resource: the Node token and the sync
  system live on ecs/renderer-owned structures, discarded with the app on stop.

## Events

None. Reactivity is poll-on-epoch (`world.changeEpoch()`) plus the system's own
`markDirty`/`setEntityVisible` calls into the renderer — never a per-frame `emit`.
