/**
 * @file graphics-2d plugin — onStart lifecycle wiring (skeleton).
 *
 * Deliberately an ORPHAN in the skeleton: `index.ts` does NOT wire `onStart: start` yet. F3 wires
 * it once this function defines the components and registers the render-sync system, so the
 * shipped framework never boots a throw-stub and the existing suite stays green.
 */

/**
 * Starts the graphics-2d plugin (deps-ready wiring): defines the SpriteRenderer + Shape components,
 * registers their reflection schemas + component-registry catalog entries, registers the render-sync
 * system, and injects the assets→renderer texture resolver. Views are renderer-owned scene data, so
 * there is no onStop.
 *
 * @param _ctx - Plugin context (require / state), unused in skeleton.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F3 build wave.
 * @example
 * ```ts
 * start(ctx); // after ecs / renderer / reflection / component-registry / assets have started
 * ```
 */
export function start(_ctx: unknown): void {
  throw new Error("not implemented");
}
