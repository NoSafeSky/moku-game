/**
 * @file editor-runtime plugin — public type surface (Config, State, Mode, Api, Events) plus the
 * structural dependency types the API resolves via `ctx.require` at call time (the `platform`
 * precedent — no dependency API is captured on state).
 */
import type { cameraPlugin } from "../camera";
import type { commandsPlugin } from "../commands";
import type { RestoreEntity, RestoreSource } from "../commands/types";
import type { loopPlugin } from "../loop";
import type { TimeStepResult } from "../loop/types";
import type { schedulerPlugin } from "../scheduler";
import type { Stage } from "../scheduler/types";
import type { serializationPlugin } from "../serialization";
import type { SceneDocument } from "../serialization/types";
import type { tweenPlugin } from "../tween";
import type { vfxPlugin } from "../vfx";

/** The two editor modes. */
export type Mode = "edit" | "play";

/**
 * editor-runtime plugin configuration.
 */
export type Config = {
  /**
   * Stages the scheduler runs in author (edit) mode. Gameplay `update`/`physics` are gated OFF;
   * `input`/`sync`/`render` stay ON so the viewport keeps rendering and editor input keeps flowing.
   * `enterPlay()` un-gates to ALL stages via the `undefined` sentinel; `enterEdit()`/`stop()` return here.
   *
   * @default ["input", "sync", "render"]
   */
  editStages: readonly Stage[];
};

/**
 * editor-runtime plugin state — the mode FSM, the pre-play snapshot, and the started guard.
 */
export type State = {
  /** Current mode. Seeded `"edit"` by createState; onStart applies the matching stage gate. */
  mode: Mode;
  /**
   * The scene captured at `enterPlay()` (the authoring baseline). `stop()` restores it and clears
   * it back to `undefined`; it is `undefined` whenever the plugin is not in play mode.
   */
  preplaySnapshot: SceneDocument | undefined;
  /** Set true in onStart (deps ready, initial gate applied). Pre-start API calls are guarded no-ops. */
  started: boolean;
};

/** Public API surface (`app["editor-runtime"]`). */
export type Api = {
  /** Enter author mode: gate the scheduler to `config.editStages`. Idempotent in edit mode. Emits `editor-runtime:modeChanged` only on an actual flip. */
  enterEdit(): void;
  /** Enter play mode: snapshot the scene, un-gate to ALL stages, start the loop. Idempotent if already playing. */
  enterPlay(): void;
  /** Exit play mode: restore the pre-play snapshot, `reset()` the tween/vfx/camera runtime, re-gate to `config.editStages`. No-op (warn) when not playing. */
  stop(): void;
  /** Advance exactly one fixed step + render (delegates to `loop.step()`), honouring the currently active stages. */
  step(): TimeStepResult;
  /** The current mode. */
  mode(): Mode;
  /** True while in play mode (`mode() === "play"`). */
  isPlaying(): boolean;
};

/**
 * editor-runtime plugin events (plugin-level, declared via `register.map<Events>`).
 */
export type Events = {
  /** Fired after an edit↔play flip — a coarse, user-gesture-frequency milestone. */
  "editor-runtime:modeChanged": { mode: Mode };
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural dependency types (obtained via ctx.require — no internal imports)
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of the `loop` API editor-runtime calls: start the frame loop, single-step it. */
export type LoopDep = {
  /** Start the rAF loop (no-op if already running). Called by `enterPlay`. */
  start(): void;
  /** Advance exactly one fixed step + render, returning the just-advanced clock. Called by `step`. */
  step(): TimeStepResult;
};

/** The subset of the `scheduler` API editor-runtime calls: gate which stages `tick` runs. */
export type SchedulerDep = {
  /** Gate active stages (`undefined` = all). `enterEdit`/`stop` pass `config.editStages`; `enterPlay` passes `undefined`. */
  setActiveStages(stages: readonly Stage[] | undefined): void;
};

/** The subset of the `serialization` API editor-runtime calls: capture the pre-play snapshot. */
export type SerializationDep = {
  /** Capture the live editor-owned ECS world as a versioned `SceneDocument`. Called by `enterPlay`. */
  serialize(): SceneDocument;
};

/** The subset of the `commands` API editor-runtime calls: the non-undoable exit-play reseed. */
export type CommandsDep = {
  /** Non-undoable bulk reseed from the pre-play snapshot's entities. Called by `stop`. */
  restore(entities: readonly RestoreEntity[], source: RestoreSource): void;
};

/**
 * The subset of the `tween` / `vfx` / `camera` APIs editor-runtime calls — just `reset()`, the
 * ghost-state sweep each MVP target implements (see `## reset() Retrofit Convention`).
 */
export type ResettableDep = {
  /** Clear this plugin's transient runtime state (the editor exit-play reset). Called by `stop`. */
  reset(): void;
};

/**
 * The `require` surface editor-runtime's context exposes: a single overloaded function mapping
 * each dependency plugin instance to its structural API subset (the `platform` precedent — no
 * dependency API is captured on state; every transition resolves what it needs at call time).
 */
export type EditorRuntimeRequire = ((plugin: typeof loopPlugin) => LoopDep) &
  ((plugin: typeof schedulerPlugin) => SchedulerDep) &
  ((plugin: typeof serializationPlugin) => SerializationDep) &
  ((plugin: typeof commandsPlugin) => CommandsDep) &
  ((plugin: typeof tweenPlugin) => ResettableDep) &
  ((plugin: typeof vfxPlugin) => ResettableDep) &
  ((plugin: typeof cameraPlugin) => ResettableDep);

/** Logger surface injected by the common logPlugin (`ctx.log`). */
export type Log = {
  /** Log at debug level. */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning. */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};
