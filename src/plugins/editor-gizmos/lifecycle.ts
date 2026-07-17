/**
 * @file editor-gizmos plugin — onStart lifecycle wiring.
 *
 * `start` runs after `renderer` / `camera` / `editor-selection` / `commands` have started
 * (guaranteed by `depends`) to (1) capture the four dependency APIs into `state` and seed
 * `state.snap` from `config.snap`, (2) capture `renderer.getStage()` and — when a stage
 * exists — build the overlay `Container` + the four per-mode handle sub-composites
 * (translate square+arrows, rotate ring, scale boxes, rect frame) via {@link buildHandleGroups},
 * `addChild` it onto the stage (appended above the `ui` overlay — chrome on top), wire the
 * drag pipeline for every mode's axis children via `attachInteraction`, register the groups
 * via `registerModeGroups` (so `syncHandle` can show only the active mode's), and leave the
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
import {
  type AxisChild,
  attachInteraction,
  type ModeGroups,
  registerModeGroups
} from "./interaction";
import type { Config, Log, State } from "./types";

/** Half-length of the centre square's side, in screen pixels. */
const SQUARE_HALF = 6;
/** Length of each axis arrow/arm, in screen pixels — shared by translate + scale. */
const ARM_LENGTH = 40;
/** Stroke width for the axis arrows, in screen pixels. */
const ARROW_WIDTH = 2;
/** Fill color for the free-move centre square (yellow — the Blender/Unity convention). */
const SQUARE_COLOR = 0xff_ff_00;
/** Stroke color for the X-axis arrow/box (red — the standard axis-color convention). */
const X_COLOR = 0xff_33_33;
/** Stroke color for the Y-axis arrow/box (green — the standard axis-color convention). */
const Y_COLOR = 0x33_cc_33;
/** Radius of the rotate ring, in screen pixels. */
const RING_RADIUS = 50;
/** Stroke width for the rotate ring. */
const RING_WIDTH = 2;
/** Stroke color for the rotate ring (white — mode-neutral, unlike the axis-colored handles). */
const RING_COLOR = 0xff_ff_ff;
/** Half-length of a scale-handle box's side, in screen pixels. */
const SCALE_BOX_HALF = 5;
/** Fill color for the uniform-scale corner box (yellow, matching the free-move square). */
const UNIFORM_COLOR = 0xff_ff_00;
/** Half-extent of the P1 rect (bounding-box) frame, in screen pixels. */
const RECT_HALF = 40;
/** Stroke width for the rect frame. */
const RECT_WIDTH = 2;
/** Stroke color for the rect frame (cyan — distinct from every other mode's handle). */
const RECT_COLOR = 0x33_cc_ff;

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

/** One built mode sub-composite: its `Container` (visibility already seeded) + its axis children. */
type ModeGroup = { readonly group: Container; readonly axisChildren: AxisChild[] };

/**
 * Build the translate sub-composite: a free-move centre square (axis `"xy"`) plus an X
 * arrow and a Y arrow (axis-locked). Visible by default — `"translate"` is the seeded mode.
 * Pure Pixi construction — no state reads/writes.
 *
 * @returns The translate group + its axis children for interaction wiring.
 * @example
 * ```ts
 * const { group, axisChildren } = buildTranslateGroup();
 * ```
 */
const buildTranslateGroup = (): ModeGroup => {
  const square = new Graphics();
  square
    .rect(-SQUARE_HALF, -SQUARE_HALF, SQUARE_HALF * 2, SQUARE_HALF * 2)
    .fill({ color: SQUARE_COLOR });

  const xArrow = new Graphics();
  xArrow.moveTo(0, 0).lineTo(ARM_LENGTH, 0).stroke({ width: ARROW_WIDTH, color: X_COLOR });

  const yArrow = new Graphics();
  yArrow.moveTo(0, 0).lineTo(0, -ARM_LENGTH).stroke({ width: ARROW_WIDTH, color: Y_COLOR });

  const group = new Container();
  group.label = "translate";
  group.visible = true; // "translate" is the seeded mode
  group.addChild(square, xArrow, yArrow);

  return {
    group,
    axisChildren: [
      { view: square, axis: "xy" },
      { view: xArrow, axis: "x" },
      { view: yArrow, axis: "y" }
    ]
  };
};

/**
 * Build the rotate sub-composite: a single free-rotation ring (axis `"xy"` — rotation has no
 * per-axis lock). Hidden by default (translate is the seeded mode).
 *
 * @returns The rotate group + its one axis child for interaction wiring.
 * @example
 * ```ts
 * const { group, axisChildren } = buildRotateGroup();
 * ```
 */
const buildRotateGroup = (): ModeGroup => {
  const ring = new Graphics();
  ring.circle(0, 0, RING_RADIUS).stroke({ width: RING_WIDTH, color: RING_COLOR });

  const group = new Container();
  group.label = "rotate";
  group.visible = false;
  group.addChild(ring);

  return { group, axisChildren: [{ view: ring, axis: "xy" }] };
};

