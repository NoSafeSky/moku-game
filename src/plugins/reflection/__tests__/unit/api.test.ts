import { describe, expect, it, vi } from "vitest";

import type { World } from "../../../ecs/types";
import type { ReflectionApiContext } from "../../api";
import { createApi } from "../../api";
import { field } from "../../field";
import type { State } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

/** A component-name-agnostic stand-in for a real `Component<T>` token — reflection never reads it. */
const anyToken = {} as unknown as ReturnType<World["componentByName"]>;

/**
 * Build a minimal World double exposing only the introspection methods reflection uses.
 *
 * @param overrides - Partial overrides for componentByName/liveEntities/componentsOf.
 * @returns A partial World mock.
 */
const makeWorldMock = (
  overrides: Partial<Pick<World, "componentByName" | "liveEntities" | "componentsOf">> = {}
): Pick<World, "componentByName" | "liveEntities" | "componentsOf"> => ({
  componentByName: vi.fn(() => undefined),
  liveEntities: vi.fn(() => []),
  componentsOf: vi.fn(() => []),
  ...overrides
});

/**
 * Build a fresh reflection State (empty schemas + inferred maps).
 *
 * @returns A fresh reflection State.
 */
const createMockState = (): State => ({ schemas: new Map(), inferred: new Map() });

/**
 * Build a ReflectionApiContext for unit tests.
 *
 * @param overrides - Partial overrides for config, state, log, and require.
 * @returns A typed mock ReflectionApiContext.
 */
const createMockCtx = (overrides: Partial<ReflectionApiContext> = {}): ReflectionApiContext => {
  const world = makeWorldMock();
  return {
    config: { humanizeLabels: true },
    state: createMockState(),
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    require: vi.fn(() => world as unknown as World),
    ...overrides
  };
};

// ─── describe: infer + cache ───────────────────────────────────

describe("createApi — describe (infer path)", () => {
  it("infers descriptors from a live value found via liveEntities/componentsOf", () => {
    const world = makeWorldMock({
      componentByName: vi.fn(() => anyToken),
      liveEntities: vi.fn(() => [1] as unknown as ReturnType<World["liveEntities"]>),
      componentsOf: vi.fn(() => [{ name: "Enemy", value: { hp: 100 } }])
    });
    const ctx = createMockCtx({ require: vi.fn(() => world as unknown as World) });
    const api = createApi(ctx);

    const descriptors = api.describe("Enemy");

    expect(descriptors).toStrictEqual([{ kind: "number", key: "hp", label: "Hp" }]);
  });

  it("caches the inferred result — a second describe() does not re-scan componentsOf", () => {
    const world = makeWorldMock({
      componentByName: vi.fn(() => anyToken),
      liveEntities: vi.fn(() => [1] as unknown as ReturnType<World["liveEntities"]>),
      componentsOf: vi.fn(() => [{ name: "Enemy", value: { hp: 100 } }])
    });
    const ctx = createMockCtx({ require: vi.fn(() => world as unknown as World) });
    const api = createApi(ctx);

    api.describe("Enemy");
    api.describe("Enemy");

    expect(world.componentsOf).toHaveBeenCalledOnce();
  });

  it("describe of an anonymous/unknown component returns [] and logs a warning", () => {
    const warn = vi.fn();
    const world = makeWorldMock({ componentByName: vi.fn(() => undefined) });
    const ctx = createMockCtx({
      require: vi.fn(() => world as unknown as World),
      log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }
    });
    const api = createApi(ctx);

    expect(api.describe("Ghost")).toStrictEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("describe of a named component with no live instance returns [] and does not cache", () => {
    const world = makeWorldMock({
      componentByName: vi.fn(() => anyToken),
      liveEntities: vi.fn(() => [])
    });
    const ctx = createMockCtx({ require: vi.fn(() => world as unknown as World) });
    const api = createApi(ctx);

    expect(api.describe("Enemy")).toStrictEqual([]);
    expect(api.describe("Enemy")).toStrictEqual([]);
    expect(ctx.state.inferred.has("Enemy")).toBe(false);
    expect(world.componentByName).toHaveBeenCalledTimes(2);
  });
});

// ─── register: overrides inference ─────────────────────────────

describe("createApi — register", () => {
  it("register(name, schema) then describe(name) returns the registered descriptors", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    api.register("Enemy", { hp: field.number({ min: 0, max: 100 }) });

    expect(api.describe("Enemy")).toStrictEqual([
      { kind: "number", key: "hp", label: "Hp", min: 0, max: 100 }
    ]);
  });

  it("a registered schema overrides a previously inferred result", () => {
    const world = makeWorldMock({
      componentByName: vi.fn(() => anyToken),
      liveEntities: vi.fn(() => [1] as unknown as ReturnType<World["liveEntities"]>),
      componentsOf: vi.fn(() => [{ name: "Enemy", value: { hp: 100 } }])
    });
    const ctx = createMockCtx({ require: vi.fn(() => world as unknown as World) });
    const api = createApi(ctx);

    const inferred = api.describe("Enemy");
    expect(inferred).toStrictEqual([{ kind: "number", key: "hp", label: "Hp" }]);

    api.register("Enemy", { hp: field.number({ min: 0, max: 10 }) });

    expect(api.describe("Enemy")).toStrictEqual([
      { kind: "number", key: "hp", label: "Hp", min: 0, max: 10 }
    ]);
  });

  it("register clears the matching inferred cache entry", () => {
    const ctx = createMockCtx();
    ctx.state.inferred.set("Enemy", [{ kind: "number", key: "hp", label: "Hp" }]);
    const api = createApi(ctx);

    api.register("Enemy", { hp: field.number() });

    expect(ctx.state.inferred.has("Enemy")).toBe(false);
  });

  it("humanizes labels from the schema key using config.humanizeLabels", () => {
    const ctx = createMockCtx({ config: { humanizeLabels: false } });
    const api = createApi(ctx);

    api.register("Enemy", { hitPoints: field.number() });

    expect(api.describe("Enemy")).toStrictEqual([
      { kind: "number", key: "hitPoints", label: "hitPoints" }
    ]);
  });
});

// ─── validate: delegates to describe + validateAgainst ─────────

describe("createApi — validate", () => {
  it("delegates to describe() + validateAgainst — rejects an out-of-range registered field", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    api.register("Enemy", { hp: field.number({ min: 0, max: 100 }) });

    expect(api.validate("Enemy", { hp: 150 })).toStrictEqual({
      ok: false,
      errors: [{ key: "hp", message: "above maximum 100" }]
    });
  });

  it("accepts a valid registered field value", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);
    api.register("Enemy", { hp: field.number({ min: 0, max: 100 }) });

    expect(api.validate("Enemy", { hp: 50 })).toStrictEqual({ ok: true });
  });

  it("is permissive (ok:true) when describe() yields no descriptors", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expect(api.validate("Ghost", { anything: 1 })).toStrictEqual({ ok: true });
  });
});

// ─── field: shared const ───────────────────────────────────────

describe("createApi — field", () => {
  it("api.field is the same const as the standalone field export", () => {
    const ctx = createMockCtx();
    const api = createApi(ctx);

    expect(api.field).toBe(field);
  });
});
