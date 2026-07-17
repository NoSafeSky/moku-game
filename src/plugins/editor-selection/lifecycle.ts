/**
 * @file editor-selection plugin — onStart lifecycle wiring.
 *
 * `start` runs after `ecs` / `renderer` / `camera` / `input` have started (guaranteed
 * by `depends`) and captures their APIs into state, captures `renderer.getStage()`,
 * builds the screen-space marquee overlay chrome onto that stage when one exists and
 * `config.marquee` is on (hidden until `enable()`), then flips `started` so the API
 * leaves its before-start guard. This is deps-ready wiring — the `camera` / `ui`
 * onStart shape — NOT a per-frame or resource-owning path. It does **not** auto-`enable()`:
 * the plugin starts DISABLED (interactivity off, marquee unwired) so a game not in the
 * editor pays nothing; the editor host calls `enable()` explicitly.
 *
 * There is no `onStop`: the marquee overlay + its Graphics are **renderer-owned** stage
 * children (the renderer disposes the whole subtree on its own `onStop` — the
 * `editor-gizmos` / `ui` / `camera` precedent), the pick layer is likewise renderer-owned,
 * the pick + marquee listeners are removed by `disable()`, and the captured `world` /
 * `renderer` / `camera` / `input` handles are plain references, not owned resources.
 */
import { Container, Graphics } from "pixi.js";
import { cameraPlugin } from "../camera";
import type { Api as CameraApi } from "../camera/types";
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { inputPlugin } from "../input";
import type { Api as InputApi } from "../input/types";
import { rendererPlugin } from "../renderer";
import type { Api as RendererApi } from "../renderer/types";
import type { Config, State } from "./types";

/** Pixi `label` of the marquee overlay Container, so `renderer.tree()` reports it by name. */
const MARQUEE_OVERLAY_LABEL = "editor-selection-marquee";

/**
 * Structural context required by {@link start}. Only the fields onStart accesses, so
 * unit tests can pass a minimal mock without wiring the full kernel.
 */
export type StartContext = {
  /** Resolved editor-selection configuration (`config.marquee` gates the overlay build). */
  readonly config: Readonly<Config>;
  /** editor-selection plugin state (mutated to store the captured dep handles + overlay). */
  readonly state: State;
  /** Require a dependency's API by plugin instance (`ecs` / `renderer` / `camera` / `input`). */
  require: ((plugin: typeof ecsPlugin) => World) &
    ((plugin: typeof rendererPlugin) => RendererApi) &
    ((plugin: typeof cameraPlugin) => CameraApi) &
    ((plugin: typeof inputPlugin) => InputApi);
};

/**
 * Build the screen-space marquee overlay — a dedicated `Container` holding the dashed
 * `Graphics` — and parent it on the renderer stage ABOVE the camera layers, so the
 * rectangle the user drags is screen-fixed and never camera-transformed. Editor chrome:
 * never an ECS entity, never `renderer.attach`ed, so it can never leak into a saved scene
 * or be picked. Starts hidden + non-interactive; `enable()` reveals it.
 *
 * @param state - editor-selection plugin state (receives the overlay + graphics handles).
 * @param stage - The renderer-owned stage the overlay is parented on.
 * @example
 * ```ts
 * buildMarqueeOverlay(ctx.state, stage);
 * ```
 */
const buildMarqueeOverlay = (state: State, stage: Container): void => {
  const overlay = new Container();
  overlay.label = MARQUEE_OVERLAY_LABEL;
  overlay.visible = false; // hidden until enable()
  overlay.eventMode = "none"; // chrome is never hit-tested — it must not shadow the pick layer
  overlay.interactiveChildren = false;

  const graphics = new Graphics();
  overlay.addChild(graphics);
  stage.addChild(overlay);

  state.marqueeOverlay = overlay;
  state.marqueeGraphics = graphics;
};

/**
 * Starts the editor-selection plugin: captures the ecs/renderer/camera/input APIs + the
 * renderer stage into state, builds the marquee overlay chrome when a stage exists and
 * `config.marquee` is on, and flips `started`. Runs identically headless — with no stage
 * the overlay/graphics stay `undefined` and every Pixi-facing API method guards on that.
 * Leaves the plugin DISABLED — the editor host calls `enable()` when it wants the pick
 * layer to become interactive.
 *
 * @param ctx - Structural start context (config + state + require).
 * @example
 * ```ts
 * start(ctx); // after ecs/renderer/camera/input have started
 * ```
 */
export const start = (ctx: StartContext): void => {
  ctx.state.world = ctx.require(ecsPlugin);
  ctx.state.renderer = ctx.require(rendererPlugin);
  ctx.state.camera = ctx.require(cameraPlugin);
  ctx.state.input = ctx.require(inputPlugin);

  const stage = ctx.state.renderer.getStage();
  if (stage) {
    ctx.state.stage = stage;
    if (ctx.config.marquee) buildMarqueeOverlay(ctx.state, stage);
  }

  ctx.state.started = true;
};
