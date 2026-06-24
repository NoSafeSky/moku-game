import { describe, expect, it } from "vitest";
import { createEntityTable } from "../../entity";

describe("entity table — generational handles", () => {
  it("allocates the first entity with index 0, generation 0", () => {
    const table = createEntityTable(1024);
    const entity = table.alloc();
    expect(table.indexOf(entity)).toBe(0);
    expect(table.generationOf(entity)).toBe(0);
  });

  it("isAlive returns true for a live entity", () => {
    const table = createEntityTable(1024);
    const entity = table.alloc();
    expect(table.isAlive(entity)).toBe(true);
  });

  it("isAlive returns false after despawn", () => {
    const table = createEntityTable(1024);
    const entity = table.alloc();
    table.free(entity);
    expect(table.isAlive(entity)).toBe(false);
  });

  it("recycles index after despawn, bumps generation (stale-handle guard)", () => {
    const table = createEntityTable(1024);
    const first = table.alloc();
    table.free(first);
    const second = table.alloc();
    // Recycled index
    expect(table.indexOf(second)).toBe(table.indexOf(first));
    // Generation is bumped
    expect(table.generationOf(second)).toBe(table.generationOf(first) + 1);
    // Original handle is stale
    expect(table.isAlive(first)).toBe(false);
    // New handle is live
    expect(table.isAlive(second)).toBe(true);
  });

  it("allocates multiple entities with unique handles", () => {
    const table = createEntityTable(1024);
    const a = table.alloc();
    const b = table.alloc();
    const c = table.alloc();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(table.isAlive(a)).toBe(true);
    expect(table.isAlive(b)).toBe(true);
    expect(table.isAlive(c)).toBe(true);
  });

  it("isAlive returns false for a never-allocated handle (entity 0 with wrong generation)", () => {
    const table = createEntityTable(1024);
    // Craft a fake entity value that was never issued
    const fakeEntity = 0x00_01_00_00 as ReturnType<typeof table.alloc>;
    expect(table.isAlive(fakeEntity)).toBe(false);
  });

  it("grows the slot arrays when allocating beyond initialCapacity", () => {
    // Capacity 2 → the third allocation must grow generations/alive arrays.
    const table = createEntityTable(2);
    const a = table.alloc();
    const b = table.alloc();
    const c = table.alloc();
    expect(table.indexOf(c)).toBe(2);
    expect(table.isAlive(a)).toBe(true);
    expect(table.isAlive(b)).toBe(true);
    expect(table.isAlive(c)).toBe(true);
  });

  it("free is a no-op on an already-freed slot (generation bumped only once)", () => {
    const table = createEntityTable(4);
    const entity = table.alloc();
    table.free(entity);
    const genAfterFirstFree = table.generationOf(entity);
    // Double-free: the slot is not alive, so free returns early without re-bumping.
    table.free(entity);
    const recycled = table.alloc();
    expect(table.indexOf(recycled)).toBe(table.indexOf(entity));
    // Generation advanced exactly once (the second free did nothing).
    expect(table.generationOf(recycled)).toBe(genAfterFirstFree + 1);
  });

  it("isAlive returns false for an index past the table length", () => {
    const table = createEntityTable(2);
    // Index 50 is far beyond capacity 2 and was never grown into.
    const farEntity = 50 as ReturnType<typeof table.alloc>;
    expect(table.isAlive(farEntity)).toBe(false);
  });
});
