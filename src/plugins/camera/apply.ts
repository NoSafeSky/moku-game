/**
 * @file camera plugin — the apply system.
 *
 * A single scheduler system that, each frame, (1) eases the camera centre toward the
 * follow target, (2) computes the current shake offset, and (3) writes each owned
 * layer container's `scale` / `rotation` / `pivot` / `position` so the camera
 * transform lands for that frame. It is pure over `state` + `config` (the `world` /
 * `dt` args are unused — the camera advances via its tweens, which the tween plugin's
 * own system steps by `dt`; this system only APPLIES the current state), so unit
 * tests drive it with a hand-built `State` and assert the written transform; a fixed
 * `random` makes shake deterministic. Because it runs inside `scheduler.tick`, a
 * paused loop freezes camera motion for free.
 *
 * **Headless-safe:** with no stage the numeric follow smoothing still runs, but the
 * per-layer container writes are skipped (there are no layers to draw).
 */
import type { System, World } from "../scheduler/types"; // re-exported from ecs/types
import type { Config, State } from "./types";

/** Dependencies the apply system reads/mutates: camera state, config, and a random source. */
export type ApplyDeps = {
  /** camera plugin state — the layer registry + live transform the system applies each tick. */
  readonly state: State;
  /** Resolved camera configuration (followLerp + reference viewport). */
  readonly config: Readonly<Config>;
  /** Random source in `[0,1)` for the shake offset; defaults to `Math.random` (injectable for deterministic tests). */
  readonly random?: () => number;
};

/**
 * Create the camera apply system.
 *
 * @param deps - The camera state, config, and optional random source.
 * @returns A `System` `(world, dt) => void` for the scheduler.
 * @example
 * ```ts
 * scheduler.addSystem("sync", createApplySystem({ state, config }));
 * ```
 */
export const createApplySystem = (deps: ApplyDeps): System => {
  const random = deps.random ?? Math.random;

  return (_world: World, _dt: number): void => {
    const { state, config } = deps;

    // (1) Follow smoothing — ease the centre toward the live target via the shared lerp.
    if (state.follow && state.tween) {
      state.center.x = state.tween.lerp(state.center.x, state.follow.x, config.followLerp);
      state.center.y = state.tween.lerp(state.center.y, state.follow.y, config.followLerp);
    }

    // (2) Shake offset — one random vector, applied to every layer so they shake together.
    let offsetX = 0;
    let offsetY = 0;
    if (state.shakeIntensity > 0) {
      offsetX = (random() * 2 - 1) * state.shakeIntensity;
      offsetY = (random() * 2 - 1) * state.shakeIntensity;
    }

    // (3) Headless — the numeric state is up to date; there are no containers to write.
    if (!state.stage) return;

    // (4) Apply the transform to each layer. Setting pivot = center*factor and
    //     position = viewport centre maps the layer's local point (center*factor) to
    //     screen centre — so factor 1 centres `center` and factor < 1 scrolls slower.
    const centreX = config.width / 2 + offsetX;
    const centreY = config.height / 2 + offsetY;
    for (const { container, factor } of state.layers.values()) {
      container.scale.set(state.zoom);
      container.rotation = state.rotation;
      container.pivot.set(state.center.x * factor, state.center.y * factor);
      container.position.set(centreX, centreY);
    }
  };
};
