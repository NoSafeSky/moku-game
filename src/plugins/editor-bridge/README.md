# editor-bridge

> Complex plugin — the **typed facade** for the editor and the **single Layer-3 integration seam**. It answers **one read** (`snapshot(): EditorSnapshot` — an immutable, poll-on-epoch, **hierarchical** view) and **forwards / orchestrates** every write to the single write-authority. The scene tree is served as a FLAT entity array carrying `Node`-derived `name`/`enabled`/`parent`/`children` plus a `roots` seed set; twelve authoring verbs (create/reparent/delete/duplicate/…) compose the existing `commands` primitives — compound ops as gesture-bracketed bursts, ONE undo entry each, no new `Command` kind. It owns no primitive, emits no event, holds no external resource — a pure aggregation + forwarding + compound-op orchestration layer, shaped to mirror the future `editor:<verb>` MCP tool surface.

```ts
const gameApp = createApp({ /* … editorBridgePlugin + its eleven deps … */ });
await gameApp.start();

const bridge = gameApp["editor-bridge"];

const enemies = bridge.create({ name: "Enemies" });          // spawn Transform+Node → 1 undo entry, returns EditorId
const grunt = bridge.createShape("rect", { name: "Grunt" }); // spawn Transform+Node+Shape → 1 undo entry

bridge.reparent(grunt, enemies);              // gesture burst: local Transform + Node.parent + Node.order → 1 undo entry
bridge.addComponent(grunt, "SpriteRenderer"); // applyTracked addComponent (registry defaults) → 1 undo entry

const s = bridge.snapshot();                  // { epoch, entities (FLAT), roots, selection, mode, canUndo, canRedo }
s.entities.find(e => e.id === grunt)?.parent;   // === enemies
s.entities.find(e => e.id === enemies)?.children; // [grunt]

bridge.undo(); // removes SpriteRenderer
bridge.undo(); // un-reparents grunt (old parent + old local transform + old order restored — zero drift)
```

## Design

### The `Api` is the single Layer-3 integration seam

The editor is **two `createApp` instances**: a **game runtime** app that owns the PixiJS canvas and the whole ECS/editor plugin graph, and a **web shell** app (Layer-3 `@moku-labs/web`, Preact) that renders the hierarchy / inspector / viewport / toolbar panels around that canvas. They integrate through **exactly one runtime object** — `gameApp["editor-bridge"]`, the `Api` this plugin exposes. The web shell is coded against the **`Api` type** (imported from `types.ts`) and the live object it receives; it never imports `createCore`/`createCoreConfig`, never re-instantiates the kernel, never reaches past the facade into `ecs`/`commands`/`hierarchy`/etc (the moku two-app idiom I1/I2). Every capability a panel needs is a method **on this `Api`** — new panels extend the facade, never the boundary.

**VIEW/interaction state stays OFF the bridge.** Gizmo mode/space/pivot, camera pan/zoom/focus, grid/snap toggles, and raw pointer selection remain **direct-handle** calls (`editor-gizmos` / `camera` / `editor-selection` / `renderer`) from the viewport/toolbar islands — they are not undoable world mutations, so routing them through the undo funnel would be wrong. The bridge grows **only** world-authoring verbs + the hierarchical snapshot + `listComponents`.

### Reactivity is poll-on-epoch

`snapshot()` returns a **frozen** `EditorSnapshot` carrying `epoch` mirrored from `world.changeEpoch()` (a monotone per-write counter). Preact panels call `snapshot()` on **their own** rAF/interval tick and re-materialize the heavy tree **only when `epoch` differs** from the last one they saw — there is **no per-frame `emit`** (spec/01 §2 kernel-bypass preserved). The **structural tree is epoch-memoized**: `state.lastEpoch` + the deeply-frozen `state.entities` **and** `state.roots` are reused verbatim while `changeEpoch` is unchanged, so repeated `snapshot()` calls between writes return the **same** `entities`/`roots` references — a Preact `useMemo`/`===` gate then skips the virtualized-tree rebuild for free. `roots` joins the memoized block because it is structural (it changes only on a create/delete/reparent, all of which bump `changeEpoch`). The **cheap scalars are read fresh every call** — `selection`, `mode`, `canUndo`, `canRedo` are **not** epoch-gated (a selection change or mode flip does not write the ECS). The snapshot and every array/object in it are `Object.freeze`d; `state.lastEpoch` is seeded `-1` (caches `undefined`) so the first call always materializes. The two coarse editor events (`editor-selection:changed`, `editor-runtime:modeChanged`) drive **when** the web shell re-polls the scalars — the bridge itself declares no hooks and stays a pure pull-facade.

