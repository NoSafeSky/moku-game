/**
 * @file editor-gizmos plugin — API factory (the `app["editor-gizmos"]` surface).
 *
 * `createApi` assembles the public control surface: `enable`/`disable` toggle the overlay
 * (guarded no-ops before start or when headless — no renderer stage means no overlay was
 * built), while `setMode`/`setSnap`/`mode`/`setSpace`/`setPivot`/`space`/`pivot`/
 * `setGestureSink` are pure state writers/readers that work before start and headless (they
 * never touch Pixi). The drag pipeline itself
 * (`onHandleDown`/`onGlobalMove`/`onGlobalUp`) lives in `interaction.ts`, which this file
 * delegates to for `enable`'s handle sync and `disable`'s drag-abort — mirroring how
 * `editor-selection`'s `api.ts` delegates to `pick.ts`. No dependency is `require`d at call
 * time: every dependency API (`renderer`/`camera`/`editor-selection`/`commands`) is captured
 * once into `state` by `onStart` (the `camera` captured-deps pattern).
 */
import { abortDrag, syncHandle } from "./interaction";
import type {
  Api,
  Config,
  GestureSink,
  GizmoMode,
  GizmoPivot,
  GizmoSpace,
  Log,
  State
} from "./types";

/**
 * Structural context required by {@link createApi} (and shared with `interaction.ts`), so
 * unit tests can pass a minimal mock without wiring the full kernel. No `require` — every
 * dependency is captured into `state` by `onStart` and read from `state` at call time.
 */
export type GizmosApiContext = {
  /** Resolved editor-gizmos configuration (`overlayLayer`, `snap`, `translateOnly`). */
  readonly config: Readonly<Config>;
  /** editor-gizmos plugin state — overlay/handle chrome, mode/snap, drag, captured deps. */
  readonly state: State;
  /** Logger from the common logPlugin (before-start / headless / MVP-stub warnings). */
  readonly log: Log;
};

/**
 * Creates the editor-gizmos plugin API surface.
 *
 * @param ctx - Plugin context (structural — `config` + `state` + `log`).
 * @returns The editor-gizmos {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.enable();
 * api.setSnap(32);
 * ```
 */
