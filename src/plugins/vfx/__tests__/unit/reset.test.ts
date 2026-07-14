/**
 * @file vfx plugin — unit tests for the editor-cycle `reset()` delta.
 *
 * `reset()` despawns every live Emitter/Particle/FloatingText effect entity, zeroes `trauma` and
 * `particleCount`, resets the shake stage offset, and clears the floating-text view handle map —
 * leaving the named component tokens DEFINED on the world.
 */
import type { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { ecsPlugin } from "../../../ecs";
import { createApi, type VfxApiContext } from "../../api";
import { makeLog, makeRenderer, setup } from "../helpers";

/** Build a started vfx api ctx over a real world + recording renderer (optional stage). */
const startedCtx = (stage?: Container) => {
  const s = setup();
  const renderer = makeRenderer(stage, s.state.views);
  const require = ((plugin: unknown) =>
    plugin === ecsPlugin ? s.world : renderer) as unknown as VfxApiContext["require"];
  const ctx: VfxApiContext = { config: s.config, state: s.state, log: makeLog(), require };
  return { api: createApi(ctx), ...s, renderer };
};

describe("vfx — reset()", () => {
  it("despawns emitters, particles, and floating text; zeroes trauma + particleCount", () => {
    const stage = { position: { set: vi.fn() } } as unknown as Container;
    const { api, world, Emitter, Particle, FloatingText, state } = startedCtx(stage);

    // Seed an emitter, a burst of particles, and a floating text, plus some trauma.
    api.createEmitter({ rate: 30, speed: 100, lifetime: 0.5 });
    api.burst(0, 0, { count: 8, speed: 120, lifetime: 0.5 });
    api.floatText(0, 0, "+10");
    api.shake(0.6, 0.3);

    expect(world.query(Emitter).count()).toBeGreaterThan(0);
    expect(world.query(Particle).count()).toBeGreaterThan(0);
    expect(world.query(FloatingText).count()).toBeGreaterThan(0);
    expect(state.trauma).toBeGreaterThan(0);

    api.reset();

    expect(world.query(Emitter).count()).toBe(0);
    expect(world.query(Particle).count()).toBe(0);
    expect(world.query(FloatingText).count()).toBe(0);
    expect(state.trauma).toBe(0);
    expect(state.particleCount).toBe(0);
    expect(state.views.size).toBe(0);
  });

  it("leaves the named component tokens defined on the world", () => {
    const { api, world } = startedCtx();
    api.reset();
    // Tokens still resolvable by name → still defined (only live instances were removed).
    expect(world.componentByName("Emitter")).toBeDefined();
    expect(world.componentByName("Particle")).toBeDefined();
    expect(world.componentByName("FloatingText")).toBeDefined();
  });

  it("is a guarded no-op before start (tokens undefined)", () => {
    const s = setup();
    // Simulate before-start: clear the captured tokens so `resolved()` returns undefined.
    s.state.transform = undefined;
    const require = (() => undefined) as unknown as VfxApiContext["require"];
    const api = createApi({ config: s.config, state: s.state, log: makeLog(), require });
    expect(() => api.reset()).not.toThrow();
  });
});
