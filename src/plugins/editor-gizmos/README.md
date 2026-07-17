# editor-gizmos

> Complex plugin — the editor's **direct-manipulation viewport layer**: a transform gizmo overlay that turns a pointer drag on the selected entity into a single, undoable `commands` mutation.

The framework default (`translateOnly: true`) ships only the **translate** handle — a centre square (free x+y move) plus an X arrow and a Y arrow (axis-locked move) — so non-editor games and translate-only tools pay nothing and keep translate-only behaviour. The editor app opts in with `editor-gizmos: { translateOnly: false }`, which additionally enables **rotate** (a ring → `Transform.rotation`), **scale** (X/Y boxes + a uniform corner box → `Transform.scaleX`/`scaleY`), and **rect** (the P1 bounding-box tool — in P1 it maps to a uniform scale anchored on the selection's bounds centre; a true independent-edge box resize is a later phase).

A drag runs entirely in **world space**: on pointerdown it captures the target's start `Transform` (position/rotation/scale, all read from `renderer.getEntityView`) and the pointer's world-space grab origin + the drag's pivot anchor; on every pointermove it recomputes the pointer's world position via `camera.screenToWorld` (**never cached** — the anti-drift discipline that avoids the classic TransformControls skew under a rotated/zoomed camera, applied identically to rotate/scale, not just translate); on pointerup it commits the net delta as `setField` command(s) on `Transform` through **`commands`**, gesture-coalesced into **one** undo step. Rotate commits a single `rotation` field; scale (and rect) commit `scaleX` + `scaleY` (an axis-locked scale skips its untouched axis via the same no-op dedupe translate already used).

The gizmo is **editor chrome, not scene data** — it lives in a separate Pixi overlay `Container` OUTSIDE the ECS (built in `onStart`, added to `renderer.getStage()`), so it never pollutes the saved world, the `EditorId` map, or undo. During a drag only chrome moves (the overlay handle + a transient view preview) — **no ECS write happens until pointerup**, so an aborted drag leaves the world untouched. It emits **no** kernel events (all mutation is the `commands` API). **Headless-safe** — with no renderer stage the overlay is never created and `enable`/`disable`/drag are guarded no-ops, while `setMode`/`setSnap`/`mode`/`setSpace`/`setPivot`/`space`/`pivot` still work on numeric/reference state. `onStart` only (the renderer disposes the overlay); no `onStop`. **Single-target** — the drag target is always `editor-selection.selected()[0]`; group/multi-target transforms are a later phase.

## API

Accessed as `app["editor-gizmos"].*` after `createApp()`:

### `enable(): void` / `disable(): void`
Show the gizmo overlay and begin responding to selection + pointer drags / hide it and stop (aborting any in-flight drag WITHOUT committing). Both idempotent; no-op when headless.

### `setMode(mode: GizmoMode): void`
Set the active manipulation mode (`"translate" | "rotate" | "scale" | "rect"`). `"rotate"`/`"scale"`/`"rect"` are accepted only when `config.translateOnly` is `false`; while it is `true` (the framework default) they warn via `ctx.log` and no-op (`mode()` stays `"translate"`).

### `setSnap(n: number): void`
Set the snap increment, clamped to `>= 0` (`0` disables). **Mode-interpreted** — a single numeric knob, read differently by each mode: translate → world units, scale → a scale-factor increment, rotate → radians.

### `mode(): GizmoMode`
The current active manipulation mode.

### `setSpace(space: GizmoSpace): void` / `space(): GizmoSpace`
Set/read the scale axis frame (`"local"` / `"global"`). Pure interaction state (toolbar-driven, like `setMode`) — works before start and headless, and is NOT gated by `translateOnly`. **P1 simplifications:** 2D rotation is a single scalar, so `space` is a no-op for rotate; for scale, `"global"` (world axes) is exact, while `"local"` scale-under-rotation is approximated as world-axis scale (an exact local-frame scale of a rotated object is a later refinement).

### `setPivot(pivot: GizmoPivot): void` / `pivot(): GizmoPivot`
Set/read the drag anchor (`"pivot"` = the entity's Transform position, `"center"` = its world-space bounds centre). Pure interaction state — works before start and headless, and is NOT gated by `translateOnly`. **P1 note:** for a single target the two coincide whenever the view's local bounds are centred on its origin; they diverge only when the bounds are offset from it. `"rect"` always anchors on the bounds centre regardless of `pivot` (a box resize about anything else isn't a box resize).

### `setGestureSink(sink: GestureSink | undefined): void`
Inject the editor-history gesture sink — the `{ begin, applyTracked, end }` triple (wired by `editor-bridge` to `editor-history`). When set, a drag (translate, rotate, or scale) is bracketed by `begin`/`end` and its commit(s) route through `applyTracked` (one undo entry per drag, regardless of mode). Pass `undefined` to clear (commits then go straight through `commands.apply` — correct world state, no undo recording).

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `overlayLayer` | `string` | `"editor-gizmos"` | Pixi node label for the overlay Container (aids `renderer.tree()` / debugging) and the key it is tracked under. |
| `snap` | `number` | `0` | Snap increment, mode-interpreted (world units / scale factor / radians). `0` disables. Overridable at runtime via `setSnap`. |
| `translateOnly` | `boolean` | `true` | Gate: `setMode("rotate"\|"scale"\|"rect")` warn + no-op while `true`. Set `false` (the editor app does) to enable rotate/scale/rect. The framework default stays `true` so non-editor consumers are unaffected. |

`space`/`pivot` are **not** config — they are toolbar-driven interaction state (like `mode`), defaulting to `"global"`/`"pivot"` in `State`.

## Dependencies

`renderer` (#3, `getStage`/`getEntityView`/`markDirty`), `camera` (#16, `screenToWorld`/`worldToScreen`), `editor-selection` (#20, the current selection), `commands` (#17, the write funnel + `editorIdOf`). **Unchanged by rotate/scale/rect** — the start rotation/scale are read from `renderer.getEntityView` (no `ecs` edge), and commits go through the already-depended-on `commands`. `editor-history` is NOT a dependency — its gesture coalescing is injected via `setGestureSink`. No `scheduler`/`input` edge (the drag loop is event-driven via Pixi federated pointer events). No new package dependency (Pixi via renderer).

## Example

```ts
import { createApp } from "game";

const app = createApp({ pluginConfigs: { "editor-gizmos": { translateOnly: false } } });
await app.start();

const gizmos = app["editor-gizmos"];
gizmos.enable();          // show the handle at the selected entity (editor mode)
gizmos.setSnap(16);       // snap committed translate moves to a 16-unit grid

gizmos.setMode("rotate");
gizmos.setSnap(Math.PI / 12); // snap rotation to 15° steps
// ... user drags the ring: pointerdown → screenToWorld each move → pointerup commits one setField rotation ...

gizmos.setMode("scale");
gizmos.setPivot("center"); // anchor the scale on the bounds centre instead of the entity origin
gizmos.setSnap(0.25);      // snap scale to quarter-steps
// ... user drags a scale box: pointerup commits setField scaleX + scaleY ...

gizmos.disable();
```

## Follow-ups (non-blocking)

- **F1 — separate angular/linear snap knobs + snap UI:** split the single `snap` into distinct rotate (angle) and translate/scale (linear) increments, a hold-to-snap modifier, and a HUD readout of the live delta.
- **F2 — group / multi-target transforms:** transform the whole `editor-selection.selected()` set as a rigid group (one gizmo at the selection centroid; each entity's delta committed in one coalesced gesture). P1 is single-target (`selected()[0]`).
- **F3 — true `"rect"` box-resize:** independent per-edge/-corner bounds resize, replacing the P1 scale-on-bounds mapping.
- **F4 — per-frame live-tracking sync:** a `scheduler`-driven system that re-places the handle every frame (auto-appear on selection change, track a camera pan while idle, follow entity motion in a play-mode preview). Adds the flagged `scheduler` (and, if it polls pointer, `input`) edge.
- **F5 — constant-screen-size handles + true local-space scale:** keep handles a fixed pixel size regardless of `camera.getZoom()`, and implement exact local-frame scale of a rotated object (P1 approximates `"local"` scale as world-axis scale).