export const createApi = (ctx: GizmosApiContext): Api => {
  /**
   * Before-start guard shared by `enable`/`disable`: warns and returns `false` when
   * `onStart` has not yet run.
   *
   * @param method - The API method name, for the warning message.
   * @returns `true` when the plugin has started, else `false`.
   * @example
   * ```ts
   * if (!requireStarted("enable")) return;
   * ```
   */
  const requireStarted = (method: string): boolean => {
    if (ctx.state.started) return true;
    ctx.log.warn(`[editor-gizmos] ${method}() called before the plugin started — no-op.`);
    return false;
  };

  return {
    /**
     * Show the gizmo overlay and begin responding to selection + pointer drags: makes the
     * overlay visible + interactive and syncs the handle to the current selection.
     * Idempotent — re-calling refreshes the handle position (the MVP's "refresh on selection
     * change" path). No-op (warns) before start or when headless (no renderer stage).
     *
     * @example
     * ```ts
     * app["editor-gizmos"].enable();
     * ```
     */
    enable(): void {
      if (!requireStarted("enable")) return;
      const { overlay } = ctx.state;
      if (!overlay) {
        ctx.log.warn("[editor-gizmos] enable() ignored — no renderer stage (headless).");
        return;
      }
      ctx.state.enabled = true;
      overlay.visible = true;
      overlay.eventMode = "static";
      overlay.interactiveChildren = true;
      syncHandle(ctx);
    },

    /**
     * Hide the overlay and stop responding to pointer input. Aborts any in-flight drag
     * WITHOUT committing (no `commands` write happens before `pointerup`, so an abort leaves
     * the world untouched). Idempotent.
     *
     * @example
     * ```ts
     * app["editor-gizmos"].disable();
     * ```
     */
    disable(): void {
      if (!requireStarted("disable")) return;
      abortDrag(ctx);
      ctx.state.enabled = false;
      const { overlay } = ctx.state;
      if (overlay) {
        overlay.visible = false;
        overlay.interactiveChildren = false;
      }
    },

    /**
     * Set the active manipulation mode. `"rotate"`/`"scale"`/`"rect"` are accepted only when
     * `config.translateOnly` is `false` (the editor app opts in); while it is `true` — the
     * framework default — they warn via `ctx.log` and no-op (`mode()` stays `"translate"`).
     *
     * Re-syncs the handle so switching tools (toolbar / keyboard) immediately shows the new mode's
     * sub-composite (arrows → ring → boxes → frame) at the current selection — otherwise the visible
     * handle would stay on the prior mode until the next selection change or drag. Headless-safe: with
     * no handle built the re-sync is a no-op, so this stays valid before start.
     *
     * @param mode - The manipulation mode to switch to.
     * @example
     * ```ts
     * app["editor-gizmos"].setMode("rotate"); // needs `editor-gizmos: { translateOnly: false }`
     * ```
     */
    setMode(mode: GizmoMode): void {
      if (mode !== "translate" && ctx.config.translateOnly) {
        ctx.log.warn(
          `[editor-gizmos] '${mode}' mode is gated off by config.translateOnly — staying in translate.`
        );
        return;
      }
      ctx.state.mode = mode;
      syncHandle(ctx);
    },

    /**
     * Set the snap increment, clamped to `>= 0` (`0` disables snapping). **Mode-interpreted**:
     * translate → world units, scale → scale-factor increment, rotate → radians. Works before
     * start and headless.
     *
     * @param n - The desired snap increment, in the active mode's units.
     * @example
     * ```ts
     * app["editor-gizmos"].setSnap(32);            // translate: 32 world units
     * app["editor-gizmos"].setSnap(Math.PI / 12);  // rotate: 15° steps
     * ```
     */
    setSnap(n: number): void {
      ctx.state.snap = Math.max(0, n);
    },

    /**
     * The current active manipulation mode.
     *
     * @returns The current {@link GizmoMode}.
     * @example
     * ```ts
     * app["editor-gizmos"].mode(); // "translate"
     * ```
     */
    mode(): GizmoMode {
      return ctx.state.mode;
    },

    /**
     * Set the scale axis frame. Pure interaction state (toolbar-driven, like `setMode`) —
     * works before start and headless, and is NOT gated by `translateOnly`.
     *
     * **P1:** 2D rotation is a single scalar, so the space is a no-op for rotate; for scale,
     * `"global"` (world axes) is exact while `"local"` scale-under-rotation is approximated as
     * world-axis scale (Follow-up F5).
     *
     * @param space - `"global"` (world axes) or `"local"` (the object's own frame).
     * @example
     * ```ts
     * app["editor-gizmos"].setSpace("local");
     * ```
     */
    setSpace(space: GizmoSpace): void {
      ctx.state.space = space;
    },

    /**
     * Set the drag anchor, then re-sync the handle so it immediately re-anchors at the new pivot for
     * the current selection (headless-safe — a no-op with no handle). Toolbar-driven, like `setMode`;
     * NOT gated by `translateOnly`.
     *
     * **P1:** for a single target `"pivot"` and `"center"` coincide whenever the view's local
     * bounds are centred on its origin; they diverge only when the bounds are offset from it.
     *
     * @param pivot - `"pivot"` (the entity's Transform position) or `"center"` (its world-space bounds centre).
     * @example
     * ```ts
     * app["editor-gizmos"].setPivot("center");
     * ```
     */
    setPivot(pivot: GizmoPivot): void {
      ctx.state.pivot = pivot;
      syncHandle(ctx);
    },

    /**
     * The current scale axis frame.
     *
     * @returns The current {@link GizmoSpace}.
     * @example
     * ```ts
     * app["editor-gizmos"].space(); // "global"
     * ```
     */
    space(): GizmoSpace {
      return ctx.state.space;
    },

    /**
     * The current drag anchor.
     *
     * @returns The current {@link GizmoPivot}.
     * @example
     * ```ts
     * app["editor-gizmos"].pivot(); // "pivot"
     * ```
     */
    pivot(): GizmoPivot {
      return ctx.state.pivot;
    },

    /**
     * Inject the editor-history gesture sink (the decoupling seam — wired by
     * `editor-bridge`); pass `undefined` to clear it back to the no-history commit path.
     *
     * @param sink - The gesture sink to inject, or `undefined` to clear.
     * @example
     * ```ts
     * app["editor-gizmos"].setGestureSink(historySink);
     * ```
     */
    setGestureSink(sink: GestureSink | undefined): void {
      ctx.state.gestureSink = sink;
    }
  };
};
