# editor-runtime

> Complex plugin — the **edit/play mode FSM** for a Moku editor, over **ONE** ECS world. `enterEdit()` stage-gates the scheduler to `config.editStages` (gameplay `update`/`physics` OFF; `input`/`sync`/`render` stay ON so the viewport keeps rendering and editor input keeps flowing). `enterPlay()` captures a pre-play snapshot (`serialization.serialize()`), un-gates to ALL stages (`setActiveStages(undefined)`), and starts the loop. `stop()` exits play by restoring the pre-play snapshot (`commands.restore`, non-undoable) and then sweeping ghost state via `tween.reset()` / `vfx.reset()` / `camera.reset()` — the `reset()` retrofit convention this plugin owns — before re-gating to author mode. `step()` advances exactly one fixed step for frame-by-frame debugging. Emits **one** coarse event, `editor-runtime:modeChanged`, on every actual edit↔play flip. **Headless-safe** — every dependency it calls is itself headless-tolerant.

## Design decision — ONE world + scheduler stage-gating, NOT two worlds

editor-runtime flips edit↔play on a **single** ECS world by changing **which stages the scheduler runs**, not by maintaining a separate "edit world" and "play world". `enterEdit()` calls `scheduler.setActiveStages(config.editStages)`; `enterPlay()` calls `scheduler.setActiveStages(undefined)` — the `undefined` = ALL sentinel. This keeps `world.tick` monomorphic (zero per-stage membership test) for a non-editor game that never calls `setActiveStages`, and means the editor authors and the game runs against the **same** archetype storage, component tokens, and entity ids — no cross-world copy, no divergence. The trade-off: because it is one world, play-mode mutations are **real writes to the authoring world**, which is exactly why exiting play needs an explicit revert rather than "drop the play world" (see Follow-up F1 for the rejected two-world alternative).

## Design decision — exit-play revert = `commands.restore` (non-undoable) THEN `reset()` on each target