/**
 * Build one small filled scale-handle box, centered on its own origin (positioned by the
 * caller). Shared by the X/Y/uniform boxes in {@link buildScaleGroup} — module-scoped since
 * it captures nothing from its caller.
 *
 * @param color - The box's fill color.
 * @returns A new, unpositioned scale-handle box.
 * @example
 * ```ts
 * const xBox = scaleBox(X_COLOR);
 * xBox.position.set(ARM_LENGTH, 0);
 * ```
 */
const scaleBox = (color: number): Graphics =>
  new Graphics()
    .rect(-SCALE_BOX_HALF, -SCALE_BOX_HALF, SCALE_BOX_HALF * 2, SCALE_BOX_HALF * 2)
    .fill({ color });

/**
 * Build the scale sub-composite: an X box and a Y box (axis-locked) plus a uniform corner
 * box (axis `"xy"` — scales both). Hidden by default (translate is the seeded mode).
 *
 * @returns The scale group + its three axis children for interaction wiring.
 * @example
 * ```ts
 * const { group, axisChildren } = buildScaleGroup();
 * ```
 */
const buildScaleGroup = (): ModeGroup => {
  const xBox = scaleBox(X_COLOR);
  xBox.position.set(ARM_LENGTH, 0);

  const yBox = scaleBox(Y_COLOR);
  yBox.position.set(0, -ARM_LENGTH);

  const uniformBox = scaleBox(UNIFORM_COLOR);
  uniformBox.position.set(ARM_LENGTH * Math.SQRT1_2, -ARM_LENGTH * Math.SQRT1_2);

  const group = new Container();
  group.label = "scale";
  group.visible = false;
  group.addChild(xBox, yBox, uniformBox);

  return {
    group,
    axisChildren: [
      { view: xBox, axis: "x" },
      { view: yBox, axis: "y" },
      { view: uniformBox, axis: "xy" }
    ]
  };
};

/**
 * Build the rect (P1 bounding-box) sub-composite: a single square frame (axis `"xy"` —
 * uniform scale-on-bounds, per the P1 simplification). Hidden by default.
 *
 * @returns The rect group + its one axis child for interaction wiring.
 * @example
 * ```ts
 * const { group, axisChildren } = buildRectGroup();
 * ```
 */
const buildRectGroup = (): ModeGroup => {
  const frame = new Graphics();
  frame
    .rect(-RECT_HALF, -RECT_HALF, RECT_HALF * 2, RECT_HALF * 2)
    .stroke({ width: RECT_WIDTH, color: RECT_COLOR });

  const group = new Container();
  group.label = "rect";
  group.visible = false;
  group.addChild(frame);

  return { group, axisChildren: [{ view: frame, axis: "xy" }] };
};

/**
 * Build all four per-mode handle sub-composites (translate/rotate/scale/rect), added as the
 * returned `handle` Container's children in that order — the order `syncHandle`'s tests and
 * `registerModeGroups` both key on. Only the seeded `"translate"` group starts visible.
 *
 * @returns The handle `Container` (four sub-composite children added), the {@link ModeGroups}
 *   map for `registerModeGroups`, and the flattened axis children for `attachInteraction`.
 * @example
 * ```ts
 * const { handle, groups, axisChildren } = buildHandleGroups();
 * overlay.addChild(handle);
 * registerModeGroups(ctx.state, groups);
 * attachInteraction(apiCtx, axisChildren);
 * ```
 */
const buildHandleGroups = (): {
  handle: Container;
  groups: ModeGroups;
  axisChildren: AxisChild[];
} => {
  const translate = buildTranslateGroup();
  const rotate = buildRotateGroup();
  const scale = buildScaleGroup();
  const rect = buildRectGroup();

  const handle = new Container();
  handle.addChild(translate.group, rotate.group, scale.group, rect.group);

  return {
    handle,
    groups: {
      translate: translate.group,
      rotate: rotate.group,
      scale: scale.group,
      rect: rect.group
    },
    axisChildren: [
      ...translate.axisChildren,
      ...rotate.axisChildren,
      ...scale.axisChildren,
      ...rect.axisChildren
    ]
  };
};

/**
 * Starts the editor-gizmos plugin: captures the renderer/camera/editor-selection/commands
 * APIs + seeds `snap`, builds the overlay + the four per-mode handle groups on the renderer
 * stage (when one exists), wires the drag pipeline for every mode's axis children, and
 * registers the groups so `syncHandle` can show only the active one, then flips `started`.
 * Runs identically headless — with no stage the overlay/handle stay `undefined` and every
 * Pixi-facing API method guards on that.
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

    const { handle, groups, axisChildren } = buildHandleGroups();
    overlay.addChild(handle);
    stage.addChild(overlay); // above the ui overlay (registration order) — chrome on top

    ctx.state.overlay = overlay;
    ctx.state.handle = handle;

    const apiContext: GizmosApiContext = { config: ctx.config, state: ctx.state, log: ctx.log };
    registerModeGroups(ctx.state, groups);
    attachInteraction(apiContext, axisChildren);
  } else {
    ctx.log.warn("[editor-gizmos] headless — overlay not created");
  }

  ctx.state.started = true;
};