### The snapshot is hierarchical but FLAT-carried; `Node` is entity-level

`buildEntities` (`snapshot.ts`, pure over facets) walks the live world into a deeply-frozen, id-stable, **flat** array. For each editor-owned entity it reads the typed `Node` (`world.get(entity, hierarchy.Node)`, no `as`), lifts `name`/`enabled`/`parent` to the **entity level**, derives ordered `children` from `hierarchy.childrenOf`, and **filters the `Node`-named component OUT** of `components` — so a panel never edits `Node` as a raw component (`name`/`enabled` are driven by `rename`/`setEnabled`, the tree's inline rename / eye toggle). `EditorSnapshot` adds `roots` (from `hierarchy.roots`). This is exactly the shape `@headless-tree/core` consumes — a flat node map keyed by id, each node exposing its parent + ordered child ids; the hierarchy island re-derives nesting itself. A legacy v1 entity with no `Node` self-heals at read time to `name: ""`, `enabled: true`, root. **`Node` still rides serialization as an ordinary component** — it is filtered only at the snapshot boundary, never in storage.

### Every write forwards to the single write-authority

User mutations never touch `world` directly. Simple edits (`apply`/`setField`/`rename`/`setEnabled`/`reorder`/`addComponent`/`removeComponent`/`create*`) funnel through **`editor-history.applyTracked` → `commands.applyRaw`** as one tracked step. The three **compound ops** (`reparent`/`delete`/`duplicate`, in `authoring.ts`) compose as **gesture-bracketed BURSTS** of the same `spawn`/`despawn`/`setField` primitives — wrapped in `editor-history.beginGesture()`/`endGesture()` so the whole burst collapses to **ONE `HistoryEntry`**. Selection routes through `editor-selection`, mode through `editor-runtime`, persistence through `serialization`.

Three invariants hold this together:

- **`SceneDocument` stays FLAT.** `Node` is an ordinary component (`{ parent, order, name, enabled }`); serialization is unchanged and there is no structural `parent` field to keep in sync.
- **The `Command` union stays closed at 5 kinds** — `spawn` / `despawn` / `setField` / `addComponent` / `removeComponent`. No compound op introduces a new kind.
- **Compound ops are drift-free via LIFO inverse replay.** Each burst member is a shipped primitive whose `CommandResult` carries its own inverse; undo replays those inverses in reverse (LIFO) inside the collapsed gesture, so a reparent restores the old parent + old local transform + old order, a delete respawns the subtree self-healing every `Node.parent` ref, and a duplicate despawns its clones — with **zero drift** and no bespoke inverse to maintain.

`reparent` is validated by `hierarchy.canReparent` **before** any gesture (returns `{ ok: false, error }` with no world write on a cycle / depth-cap violation). `create*`/`reparent`/`addComponent`/`removeComponent`/`apply`/`setField` return the `CommandResult` so a panel can surface a validation failure (toast). `load(name)` routes through `serialization.load` → `commands.restore` (non-undoable reseed), which bumps `changeEpoch` and — via `commands:restored` — clears history; the next `snapshot()` reflects the loaded world with `canUndo === false`.

### The `mcp` edge is forward-declared

The twelve authoring verbs are named to map **1:1** onto future `editor:<verb>` MCP tools (`editor:create`, `editor:reparent`, `editor:addComponent`, …). At `onStart` the bridge captures `mcp` and probes it (`isRunning`/`clientTransport`) to log editor↔MCP readiness. The substantive mirror — an `editor://schema` **resource** (serves `reflection.describe` per component) and per-verb **tools** routing through the same `applyTracked` funnel (so an agent's edits are undo-tracked and id-stable exactly like the inspector's) — is **Follow-up F1**, not this cycle. Declaring the edge now keeps the bridge's registration position (after `mcp`) correct so F1 is a pure additive delta.

## API

Accessed as `gameApp["editor-bridge"].*` after `createApp()`. Every authoring verb below maps 1:1 onto a future `editor:<verb>` MCP tool (F1).

**Read (poll-on-epoch)**

- **`snapshot()`** — the immutable, hierarchical `EditorSnapshot` (structural tree memoized by `epoch`; scalars read fresh). See the shape below.

**Authoring verbs (the twelve)** — each is one atomic undo step; the three compounds are gesture-bracketed bursts.

- **`create(opts?)`** — create an empty object (`Transform` + `Node`). One `spawn`. Returns the minted `EditorId`.
- **`createShape(kind, opts?)`** — create an object with a `Shape` (`kind: "rect" | "circle"`, defaults from `component-registry`, overlaid by `opts.shape`). One `spawn`. Returns the minted `EditorId`.
- **`createSprite(alias, opts?)`** — create an object with a `SpriteRenderer` bound to `alias`. One `spawn`. Returns the minted `EditorId`.
- **`delete(...ids)`** — delete the given objects and **ALL** descendants (cascade). ONE undo entry — a burst of `despawn`s, deepest-first; undo respawns the subtree, self-healing every `Node.parent`.
- **`duplicate(...ids)`** — subtree-aware clone (a burst of `spawn`s, parents-first, remapping each clone's `Node.parent`). ONE undo entry; **selects** the clones. Returns the top-level clone ids.
- **`reparent(id, newParent, opts?)`** — re-parent `id` under `newParent` (`undefined` = root). Validated via `hierarchy.canReparent` before any write; gesture burst of `setField`s: (`mode: "preserve-world"`, the default) the local `Transform` + `Node.parent` + `Node.order`; `"keep-local"` skips the `Transform` writes. `opts.before`/`opts.after` place it between siblings. Returns the `CommandResult` (or `{ ok: false, error }` on an illegal move — no world write).
- **`reorder(id, before, after)`** — move `id` between two siblings (`Node.order` via `hierarchy.orderBetween`); undo-tracked.
- **`rename(id, name)`** — rename `id` (`setField Node.name`); undo-tracked.
- **`setEnabled(id, enabled)`** — toggle `id`'s active flag (`setField Node.enabled`); undo-tracked.
- **`addComponent(id, component)`** — add a named component with `component-registry` defaults; undo-tracked. Returns the `CommandResult`.
- **`removeComponent(id, component)`** — remove a named component; undo-tracked. Returns the `CommandResult`.
- **`listComponents()`** — the addable-component catalog (`component-registry.list()`) enriched with each entry's `reflection.describe` field schema — the Add-Component picker's source. Fresh every call (static + cheap; not epoch-gated).

**Generic write funnel (preserved)**

- **`apply(command)`** — apply a `Command` through the undo-tracked funnel; returns the `CommandResult`.
- **`setField(id, component, field, value)`** — edit one component field — sugar for `apply({ kind: "setField", … })`; undo-tracked; returns the `CommandResult`.

**Selection / history / transport / persistence / schema (preserved)**

- **`select(...ids)`** — set the selection to the given editor ids (resolved via `commands.resolve`; unresolvable ids are skipped with a warning).
- **`clearSelection()`** — clear the selection.
- **`undo()` / `redo()`** — undo/redo the last tracked edit (`editor-history`).
- **`play()` / `stop()` / `step()`** — enter play mode / exit to the pre-play snapshot / advance one frame while paused (`editor-runtime`).
- **`save(name)`** — persist the current scene (`serialization`, storage-backed); returns the success flag.
- **`load(name)`** — load a persisted scene (`serialization.load` → `commands.restore`; clears history). Returns `false` if absent (no world change).
- **`describe(componentName)`** — the field descriptors for a component name (`reflection.describe`) — for a panel needing a schema before any instance is live.

## `EditorSnapshot`

```ts
type EditorSnapshot = {
  readonly epoch: number;                        // world.changeEpoch() — the re-render gate
  readonly entities: readonly EntitySnapshot[];  // FLAT; memoized by epoch
  readonly roots: readonly EditorId[];           // ordered top-level ids; memoized by epoch
  readonly selection: readonly EditorId[];       // read fresh every call
  readonly mode: "edit" | "play";                // read fresh every call
  readonly canUndo: boolean;                     // read fresh every call
  readonly canRedo: boolean;                     // read fresh every call
};

type EntitySnapshot = {
  readonly id: EditorId;                         // commands.editorIdOf — the external handle
  readonly name: string;                         // lifted from Node ("" for a legacy nodeless entity)
  readonly enabled: boolean;                     // lifted from Node (true default)
  readonly parent: EditorId | undefined;         // lifted from Node; undefined = scene root
  readonly children: readonly EditorId[];        // hierarchy.childrenOf, ordered by Node.order
  readonly components: readonly ComponentSnapshot[]; // EXCLUDES the internal Node
};

type ComponentSnapshot = {
  readonly name: string;                         // never "Node"
  readonly value: unknown;                        // live value at snapshot time (frozen)
  readonly fields: readonly FieldDescriptor[];    // reflection.describe(name)
};
```

`entities` is **flat**; nesting is re-derived from `parent`/`children`/`roots`. Every object in the tree — the snapshot, `entities`, `roots`, each entity's `children`, `components`, and `selection` — is `Object.freeze`d, so a panel can hold a previous snapshot to diff against the next.

## Configuration

`Config` is intentionally **empty** (`Record<string, never>`) — the facade owns no tunable behavior. Any knob belongs on the plugin that owns it (`hierarchy.maxDepth`, `reflection.humanizeLabels`, `serialization.storageKeyPrefix`, `editor-history.maxDepth`, …).

## Dependencies

**Eleven** real edges — each backs a snapshot read, a facade verb, or an `onStart` seam. The only deliberately under-exercised edge is the forward-declared `mcp`.

- **`ecs`** — `changeEpoch()` (the poll signal + memo key), `liveEntities()` + `componentsOf(entity)` (the entity/component tree), `get(entity, Node)` (the typed `Node` lift, and the clone source read in `duplicate`).
- **`reflection`** — `describe(name)` (snapshot field schemas, `describe` passthrough, `listComponents` enrichment) and `validate` (injected into `commands.setValidator` at `onStart`).
- **`commands`** — `editorIdOf`/`resolve` (Entity ↔ EditorId), `setValidator` (the decoupling seam), and — via `editor-history.applyTracked` — `applyRaw` (the write funnel for every verb, incl. the compound bursts).
- **`hierarchy`** *(new this cycle)* — `Node` token (typed snapshot read), `childrenOf`/`roots` (the hierarchical snapshot), `parentOf` (reorder), `canReparent`/`computeLocalForPreserveWorld`/`orderBetween` (the `reparent`/`reorder`/`duplicate` math). Consumed at call time via `ctx.require` — no `onStart` wiring.
- **`component-registry`** *(new this cycle)* — `list()` (`listComponents`), `get(name)?.defaults` (`create*`/`addComponent`). Consumed at call time — no `onStart` wiring.
- **`editor-selection`** — `selected()` (snapshot selection), `select`/`toggle`/`clear` (the `select`/`clearSelection` forwards; `duplicate` selects its clones).
- **`editor-gizmos`** — `setGestureSink(sink)`, wired at `onStart` to `editor-history` so a gizmo drag is ONE undo entry. No gizmo-control method on the bridge (the toolbar drives `editor-gizmos` directly — off-bridge view state).
- **`editor-history`** — `applyTracked` (the tracked write path), `beginGesture`/`endGesture` (the compound-op brackets + the gizmo sink), `undo`/`redo`, `canUndo`/`canRedo` (snapshot flags).
- **`editor-runtime`** — `enterPlay`/`stop`/`step` (the transport forwards) and `mode()` (snapshot mode).
- **`serialization`** — `save(name)`/`load(name)` (persistence forwards).
- **`mcp`** — **forward-declared**: captured + readiness-probed at `onStart`; the `editor://schema` + per-verb tool mirror is Follow-up F1.

**Type-only re-uses** (no runtime edge, no `depends` entry): `TransformValue` (`../renderer/types`), `ShapeValue` (`../graphics-2d/types`). `renderer` and `graphics-2d` are **not** dependencies — the bridge only re-uses their published types.

## Lifecycle

- **`onInit`** — not used (no config-time work; `createState` seeds the memoization cache `{ lastEpoch: -1, entities: undefined, roots: undefined }`).
- **`onStart`** (`@no-resource-check` — deps-ready wiring, no resource opened) runs after all eleven deps have started:
  1. **Validator seam** — `commands.setValidator((name, partial) => reflection.validate(name, partial))`, so `commands` gets rich field validation without a `commands → reflection` edge (the E1 pair).
  2. **Gizmo gesture-sink seam** — `editor-gizmos.setGestureSink({ begin, applyTracked, end })` wired to `editor-history`, so a gizmo drag collapses to ONE undo entry (the E3 pair). `editor-gizmos` and `editor-history` are same-wave siblings that cannot edge each other — the bridge composes them.
  3. **`mcp` readiness probe** — captures `mcp` and logs `isRunning()`/`clientTransport()` for Follow-up F1; registers no tool/resource this cycle.
- **`onStop`** — not used. The bridge owns **no external resource**; its only side effects are function references installed on `commands` (`setValidator`) and `editor-gizmos` (`setGestureSink`), both discarded with the app on stop, so unwiring would be dead work.

## Package Dependencies

None beyond `@moku-labs/core`. **No `pixi.js`** (it never touches a view), **no `@moku-labs/web`** (that is the Layer-3 app, a separate `createApp` importing this plugin's `Api` type — the dependency points the correct way, Layer-3 → Layer-2, never the reverse).

## Events

**None.** The facade is pull, not push — reactivity is poll-on-epoch. The reactive editor events the web shell listens to (`editor-selection:changed`, `editor-runtime:modeChanged`, `commands:restored`) are emitted by **those** plugins, not by the bridge.

## Hooks

**None.** The bridge registers no lifecycle hooks and listens to no events. Selection/mode re-render timing is owned by the Layer-3 web shell.

## Headless-safe

Every method is plain data over the deps' facets. With no live entity, `snapshot().entities` and `.roots` are `[]`; `selection` is `[]`; `mode` is `"edit"`; `canUndo`/`canRedo` are `false`. No Pixi/DOM import — the bridge never touches a view.

## Follow-ups (non-blocking)

- **F1 — the `mcp` mirror.** Register an `editor://schema` **resource** (serves `reflection.describe(name)` per component) and per-verb **tools** (`editor:create`, `editor:reparent`, `editor:addComponent`, …) routing through the same `editor-history.applyTracked` → `commands.applyRaw` funnel, so an agent's edits are validated, id-stable, and undo-tracked exactly like the inspector's — the north-star AI co-editing capability the twelve verbs already mirror 1:1.
- **F2 — multi-select `select(...ids)`.** Once `editor-selection` ships marquee/multi-select, honor **all** ids (today it clears + toggles each in order).
- **F3 — snapshot deltas / structural sharing.** For very large worlds, return a diff since the last epoch alongside the full tree, so a virtualized hierarchy patches instead of re-diffing.
- **F4 — export/import passthrough.** Surface `serialization.serialize()`/import as `export()`/`import(json)` on the facade for a "download scene / paste scene" action.
