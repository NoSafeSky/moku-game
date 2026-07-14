# editor-bridge

> Complex plugin — the **typed facade** for the editor, and the **single Layer-3 integration seam**. It answers **one read** — `snapshot(): EditorSnapshot`, an immutable, **poll-on-epoch** view aggregating the live world (`ecs` introspection), per-component field schemas (`reflection.describe`), the current selection (`editor-selection`), the edit/play mode (`editor-runtime`), and undo/redo availability (`editor-history`) — and it **forwards** every user action to the single write-authority. It owns no primitive, emits no event, and holds no external resource; it is a pure aggregation + forwarding layer. It is the plugin that makes the editor **two-`createApp`-clean** (the deferred Layer-3 `@moku-labs/web` shell never touches the kernel), and the plugin **shaped** to mirror the `mcp` surface for the north-star AI co-editing follow-up.

```ts
const app = createApp({ /* … all nine editor-bridge deps … */ });
await app.start();

const bridge = app["editor-bridge"];
const s = bridge.snapshot();               // { epoch, entities, selection, mode, canUndo, canRedo }
bridge.setField(id, "Transform", "x", 128); // undo-tracked write through editor-history -> commands
bridge.select(id);                          // drives editor-selection
bridge.play();                              // editor-runtime.enterPlay()
bridge.save("level1");                      // serialization.save()
```

## Design decision — the `Api` is the single Layer-3 integration seam

The editor is **two `createApp` instances**: a **game runtime** app that owns the PixiJS canvas and the whole ECS/editor plugin graph, and a **web shell** app (deferred Layer-3 `@moku-labs/web`, Preact) that renders the hierarchy / inspector / asset-browser / toolbar panels around that canvas. They integrate through **exactly one runtime object**: `gameApp["editor-bridge"]` — the `EditorBridge.Api` this plugin exposes. The web shell is coded against the **`Api` type** (imported from `types.ts`) and the live object it receives; it never imports `createCore`/`createCoreConfig`, never re-instantiates the kernel, never reaches past the facade into `ecs`/`commands`/etc — this is the moku two-app idiom I1/I2 (a merged super-app would force Layer-2 `game` to know `@moku-labs/web`). The rejected alternative — the web app `require`s `ecs`/`commands`/`editor-selection` directly — multiplies the seams the two apps must agree on from **one** to **eight**; the facade collapses that to a single typed contract. Every capability a panel needs is a method **on this `Api`**; new panels extend the facade, never the boundary.

## Design decision — reactivity is poll-on-epoch

`snapshot()` returns a **frozen** `EditorSnapshot` carrying `epoch` mirrored straight from `world.changeEpoch()` (the `ecs` extension — a monotone per-write counter). Preact panels call `snapshot()` on **their own** rAF/interval tick (outside the game loop) and re-materialize the heavy inspector tree **only when `epoch` differs** from the last one they saw — the r3f "state that changes each frame lives outside the component tree" rule and Unity's `SerializedObject.Update()`, applied to the Pixi-canvas / Preact-panels split. There is **no per-frame `emit`** from the bridge (spec/01 §2 kernel-bypass preserved). To make polling cheap and referentially stable, the bridge **memoizes the entities array by epoch**: `state.lastEpoch` + the frozen `state.entities` are reused verbatim while `world.changeEpoch()` is unchanged, so repeated `snapshot()` calls between writes return the **same** `entities` reference — a Preact `useMemo`/`===` gate then skips the virtualized-tree rebuild for free. **The cheap scalars are read fresh every call** — `selection`, `mode`, `canUndo`, `canRedo` are **not** epoch-gated (a pure selection change or a mode flip does not write the ECS, so it does not bump `changeEpoch`). The two coarse editor events (`editor-selection:changed`, `editor-runtime:modeChanged`) drive **when** the Layer-3 web shell re-polls for those — the bridge itself declares no hooks and stays a pure pull-facade. The rejected alternative — the bridge `emit`s a `bridge:changed` per world write — re-introduces a hot-path `emit` on the mutation funnel; poll-on-epoch is strictly cheaper and the r3f/Unity-validated shape. The snapshot, its `selection` array, and every entity/component object are `Object.freeze`d, so a panel can hold a previous snapshot to diff against the next without the underlying state mutating beneath it. `state.lastEpoch` is seeded `-1` so the first `snapshot()` always materializes.

## Design decision — every write forwards to the single write-authority