`stop()` performs two ordered steps: **(1)** `commands.restore(snapshot.entities, "exit-play")` — the non-undoable bulk reseed that clears the editor-owned entities, respawns them from the pre-play `SceneDocument`, rebuilds the stable `EditorId` map, and emits `commands:restored` (which `editor-history` clears its undo/redo stacks on — a scene reload must never be undoable); **then (2)** `tween.reset()`, `vfx.reset()`, `camera.reset()` to clear **transient runtime state** a `SceneDocument` does not describe (in-flight tweens, live particle entities + trauma/particle-count accumulators, the camera's follow/shake/zoom holder). Restore happens first (so `reset()` cannot be clobbered by a system running against the not-yet-restored world), reset second. This is a **direct synchronous call** (`ctx.require(plugin).reset()`), not an emit — kernel `emit` is fire-and-forget, not an RPC, and the revert must complete before `stop()` returns.

## Design decision — no `renderer` dependency; the VRAM-safe restore is structural

The pre-play snapshot is **incomplete by construction** — a `SceneDocument` captures ECS component data only, not non-ECS runtime timers, particle accumulators, or camera holders. The mitigation is the `reset()` convention above, NOT tearing down and rebuilding renderer views on a stage-gate flip (a wholesale `destroy()`/recreate of Pixi v8 views churns GPU textures — see open issues [#10586](https://github.com/pixijs/pixijs/issues/10586) / [#11331](https://github.com/pixijs/pixijs/issues/11331)). Because `config.editStages` keeps the renderer's `sync` stage **active**, the renderer's own sync system — which diffs its entity→view `Map` — reconciles views on the **very next tick** after `commands.restore` reseeds the world: only the views that actually changed are touched. This guarantee is **structural** (restore routes through the same spawn/despawn funnel the renderer already reconciles), which is why editor-runtime takes **no** `renderer` dependency — it never pokes views directly.

```ts
const app = createApp({ /* ecs, scheduler, renderer, loop, serialization, commands, tween, vfx, camera, editor-runtime */ });
await app.start();

app["editor-runtime"].mode();       // "edit" (seeded intent — boot is UNGATED until enterEdit())
app["editor-runtime"].enterEdit();  // engage author mode: gate update/physics OFF
app["editor-runtime"].enterPlay();  // snapshot taken; all stages run; loop running
app["editor-runtime"].step();       // advance one fixed step for frame-by-frame debugging
app["editor-runtime"].stop();       // world rewound; no ghost tween/vfx/camera runtime remains
```

## API

Accessed as `app["editor-runtime"].*` after `createApp()`. The four mutators + `step()` are guarded no-ops before `app.start()` (they warn via `ctx.log`; `step()` returns a zeroed clock). The pure readers (`mode`/`isPlaying`) work before start (they read seeded state directly, unguarded).

| Member | Description |
|---|---|
| `enterEdit()` | Gate the scheduler to `config.editStages`. Idempotent in edit mode (re-gates, no emit). |
| `enterPlay()` | Snapshot the scene, un-gate to ALL stages, start the loop. Idempotent if already playing (warns). |
| `stop()` | Restore the pre-play snapshot, `reset()` tween/vfx/camera, re-gate to `config.editStages`. No-op (warn) outside play mode. |
| `step()` | Advance exactly one fixed step + render (delegates to `loop.step()`). Returns `{ frame, elapsed, dt }`. |
| `mode()` | The current `Mode` — `"edit"` or `"play"`. |
| `isPlaying()` | `true` while `mode() === "play"`. |

## Configuration

Per-plugin config under `pluginConfigs["editor-runtime"]`.

| Field | Type | Default | Description |
|---|---|---|---|
| `editStages` | `readonly Stage[]` | `["input", "sync", "render"]` | Stages the scheduler runs in author (edit) mode. Gameplay `update`/`physics` are gated OFF; `input`/`sync`/`render` stay ON so the viewport keeps rendering and editor input keeps flowing. |

`Stage` is imported from `../scheduler/types` (re-exported from `ecs/types`) — no re-declared tuple. A title with an extra editor-only stage, or one that wants `physics` frozen but `update` running in edit (e.g. animation preview), overrides this default.

## `reset()` Retrofit Convention

> editor-runtime owns and documents this convention — the canonical reference other specs point to.

**What `reset()` is.** A new, `void`, no-argument method on each MVP target's `Api` that clears that plugin's **transient runtime state** — the ghost state a `SceneDocument` does not describe — so an exit-play revert leaves no residual behaviour. Invoked via a **direct synchronous call**, `ctx.require(plugin).reset()` — **not** an emit. A non-editor game never calls it; it is pure editor-serviceability surface.

**MVP `reset()` targets (wired by `stop()`, this cycle):**

| Target | Contract | Clears | Leaves intact |
|---|---|---|---|
| `tween` | `killAll()` semantics | Every active tween settled + dropped (`onComplete` does NOT fire) | The advance system, easing table, `lerp` |
| `vfx` | Despawn + zero accumulators | Every live `Emitter`/`Particle`/`FloatingText` entity; `trauma`/`particleCount` zeroed; shake offset reset | The named component tokens stay defined |
| `camera` | Recentre + drop runtime | `center → (0,0)`; `zoom → config.zoom`; `rotation → 0`; `follow` cleared; shake stopped | The layer containers + captured tween API |

**Fast-follow targets (a LATER wave, not this cycle):** `audio.reset()` (stop live sources, restore persisted mute/volume) and `ui.reset()` (clear the screen stack + HUD) — see Follow-up F2.

**Exclusions (deliberately NO `reset()`):**
- **`renderer`** — its views ARE scene data; resetting would destroy the scene's on-screen representation. The still-active `sync` stage reconciles views after `commands.restore` instead (see the design decision above).
- **`platform`** — portal/ad state is orthogonal to edit/play; resetting could tear down a live portal session.

## Events

| Event | Payload | When |
|---|---|---|
| `editor-runtime:modeChanged` | `{ mode: "edit" \| "play" }` | Fired **once per actual transition** — `enterPlay` (edit→play) and `stop`/`enterEdit` (play→edit). An idempotent call that does not change mode emits nothing. Coarse, user-gesture frequency — never per-frame. |

## Lifecycle

`onStart` is deps-ready wiring (`@no-resource-check`): after all seven dependencies have started, it only flips `state.started` so the API leaves its before-start guard. It deliberately does **NOT** apply the `editStages` gate at boot: editor-runtime ships in the default framework plugin set, so gating at startup would freeze gameplay (`update`/`physics`) for **every** app — including non-editor games that never touch the editor. Per the pay-for-what-you-use design decision above (a non-editor game never calls `setActiveStages`; `activeStages()` stays `undefined`), the gate engages only when the Layer-3 editor shell calls `enterEdit()` explicitly. `state.mode` seeds to `"edit"` (the intent); the scheduler gate is the mechanism, applied on entry, not at startup.

There is **no `onStop`**: editor-runtime owns no external resource. The frame loop's rAF is owned by `loop` (its own `onStop` cancels it); the active-stages set lives in the ecs `world` (the `scheduler` extension writes it there); the pre-play `SceneDocument` snapshot is plain GC-able data on `state`. It registers no scheduler system, no DOM listener, no timer, no socket.

## Headless-safe

Every dependency editor-runtime calls (`scheduler.setActiveStages`, `loop.start`/`step`, `serialization.serialize`, `commands.restore`, the three `reset()`s) is itself headless-tolerant, so the mode FSM runs in a headless core with no renderer stage — the viewport simply has nothing to draw.

## Dependencies

Every edge is **real** — invoked in a transition, no dead deps. `ctx.require(plugin)` is resolved at call time (the `platform` precedent); no dependency API is captured on state.

- **`loop`** — `start()` (in `enterPlay`) and `step(): TimeStepResult` (in `step`).
- **`scheduler`** — `setActiveStages(stages | undefined)`: `enterEdit`/`stop` pass `config.editStages`; `enterPlay` passes `undefined` (all).
- **`serialization`** — `serialize(): SceneDocument` (in `enterPlay`, capture the pre-play snapshot).
- **`commands`** — `restore(entities, "exit-play")` (in `stop`, the non-undoable reseed).
- **`tween`** — `reset()` (in `stop`). Edge exists **solely** to call `reset()`.
- **`vfx`** — `reset()` (in `stop`). Edge exists **solely** to call `reset()`.
- **`camera`** — `reset()` (in `stop`). Edge exists **solely** to call `reset()`.
- **No `ecs` / no `renderer` edge** — the plugin touches the world only indirectly through `serialization`/`commands`, and never touches renderer views.

## Package Dependencies

None new. No `pixi.js` import — the plugin never touches views. Everything it does is through the seven plugin APIs.

## Follow-ups (non-blocking)

- **F1 — two-world play mode:** an opt-in mode that clones the edit world into an isolated play world on `enterPlay` and discards it on `stop` (bit-exact isolation), instead of stage-gating one world. Deferred because stage-gating is cheaper and single-authority.
- **F2 — full `reset()` retrofit (audio/ui):** add `depends` edges on `audio`/`ui`, ship `audio.reset()` / `ui.reset()`, and call them in `stop()`.
- **F3 — MCP-remote play control:** expose `enterPlay`/`stop`/`step`/`mode` through the `mcp` editor mirror so an agent can drive edit/play remotely.
- **F4 — explicit `renderer.markDirty()` nudge:** if a scene ever restores views the still-active `sync` stage does not reconcile promptly enough, add a `renderer` edge and a single `markDirty()` after `commands.restore` — measured, not speculative.
