/**
 * @file vfx plugin — screen-shake stage system.
 *
 * Runs in the `"render"` stage. While trauma is non-zero it offsets the Pixi
 * stage root by `trauma² · shakeMaxOffset` in a random direction (trauma² gives
 * the characteristic non-linear falloff), decays trauma by `shakeDecay · dt`, and
 * snaps the stage back to (0, 0) the frame trauma reaches zero.
 *
 * **Headless-safe:** with no stage (`getStage()` undefined) the offset writes are
 * skipped, but trauma still decays so a headless run behaves identically.
 */
import type { System, World } from "../../ecs/types";
import type { Config, RendererDep, State } from "../types";

/** Dependencies the shake stage system reads/writes. */
export type ShakeSystemDeps = {
  /** Renderer surface — `getStage` carries the shake offset (undefined when headless). */
  readonly renderer: RendererDep;
  /** Resolved config — decay rate + max offset. */
  readonly config: Readonly<Config>;
  /** vfx state — the current trauma scalar. */
  readonly state: State;
  /** Random source in `[0, 1)` (injectable for deterministic tests). */
  readonly random: () => number;
};

/**
 * Create the screen-shake system for the `"render"` stage.
 *
 * @param deps - Renderer, config, state, and rng.
 * @returns A `System` that offsets + decays + resets the stage per trauma.
 * @example
 * ```ts
 * scheduler.addSystem("render", createShakeSystem(deps));
 * ```
 */
export const createShakeSystem = (deps: ShakeSystemDeps): System => {
  return (_world: World, dt: number): void => {
    // At rest — the stage offset was already reset to (0,0) on the frame trauma hit 0.
    if (deps.state.trauma <= 0) return;

    const stage = deps.renderer.getStage();

    // trauma² falloff — a random offset within ±(trauma² · shakeMaxOffset).
    const magnitude = deps.state.trauma * deps.state.trauma * deps.config.shakeMaxOffset;
    if (stage) {
      const offsetX = magnitude * (deps.random() * 2 - 1);
      const offsetY = magnitude * (deps.random() * 2 - 1);
      stage.position.set(offsetX, offsetY);
    }

    deps.state.trauma = Math.max(0, deps.state.trauma - deps.config.shakeDecay * dt);

    // Snap back to rest the frame trauma decays to zero.
    if (deps.state.trauma <= 0 && stage) {
      stage.position.set(0, 0);
    }
  };
};