User mutations do **not** touch `world` directly. `apply(command)` and `setField(id, component, field, value)` both forward to `editor-history.applyTracked(command)`, which wraps `commands.applyRaw(command)` synchronously and records the field-diff — so every facade edit is a single undo-tracked step through the one validated funnel. Selection forwards to `editor-selection`, mode to `editor-runtime`, persistence to `serialization`. At `onStart` the bridge calls `commands.setValidator(reflection.validate)` — the **decoupling seam**: `commands` performs only **structural** validation itself (entity alive, component known, value is an object); **rich** field validation lives in `reflection` (it owns the descriptors). The bridge is a plugin that **holds both** deps, so it is the natural place to inject `reflection.validate` into `commands`, keeping `commands → reflection` a **non-edge** (both are foundational plugins that build in parallel). After the wiring, an out-of-range or wrong-typed reflected write is rejected by `commands.applyRaw`/`apply` before it can corrupt SoA storage. The rejected alternative — `commands` depends on `reflection` directly — forces a build order between two parallel foundations and puts rich validation on the structural hot path even for games that never load the editor. The rejected alternative — the facade calls `commands.apply` directly (skipping history) — opens an undo hole; the facade always goes through `applyTracked`. `apply`/`setField` return the `CommandResult` `applyTracked` relays, so a panel can surface a validation failure (toast) instead of silently dropping it. `load(name)` routes through `serialization.load` → `commands.restore` (non-undoable reseed), which bumps `changeEpoch` and — via `commands:restored` — clears `editor-history`; the next `snapshot()` reflects the loaded world and `canUndo` is `false`.

## Design decision — the `mcp` edge is forward-declared (Follow-up F1, not this cycle)

`editor-bridge` `depends: [ …, mcp ]` even though the MVP does **not** register any MCP tool or resource. At `onStart` the bridge captures the `mcp` `Api` and probes it (`isRunning()`, `clientTransport()`) to `ctx.log` the editor↔MCP readiness. The substantive mirror — an `editor://schema` **resource** (serves `reflection.describe` per component) and an `editor:apply` **tool** (routes an incoming `Command` through the same `editor-history.applyTracked` → `commands.applyRaw` funnel, so an agent's edits are undo-tracked and id-stable exactly like the inspector's) — is **Follow-up F1**. The bridge is the only plugin that holds both the write funnel (`commands`/`editor-history`) **and** the schema source (`reflection`) **and** the MCP server (`mcp`), so it is the designated owner of that mirror. Declaring the `mcp` edge now makes the bridge's topological position correct now (registered after `mcp`), so F1 is a pure additive delta with no dependency-graph or registration-order change.

## API

Accessed as `app["editor-bridge"].*` after `createApp()`.

| Member | Description |
|---|---|
| `snapshot()` | The immutable poll-on-epoch view of the editor world (memoized by `epoch`). |
| `apply(command)` | Apply a `Command` through the undo-tracked write funnel; returns the `CommandResult`. |
| `setField(id, component, field, value)` | Edit one component field on one entity — sugar for `apply({ kind: "setField", … })`; undo-tracked. |
| `select(...ids)` | Set the selection to the given editor ids (resolved via `commands.resolve`; unresolvable ids are skipped with a warning). |
| `clearSelection()` | Clear the selection. |
| `undo()` / `redo()` | Undo/redo the last tracked edit. |
| `play()` / `stop()` / `step()` | Enter play mode / exit to the pre-play snapshot / advance one frame while paused. |
| `save(name)` / `load(name)` | Persist / load a scene by name (`serialization`, storage-backed); `load` returns `false` if absent (no world change). |
| `describe(componentName)` | The field descriptors for a component name (`reflection.describe`) — for a panel needing a schema before any instance is live. |

## `EditorSnapshot`

```ts
type EditorSnapshot = {
  readonly epoch: number;                       // world.changeEpoch() — the re-render gate
  readonly entities: readonly EntitySnapshot[];  // memoized by epoch
  readonly selection: readonly EditorId[];       // read fresh every call
  readonly mode: "edit" | "play";                // read fresh every call
  readonly canUndo: boolean;                     // read fresh every call
  readonly canRedo: boolean;                     // read fresh every call
};
```

Each `EntitySnapshot` is `{ id: EditorId; components: readonly ComponentSnapshot[] }`; each `ComponentSnapshot` is `{ name: string; value: unknown; fields: readonly FieldDescriptor[] }`. Every object in the tree — the snapshot itself, its `selection` array, and every entity/component object — is `Object.freeze`d.

## Configuration

`Config` is intentionally **empty** (`Record<string, never>`) — the facade owns no tunable behavior. Any knob belongs on the plugin that owns it (`reflection.humanizeLabels`, `serialization.storageKeyPrefix`, `editor-history.maxDepth`, …).

## Lifecycle

`onStart` (`@no-resource-check` — deps-ready wiring, no resource opened) runs after all nine dependencies have started:

