/**
 * @file commands plugin — apply/applyRaw unit tests.
 *
 * Drives `createApi` against a fake ECS world (see `../mock-world.ts`), covering
 * the structural validation branches, the injected rich-validator branch,
 * inverse generation for every `Command` kind, and `applyRaw`'s no-inverse
 * contract. The real `reflection` plugin is never imported — only a fake
 * `FieldValidator` (sibling decoupling, spec §"structural validation").
 */
import { describe, expect, it, vi } from "vitest";
import type { CommandsApiContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Command, Config, FieldValidator, ValidationResult } from "../../types";
import { asEditorId, makeLog, makeMockWorld } from "../mock-world";

const defaultConfig: Config = { maxIdWarn: 100_000 };

/** Build a fresh commands api + ctx wired to a fake world seeded with named components. */
const makeApi = (components: readonly string[] = ["Position"]) => {
  const config = { ...defaultConfig };
  const state = createState({ global: {}, config });
  const { world, alive, store, tokens } = makeMockWorld(components);
  const log = makeLog();
  const emit = vi.fn();
  const ctx: CommandsApiContext = {
    config,
    state,
    log,
    require: vi.fn(() => world),
    emit
  };
  return { api: createApi(ctx), ctx, world, alive, store, tokens, log, emit };
};

/** Simulate untyped/serialized input reaching apply/applyRaw (bypasses the type checker on purpose). */
const asCommand = (value: unknown): Command => value as Command;

// ─────────────────────────────────────────────────────────────────────────────
// Structural validation
// ─────────────────────────────────────────────────────────────────────────────

