/**
 * @file commands plugin — setValidator() unit tests.
 *
 * `setValidator` is the reflection-decoupling seam: `commands` defines the
 * `FieldValidator` shape itself and never imports `reflection`; a plugin that
 * HAS reflection wires `commands.setValidator(reflection.validate)`. Here we
 * wire a fake validator to prove the seam fires, and clear it back to
 * structural-only.
 */
import { describe, expect, it, vi } from "vitest";
import type { CommandsApiContext } from "../../api";
import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config, FieldValidator, ValidationResult } from "../../types";
import { makeLog, makeMockWorld } from "../mock-world";

const defaultConfig: Config = { maxIdWarn: 100_000 };

/** A fake validator that rejects every value — used to prove the seam fires, then is cleared. */
const rejectEverything: FieldValidator = (): ValidationResult => ({
  ok: false,
  errors: [{ key: "x", message: "always rejected" }]
});

/** Build a fresh commands api + ctx wired to a fake world seeded with named components. */
const makeApi = (components: readonly string[] = ["Position"]) => {
  const config = { ...defaultConfig };
  const state = createState({ global: {}, config });
  const { world } = makeMockWorld(components);
  const ctx: CommandsApiContext = {
    config,
    state,
    log: makeLog(),
    require: vi.fn(() => world),
    emit: vi.fn()
  };
  return { api: createApi(ctx), ctx, world };
};

describe("commands api — setValidator", () => {
  it("setValidator(fn) makes the rich branch fire", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");

    const validate: FieldValidator = vi.fn(
      (): ValidationResult => ({
        ok: false,
        errors: [{ key: "x", message: "rejected by fake validator" }]
      })
    );
    api.setValidator(validate);

    const result = api.applyRaw({
      kind: "setField",
      id: spawned.id,
      component: "Position",
      field: "x",
      value: 1
    });

    expect(validate).toHaveBeenCalledWith("Position", { x: 1 });
    expect(result).toEqual({ ok: false, error: "rejected by fake validator" });
  });

  it("setValidator(undefined) clears it back to structural-only", () => {
    const { api } = makeApi(["Position"]);
    const spawned = api.applyRaw({ kind: "spawn", components: { Position: { x: 0, y: 0 } } });
    if (!spawned.ok) throw new Error("setup spawn failed");

    api.setValidator(rejectEverything);
    api.setValidator(undefined);

    const result = api.applyRaw({
      kind: "setField",
      id: spawned.id,
      component: "Position",
      field: "x",
      value: 1
    });

    expect(result.ok).toBe(true);
  });
});
