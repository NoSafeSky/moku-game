/**
 * @file editor-gizmos plugin — onStart lifecycle wiring.
 *
 * `start` runs after `renderer` / `camera` / `editor-selection` / `commands` have started
 * (guaranteed by `depends`) to (1) capture the four dependency APIs into `state` and seed
 * `state.snap` from `config.snap`, (2) capture `renderer.getStage()` and — when a stage
 * exists — build the overlay `Container` + the translate handle (a centre square + X/Y
 * arrows) via {@link buildHandle}, `addChild` it onto the stage (appended above the `ui`
 * overlay — chrome on top), wire the drag pipeline via `attachInteraction`, and leave the
 * overlay hidden until `enable()`; when headless (no stage), logs and leaves
 * `overlay`/`handle` `undefined`, and (3) flips `state.started` so the API leaves its
 * before-start guard.
 *
 * This is deps-ready wiring — the `camera`/`ui`/`vfx` onStart shape — NOT a per-frame or
 * resource-owning path. There is no `onStop`: every `Container` built here is parented
 * under the renderer-owned stage, so the renderer's `onStop` disposes the whole subtree;
 * the Pixi pointer listeners live on those same Containers and are GC'd with them.
 */
import { Container, Graphics } from "pixi.js";
import { cameraPlugin } from "../camera";
import type { Api as CameraApi } from "../camera/types";
import { commandsPlugin } from "../commands";
import type { Api as CommandsApi } from "../commands/types";
import { editorSelectionPlugin } from "../editor-selection";
import type { Api as EditorSelectionApi } from "../editor-selection/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import type { GizmosApiContext } from "./api";
import { type AxisChild, attachInteraction } from "./interaction";
import type { Config, Log, State } from "./types";

/** Half-length of the centre square's side, in screen pixels. */
const SQUARE_HALF = 6;
/** Length of each axis arrow, in screen pixels. */
const ARM_LENGTH = 40;
/** Stroke width for the axis arrows, in screen pixels. */
const ARROW_WIDTH = 2;
/** Fill color for the free-move centre square (yellow — the Blender/Unity convention). */
const SQUARE_COLOR = 0xff_ff_00;
/** Stroke color for the X-axis arrow (red — the standard axis-color convention). */
const X_COLOR = 0xff_33_33;
/** Stroke color for the Y-axis arrow (green — the standard axis-color convention). */
const Y_COLOR = 0x33_cc_33;

/**
 * Structural context required by {@link start}. Only the fields `onStart` accesses, so
 * unit tests can pass a minimal mock without wiring the full kernel.
 */
export type StartContext = {
  /** Resolved editor-gizmos configuration (`overlayLayer`, `snap`, `translateOnly`). */
  readonly config: Readonly<Config>;
  /** editor-gizmos plugin state (mutated to store the captured deps + built overlay/handle). */
  readonly state: State;
  /** Logger from the common logPlugin (the headless notice). */
  readonly log: Log;
  /** Require a dependency's API by plugin instance (`renderer`/`camera`/`editor-selection`/`commands`). */
  require: ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof cameraPlugin) => CameraApi) &
    ((plugin: typeof editorSelectionPlugin) => EditorSelectionApi) &
    ((plugin: typeof commandsPlugin) => CommandsApi);
};

/**
 * Build the translate handle composite: a free-move centre square (axis `"xy"`) plus an
 * X arrow and a Y arrow (axis-locked), each wired for `pointerdown` via
 * {@link attachInteraction} by the caller. Pure Pixi construction — no state reads/writes.
 *
 * @returns The handle `Container` (children added) and its axis children for interaction wiring.
 * @example
 * ```ts
 * const { handle, axisChildren } = buildHandle();
 * overlay.addChild(handle);
 * attachInteraction(apiCtx, axisChildren);
 * ```
 */
const buildHandle = (): { handle: Container; axisChildren: AxisChild[] } => {
  const square = new Graphics();
  square
    .rect(-SQUARE_HALF, -SQUARE_HALF, SQUARE_HALF * 2, SQUARE_HALF * 2)
    .fill({ color: SQUARE_COLOR });

  const xArrow = new Graphics();
  xArrow.moveTo(0, 0).lineTo(ARM_LENGTH, 0).stroke({ width: ARROW_WIDTH, color: X_COLOR });

  const yArrow = new Graphics();
  yArrow.moveTo(0, 0).lineTo(0, -ARM_LENGTH).stroke({ width: ARROW_WIDTH, color: Y_COLOR });

  const handle = new Container();
  handle.addChild(square, xArrow, yArrow);

  return {
    handle,
    axisChildren: [
      { view: square, axis: "xy" },
      { view: xArrow, axis: "x" },
      { view: yArrow, axis: "y" }
    ]
  };
};

/**
 * Starts the editor-gizmos plugin: captures the renderer/camera/editor-selection/commands
 * APIs + seeds `snap`, builds the overlay + handle on the renderer stage (when one exists)
 * and wires the drag pipeline, then flips `started`. Runs identically headless — with no
 * stage the overlay/handle stay `undefined` and every Pixi-facing API method guards on that.
 *
 * @param ctx - Structural start context (config + state + log + require).
 * @example
 * ```ts
 * start(ctx); // after renderer/camera/editor-selection/commands have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  ctx.state.renderer = ctx.require(rendererPlugin);
  ctx.state.camera = ctx.require(cameraPlugin);
  ctx.state.selection = ctx.require(editorSelectionPlugin);
  ctx.state.commands = ctx.require(commandsPlugin);
  ctx.state.snap = ctx.config.snap;

  const stage = ctx.state.renderer.getStage();
  if (stage) {
    ctx.state.stage = stage;

    const overlay = new Container();
    overlay.label = ctx.config.overlayLayer;
    overlay.visible = false;
    overlay.interactiveChildren = false;

    const { handle, axisChildren } = buildHandle();
    overlay.addChild(handle);
    stage.addChild(overlay); // above the ui overlay (registration order) — chrome on top

    ctx.state.overlay = overlay;
    ctx.state.handle = handle;

    const apiContext: GizmosApiContext = { config: ctx.config, state: ctx.state, log: ctx.log };
    attachInteraction(apiContext, axisChildren);
  } else {
    ctx.log.warn("[editor-gizmos] headless — overlay not created");
  }

  ctx.state.started = true;
};
