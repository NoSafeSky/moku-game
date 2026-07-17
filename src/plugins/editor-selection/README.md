# editor-selection

> Standard plugin — the editor's viewport **picking + selection model**: how a human (or an agent, via `editor-bridge`) points at the running game and says *"that one"* — or drags a box around several.

`enable()`/`disable()` flip Pixi `eventMode`/`interactiveChildren` on **one** camera layer (`camera.layer(config.pickLayer)`, default `"world"`), so a non-editor game — or a game in play mode — pays **zero** hit-testing cost. `pickAt(screen)` maps a pointer to the **topmost entity under it** through the shared coordinate pipeline (`camera.screenToWorld`), resolving the entity from a **non-enumerable `entity` handle** stamped onto each view (`Object.defineProperty(view, "entity", …)` — the ecs `__id` pattern), never a side `Container → Entity` map that rots as views attach/detach. The handle is refreshed from the source of truth (`world.liveEntities()` → `renderer.getEntityView(e)`) on `enable()` and lazily before each `pickAt`/`selectInRect` scan, and every resolved entity is validated with `world.isAlive` (the recycled-id guard).

The selection is a `Set<Entity>` behind `select`/`toggle`/`clear`/`selected()`/`isSelected`/`selectInRect`. **Picking is modifier-aware**: the native pick listener reads the toggle modifier off the **same shared `input.snapshot()`** the primary-button press-edge gate already reads (`snapshot().isDown("Control") || snapshot().isDown("Meta")`) and routes a hit to **toggle** when held, else **replace**. Shift-range is deliberately *not* a viewport concern — it presupposes a linear order the 2D scene doesn't have, so it belongs to the hierarchy panel instead. A primary drag that starts on **empty** pick-layer space and travels past a small screen threshold draws a **dashed marquee rectangle** — screen-space editor chrome on its own overlay `Container` parented on `renderer.getStage()`, never an ECS entity — and on release maps the two canvas corners through `camera.screenToWorld` into a world-space `Rect` and calls `selectInRect`, unioning into the selection under Ctrl/Cmd or `config.multiSelect`, else replacing.

It emits **one** coarse event, `editor-selection:changed`, only when the set actually changes — never per-frame (the kernel-bypass invariant) — whether the change came from `select`/`toggle`/`clear` or a marquee's `selectInRect`. **Headless-safe**: with no renderer stage there is no pick layer, no marquee overlay, and no views, so `enable()` is a guarded no-op and `pickAt`/`selectInRect` are inert, while the pure selection-set API still works so logic/tests run headless. The framework default for `multiSelect` **stays `false`** so a non-editor game keeps plain single-select click; the editor **app** opts in (`editor-selection: { multiSelect: true }`) to get accumulating clicks alongside the marquee.

## API

Accessed as `app["editor-selection"].*` after `createApp()`:

### `enable(): void`
Enter edit mode: make the pick layer interactive, stamp live views, attach the pointerdown listener, and — when `config.marquee` and the overlay was built — reveal the marquee overlay and wire its drag. No-op (warns) before start, headless, or if the layer is missing. Idempotent.

### `disable(): void`
Leave edit mode: detach the pick + marquee listeners, abort any in-flight marquee **without** selecting, hide the marquee overlay, and stop hit-testing. Idempotent. Does **not** clear the selection.

### `select(entity: Entity): void`
Select an entity (single-select replaces; `multiSelect` adds). Ignores a despawned entity. Emits `editor-selection:changed` iff the set changed.

### `toggle(entity: Entity): void`
Toggle an entity's membership (the Ctrl/Cmd-click path). Ignores a despawned entity. Emits iff the set changed.

### `clear(): void`
Clear the selection. Emits iff the set was non-empty.

### `selected(): readonly Entity[]`
The current selection as a fresh immutable array, pruned of despawned entities (never the live `Set`).

### `isSelected(entity: Entity): boolean`
Whether an entity is currently selected and still alive. A pure reader — works before start.

### `pickAt(screen: Point): Entity | undefined`
Resolve the topmost entity under a canvas-relative screen point via the stamped handle; `undefined` if nothing hit / headless / disabled.

### `selectInRect(rect: Rect): void`
Select every stamped, still-alive entity whose **world-space bounds** intersect `rect` (`{ x; y; width; height }`, world space). Additive (unions into the current selection) under `config.multiSelect`; otherwise replaces. Emits `editor-selection:changed` iff the set changed. No-op before start (warns) or headless. The marquee drag calls the same underlying hit-test with its own additive flag (Ctrl/Cmd held for the gesture, or `config.multiSelect`).

## Events

### `editor-selection:changed { selected: readonly Entity[] }`
Fired after the selection set actually changes — from `select`/`toggle`/`clear` or `selectInRect`/the marquee; the payload is a fresh immutable snapshot. Coarse, user-gesture frequency — never per-frame.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `pickLayer` | `string` | `"world"` | The camera layer made interactive + hit-tested for picking (must be a `camera.layer(name)`). |
| `multiSelect` | `boolean` | `false` | When `true`, `select`/`toggle` are additive and the marquee unions its hits; when `false`, `select` replaces (a held Ctrl/Cmd still toggles the single item). The framework default is deliberately `false` — a non-editor game keeps plain single-select; the editor app opts in. |
| `marquee` | `boolean` | `true` | Enables the drag marquee: an empty-space primary drag past a small screen threshold draws a dashed overlay rect and `selectInRect`s on release. When `false`, the overlay is never built and empty-space drags do nothing (an empty click still clears). Only ever active once `enable()` has run on a real stage. |

## Dependencies

`ecs` (#1, `isAlive`/`liveEntities` — the recycled-id guard + view stamping + marquee scan), `renderer` (#3, `getEntityView`/`getView`/`getStage` — the marquee overlay's parent), `camera` (#16, `layer`/`screenToWorld` — the pick layer + coordinate pipeline + marquee corner projection), `input` (#7, the pointer snapshot **and** the toggle-modifier held-key set). No new package dependency (Pixi via renderer). No `scheduler`/`loop` edge — both the entity pick and the marquee ride Pixi's native federated pointer dispatch. No `onStop` — the marquee overlay + its `Graphics` are **renderer-owned** stage children (disposed with the renderer's own `onStop`, the `editor-gizmos`/`ui`/`camera` precedent), the pick layer is likewise renderer-owned, the pick + marquee listeners are removed by `disable()`, and the captured handles / selection `Set` are plain references / GC-able data.

## Example

```ts
import { createApp } from "game";

const app = createApp({ pluginConfigs: { "editor-selection": { multiSelect: true } } });
await app.start();

const selection = app["editor-selection"];
selection.enable();                       // pick layer + marquee become interactive (editor mode)
const hit = selection.pickAt({ x: 120, y: 80 });
if (hit !== undefined) selection.select(hit);
// app.on("editor-selection:changed", ({ selected }) => updateInspector(selected));
selection.selectInRect({ x: 0, y: 0, width: 200, height: 120 }); // programmatic marquee-equivalent
selection.disable();                      // back to zero hit-testing cost
```
