/**
 * @file hierarchy plugin — onStart lifecycle wiring (skeleton).
 *
 * Deliberately an ORPHAN in the skeleton: `index.ts` does NOT wire `onStart: start` yet. F2 wires
 * it once this function defines the Node token and registers the system, so the shipped framework
 * never boots a throw-stub and the existing suite stays green at the skeleton commit.
 */

/**
 * Starts the hierarchy plugin (deps-ready wiring): defines the Node token, self-registers the Node
 * reflection schema, registers the world-transform sync system, and injects the renderer
 * world-transform resolver. Owns no external resource, so there is no onStop.
 *
 * @param _ctx - Plugin context (require / state / config), unused in skeleton.
 * @throws {Error} Always — this is a skeleton stub, implemented by the F2 build wave.
 * @example
 * ```ts
 * start(ctx); // after ecs / renderer / commands / reflection have started
 * ```
 */
export function start(_ctx: unknown): void {
  throw new Error("not implemented");
}