1. **Validator seam** — `commands.setValidator((name, partial) => reflection.validate(name, partial))`, so `commands` gets rich field validation without a `commands → reflection` edge.
2. **Gizmo gesture-sink seam** — `editor-gizmos.setGestureSink({ begin, applyTracked, end })` wired to `editor-history.beginGesture`/`applyTracked`/`endGesture`, so a gizmo drag collapses to ONE undo entry through the single write-authority. `editor-gizmos` and `editor-history` are sibling plugins that cannot edge each other directly — the bridge composes them, exactly as it composes the E1 validator pair.
3. **`mcp` readiness probe** — captures the `mcp` `Api` and logs `isRunning()`/`clientTransport()` for Follow-up F1; registers no tool/resource this cycle.

There is **no `onStop`**: the bridge owns no external resource. Its only side effect is installing a function reference on `commands`' state via `setValidator`; `commands` is discarded with the app on stop, so unwiring it would be dead work on an object about to be garbage-collected.

## Headless-safe

Every method is plain data over the deps' own facets. With no live entity, `snapshot().entities` is `[]`; `selection` is `[]`; `mode` is `"edit"`; `canUndo`/`canRedo` are `false`. No Pixi/DOM import — the bridge never touches a view.

## Events

**None.** The facade is pull, not push — reactivity is poll-on-epoch. The two reactive editor events the web shell listens to (`editor-selection:changed`, `editor-runtime:modeChanged`) are emitted by **those** plugins, not by the bridge.

## Hooks

**None.** The bridge registers no lifecycle hooks and listens to no events. Selection/mode re-render timing is owned by the Layer-3 web shell.

## Dependencies

All nine edges are real (each backs a facade method, the `setValidator` seam, or the gizmo gesture-sink wiring) — the only deliberately under-exercised edge is the forward-declared `mcp` (documented above).

- **`ecs`** — `changeEpoch()` (the poll-on-epoch signal + memoization key), `liveEntities()` + `componentsOf(entity)` (the snapshot entity/component tree).
- **`reflection`** — `describe(name)` (field descriptors in the snapshot **and** the `describe` passthrough) and `validate` (injected into `commands.setValidator` at `onStart`).
- **`commands`** — `editorIdOf(entity)` + `resolve(id)` (the `Entity` ↔ `EditorId` translation) and `setValidator(fn)` (the decoupling seam).
- **`editor-selection`** — `selected()` (snapshot selection), `select`/`toggle`/`clear` (the `select`/`clearSelection` forwards).
- **`editor-gizmos`** — `setGestureSink(sink)`, wired at `onStart` to `editor-history`. The bridge exposes no gizmo control method in the MVP; the edge exists for the sink wiring.
- **`editor-history`** — `applyTracked(command)` (the undo-tracked write path), `undo`/`redo`, `canUndo`/`canRedo` (snapshot flags), `beginGesture`/`endGesture` (the gizmo sink).
- **`editor-runtime`** — `enterPlay`/`stop`/`step` (the `play`/`stop`/`step` forwards) and `mode()` (snapshot mode).
- **`serialization`** — `save`/`load` (persistence forwards).
- **`mcp`** — forward-declared: captured + readiness-probed at `onStart`; the mirror is Follow-up F1.

## Package Dependencies

None beyond `@moku-labs/core`. No `pixi.js` (it never touches a view), no `@moku-labs/web` (that is the deferred Layer-3 app — the dependency points the correct way, Layer-3 → Layer-2, never the reverse).

## Follow-ups (non-blocking)

- **F1 — the `mcp` mirror.** Register, at `onStart`, an `editor://schema` **resource** (serves `reflection.describe(name)` per named component) and an `editor:apply` **tool** (accepts a serialized `Command`, routed through the same `editor-history.applyTracked` → `commands.applyRaw` funnel, so an agent's edits are validated, id-stable, and undo-tracked exactly like the inspector's) — the north-star AI co-editing / MCP-remote attach capability.
- **F2 — multi-select `select(...ids)`.** Once `editor-selection` ships its `multiSelect`/marquee follow-up, `select(...ids)` honors **all** ids (today it clears + toggles, which under single-select leaves the last id).
- **F3 — snapshot deltas / structural sharing.** For very large worlds, return a diff since the last epoch alongside the full tree, so a virtualized hierarchy patches instead of re-diffing.
- **F4 — export/import passthrough.** Surface `serialization.export()`/`import(json)` as `export()`/`import(json)` on the facade, for a "download scene / paste scene" toolbar action.
- **F5 — two-world play mode reflection.** If `editor-runtime` upgrades to a two-world play clone, `snapshot()` gains a `worldId`/`isClone` discriminator.
