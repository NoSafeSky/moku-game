/**
 * @file camera plugin — editor-control math (Phase-1 F2; pure over `state` + `config`, Pixi-free).
 *
 * `focusAt` / `zoomAtScreen` / `panByScreen` back the public `focus` / `zoomAt` / `panBy`
 * API methods AND the editor-control system (`editor-controls.ts`), so the cursor-anchored
 * zoom/pan math has ONE definition and unit tests need no kernel. All three mutate only
 * numeric `state` (`center` / `zoom`) and clear `follow` (an explicit editor gesture
 * overrides continuous follow, mirroring `setPosition` / `moveTo`) — no tween, no
 * container — so they are valid before start and headless.
 */
import { screenDeltaToWorld, screenToWorld } from "./transform";
import type { Config, Point, State } from "./types";

/**
 * Clamp `v` into the inclusive `[lo, hi]` range.
 *
 * @param v - The value to clamp.
 * @param lo - Lower bound.
 * @param hi - Upper bound.
 * @returns `v` constrained to `[lo, hi]`.
 * @example
 * ```ts
 * clamp(50, 0.1, 10); // 10
 * ```
 */
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Frame a world point: snap the camera centre to `target`, optionally clamp+set
 * `zoom`, and clear `follow`.
 *
 * @param state - camera plugin state (mutated).
 * @param config - Resolved camera configuration (zoom clamps).
 * @param target - The world point to centre the camera on.
 * @param zoom - Optional new zoom, clamped to `[minZoom, maxZoom]`.
 * @example
 * ```ts
 * focusAt(state, config, { x: 100, y: 50 }, 2);
 * ```
 */
export const focusAt = (state: State, config: Config, target: Point, zoom?: number): void => {
  state.center.x = target.x;
  state.center.y = target.y;
  if (zoom !== undefined) state.zoom = clamp(zoom, config.minZoom, config.maxZoom);
  state.follow = undefined;
};

/**
 * Cursor-anchored zoom: scale `zoom` by `factor` (clamped to `[minZoom, maxZoom]`)
 * while keeping the world point under `screen` fixed — reads `screenToWorld(screen)`
 * before and after the zoom change and folds the difference into `center` — then
 * clears `follow`.
 *
 * @param state - camera plugin state (mutated).
 * @param config - Resolved camera configuration (zoom clamps + reference viewport).
 * @param screen - The screen-space anchor point (e.g. the pointer position).
 * @param factor - The zoom multiplier (e.g. `Math.exp(-deltaY * sensitivity)`).
 * @example
 * ```ts
 * zoomAtScreen(state, config, { x: 400, y: 300 }, 1.1); // zoom in 10%, anchored at (400,300)
 * ```
 */
export const zoomAtScreen = (state: State, config: Config, screen: Point, factor: number): void => {
  const before = screenToWorld(
    screen,
    state.center,
    state.zoom,
    state.rotation,
    config.width,
    config.height
  );

  state.zoom = clamp(state.zoom * factor, config.minZoom, config.maxZoom);

  const after = screenToWorld(
    screen,
    state.center,
    state.zoom,
    state.rotation,
    config.width,
    config.height
  );

  state.center.x += before.x - after.x;
  state.center.y += before.y - after.y;
  state.follow = undefined;
};

/**
 * Free-pan by a screen-pixel delta: converts it to a world-space delta (rotation-aware,
 * `÷zoom`, via `screenDeltaToWorld`) and subtracts it from `center` (a drag moves the
 * view opposite the pointer), then clears `follow`.
 *
 * @param state - camera plugin state (mutated).
 * @param _config - Unused; kept for signature symmetry with {@link focusAt} /
 *   {@link zoomAtScreen} (the delta conversion only needs `state`'s live `zoom` / `rotation`).
 * @param dxScreen - Horizontal screen-pixel delta.
 * @param dyScreen - Vertical screen-pixel delta.
 * @example
 * ```ts
 * panByScreen(state, config, 10, -5);
 * ```
 */
export const panByScreen = (
  state: State,
  _config: Config,
  dxScreen: number,
  dyScreen: number
): void => {
  const delta = screenDeltaToWorld(dxScreen, dyScreen, state.zoom, state.rotation);
  state.center.x -= delta.x;
  state.center.y -= delta.y;
  state.follow = undefined;
};
