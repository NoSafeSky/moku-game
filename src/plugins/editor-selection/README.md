# editor-selection

> Standard plugin — the editor's viewport **picking + selection model**: how a human (or an agent, via `editor-bridge`) points at the running game and says *"that one."*

`enable()`/`disable()` flip Pixi `eventMode`/`interactiveChildren` on **one** camera layer (`camera.layer(config.pickLayer)`, default `"world"`), so a non-editor game — or a game in play mode — pays **zero** hit-testing cost. `pickAt(screen)` maps a pointer to the **topmost entity under it** through the shared coordinate pipeline (`camera.screenToWorld`), resolving the entity from a **non-enumerable `entity` handle** stamped onto each view (`Object.defineProperty(view, "entity", …)` — the ecs `__id` pattern), never a side `Container → Entity` map that rots as views attach/detach. The handle is refreshed from the source of truth (`world.liveEntities()` → `renderer.getEntityView(e)`) on `enable()` and lazily before each `pickAt`, and every resolved entity is validated with `world.isAlive` (the recycled-id guard).

The selection is a `Set<Entity>` behind `select`/`toggle`/`clear`/`selected()`/`isSelected`. It emits **one** coarse event, `editor-selection:changed`, only when the set actually changes — never per-frame (the kernel-bypass invariant). **Headless-safe**: with no renderer stage there is no pick layer and no views, so `enable()` is a guarded no-op and `pickAt` returns `undefined`, while the pure selection-set API still works so logic/tests run headless. MVP = single-select click; marquee / additive multi-select is a follow-up (`config.multiSelect` is reserved).

## API

Accessed as `app["editor-selection"].*` after `createApp()`:

### `enable(): void`
Enter edit mode: make the pick layer interactive, stamp live views, attach the pointerdown listener. No-op (warns) before start, headless, or if the layer is missing. Idempotent.

### `disable(): void`
Leave edit mode: detach the listener and stop hit-testing. Idempotent. Does **not** clear the selection.

### `select(entity: Entity): void`
Select an entity (single-select replaces; `multiSelect` adds). Ignores a despawned entity. Emits `editor-selection:changed` iff the set changed.

### `toggle(entity: Entity): void`
Toggle an entity's membership. Ignores a despawned entity. Emits iff the set changed.

### `clear(): void`
Clear the selection. Emits iff the set was non-empty.

### `selected(): readonly Entity[]`
The current selection as a fresh immutable array, pruned of despawned entities (never the live `Set`).

### `isSelected(entity: Entity): boolean`
Whether an entity is currently selected and still alive. A pure reader — works before start.

### `pickAt(screen: Point): Entity | undefined`
Resolve the topmost entity under a canvas-relative screen point via the stamped handle; `undefined` if nothing hit / headless / disabled.

## Events

### `editor-selection:changed { selected: readonly Entity[] }`
Fired after the selection set actually changes; the payload is a fresh immutable snapshot. Coarse, user-gesture frequency — never per-frame.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `pickLayer` | `string` | `"world"` | The camera layer made interactive + hit-tested for picking (must be a `camera.layer(name)`). |
| `multiSelect` | `boolean` | `false` | **Reserved (MVP: single-select).** When `true`, `select`/`toggle` are additive; when `false`, `select` replaces. |

## Dependencies

`ecs` (#1, `isAlive`/`liveEntities` — the recycled-id guard + view stamping), `renderer` (#3, `getEntityView`/`getView`), `camera` (#16, `layer`/`screenToWorld` — the pick layer + coordinate pipeline), `input` (#7, the pointer snapshot). No new package dependency (Pixi via renderer). No `onStop` — the pick layer is a renderer-owned Container, the listener is removed by `disable()`, and the captured handles are plain references.

## Example

```ts
import { createApp } from "game";

const app = createApp();
await app.start();

const selection = app["editor-selection"];
selection.enable();                       // pick layer becomes interactive (editor mode)
const hit = selection.pickAt({ x: 120, y: 80 });
if (hit !== undefined) selection.select(hit);
// app.on("editor-selection:changed", ({ selected }) => updateInspector(selected));
selection.disable();                      // back to zero hit-testing cost
```
