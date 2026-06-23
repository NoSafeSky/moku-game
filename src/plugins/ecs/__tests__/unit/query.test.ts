import { describe, expect, expectTypeOf, it } from "vitest";
import { createWorld } from "../../world";

// ─── helpers ──────────────────────────────────────────────────
const makeWorld = () => createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

describe("query — correctness + arities", () => {
  it("arity-1 query returns matching entities", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    world.spawn(Position({ x: 1, y: 2 }));
    world.spawn(Position({ x: 3, y: 4 }));
    expect(world.query(Position).count()).toBe(2);
  });

  it("arity-2 query only returns entities with both components", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));
    world.spawn(Position({ x: 1, y: 0 }));
    world.spawn(Position({ x: 2, y: 0 }), Velocity({ dx: 1, dy: 0 }));
    expect(world.query(Position, Velocity).count()).toBe(1);
  });

  it("arity-3 query filters correctly", () => {
    const world = makeWorld();
    const A = world.defineComponent(() => ({ a: 0 }));
    const B = world.defineComponent(() => ({ b: 0 }));
    const C = world.defineComponent(() => ({ c: 0 }));
    world.spawn(A({ a: 1 }), B({ b: 2 }), C({ c: 3 }));
    world.spawn(A({ a: 4 }), B({ b: 5 }));
    expect(world.query(A, B, C).count()).toBe(1);
    expect(world.query(A, B).count()).toBe(2);
  });

  it("updateEach yields correct tuples and mutations persist in storage", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 5, y: 10 }));

    world.query(Position).updateEach(([pos]) => {
      pos.x = 99;
    });

    expect(world.get(entity, Position)?.x).toBe(99);
  });

  it("updateEach passes entity as second argument", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));
    const seen: number[] = [];

    world.query(Position).updateEach((_values, ent) => {
      seen.push(ent);
    });

    expect(seen).toContain(entity);
  });

  it("count returns 0 for an empty query", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    expect(world.query(Position).count()).toBe(0);
  });

  it("first returns the entity for a single-entity query", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 1, y: 1 }));
    expect(world.query(Position).first()).toBe(entity);
  });

  it("first returns undefined for an empty query", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    expect(world.query(Position).first()).toBeUndefined();
  });

  it("Symbol.iterator iterates all matching entities", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entities = [
      world.spawn(Position({ x: 1, y: 0 })),
      world.spawn(Position({ x: 2, y: 0 })),
      world.spawn(Position({ x: 3, y: 0 }))
    ];
    const found = [...world.query(Position)];
    expect(found).toHaveLength(3);
    for (const entity of entities) {
      expect(found).toContain(entity);
    }
  });

  it("despawned entities are excluded from query results", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));
    world.despawn(entity);
    expect(world.query(Position).count()).toBe(0);
  });

  it("arity-4 query compiles and runs correctly", () => {
    const world = makeWorld();
    const A = world.defineComponent(() => ({ a: 0 }));
    const B = world.defineComponent(() => ({ b: 0 }));
    const C = world.defineComponent(() => ({ c: 0 }));
    const D = world.defineComponent(() => ({ d: 0 }));
    world.spawn(A({ a: 1 }), B({ b: 2 }), C({ c: 3 }), D({ d: 4 }));
    expect(world.query(A, B, C, D).count()).toBe(1);
  });

  it("arity-5 query compiles and runs correctly", () => {
    const world = makeWorld();
    const A = world.defineComponent(() => ({ a: 0 }));
    const B = world.defineComponent(() => ({ b: 0 }));
    const C = world.defineComponent(() => ({ c: 0 }));
    const D = world.defineComponent(() => ({ d: 0 }));
    const E = world.defineComponent(() => ({ e: 0 }));
    world.spawn(A({ a: 1 }), B({ b: 2 }), C({ c: 3 }), D({ d: 4 }), E({ e: 5 }));
    expect(world.query(A, B, C, D, E).count()).toBe(1);
  });

  it("arity-6 query compiles and runs correctly", () => {
    const world = makeWorld();
    const A = world.defineComponent(() => ({ a: 0 }));
    const B = world.defineComponent(() => ({ b: 0 }));
    const C = world.defineComponent(() => ({ c: 0 }));
    const D = world.defineComponent(() => ({ d: 0 }));
    const E = world.defineComponent(() => ({ e: 0 }));
    const F = world.defineComponent(() => ({ f: 0 }));
    world.spawn(A({ a: 1 }), B({ b: 2 }), C({ c: 3 }), D({ d: 4 }), E({ e: 5 }), F({ f: 6 }));
    expect(world.query(A, B, C, D, E, F).count()).toBe(1);
  });

  it("arity-7 query compiles and runs correctly", () => {
    const world = makeWorld();
    const A = world.defineComponent(() => ({ a: 0 }));
    const B = world.defineComponent(() => ({ b: 0 }));
    const C = world.defineComponent(() => ({ c: 0 }));
    const D = world.defineComponent(() => ({ d: 0 }));
    const E = world.defineComponent(() => ({ e: 0 }));
    const F = world.defineComponent(() => ({ f: 0 }));
    const G = world.defineComponent(() => ({ g: 0 }));
    world.spawn(
      A({ a: 1 }),
      B({ b: 2 }),
      C({ c: 3 }),
      D({ d: 4 }),
      E({ e: 5 }),
      F({ f: 6 }),
      G({ g: 7 })
    );
    expect(world.query(A, B, C, D, E, F, G).count()).toBe(1);
  });

  it("arity-8 query compiles and runs correctly", () => {
    const world = makeWorld();
    const A = world.defineComponent(() => ({ a: 0 }));
    const B = world.defineComponent(() => ({ b: 0 }));
    const C = world.defineComponent(() => ({ c: 0 }));
    const D = world.defineComponent(() => ({ d: 0 }));
    const E = world.defineComponent(() => ({ e: 0 }));
    const F = world.defineComponent(() => ({ f: 0 }));
    const G = world.defineComponent(() => ({ g: 0 }));
    const H = world.defineComponent(() => ({ h: 0 }));
    world.spawn(
      A({ a: 1 }),
      B({ b: 2 }),
      C({ c: 3 }),
      D({ d: 4 }),
      E({ e: 5 }),
      F({ f: 6 }),
      G({ g: 7 }),
      H({ h: 8 })
    );
    expect(world.query(A, B, C, D, E, F, G, H).count()).toBe(1);
  });
});

// ─── type-level tests ─────────────────────────────────────────
describe("query — type-level: tuple inference", () => {
  it("updateEach yields the precise tuple, not any", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const Velocity = world.defineComponent(() => ({ dx: 0, dy: 0 }));

    world.query(Position, Velocity).updateEach(([pos, vel]) => {
      expectTypeOf(pos).toEqualTypeOf<{ x: number; y: number }>();
      expectTypeOf(vel).toEqualTypeOf<{ dx: number; dy: number }>();
    });
  });

  it("Entity is not assignable from raw number", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    const entity = world.spawn(Position({ x: 0, y: 0 }));
    // Entity carries a unique brand — a plain number cannot be used where Entity is expected
    // @ts-expect-error -- a raw number is not assignable to the branded Entity type
    const _entity: typeof entity = 42 as number;
    expect(typeof entity).toBe("number");
    expect(_entity).toBeDefined();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- type-level test, no runtime assertion
  it("spawn requires ComponentInit, not a bare Component token", () => {
    const world = makeWorld();
    const Position = world.defineComponent(() => ({ x: 0, y: 0 }));
    // @ts-expect-error -- spawn(Position) should be an error; must pass Position({...})
    world.spawn(Position);
  });
});
