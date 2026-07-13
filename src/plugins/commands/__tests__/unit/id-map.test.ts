/**
 * @file commands plugin — EditorId map atomicity + resolve unit tests.
 *
 * Covers: mint/atomic-write, the despawn-non-last-then-resolve regression, the
 * validate-before-resolve recycled-id guard, and the `maxIdWarn` diagnostic.
 */
import { describe, expect, it, vi } from "vitest";
import type { CommandsApiContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config } from "../../types";
import { asEditorId, makeLog, makeMockWorld } from "../mock-world";

const defaultConfig: Config = { maxIdWarn: 100_000 };

/** Build a fresh commands api + ctx wired to a fake world seeded with named components. */
const makeApi = (
  configOverrides?: Partial<Config>,
  components: readonly string[] = ["Position"]
) => {
  const config: Config = { ...defaultConfig, ...configOverrides };
  const state = createState({ global: {}, config });
  const { world, alive } = makeMockWorld(components);
  const log = makeLog();
  const ctx: CommandsApiContext = {
    config,
    state,
    log,
    require: vi.fn(() => world),
    emit: vi.fn()
  };
  return { api: createApi(ctx), ctx, world, alive, log };
};

describe("commands api — mint / atomic write", () => {
  it("each spawn mints a monotonic EditorId and writes both maps", () => {
    const { api } = makeApi();

    const a = api.applyRaw({ kind: "spawn", components: {} });
    const b = api.applyRaw({ kind: "spawn", components: {} });
    const c = api.applyRaw({ kind: "spawn", components: {} });

    expect(a.ok && a.id).toBe(1);
    expect(b.ok && b.id).toBe(2);
    expect(c.ok && c.id).toBe(3);
    expect(api.count()).toBe(3);
  });

  it("resolve / editorIdOf round-trip for a freshly spawned entity", () => {
    const { api } = makeApi();

    const spawned = api.applyRaw({ kind: "spawn", components: {} });
    if (!spawned.ok) throw new Error("spawn failed");

    const entity = api.resolve(spawned.id);
    expect(entity).toBeDefined();
    expect(entity && api.editorIdOf(entity)).toBe(spawned.id);
  });
});

describe("commands api — despawn-non-last-then-resolve regression", () => {
  it("despawning a non-last entity leaves the other ids resolvable and count correct", () => {
    const { api } = makeApi();

    const a = api.applyRaw({ kind: "spawn", components: {} });
    const b = api.applyRaw({ kind: "spawn", components: {} });
    const c = api.applyRaw({ kind: "spawn", components: {} });
    if (!a.ok || !b.ok || !c.ok) throw new Error("setup spawns failed");

    const entityA = api.resolve(a.id);
    const entityC = api.resolve(c.id);

    const despawnResult = api.applyRaw({ kind: "despawn", id: b.id });
    expect(despawnResult.ok).toBe(true);

    expect(api.resolve(a.id)).toBe(entityA);
    expect(api.resolve(c.id)).toBe(entityC);
    expect(api.resolve(b.id)).toBeUndefined();
    expect(api.count()).toBe(2);
  });
});

describe("commands api — validate-before-resolve (recycled-id guard)", () => {
  it("resolve prunes both map entries when the mapped entity is no longer alive", () => {
    const { api, alive } = makeApi();

    const spawned = api.applyRaw({ kind: "spawn", components: {} });
    if (!spawned.ok) throw new Error("spawn failed");
    const entity = api.resolve(spawned.id);
    expect(entity).toBeDefined();
    if (entity === undefined) return;

    // Simulate the world reporting this entity as recycled/dead WITHOUT going
    // through commands.applyRaw({ kind: "despawn" }) — an external liveness change.
    alive.delete(entity);

    expect(api.resolve(spawned.id)).toBeUndefined();
    expect(api.count()).toBe(0); // the stale byEntity entry was pruned too
  });

  it("editorIdOf on a not-alive handle returns undefined", () => {
    const { api, alive } = makeApi();

    const spawned = api.applyRaw({ kind: "spawn", components: {} });
    if (!spawned.ok) throw new Error("spawn failed");
    const entity = api.resolve(spawned.id);
    if (entity === undefined) throw new Error("resolve failed");

    alive.delete(entity);

    expect(api.editorIdOf(entity)).toBeUndefined();
  });

  it("resolve on a never-minted id returns undefined without touching liveness", () => {
    const { api, world } = makeApi();

    expect(api.resolve(asEditorId(12_345))).toBeUndefined();
    expect(world.isAlive).not.toHaveBeenCalled();
  });
});

describe("commands api — maxIdWarn diagnostic", () => {
  it("crossing the threshold logs exactly one warning (warned latches)", () => {
    const { api, log } = makeApi({ maxIdWarn: 2 });

    for (let i = 0; i < 6; i++) api.applyRaw({ kind: "spawn", components: {} });

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("maxIdWarn: 0 never warns, no matter how many entities are minted", () => {
    const { api, log } = makeApi({ maxIdWarn: 0 });

    for (let i = 0; i < 10; i++) api.applyRaw({ kind: "spawn", components: {} });

    expect(log.warn).not.toHaveBeenCalled();
  });
});
