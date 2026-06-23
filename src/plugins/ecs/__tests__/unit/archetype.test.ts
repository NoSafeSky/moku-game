import { describe, expect, it } from "vitest";
import { createArchetypeStore } from "../../archetype";
import { createEntityTable } from "../../entity";

describe("archetype store — swap-remove + bookkeeping", () => {
  it("moves an entity into an archetype when components are added", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const entityA = table.alloc();

    store.insert(entityA, [posId], [{ x: 1, y: 2 }]);
    expect(store.has(entityA, posId)).toBe(true);
  });

  it("retrieves the component value after insertion", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const entityA = table.alloc();
    const posValue = { x: 10, y: 20 };

    store.insert(entityA, [posId], [posValue]);
    const retrieved = store.get(entityA, posId);
    expect(retrieved).toBe(posValue);
  });

  it("swap-remove regression: despawn non-last entity; others still readable", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const entityA = table.alloc();
    const entityB = table.alloc();
    const entityC = table.alloc();

    const posA = { x: 1, y: 0 };
    const posB = { x: 2, y: 0 };
    const posC = { x: 3, y: 0 };

    store.insert(entityA, [posId], [posA]);
    store.insert(entityB, [posId], [posB]);
    store.insert(entityC, [posId], [posC]);

    // Despawn B (middle entity — not the last)
    store.remove(entityB);
    table.free(entityB);

    // A and C must still be readable
    expect(store.has(entityA, posId)).toBe(true);
    expect(store.has(entityC, posId)).toBe(true);
    expect(store.get(entityA, posId)).toBe(posA);
    expect(store.get(entityC, posId)).toBe(posC);
    expect(store.has(entityB, posId)).toBe(false);
  });

  it("iterates all entities in an archetype", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const entities = [table.alloc(), table.alloc(), table.alloc()];

    for (const entity of entities) {
      store.insert(entity, [posId], [{ x: 0, y: 0 }]);
    }

    const allEntities = [...store.iterateArchetype([posId])].map(r => r.entity);
    for (const entity of entities) {
      expect(allEntities).toContain(entity);
    }
  });

  it("returns undefined for absent component", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const velId = 1;
    const entity = table.alloc();

    store.insert(entity, [posId], [{ x: 0, y: 0 }]);
    expect(store.get(entity, velId)).toBeUndefined();
  });

  it("supports multi-component archetypes", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const velId = 1;
    const entity = table.alloc();
    const pos = { x: 5, y: 10 };
    const vel = { dx: 1, dy: -1 };

    store.insert(entity, [posId, velId], [pos, vel]);
    expect(store.get(entity, posId)).toBe(pos);
    expect(store.get(entity, velId)).toBe(vel);
  });

  it("allows adding a component to an existing entity (archetype migration)", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const velId = 1;
    const entity = table.alloc();
    const pos = { x: 1, y: 2 };
    const vel = { dx: 3, dy: 4 };

    store.insert(entity, [posId], [pos]);
    store.addComponent(entity, velId, vel);
    expect(store.get(entity, posId)).toStrictEqual(pos);
    expect(store.get(entity, velId)).toBe(vel);
  });

  it("allows removing a single component (archetype migration)", () => {
    const table = createEntityTable(1024);
    const store = createArchetypeStore();

    const posId = 0;
    const velId = 1;
    const entity = table.alloc();
    const pos = { x: 1, y: 2 };
    const vel = { dx: 3, dy: 4 };

    store.insert(entity, [posId, velId], [pos, vel]);
    store.removeComponent(entity, velId);
    expect(store.get(entity, posId)).toStrictEqual(pos);
    expect(store.get(entity, velId)).toBeUndefined();
    expect(store.has(entity, velId)).toBe(false);
  });
});
