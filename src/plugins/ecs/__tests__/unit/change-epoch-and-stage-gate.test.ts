/**
 * @file ecs plugin — unit tests for the editor-cycle delta:
 *   - `changeEpoch()`: bumped once per data write (structural appliers, `set`, `updateEach`),
 *     monotonically non-decreasing, starts at 0.
 *   - `setActiveStages()` / `activeStages()`: gate which stages `tick` runs; `undefined` = all.
 */
import { describe, expect, it } from "vitest";
import type { Stage } from "../../types";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

/** Register one call-recording system per stage; returns the (mutated) recording array. */
const wireRecorders = (world: ReturnType<typeof makeWorld>): Stage[] => {
  const calls: Stage[] = [];
  const stages: readonly Stage[] = ["input", "update", "physics", "sync", "render"];
  for (const stage of stages) {
    world.addSystem(stage, () => {
      calls.push(stage);
    });
  }
  return calls;
};

// ─────────────────────────────────────────────────────────────────────────────
// changeEpoch
// ─────────────────────────────────────────────────────────────────────────────

describe("changeEpoch — data-write counter", () => {
  it("starts at 0", () => {
    expect(makeWorld().changeEpoch()).toBe(0);
  });

  it("bumps on spawn / add / remove / despawn (structural writes)", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }), { name: "Velocity" });

    const afterSpawnBase = world.changeEpoch();
    const entity = world.spawn(Position({ x: 1, y: 1 }));
    expect(world.changeEpoch()).toBeGreaterThan(afterSpawnBase);

    const beforeAdd = world.changeEpoch();
    world.add(entity, Velocity, { dx: 2 });
    expect(world.changeEpoch()).toBeGreaterThan(beforeAdd);

    const beforeRemove = world.changeEpoch();
    world.remove(entity, Velocity);
    expect(world.changeEpoch()).toBeGreaterThan(beforeRemove);

    const beforeDespawn = world.changeEpoch();
    world.despawn(entity);
    expect(world.changeEpoch()).toBeGreaterThan(beforeDespawn);
  });

  it("bumps on a real set, but not on a set to a component the entity lacks", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }), { name: "Velocity" });
    const entity = world.spawn(Position({ x: 0, y: 0 }));

    const before = world.changeEpoch();
    world.set(entity, Position, { x: 5 });
    expect(world.changeEpoch()).toBe(before + 1);

    // Entity has no Velocity → no write happens → no bump.
    const beforeNoop = world.changeEpoch();
    world.set(entity, Velocity, { dx: 1 });
    expect(world.changeEpoch()).toBe(beforeNoop);
  });

  it("bumps once per updateEach call (the value-mutation path)", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
    world.spawn(Position({ x: 0, y: 0 }));

    const before = world.changeEpoch();
    world.query(Position).updateEach(([p]) => {
      (p as { x: number }).x += 1;
    });
    expect(world.changeEpoch()).toBe(before + 1);
  });

  it("is monotonically non-decreasing across a sequence of writes", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
    let prev = world.changeEpoch();
    for (let i = 0; i < 5; i++) {
      world.spawn(Position({ x: i, y: i }));
      const now = world.changeEpoch();
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setActiveStages / activeStages
// ─────────────────────────────────────────────────────────────────────────────

describe("setActiveStages / activeStages — stage gate", () => {
  it("defaults to undefined (all stages) and runs every stage in order", () => {
    const world = makeWorld();
    expect(world.activeStages()).toBeUndefined();
    const calls = wireRecorders(world);

    world.tick(0.016);
    expect(calls).toEqual(["input", "update", "physics", "sync", "render"]);
  });

  it("gates OFF the stages not in the active set (edit mode)", () => {
    const world = makeWorld();
    const calls = wireRecorders(world);

    world.setActiveStages(["input", "sync", "render"]);
    expect(world.activeStages()).toEqual(["input", "sync", "render"]);

    world.tick(0.016);
    // update + physics are skipped; the rest run in order.
    expect(calls).toEqual(["input", "sync", "render"]);
  });

  it("restores all stages when set back to undefined (play mode)", () => {
    const world = makeWorld();
    const calls = wireRecorders(world);

    world.setActiveStages(["render"]);
    world.tick(0.016);
    expect(calls).toEqual(["render"]);

    calls.length = 0;
    world.setActiveStages(undefined);
    expect(world.activeStages()).toBeUndefined();
    world.tick(0.016);
    expect(calls).toEqual(["input", "update", "physics", "sync", "render"]);
  });

  it("still applies structural ops queued by an active stage while others are gated", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });

    // An active-stage system spawns an entity; the command buffer must still flush.
    world.addSystem("input", w => {
      w.spawn(Position({ x: 1, y: 1 }));
    });
    world.setActiveStages(["input"]); // gate off everything except input

    expect(world.entityCount()).toBe(0);
    world.tick(0.016);
    expect(world.entityCount()).toBe(1);
  });
});
