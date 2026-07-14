/**
 * @file editor-runtime plugin — API factory (the `app["editor-runtime"]` surface).
 *
 * The edit/play mode FSM. `enterEdit()` gates the scheduler to `config.editStages`;
 * `enterPlay()` snapshots the scene, un-gates to ALL stages (`setActiveStages(undefined)`), and
 * starts the loop; `stop()` restores the pre-play snapshot (`commands.restore`, non-undoable)
 * then sweeps ghost state via `tween.reset()` / `vfx.reset()` / `camera.reset()` (the `##
 * reset() Retrofit Convention`), then re-gates to author mode; `step()` delegates one fixed step
 * to `loop.step()`. Every dependency is resolved via `ctx.require(plugin)` at call time — no API
 * is captured on state (the `platform` precedent). All four mutators/stepper are guarded no-ops
 * before start; the pure readers (`mode`/`isPlaying`) read `state` directly, unguarded.
 */
import { cameraPlugin } from "../camera";
import { commandsPlugin } from "../commands";
import { loopPlugin } from "../loop";
import type { TimeStepResult } from "../loop/types";
import { schedulerPlugin } from "../scheduler";
import { serializationPlugin } from "../serialization";
import { tweenPlugin } from "../tween";
import { vfxPlugin } from "../vfx";
import type { Api, Config, EditorRuntimeRequire, Events, Log, Mode, State } from "./types";

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal mock
 * without wiring the full kernel. Mirrors the `platform` pattern — every dependency is resolved
 * via `require` at call time, so no captured API reference lives on `state`.
 */
