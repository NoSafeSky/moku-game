/**
 * @file editor-runtime plugin — public type surface (Config, State, Mode, Api, Events).
 */
import type { TimeStepResult } from "../loop/types";
import type { Stage } from "../scheduler/types";
import type { SceneDocument } from "../serialization/types";

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
