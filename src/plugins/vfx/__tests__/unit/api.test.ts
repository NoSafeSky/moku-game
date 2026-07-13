/**
 * @file vfx plugin — API surface unit tests.
 *
 * Exercises `app.vfx` via `createApi` with a real ecs world + a recording mock
 * renderer. Covers: guarded no-ops before start; createEmitter (+ MCP-name
 * introspection); configureEmitter / setEmitterEnabled / removeEmitter (incl. the
 * particle sweep); burst (+ cap); shake / stopShake trauma banking; pop (capture,
 * refresh, no-Transform guard); floatText (view attach + headless); easing / lerp.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";

// Pixi is pulled in transitively (renderer module) + by buildText (floatText).
vi.mock("pixi.js", () => ({
  Application: class {},
  Graphics: class {},
  Container: class {},
  Text: class {
    anchor = { set: vi.fn() };
    alpha = 1;
    constructor(public opts: unknown) {}
  }
}));

import type { Container } from "pixi.js";
import { ecsPlugin } from "../../../ecs";
import type { Entity } from "../../../ecs/types";
import { createApi, type VfxApiContext } from "../../api";
import { easing as easingTable } from "../../easing";
import { createState } from "../../state";
import type { EmitterValue, ParticleValue } from "../../types";
import { asEntity, makeConfig, makeLog, makeRenderer, makeStage, setup } from "../helpers";

/** A full ParticleValue owned by `owner` (or `-1` for an unowned burst particle). */
const mkParticle = (owner: Entity): ParticleValue => ({
  vx: 0,
  vy: 0,
  age: 0,
  lifetime: 1,
  startScale: 1,
  endScale: 0,
  gravityX: 0,
  gravityY: 0,
  emitter: owner
});

/** Build a STARTED api context (tokens wired) with an optional live stage. */
const startedCtx = (opts: { headless?: boolean; config?: ReturnType<typeof makeConfig> } = {}) => {
  const s = setup(opts.config ?? makeConfig());
  const stage: Container | undefined = opts.headless ? undefined : makeStage();
  const renderer = makeRenderer(stage);
  const log = makeLog();
  const require = ((plugin: unknown) =>
    plugin === ecsPlugin ? s.world : renderer) as unknown as VfxApiContext["require"];
  const ctx: VfxApiContext = { config: s.config, state: s.state, log, require };
  return { api: createApi(ctx), s, renderer, stage, log };
};

/** Build an UNSTARTED api context (tokens undefined → every method guards). */
const unstartedCtx = () => {
  const config = makeConfig();
  const state = createState({ global: {}, config });
  const log = makeLog();
  const require = (() => {
    throw new Error("require must not be called before start");
  }) as unknown as VfxApiContext["require"];
  return { api: createApi({ config, state, log, require }), state, log };
};

describe("api — guarded no-ops before start", () => {
  it("createEmitter returns a dead handle and warns", () => {
    const { api, log } = unstartedCtx();
    const e = api.createEmitter({ rate: 10, speed: 10, lifetime: 1 });
    expect(api).toBeDefined();
    expect(e).toBe(-1);
    expect(log.warn).toHaveBeenCalled();
  });

  it("floatText returns a dead handle and warns", () => {
    const { api, log } = unstartedCtx();
    expect(api.floatText(0, 0, "hi")).toBe(-1);
    expect(log.warn).toHaveBeenCalled();
  });

  it("burst / shake / stopShake / pop / flash / configure / enable / remove are silent no-ops", () => {
    const { api, state } = unstartedCtx();
    expect(() => {
      api.burst(0, 0, { count: 5, speed: 10, lifetime: 1 });
      api.shake(1, 1);
      api.stopShake();
      api.pop(asEntity(1));
      api.flash(asEntity(1));
      api.configureEmitter(asEntity(1), { rate: 5 });
      api.setEmitterEnabled(asEntity(1), false);
      api.removeEmitter(asEntity(1));
    }).not.toThrow();
    expect(state.particleCount).toBe(0);
    expect(state.trauma).toBe(0);
  });
});

