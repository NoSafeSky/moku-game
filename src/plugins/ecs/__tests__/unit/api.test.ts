import { describe, expect, it } from "vitest";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

describe("world API — defineComponent / defineTag", () => {
  it("defineComponent returns a callable token", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    expect(typeof Position).toBe("function");
  });

  it("calling the token returns a ComponentInit with matching value", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const init = Position({ x: 5, y: 10 });
    expect(init).toHaveProperty("component");
    expect(init).toHaveProperty("value");
    expect(init.value).toStrictEqual({ x: 5, y: 10 });
  });

  it("defineTag returns a callable token with empty value", () => {
    const world = makeWorld();
    const Dead = world.defineTag();
    expect(typeof Dead).toBe("function");
    const init = Dead({});
    expect(init).toHaveProperty("component");
  });

  it("defineTag uses sparse storage by default", () => {
    const world = makeWorld();
    const Dead = world.defineTag();
    const entity = world.spawn(Dead({}));
    expect(world.has(entity, Dead)).toBe(true);
  });
});

describe("world API — spawn / despawn / isAlive", () => {
  it("spawn returns a live entity", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    expect(world.isAlive(entity)).toBe(true);
  });

  it("spawn with no components creates a live entity", () => {
    const world = makeWorld();
    const entity = world.spawn();
    expect(world.isAlive(entity)).toBe(true);
  });

  it("despawn makes entity not alive", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));
    world.despawn(entity);
    expect(world.isAlive(entity)).toBe(false);
  });

  it("despawned entity index is recycled (generation bumped)", () => {
    const world = makeWorld();
    const entity1 = world.spawn();
    world.despawn(entity1);
    const entity2 = world.spawn();
    expect(entity2).not.toBe(entity1);
    expect(world.isAlive(entity2)).toBe(true);
    expect(world.isAlive(entity1)).toBe(false);
  });
});

describe("world API — add / remove / has / get / set", () => {
  it("has returns true for a component that was spawned with the entity", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    expect(world.has(entity, Position)).toBe(true);
  });

  it("has returns false for an absent component", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    expect(world.has(entity, Velocity)).toBe(false);
  });

  it("get returns the component value", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 7, y: 8 }));
    expect(world.get(entity, Position)).toStrictEqual({ x: 7, y: 8 });
  });

  it("get returns undefined for an absent component", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    expect(world.get(entity, Velocity)).toBeUndefined();
  });

  it("add attaches a component to an existing entity", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    world.add(entity, Velocity, { dx: 3, dy: 4 });
    expect(world.has(entity, Velocity)).toBe(true);
    expect(world.get(entity, Velocity)?.dx).toBe(3);
  });

  it("remove detaches a component from an entity", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    world.remove(entity, Position);
    expect(world.has(entity, Position)).toBe(false);
  });

  it("set shallow-merges a patch into the component value", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    world.set(entity, Position, { x: 99 });
    expect(world.get(entity, Position)).toStrictEqual({ x: 99, y: 2 });
  });

  it("get returns undefined for a dead entity", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));
    world.despawn(entity);
    expect(world.get(entity, Position)).toBeUndefined();
  });
});

describe("world API — addSystem / tick stage order", () => {
  it("addSystem registers a system and tick calls it", () => {
    const world = makeWorld();
    let called = false;
    world.addSystem("update", () => {
      called = true;
    });
    world.tick(0.016);
    expect(called).toBe(true);
  });

  it("tick passes dt to systems", () => {
    const world = makeWorld();
    let receivedDt = 0;
    world.addSystem("update", (_w, dt) => {
      receivedDt = dt;
    });
    world.tick(0.033);
    expect(receivedDt).toBeCloseTo(0.033);
  });

  it("stages run in fixed order: input, update, physics, sync, render", () => {
    const world = makeWorld();
    const order: string[] = [];
    world.addSystem("render", () => order.push("render"));
    world.addSystem("input", () => order.push("input"));
    world.addSystem("physics", () => order.push("physics"));
    world.addSystem("sync", () => order.push("sync"));
    world.addSystem("update", () => order.push("update"));
    world.tick(0.016);
    expect(order).toStrictEqual(["input", "update", "physics", "sync", "render"]);
  });

  it("addSystem returns an unsubscribe function", () => {
    const world = makeWorld();
    let callCount = 0;
    const unsub = world.addSystem("update", () => {
      callCount++;
    });
    world.tick(0.016);
    unsub();
    world.tick(0.016);
    expect(callCount).toBe(1);
  });
});

describe("world API — storage strategy seam parity", () => {
  it("archetype-stored and sparse-stored components are both queryable", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 })); // archetype
    const Tag = world.defineTag({ storage: "sparse" }); // sparse
    const entity = world.spawn(Position({ x: 5, y: 5 }), Tag({}));
    expect(world.has(entity, Tag)).toBe(true);
    expect(world.get(entity, Position)?.x).toBe(5);
  });

  it("sparse-stored component can be added and removed without affecting archetype", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Timer = world.defineComponent(() => ({ elapsed: 0 }), { storage: "sparse" });
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    world.add(entity, Timer, { elapsed: 0.5 });
    expect(world.has(entity, Timer)).toBe(true);
    world.remove(entity, Timer);
    expect(world.has(entity, Timer)).toBe(false);
    // Position is unaffected
    expect(world.has(entity, Position)).toBe(true);
    expect(world.get(entity, Position)?.x).toBe(1);
  });
});