export type EditorRuntimeApiContext = {
  /** Resolved editor-runtime configuration (the author-mode `editStages` gate). */
  readonly config: Readonly<Config>;
  /** editor-runtime plugin state — the mode FSM, the pre-play snapshot, and the started guard. */
  readonly state: State;
  /** Logger from logPlugin (before-start / outside-play-mode no-op notices). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance (loop/scheduler/serialization/commands/tween/vfx/camera). */
  require: EditorRuntimeRequire;
  /**
   * Emit a declared editor-runtime event with its typed payload. Written as a method signature
   * (bivariant params) so the kernel's merged `ctx.emit` is assignable to this narrower view when
   * the API factory is wired via `api: ctx => createApi(ctx)`.
   *
   * @param event - The editor-runtime event name.
   * @param payload - The event payload, matching the declared shape.
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

/** The zeroed clock `step()` returns on a before-start no-op call (mirrors `loop.step`). */
const ZERO_STEP: TimeStepResult = { frame: 0, elapsed: 0, dt: 0 };

/**
 * Creates the editor-runtime plugin API surface.
 *
 * @param ctx - Plugin context (structural — only the fields this API uses).
 * @param ctx.config - Resolved editor-runtime configuration.
 * @param ctx.state - The mode FSM state (mode, pre-play snapshot, started guard).
 * @param ctx.log - Logger from logPlugin.
 * @param ctx.require - Kernel function to obtain the seven dependency APIs at call time.
 * @param ctx.emit - Typed emit for the `editor-runtime:modeChanged` event.
 * @returns The editor-runtime plugin {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.enterPlay(); // snapshot taken; all stages run; loop running
 * api.stop(); // world rewound; no ghost tween/vfx/camera runtime remains
 * ```
 */
export const createApi = (ctx: EditorRuntimeApiContext): Api => {
  /**
   * Guard a mutating method / `step()` against the before-start condition.
   *
   * @param method - The method name, for the warning message.
   * @returns `true` when the call should no-op (not started), else `false`.
   * @example
   * ```ts
   * if (guardStarted("enterEdit()")) return;
   * ```
   */
  const guardStarted = (method: string): boolean => {
    if (ctx.state.started) return false;
    ctx.log.warn(`[editor-runtime] ${method} called before start — no-op.`);
    return true;
  };

  return {
    /**
     * Enter author (edit) mode: gate the scheduler to `config.editStages` (gameplay update/physics
     * OFF, viewport live). Idempotent in edit mode. Emits `editor-runtime:modeChanged` only on an
     * actual flip. No-op (warn) before start.
     *
     * @example
     * ```ts
     * app["editor-runtime"].enterEdit();
     * ```
     */
    enterEdit(): void {
      if (guardStarted("enterEdit()")) return;

      ctx.require(schedulerPlugin).setActiveStages(ctx.config.editStages);
      if (ctx.state.mode !== "edit") {
        ctx.state.mode = "edit";
        ctx.emit("editor-runtime:modeChanged", { mode: "edit" });
      }
    },

    /**
     * Enter play mode: snapshot the scene (`serialization.serialize()`), un-gate to ALL stages
     * (`setActiveStages(undefined)`), and start the loop. Idempotent if already playing (warn).
     * Emits `editor-runtime:modeChanged { mode: "play" }`. No-op (warn) before start.
     *
     * @example
     * ```ts
     * app["editor-runtime"].enterPlay();
     * ```
     */
    enterPlay(): void {
      if (guardStarted("enterPlay()")) return;
      if (ctx.state.mode === "play") {
        ctx.log.warn("[editor-runtime] enterPlay() called while already playing — no-op.");
        return;
      }

      ctx.state.preplaySnapshot = ctx.require(serializationPlugin).serialize();
      ctx.require(schedulerPlugin).setActiveStages(undefined);
      ctx.require(loopPlugin).start();
      ctx.state.mode = "play";
      ctx.emit("editor-runtime:modeChanged", { mode: "play" });
    },

    /**
     * Exit play mode: restore the pre-play snapshot (`commands.restore`, non-undoable → history
     * clears via `commands:restored`), then `reset()` the tween/vfx/camera runtime IN ORDER, then
     * re-gate to `config.editStages`. No-op (warn) when not currently playing.
     * Emits `editor-runtime:modeChanged { mode: "edit" }`.
     *
     * @example
     * ```ts
     * app["editor-runtime"].stop();
     * ```
     */
    stop(): void {
      if (guardStarted("stop()")) return;
      if (ctx.state.mode !== "play") {
        ctx.log.warn("[editor-runtime] stop() called outside play mode — no-op.");
        return;
      }

      const snapshot = ctx.state.preplaySnapshot;
      if (!snapshot) return;

      ctx.require(commandsPlugin).restore(snapshot.entities, "exit-play");
      ctx.require(tweenPlugin).reset();
      ctx.require(vfxPlugin).reset();
      ctx.require(cameraPlugin).reset();
      ctx.require(schedulerPlugin).setActiveStages(ctx.config.editStages);
      ctx.state.preplaySnapshot = undefined;
      ctx.state.mode = "edit";
      ctx.emit("editor-runtime:modeChanged", { mode: "edit" });
    },

    /**
     * Advance exactly one fixed step + render (delegates to `loop.step()`), honouring the currently
     * active stages. Returns the just-advanced frame clock; a zeroed `{ frame, elapsed, dt }` before
     * start.
     *
     * @returns The just-advanced `TimeStepResult`.
     * @example
     * ```ts
     * const t = app["editor-runtime"].step();
     * ```
     */
    step(): TimeStepResult {
      if (guardStarted("step()")) return { ...ZERO_STEP };
      return ctx.require(loopPlugin).step();
    },

    /**
     * The current mode (`"edit"` | `"play"`). Works before start (reads seeded state).
     *
     * @returns The current mode.
     * @example
     * ```ts
     * app["editor-runtime"].mode(); // "edit"
     * ```
     */
    mode(): Mode {
      return ctx.state.mode;
    },

    /**
     * Whether the runtime is in play mode.
     *
     * @returns `true` while `mode() === "play"`.
     * @example
     * ```ts
     * app["editor-runtime"].isPlaying(); // false in edit mode
     * ```
     */
    isPlaying(): boolean {
      return ctx.state.mode === "play";
    }
  };
};