describe("api — createEmitter", () => {
  it("spawns a live emitter with named components at the given origin", () => {
    const { api, s } = startedCtx();
    const e = api.createEmitter({ x: 30, y: 40, rate: 80, speed: 40, spread: 0.3, lifetime: 0.6 });

    expect(s.world.isAlive(e)).toBe(true);
    expect(s.world.has(e, s.Emitter)).toBe(true);
    expect(s.world.get(e, s.transform)).toMatchObject({ x: 30, y: 40 });

    // MCP-name introspection proof.
    const names = s.world.componentsOf(e).map(c => c.name);
    expect(names).toContain("Emitter");
    expect(names).toContain("Transform");
  });

  it("applies spec defaults (enabled true, spread 0.3)", () => {
    const { api, s } = startedCtx();
    const e = api.createEmitter({ rate: 10, speed: 10, lifetime: 1 });
    const value = s.world.get(e, s.Emitter) as EmitterValue;
    expect(value.enabled).toBe(true);
    expect(value.spread).toBeCloseTo(0.3, 6);
  });
});

describe("api — configure / enable / remove", () => {
  it("configureEmitter shallow-merges emission params on a live emitter", () => {
    const { api, s } = startedCtx();
    const e = api.createEmitter({ rate: 10, speed: 10, lifetime: 1 });
    api.configureEmitter(e, { rate: 42, color: 0x00_ff_00 });

    const value = s.world.get(e, s.Emitter) as EmitterValue;
    expect(value.rate).toBe(42);
    expect(value.color).toBe(0x00_ff_00);
    expect(value.speed).toBe(10); // untouched
  });

  it("configureEmitter is a no-op on a dead / non-emitter entity", () => {
    const { api, s } = startedCtx();
    const notEmitter = s.world.spawn(
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );
    expect(() => api.configureEmitter(notEmitter, { rate: 5 })).not.toThrow();
    expect(s.world.has(notEmitter, s.Emitter)).toBe(false);
  });

  it("setEmitterEnabled / removeEmitter are no-ops on a non-emitter entity", () => {
    const { api, s } = startedCtx();
    const notEmitter = s.world.spawn(
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );
    expect(() => api.setEmitterEnabled(notEmitter, false)).not.toThrow();
    expect(() => api.removeEmitter(notEmitter)).not.toThrow();
    expect(s.world.isAlive(notEmitter)).toBe(true); // not despawned
  });

  it("setEmitterEnabled toggles emission", () => {
    const { api, s } = startedCtx();
    const e = api.createEmitter({ rate: 10, speed: 10, lifetime: 1 });
    api.setEmitterEnabled(e, false);
    expect((s.world.get(e, s.Emitter) as EmitterValue).enabled).toBe(false);
  });

  it("removeEmitter despawns the emitter AND only its own live particles", () => {
    const { api, s } = startedCtx();
    const e = api.createEmitter({ rate: 10, speed: 10, lifetime: 1 });

    // Two particles owned by e, one unowned (burst) particle.
    s.world.spawn(
      s.Particle(mkParticle(e)),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );
    s.world.spawn(
      s.Particle(mkParticle(e)),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );
    s.world.spawn(
      s.Particle(mkParticle(asEntity(-1))),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );
    s.state.particleCount = 3;

    api.removeEmitter(e);

    expect(s.world.isAlive(e)).toBe(false);
    expect(s.world.query(s.Particle).count()).toBe(1); // the unowned burst particle survives
    expect(s.state.particleCount).toBe(1);
  });
});

describe("api — burst", () => {
  it("emits count particles at (x, y) and stages each", () => {
    const { api, s, renderer } = startedCtx();
    api.burst(15, 25, { count: 5, speed: 100, lifetime: 0.5, radius: 3 });

    expect(s.state.particleCount).toBe(5);
    expect(s.world.query(s.Particle).count()).toBe(5);
    expect(renderer.attachPrimitive).toHaveBeenCalledTimes(5);
  });

  it("respects the maxParticles cap and debug-logs the drop", () => {
    const { api, s, log } = startedCtx({ config: makeConfig({ maxParticles: 2 }) });
    api.burst(0, 0, { count: 5, speed: 100, lifetime: 0.5 });

    expect(s.state.particleCount).toBe(2);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });
});

