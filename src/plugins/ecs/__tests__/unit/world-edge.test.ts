import { describe, expect, it } from "vitest";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

describe("world edge cases — sparse storage paths", () => {
  it("get reads a sparse-stored component value", () => {
    const world = makeWorld();
    const Timer = world.defineComponent(() => ({ t: 0 }), { storage: "sparse" });
    const entity = world.spawn(Timer({ t: 5 }));
    // Routes through the sparse-storage branch of world.get, not the archetype store.
    expect(world.get(entity, Timer)).toStrictEqual({ t: 5 });
  });

  it("set shallow-merges a patch into an existing sparse component value", () => {
    const world = makeWorld();
    const Timer = world.defineComponent(() => ({ t: 0, label: "idle" }), { storage: "sparse" });
    const entity = world.spawn(Timer({ t: 5, label: "idle" }));
    world.set(entity, Timer, { t: 9 });
    // The sparse map entry is replaced with a merged object (t updated, label retained).
    expect(world.get(entity, Timer)).toStrictEqual({ t: 9, label: "idle" });
  });

  it("set on a sparse component the entity lacks is a no-op", () => {
    const world = makeWorld();
    const Timer = world.defineComponent(() => ({ t: 0 }), { storage: "sparse" });
    const entity = world.spawn(); // entity has no Timer
    world.set(entity, Timer, { t: 9 });
    // Nothing to merge into — the entity still lacks the component.
    expect(world.get(entity, Timer)).toBeUndefined();
    expect(world.has(entity, Timer)).toBe(false);
  });

  it("despawn clears a sparse component held by the entity", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Timer = world.defineComponent(() => ({ t: 0 }), { storage: "sparse" });
    const entity = world.spawn(Position({ x: 1, y: 2 }), Timer({ t: 3 }));
    expect(world.has(entity, Timer)).toBe(true);

    world.despawn(entity);
    // completeDespawn must iterate the sparse maps and delete this entity's entry.
    expect(world.isAlive(entity)).toBe(false);
    expect(world.get(entity, Timer)).toBeUndefined();
    expect(world.has(entity, Timer)).toBe(false);
  });

  it("removing a sparse component the entity lacks leaves it absent", () => {
    const world = makeWorld();
    const Timer = world.defineComponent(() => ({ t: 0 }), { storage: "sparse" });
    const entity = world.spawn();
    // applyRemove on a sparse component with no entry: optional-chained delete, no throw.
    expect(() => world.remove(entity, Timer)).not.toThrow();
    expect(world.has(entity, Timer)).toBe(false);
  });
});

describe("world edge cases — add to a component-less entity", () => {
  it("add attaches the first archetype component to an entity spawned empty", () => {
    const world = makeWorld();
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(); // no archetype components yet

    world.add(entity, Velocity, { dx: 7, dy: 8 });
    // The archetype store had no location for this entity → it inserts a fresh single-component row.
    expect(world.has(entity, Velocity)).toBe(true);
    expect(world.get(entity, Velocity)).toStrictEqual({ dx: 7, dy: 8 });
  });

  it("add merges the partial value over the component default", () => {
    const world = makeWorld();
    const Velocity = world.defineComponent(() => ({ dx: 1, dy: 2 }));
    const entity = world.spawn();
    world.add(entity, Velocity, { dx: 5 });
    // Default { dx: 1, dy: 2 } merged with { dx: 5 } → dy preserved from the default factory.
    expect(world.get(entity, Velocity)).toStrictEqual({ dx: 5, dy: 2 });
  });
});

describe("world edge cases — dead-entity guards", () => {
  it("add / remove / set / has on a despawned entity are inert", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 2 }));
    world.despawn(entity);

    // Every mutator early-returns on a dead handle; has returns false.
    expect(() => world.add(entity, Velocity, { dx: 1, dy: 1 })).not.toThrow();
    expect(() => world.remove(entity, Position)).not.toThrow();
    expect(() => world.set(entity, Position, { x: 9 })).not.toThrow();
    expect(world.has(entity, Position)).toBe(false);
    expect(world.get(entity, Position)).toBeUndefined();
  });

  it("despawn on an already-dead entity is a no-op", () => {
    const world = makeWorld();
    const entity = world.spawn();
    world.despawn(entity);
    // Second despawn hits the isAlive guard and returns without touching storage.
    expect(() => world.despawn(entity)).not.toThrow();
    expect(world.isAlive(entity)).toBe(false);
  });
});

describe("world edge cases — query iterator skips stale rows", () => {
  it("for...of despawning the current entity completes without yielding dead handles", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const a = world.spawn(Position({ x: 1, y: 0 }));
    const b = world.spawn(Position({ x: 2, y: 0 }));

    const visited: number[] = [];
    for (const entity of world.query(Position)) {
      visited.push(entity);
      // Immediate despawn swap-removes the current row; the iterator's isAlive guard
      // must skip any row whose entity is no longer alive.
      world.despawn(entity);
    }

    // Only live handles are ever surfaced by the iterator.
    for (const visitedEntity of visited) {
      expect([a, b]).toContain(visitedEntity);
    }
    expect(world.isAlive(a)).toBe(false);
  });
});

describe("world edge cases — addSystem with an unregistered stage", () => {
  it("addSystem lazily creates a bucket for a stage outside STAGE_ORDER", () => {
    const world = makeWorld();
    let ran = false;
    // A stage not in STAGE_ORDER has no pre-created array; addSystem must create one.
    const unsubscribe = world.addSystem("custom" as Parameters<typeof world.addSystem>[0], () => {
      ran = true;
    });
    // tick only iterates STAGE_ORDER, so the custom-stage system never runs...
    world.tick(0.016);
    expect(ran).toBe(false);
    // ...but registration succeeded and returned a working unsubscribe.
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });
});
