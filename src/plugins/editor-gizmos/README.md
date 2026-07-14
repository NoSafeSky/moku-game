# editor-gizmos

> Complex plugin — the editor's **direct-manipulation viewport layer**: a transform gizmo overlay that turns a pointer drag on the selected entity into a single, undoable `commands` mutation.

The MVP ships the **translate** handle — a centre square (free x+y move) plus an X arrow and a Y arrow (axis-locked move). A drag runs entirely in **world space**: on pointerdown it captures the target's start `Transform` (read from `renderer.getEntityView`) and the pointer's world-space grab origin; on every pointermove it recomputes the pointer's world position via `camera.screenToWorld` (**never cached** — the anti-drift discipline that avoids the classic TransformControls skew under a rotated/zoomed camera); on pointerup it commits the net delta as `setField` command(s) on `Transform` through **`commands`**, gesture-coalesced into **one** undo step.

The gizmo is **editor chrome, not scene data** — it lives in a separate Pixi overlay `Container` OUTSIDE the ECS (built in `onStart`, added to `renderer.getStage()`), so it never pollutes the saved world, the `EditorId` map, or undo. During a drag only chrome moves (the overlay handle + a transient view preview) — **no ECS write happens until pointerup**, so an aborted drag leaves the world untouched. It emits **no** kernel events (all mutation is the `commands` API). **Headless-safe** — with no renderer stage the overlay is never created and `enable`/`disable`/drag are guarded no-ops, while `setMode`/`setSnap`/`mode` still work on numeric state. `onStart` only (the renderer disposes the overlay); no `onStop`.

## API

Accessed as `app["editor-gizmos"].*` after `createApp()`:

### `enable(): void` / `disable(): void`
Show the gizmo overlay and begin responding to selection + pointer drags / hide it and stop (aborting any in-flight drag WITHOUT committing). Both idempotent; no-op when headless.

### `setMode(mode: GizmoMode): void`
Set the active manipulation mode. **MVP: only `"translate"` is functional** — `setMode("rotate")` / `setMode("scale")` warn via `ctx.log` and no-op while `config.translateOnly` is true (Follow-up F1 ships rotate/scale).

### `setSnap(n: number): void`
Set the translate snap increment in world units (clamped to `>= 0`; `0` disables snapping). Each committed axis value is rounded to the nearest multiple.

### `mode(): GizmoMode`
The current active manipulation mode.

### `setGestureSink(sink: GestureSink | undefined): void`
Inject the editor-history gesture sink — the `{ begin, applyTracked, end }` triple (wired by `editor-bridge` to `editor-history`). When set, a drag is bracketed by `begin`/`end` and commits route through `applyTracked` (one undo entry). Pass `undefined` to clear (commits then go straight through `commands.apply` — correct world state, no undo recording).

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `overlayLayer` | `string` | `"editor-gizmos"` | Pixi node label for the overlay Container (aids `renderer.tree()` / debugging) and the key it is tracked under. |
| `snap` | `number` | `0` | Translate snap increment in world units (`0` disables). Overridable at runtime via `setSnap`. |
| `translateOnly` | `boolean` | `true` | MVP gate: `setMode("rotate")`/`setMode("scale")` warn + no-op while `true`. Set `false` once rotate/scale ship (F1). |

## Dependencies

`renderer` (#3, `getStage`/`getEntityView`), `camera` (#16, `screenToWorld`), `editor-selection` (#20, the current selection), `commands` (#17, the write funnel + `editorIdOf`). `editor-history` is NOT a dependency — its gesture coalescing is injected via `setGestureSink`. No `scheduler`/`input` edge (the drag loop is event-driven via Pixi federated pointer events). No new package dependency (Pixi via renderer).

## Example

```ts
import { createApp } from "game";

const app = createApp();
await app.start();

const gizmos = app["editor-gizmos"];
gizmos.enable();          // show the handle at the selected entity (editor mode)
gizmos.setSnap(16);       // snap committed moves to a 16-unit grid
// ... user drags the handle: pointerdown → moves world-space → pointerup commits one setField ...
gizmos.disable();
```