describe("api — shake / stopShake", () => {
  it("banks amplitude as trauma and clamps accumulation to 1", () => {
    const { api, s } = startedCtx();
    api.shake(0.8, 0);
    expect(s.state.trauma).toBeCloseTo(0.8, 6);
    api.shake(0.5, 0); // 1.3 → clamp 1
    expect(s.state.trauma).toBe(1);
  });

  it("banks enough trauma for the requested duration", () => {
    const { api, s } = startedCtx({ config: makeConfig({ shakeDecay: 1.8 }) });
    api.shake(0.1, 0.5); // max(0.1, 0.5*1.8) = 0.9
    expect(s.state.trauma).toBeCloseTo(0.9, 6);
  });

  it("stopShake zeroes trauma and resets the stage offset", () => {
    const { api, s, stage } = startedCtx();
    api.shake(1, 1);
    api.stopShake();
    expect(s.state.trauma).toBe(0);
    expect(
      (stage as unknown as { position: { set: ReturnType<typeof vi.fn> } }).position.set
    ).toHaveBeenCalledWith(0, 0);
  });
});

describe("api — pop", () => {
  it("captures the base scale and adds a Pop", () => {
    const { api, s } = startedCtx();
    const target = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 2 }));
    api.pop(target, { scale: 1.5, duration: 0.2 });

    expect(s.world.has(target, s.Pop)).toBe(true);
    const pop = s.world.get(target, s.Pop);
    expect(pop?.baseScaleX).toBe(2);
    expect(pop?.amplitude).toBe(1.5);
  });

  it("is a no-op on an entity without a Transform", () => {
    const { api, s } = startedCtx();
    const bare = s.world.spawn();
    expect(() => api.pop(bare)).not.toThrow();
    expect(s.world.has(bare, s.Pop)).toBe(false);
  });

  it("is a no-op on a dead entity", () => {
    const { api, s } = startedCtx();
    const dead = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
    s.world.despawn(dead);
    expect(() => api.pop(dead, { scale: 1.5 })).not.toThrow();
  });

  it("refreshes an in-flight pop without recapturing the (mid-pop) base scale", () => {
    const { api, s } = startedCtx();
    const target = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 2, scaleY: 2 }));
    api.pop(target, { scale: 1.5 });

    // Simulate the pop mid-flight (scale drifted) then re-pop.
    s.world.set(target, s.transform, { scaleX: 3, scaleY: 3 });
    s.world.set(target, s.Pop, { age: 0.1 });
    api.pop(target, { scale: 1.8 });

    const pop = s.world.get(target, s.Pop);
    expect(pop?.age).toBe(0); // refreshed
    expect(pop?.amplitude).toBe(1.8); // updated
    expect(pop?.baseScaleX).toBe(2); // ORIGINAL base kept, not the drifted 3
  });
});

