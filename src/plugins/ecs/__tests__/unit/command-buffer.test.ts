import { describe, expect, it } from "vitest";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

describe("command buffer — deferral during iteration", () => {
  it("spawn during updateEach returns a live handle (index reserved immediately)", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    world.spawn(Position({ x: 0, y: 0 }));

    let spawnedEntity: ReturnType<typeof world.spawn> | undefined;

    world.query(Position).updateEach(() => {
      spawnedEntity = world.spawn(Position({ x: 99, y: 99 }));
    });

    expect(spawnedEntity).toBeDefined();
    // After the flush (iteration complete) the entity is alive
    expect(world.isAlive(spawnedEntity!)).toBe(true);
  });

  it("despawn during updateEach is deferred — other iterations complete without corruption", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const a = world.spawn(Position({ x: 1, y: 0 }));
    const b = world.spawn(Position({ x: 2, y: 0 }));
    const c = world.spawn(Position({ x: 3, y: 0 }));

    const seen: number[] = [];
    world.query(Position).updateEach((_values, entity) => {
      if (entity === b) {
        world.despawn(b);
      }
      seen.push(entity);
    });

    // All three were visited (despawn was deferred)
    expect(seen).toHaveLength(3);
    // After iteration, the despawn was flushed
    expect(world.isAlive(a)).toBe(true);
    expect(world.isAlive(b)).toBe(false);
    expect(world.isAlive(c)).toBe(true);
  });

  it("add during updateEach is deferred and applied after iteration", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));

    world.query(Position).updateEach((_values, ent) => {
      world.add(ent, Velocity, { dx: 5, dy: 5 });
    });

    // After iteration, the add should have been applied
    expect(world.has(entity, Velocity)).toBe(true);
    expect(world.get(entity, Velocity)?.dx).toBe(5);
  });

  it("remove during updateEach is deferred and applied after iteration", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }), Velocity({ dx: 1, dy: 0 }));

    world.query(Position, Velocity).updateEach((_values, ent) => {
      world.remove(ent, Velocity);
    });

    expect(world.has(entity, Velocity)).toBe(false);
    expect(world.has(entity, Position)).toBe(true);
  });

  it("ops outside iteration apply immediately (no deferral)", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));

    // Outside any updateEach — immediate
    world.despawn(entity);
    expect(world.isAlive(entity)).toBe(false);
  });

  it("multiple deferred ops in one updateEach all flush after iteration", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Tag = world.defineTag();
    const a = world.spawn(Position({ x: 1, y: 0 }));
    const b = world.spawn(Position({ x: 2, y: 0 }));

    world.query(Position).updateEach((_values, ent) => {
      world.add(ent, Tag);
    });

    // Both entities should now have the tag
    expect(world.has(a, Tag)).toBe(true);
    expect(world.has(b, Tag)).toBe(true);
  });
});

describe("command buffer — world.tick stage-boundary flush", () => {
  it("despawn in update stage is visible to physics stage", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));

    let visibleInPhysics = true;

    world.addSystem("update", w => {
      w.despawn(entity);
    });

    world.addSystem("physics", w => {
      visibleInPhysics = w.isAlive(entity);
    });

    world.tick(0.016);

    // The despawn from update must be flushed before physics runs
    expect(visibleInPhysics).toBe(false);
    expect(world.isAlive(entity)).toBe(false);
  });

  it("spawn in update is visible in physics (handle reserved + inserted)", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    let spawned: ReturnType<typeof world.spawn> | undefined;
    let aliveInPhysics = false;

    world.addSystem("update", w => {
      spawned = w.spawn(Position({ x: 10, y: 0 }));
    });

    world.addSystem("physics", w => {
      if (spawned !== undefined) {
        aliveInPhysics = w.isAlive(spawned);
      }
    });

    world.tick(0.016);
    expect(aliveInPhysics).toBe(true);
  });
});