describe("commands api — structural validation", () => {
  it("rejects a despawn whose id does not resolve to a live entity (no world write)", () => {
    const { api, world } = makeApi();

    const result = api.applyRaw({ kind: "despawn", id: asEditorId(999) });

    expect(result.ok).toBe(false);
    expect(world.despawn).not.toHaveBeenCalled();
  });

  it("rejects setField naming an unknown component", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");

    const result = api.applyRaw({
      kind: "setField",
      id: spawned.id,
      component: "NoSuchComponent",
      field: "x",
      value: 1
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a setField with a non-string field (untrusted input)", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    vi.clearAllMocks();

    const result = api.applyRaw(
      asCommand({ kind: "setField", id: spawned.id, component: "Position", field: 42, value: 1 })
    );

    expect(result.ok).toBe(false);
    expect(world.set).not.toHaveBeenCalled();
  });

  it("rejects an empty-string field", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");

    const result = api.applyRaw({
      kind: "setField",
      id: spawned.id,
      component: "Position",
      field: "",
      value: 1
    });

    expect(result.ok).toBe(false);
  });

  it("rejects addComponent with a non-object value (no world write)", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: {} });
    if (!spawned.ok) throw new Error("setup spawn failed");
    vi.clearAllMocks();

    const result = api.applyRaw(
      asCommand({
        kind: "addComponent",
        id: spawned.id,
        component: "Position",
        value: "not-an-object"
      })
    );

    expect(result.ok).toBe(false);
    expect(world.add).not.toHaveBeenCalled();
  });

  it("rejects spawn with a non-object component value (no world write)", () => {
    const { api, world } = makeApi(["Position"]);

    const result = api.applyRaw(
      asCommand({ kind: "spawn", components: { Position: "not-an-object" } })
    );

    expect(result.ok).toBe(false);
    expect(world.spawn).not.toHaveBeenCalled();
  });

  it("rejects spawn naming an unknown component (no world write)", () => {
    const { api, world } = makeApi(["Position"]);

    const result = api.applyRaw({ kind: "spawn", components: { NoSuchComponent: { x: 0 } } });

    expect(result.ok).toBe(false);
    expect(world.spawn).not.toHaveBeenCalled();
  });

  it("the happy path applies and calls the right world method", () => {
    const { api, world } = makeApi(["Position"]);

    const result = api.applyRaw({ kind: "spawn", components: { Position: { x: 1, y: 2 } } });

    expect(result.ok).toBe(true);
    expect(world.spawn).toHaveBeenCalledOnce();
    expect(world.add).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Injected rich validator
// ─────────────────────────────────────────────────────────────────────────────

const rejecting: FieldValidator = (): ValidationResult => ({
  ok: false,
  errors: [{ key: "x", message: "x must be finite" }]
});
const accepting: FieldValidator = (): ValidationResult => ({ ok: true });

describe("commands api — injected rich validator", () => {
  it("a rejected setField carries the joined errors and writes nothing", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    api.setValidator(rejecting);
    vi.clearAllMocks();

    const result = api.applyRaw({
      kind: "setField",
      id: spawned.id,
      component: "Position",
      field: "x",
      value: Number.NaN
    });

    expect(result).toEqual({ ok: false, error: "x must be finite" });
    expect(world.set).not.toHaveBeenCalled();
  });

  it("a rejected addComponent carries the joined errors and writes nothing", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: {} });
    if (!spawned.ok) throw new Error("setup spawn failed");
    api.setValidator(rejecting);
    vi.clearAllMocks();

    const result = api.applyRaw({
      kind: "addComponent",
      id: spawned.id,
      component: "Position",
      value: { x: Number.NaN }
    });

    expect(result.ok).toBe(false);
    expect(world.add).not.toHaveBeenCalled();
  });

  it("an accepted value applies through the fake world", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    api.setValidator(accepting);

    const result = api.applyRaw({
      kind: "setField",
      id: spawned.id,
      component: "Position",
      field: "x",
      value: 5
    });

    expect(result.ok).toBe(true);
    expect(world.set).toHaveBeenCalledOnce();
  });

  it("with no validator set, structural validation alone gates the write", () => {
    const { api, world } = makeApi(["Position"]);

    const result = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });

    expect(result.ok).toBe(true);
    expect(world.spawn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inverse generation (apply)
// ─────────────────────────────────────────────────────────────────────────────

describe("commands api — apply inverse generation", () => {
  it("spawn's inverse is a despawn command carrying a numeric EditorId", () => {
    const { api } = makeApi(["Position"]);

    const result = api.apply({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inverse.kind).toBe("despawn");
    if (result.inverse.kind !== "despawn") return;
    expect(typeof result.inverse.id).toBe("number");
  });

  it("spawn's inverse despawn, once applied, makes resolve() return undefined", () => {
    const { api } = makeApi(["Position"]);

    const spawnResult = api.apply({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawnResult.ok) throw new Error("spawn failed");
    if (spawnResult.inverse.kind !== "despawn") throw new Error("expected a despawn inverse");

    const undoResult = api.applyRaw(spawnResult.inverse);

    expect(undoResult.ok).toBe(true);
    if (!undoResult.ok) return;
    expect(api.resolve(undoResult.id)).toBeUndefined();
  });

  it("despawn's inverse is spawn carrying the captured components and the original id", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.apply({ kind: "spawn", components: { Position: { x: 3, y: 4 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    if (spawned.inverse.kind !== "despawn") throw new Error("expected a despawn inverse");
    const id = spawned.inverse.id;

    const despawnResult = api.apply({ kind: "despawn", id });

    expect(despawnResult.ok).toBe(true);
    if (!despawnResult.ok) return;
    expect(despawnResult.inverse.kind).toBe("spawn");
    if (despawnResult.inverse.kind !== "spawn") return;
    expect(despawnResult.inverse.components).toEqual({ Position: { x: 3, y: 4 } });
    expect(despawnResult.inverse.id).toBe(id);

    // Re-applying the inverse re-binds the SAME EditorId to a fresh entity.
    const undo = api.apply(despawnResult.inverse);
    expect(undo.ok).toBe(true);
    expect(world.componentsOf).toHaveBeenCalled();
  });

  it("setField's inverse carries the OLD value read before the write", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.apply({ kind: "spawn", components: { Position: { x: 1, y: 1 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    if (spawned.inverse.kind !== "despawn") throw new Error("expected a despawn inverse");
    const id = spawned.inverse.id;

    const result = api.apply({
      kind: "setField",
      id,
      component: "Position",
      field: "x",
      value: 99
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inverse).toEqual({
      kind: "setField",
      id,
      component: "Position",
      field: "x",
      value: 1
    });

    // Applying the inverse restores the old value.
    const undo = api.apply(result.inverse);
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.inverse).toEqual({
      kind: "setField",
      id,
      component: "Position",
      field: "x",
      value: 99
    });
  });

  it("addComponent's inverse is removeComponent", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.apply({ kind: "spawn", components: {} });
    if (!spawned.ok) throw new Error("setup spawn failed");
    if (spawned.inverse.kind !== "despawn") throw new Error("expected a despawn inverse");
    const id = spawned.inverse.id;

    const result = api.apply({
      kind: "addComponent",
      id,
      component: "Position",
      value: { x: 0, y: 0 }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inverse).toEqual({ kind: "removeComponent", id, component: "Position" });
  });

  it("removeComponent's inverse is addComponent carrying the captured old value", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.apply({ kind: "spawn", components: { Position: { x: 7, y: 8 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    if (spawned.inverse.kind !== "despawn") throw new Error("expected a despawn inverse");
    const id = spawned.inverse.id;

    const result = api.apply({ kind: "removeComponent", id, component: "Position" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inverse).toEqual({
      kind: "addComponent",
      id,
      component: "Position",
      value: { x: 7, y: 8 }
    });
  });

  it("on validation failure, apply returns { ok: false, error } with no inverse", () => {
    const { api } = makeApi(["Position"]);

    const result = api.apply({ kind: "despawn", id: asEditorId(999) });

    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyRaw — the primitive (no inverse)
// ─────────────────────────────────────────────────────────────────────────────

describe("commands api — applyRaw", () => {
  it("applies the same validation + world write as apply, but returns no inverse", () => {
    const { api, world } = makeApi(["Position"]);

    const result = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("inverse");
    if (result.ok) expect(typeof result.id).toBe("number");
    expect(world.spawn).toHaveBeenCalledOnce();
  });

  it("does not read the pre-write value for an inverse (no extra world.get call)", () => {
    const { api, world } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");
    vi.clearAllMocks();

    api.applyRaw({ kind: "setField", id: spawned.id, component: "Position", field: "x", value: 9 });

    expect(world.get).not.toHaveBeenCalled();
  });
});