describe("api — flash", () => {
  it("captures the view's ACTUAL base tint, adds a Flash, and snaps the tint to the flash color", () => {
    const { api, s, renderer } = startedCtx();
    // Non-white base tint so the capture is genuinely proven (not the white fallback).
    const view = { tint: 0x12_34_56 } as unknown as Container;
    renderer.getEntityView.mockReturnValue(view);
    const target = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));

    api.flash(target, { color: 0xff_00_00, duration: 0.2 });

    expect(s.world.has(target, s.Flash)).toBe(true);
    const flash = s.world.get(target, s.Flash);
    expect(flash?.baseTint).toBe(0x12_34_56); // captured the view's real tint, not white
    expect(flash?.color).toBe(0xff_00_00);
    expect(flash?.duration).toBe(0.2);
    expect((view as unknown as { tint: number }).tint).toBe(0xff_00_00); // snapped immediately
  });

  it("defaults to a white flash over 0.12s", () => {
    const { api, s, renderer } = startedCtx();
    renderer.getEntityView.mockReturnValue({ tint: 0xff_ff_ff } as unknown as Container);
    const target = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));

    api.flash(target);

    const flash = s.world.get(target, s.Flash);
    expect(flash?.color).toBe(0xff_ff_ff);
    expect(flash?.duration).toBeCloseTo(0.12, 6);
  });

  it("captures white as the base tint when the entity has no view (headless)", () => {
    const { api, s } = startedCtx({ headless: true });
    const target = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));

    expect(() => api.flash(target, { color: 0xff_00_00 })).not.toThrow();
    expect(s.world.get(target, s.Flash)?.baseTint).toBe(0xff_ff_ff);
  });

  it("is a no-op on a dead entity", () => {
    const { api, s } = startedCtx();
    const dead = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
    s.world.despawn(dead);
    expect(() => api.flash(dead)).not.toThrow();
    expect(s.world.has(dead, s.Flash)).toBe(false);
  });

  it("refreshes an in-flight flash without recapturing the (mid-flash) base tint", () => {
    const { api, s, renderer } = startedCtx();
    const view = { tint: 0xff_ff_ff } as unknown as Container;
    renderer.getEntityView.mockReturnValue(view);
    const target = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
    api.flash(target, { color: 0xff_00_00, duration: 0.2 });

    // Simulate the flash mid-flight (tint drifted) then re-flash.
    (view as unknown as { tint: number }).tint = 0xab_cd_ef;
    s.world.set(target, s.Flash, { age: 0.1 });
    api.flash(target, { color: 0x00_ff_00, duration: 0.3 });

    const flash = s.world.get(target, s.Flash);
    expect(flash?.age).toBe(0); // refreshed
    expect(flash?.color).toBe(0x00_ff_00); // updated
    expect(flash?.duration).toBe(0.3); // updated
    expect(flash?.baseTint).toBe(0xff_ff_ff); // ORIGINAL base kept, not the drifted 0xabcdef
    expect((view as unknown as { tint: number }).tint).toBe(0x00_ff_00); // re-snapped to the new color
  });
});

describe("api — floatText", () => {
  it("spawns an entity, builds + attaches a Text, and retains the handle", () => {
    const { api, s, renderer } = startedCtx();
    const e = api.floatText(10, 20, "+50", { color: 0xff_ff_ff, startAlpha: 1 });

    expect(s.world.isAlive(e)).toBe(true);
    expect(s.world.has(e, s.FloatingText)).toBe(true);
    expect(renderer.attach).toHaveBeenCalledTimes(1);
    expect(s.state.views.has(e)).toBe(true);
  });

  it("creates the entity but no Text view when headless", () => {
    const { api, s, renderer } = startedCtx({ headless: true });
    const e = api.floatText(10, 20, "+50");

    expect(s.world.isAlive(e)).toBe(true);
    expect(s.world.has(e, s.FloatingText)).toBe(true);
    expect(renderer.attach).not.toHaveBeenCalled();
    expect(s.state.views.has(e)).toBe(false);
  });
});

describe("api — easing / lerp", () => {
  it("exposes the shared easing table and lerp", () => {
    const { api } = startedCtx();
    expect(api.easing).toBe(easingTable);
    expect(api.lerp(0, 100, 0.25)).toBe(25);
  });
});

describe("api — type-level contracts", () => {
  it("createEmitter returns Entity; burst / pop specs are enforced", () => {
    const { api } = startedCtx();

    expectTypeOf(api.createEmitter).returns.toEqualTypeOf<Entity>();
    expectTypeOf(api.floatText).returns.toEqualTypeOf<Entity>();

    // Compile-time only — never invoked; tsc still type-checks the bodies.
    const contracts = (e: Entity): void => {
      // @ts-expect-error — burst requires speed + lifetime, not just count.
      api.burst(0, 0, { count: 5 });
      // @ts-expect-error — pop options reject unknown fields.
      api.pop(e, { scale: 1.5, bogus: true });
      // @ts-expect-error — flash options reject unknown fields.
      api.flash(e, { color: 0xff_00_00, bogus: true });
    };
    expect(typeof contracts).toBe("function");
  });
});
