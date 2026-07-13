/**
 * @file commands plugin — createState unit tests.
 */
import { describe, expect, it } from "vitest";
import { createState } from "../../state";
import type { Config } from "../../types";
import { asEditorId, asEntity } from "../mock-world";

const defaultConfig: Config = { maxIdWarn: 100_000 };

const makeCtx = (configOverrides?: Partial<Config>) => ({
  global: {},
  config: { ...defaultConfig, ...configOverrides }
});

describe("commands createState", () => {
  it("creates empty byId and byEntity maps", () => {
    const state = createState(makeCtx());

    expect(state.byId).toBeInstanceOf(Map);
    expect(state.byId.size).toBe(0);
    expect(state.byEntity).toBeInstanceOf(Map);
    expect(state.byEntity.size).toBe(0);
  });

  it("starts nextId at 1 (never 0, so a falsy check never masks a valid id)", () => {
    const state = createState(makeCtx());

    expect(state.nextId).toBe(1);
  });

  it("starts with no injected validator", () => {
    const state = createState(makeCtx());

    expect(state.validate).toBeUndefined();
  });

  it("starts with warned false", () => {
    const state = createState(makeCtx());

    expect(state.warned).toBe(false);
  });

  it("initial shape is independent of maxIdWarn (state carries no config-derived field)", () => {
    const state = createState(makeCtx({ maxIdWarn: 0 }));

    expect(state.byId.size).toBe(0);
    expect(state.nextId).toBe(1);
  });

  it("each call returns fresh, independent maps", () => {
    const a = createState(makeCtx());
    const b = createState(makeCtx());

    a.byId.set(asEditorId(1), asEntity(1));

    expect(b.byId.size).toBe(0);
  });
});
