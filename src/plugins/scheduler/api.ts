/**
 * @file scheduler plugin — API factory.
 *
 * Thin facade over the ECS world's system registry and tick loop.
 * Validates stage names against the canonical ordered tuple and forwards
 * to `world.addSystem` / `world.tick`.
 */
import { ecsPlugin } from "../ecs";
import type { Api, Config, Stage, State, System, World } from "./types";

/** The canonical ordered execution stages owned by the scheduler. */
const STAGES: readonly Stage[] = ["input", "update", "physics", "sync", "render"] as const;

/**
 * Structural context type required by `createApi`.
 *
 * Uses only the fields the scheduler actually accesses so unit tests can
 * supply a minimal mock without wiring the full kernel.
 */
export type SchedulerContext = {
  /** Resolved scheduler configuration. */
  readonly config: Readonly<Config>;
  /** Scheduler state (empty record). */
  readonly state: State;
  /** Logger injected by logPlugin. */
  readonly log: {
    /** Log at debug level. */
    debug: (message: string) => void;
    /** Log at info level. */
    info: (message: string) => void;
    /** Log a warning. */
    warn: (message: string) => void;
    /** Log an error. */
    error: (message: string) => void;
  };
  /** Require a dependency's API by plugin instance. */
  require: (plugin: typeof ecsPlugin) => World;
};

/**
 * Creates the scheduler plugin API surface.
 *
 * Exposes `stages` (the canonical ordered tuple), `addSystem` (validates the
 * stage name and forwards to the ecs world), and `tick` (forwards to
 * `world.tick`).
 *
 * @param ctx - Plugin context providing `config`, `log`, and `require`.
 * @param ctx.config - Resolved scheduler configuration (reads `strictStages`).
 * @param ctx.state - Scheduler state (empty record, unused at runtime).
 * @param ctx.log - Logger from the common logPlugin.
 * @param ctx.require - Kernel function to obtain the ecs world API.
 * @returns The scheduler API object `{ stages, addSystem, tick }`.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.addSystem("update", (world, dt) => { ... });
 * api.tick(0.016);
 * ```
 */
export const createApi = (ctx: SchedulerContext): Api => {
  /**
   * Obtain the ecs world lazily so the dependency is resolved after init.
   *
   * @returns The ECS World facade.
   * @example
   * ```ts
   * const world = getWorld();
   * world.tick(0.016);
   * ```
   */
  const getWorld = (): World => ctx.require(ecsPlugin);

  /**
   * Determine whether `stage` is one of the canonical scheduler stages.
   *
   * @param stage - The stage string to validate.
   * @returns True when the stage belongs to the canonical tuple.
   * @example
   * ```ts
   * isKnownStage("update"); // true
   * isKnownStage("bogus");  // false
   * ```
   */
  const isKnownStage = (stage: string): stage is Stage =>
    (STAGES as readonly string[]).includes(stage);

  return {
    stages: STAGES,

    /**
     * Register a system to run during the given stage each tick.
     *
     * Validates the stage name. When `strictStages` is `true` and the stage is
     * unknown, throws an error. When `strictStages` is `false`, logs a warning
     * and returns a no-op unsubscribe without forwarding to the world.
     *
     * @param stage - The execution stage to register the system in.
     * @param system - The system function `(world, dt) => void`.
     * @returns An unsubscribe function that removes the system from the stage.
     * @throws {Error} When `strictStages` is true and `stage` is not a known stage.
     * @example
     * ```ts
     * const remove = api.addSystem("update", (world, dt) => {
     *   world.query(Velocity).updateEach(([v]) => { v.x += dt; });
     * });
     * remove(); // deregisters the system
     * ```
     */
    addSystem: (stage: Stage, system: System): (() => void) => {
      if (!isKnownStage(stage)) {
        if (ctx.config.strictStages) {
          throw new Error(
            `[scheduler] Unknown stage "${String(stage)}".\n  Valid stages: ${STAGES.join(", ")}.`
          );
        }
        ctx.log.warn(
          `[scheduler] Unknown stage "${String(stage)}" — system ignored. Valid stages: ${STAGES.join(", ")}.`
        );
        return () => {
          /* unknown stage ignored — no system was registered, so nothing to remove */
        };
      }
      return getWorld().addSystem(stage, system);
    },

    /**
     * Advance the simulation by one frame.
     *
     * Forwards to `world.tick(dt)`, which runs all registered systems in
     * canonical stage order and flushes the ECS command buffer between stages.
     *
     * @param dt - Delta-time in seconds since the last frame.
     * @example
     * ```ts
     * api.tick(1 / 60); // advance by one frame at 60 fps
     * ```
     */
    tick: (dt: number): void => {
      getWorld().tick(dt);
    },

    /**
     * Gate which stages `tick` runs. Forwards to `world.setActiveStages` (the gate is implemented
     * in `ecs`, which owns `world.tick`). `undefined` (the default + sentinel) runs all stages; a
     * gated-off stage is skipped but its command-buffer flush still runs.
     *
     * @param stages - The stages to keep active, or `undefined` to run all stages.
     * @example
     * ```ts
     * app.scheduler.setActiveStages(["input", "sync", "render"]); // edit mode
     * app.scheduler.setActiveStages(undefined);                    // play mode
     * ```
     */
    setActiveStages: (stages: readonly Stage[] | undefined): void => {
      getWorld().setActiveStages(stages);
    },

    /**
     * The stages currently active for `tick`, or `undefined` when all stages run.
     * Forwards to `world.activeStages`.
     *
     * @returns The active-stage list, or `undefined` (all stages / default).
     * @example
     * ```ts
     * app.scheduler.activeStages(); // undefined by default
     * ```
     */
    activeStages: (): readonly Stage[] | undefined => {
      return getWorld().activeStages();
    }
  };
};
