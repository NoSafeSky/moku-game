/**
 * @file vfx plugin — emit + particle system unit tests.
 *
 * Drives the emit and particle systems (and the shared `emitParticles` core)
 * against a real ecs world + a recording mock renderer. Covers: rate-based
 * emission with a fractional accumulator, spawn origin + view attach, velocity +
 * gravity integration, scale-out fade, end-of-life despawn + counter, the
 * `maxParticles` cap (drop + debug-log), and the emission cone.
 */
import { describe, expect, it } from "vitest";
import type { Entity } from "../../../ecs/types";
import { createEmitSystem, DEAD_ENTITY, type EmitDeps, emitParticles } from "../../systems/emit";
import { createParticleSystem } from "../../systems/particles";
import type { EmitterValue } from "../../types";
import { makeConfig, makeLog, makeRenderer, makeStage, setup } from "../helpers";

/** Build a full EmitterValue from partial overrides (sane emitting defaults). */
const emitterValue = (overrides: Partial<EmitterValue> = {}): EmitterValue => ({
  enabled: true,
  rate: 60,
  accumulator: 0,
  angle: 0,
  spread: 0,
  speed: 100,
  speedVariance: 0,
  lifetime: 1,
  lifetimeVariance: 0,
  startScale: 1,
  endScale: 0,
  radius: 2,
  color: 0xff_00_00,
  gravityX: 0,
  gravityY: 0,
  ...overrides
});

describe("emit system", () => {
  it("emits one particle per 1/60s tick at rate 60 (at the emitter's origin)", () => {
    const s = setup();
    const renderer = makeRenderer(makeStage());
    const emit = createEmitSystem({
      world: s.world,
      transform: s.transform,
      Emitter: s.Emitter,
      Particle: s.Particle,
      renderer,
      state: s.state,
      config: s.config,
      log: makeLog(),
      random: () => 0.5
    });

    s.world.spawn(
      s.Emitter(emitterValue({ rate: 60 })),
      s.transform({ x: 50, y: 20, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    emit(s.world, 1 / 60);

    expect(s.state.particleCount).toBe(1);
    expect(s.world.query(s.Particle).count()).toBe(1);
    expect(renderer.attachPrimitive).toHaveBeenCalledTimes(1);

    const particle = s.world.query(s.Particle, s.transform).first() as Entity;
    expect(s.world.get(particle, s.transform)).toMatchObject({ x: 50, y: 20 });
  });

  it("carries the fractional accumulator without double-spawning", () => {
    const s = setup();
    const emit = createEmitSystem({
      world: s.world,
      transform: s.transform,
      Emitter: s.Emitter,
      Particle: s.Particle,
      renderer: makeRenderer(makeStage()),
      state: s.state,
      config: s.config,
      log: makeLog(),
      random: () => 0.5
    });
    s.world.spawn(
      s.Emitter(emitterValue({ rate: 60 })),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    // Half a particle's worth of accumulation → nothing spawns yet.
    emit(s.world, 1 / 120);
    expect(s.state.particleCount).toBe(0);

    // The carried 0.5 + another 0.5 = 1 → exactly one particle.
    emit(s.world, 1 / 120);
    expect(s.state.particleCount).toBe(1);
  });

  it("does not emit from a disabled emitter", () => {
    const s = setup();
    const emit = createEmitSystem({
      world: s.world,
      transform: s.transform,
      Emitter: s.Emitter,
      Particle: s.Particle,
      renderer: makeRenderer(makeStage()),
      state: s.state,
      config: s.config,
      log: makeLog(),
      random: () => 0.5
    });
    s.world.spawn(
      s.Emitter(emitterValue({ enabled: false, rate: 600 })),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    emit(s.world, 1 / 60);
    expect(s.state.particleCount).toBe(0);
  });

  it("does not emit from an enabled emitter with zero rate", () => {
    const s = setup();
    const emit = createEmitSystem({
      world: s.world,
      transform: s.transform,
      Emitter: s.Emitter,
      Particle: s.Particle,
      renderer: makeRenderer(makeStage()),
      state: s.state,
      config: s.config,
      log: makeLog(),
      random: () => 0.5
    });
    s.world.spawn(
      s.Emitter(emitterValue({ enabled: true, rate: 0 })),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    emit(s.world, 1 / 60);
    expect(s.state.particleCount).toBe(0);
  });

  it("drops over-budget emission and debug-logs once per frame", () => {
    const s = setup(makeConfig({ maxParticles: 1 }));
    const log = makeLog();
    const emit = createEmitSystem({
      world: s.world,
      transform: s.transform,
      Emitter: s.Emitter,
      Particle: s.Particle,
      renderer: makeRenderer(makeStage()),
      state: s.state,
      config: s.config,
      log,
      random: () => 0.5
    });
    // rate 600 @ 1/60 s ⇒ 10 requested, but cap is 1.
    s.world.spawn(
      s.Emitter(emitterValue({ rate: 600 })),
      s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })
    );

    emit(s.world, 1 / 60);

    expect(s.state.particleCount).toBe(1);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });
});

describe("particle system", () => {
  it("integrates velocity + gravity into the Transform and fades the scale", () => {
    const s = setup();
    const renderer = makeRenderer(makeStage());
    const deps: EmitDeps = {
      world: s.world,
      transform: s.transform,
      Particle: s.Particle,
      renderer,
      state: s.state,
      config: s.config,
      random: () => 0.5
    };
    // random 0.5 ⇒ no jitter: direction 0, speed 100 ⇒ vx 100, vy 0.
    emitParticles(
      deps,
      10,
      20,
      {
        angle: 0,
        spread: 0,
        speed: 100,
        speedVariance: 0,
        lifetime: 1,
        lifetimeVariance: 0,
        startScale: 1,
        endScale: 0,
        radius: 2,
        color: 0xff_ff_ff,
        gravityX: 0,
        gravityY: 100,
        emitter: DEAD_ENTITY
      },
      1
    );

    const particle = s.world.query(s.Particle, s.transform).first() as Entity;
    const particleSystem = createParticleSystem({
      world: s.world,
      transform: s.transform,
      Particle: s.Particle,
      renderer,
      state: s.state
    });

    particleSystem(s.world, 0.1);

    const tf = s.world.get(particle, s.transform);
    expect(tf?.x).toBeCloseTo(20, 6); // 10 + vx(100)*0.1
    expect(tf?.y).toBeCloseTo(21, 6); // 20 + vy(0→10)*0.1
    expect(s.world.get(particle, s.Particle)?.vy).toBeCloseTo(10, 6); // gravity applied
    expect(tf?.scaleX).toBeGreaterThan(0);
    expect(tf?.scaleX).toBeLessThan(1); // eased startScale→endScale
    expect(renderer.markDirty).toHaveBeenCalledWith(particle);
  });

  it("despawns a particle at end of life and decrements the counter", () => {
    const s = setup();
    const renderer = makeRenderer(makeStage());
    const deps: EmitDeps = {
      world: s.world,
      transform: s.transform,
      Particle: s.Particle,
      renderer,
      state: s.state,
      config: s.config,
      random: () => 0.5
    };
    emitParticles(
      deps,
      0,
      0,
      {
        angle: 0,
        spread: 0,
        speed: 0,
        speedVariance: 0,
        lifetime: 0.1,
        lifetimeVariance: 0,
        startScale: 1,
        endScale: 0,
        radius: 2,
        color: 0xff_ff_ff,
        gravityX: 0,
        gravityY: 0,
        emitter: DEAD_ENTITY
      },
      1
    );
    expect(s.state.particleCount).toBe(1);

    const particleSystem = createParticleSystem({
      world: s.world,
      transform: s.transform,
      Particle: s.Particle,
      renderer,
      state: s.state
    });
    particleSystem(s.world, 0.1); // age 0.1 ≥ lifetime 0.1 → despawn

    expect(s.world.query(s.Particle).count()).toBe(0);
    expect(s.state.particleCount).toBe(0);
  });
});

describe("emitParticles core", () => {
  it("spawns exactly `count` particles at (x, y), honouring the cap", () => {
    const s = setup(makeConfig({ maxParticles: 3 }));
    const deps: EmitDeps = {
      world: s.world,
      transform: s.transform,
      Particle: s.Particle,
      renderer: makeRenderer(makeStage()),
      state: s.state,
      config: s.config,
      random: () => 0.5
    };

    const spawned = emitParticles(
      deps,
      7,
      9,
      {
        angle: 0,
        spread: Math.PI,
        speed: 50,
        speedVariance: 0,
        lifetime: 1,
        lifetimeVariance: 0,
        startScale: 1,
        endScale: 0,
        radius: 2,
        color: 0xff_ff_ff,
        gravityX: 0,
        gravityY: 0,
        emitter: DEAD_ENTITY
      },
      5 // request 5, cap 3
    );

    expect(spawned).toBe(3);
    expect(s.state.particleCount).toBe(3);
    for (const particle of s.world.query(s.Particle, s.transform)) {
      expect(s.world.get(particle, s.transform)).toMatchObject({ x: 7, y: 9 });
    }
  });

  it("launches velocities inside the angle ± spread cone", () => {
    const s = setup();
    // random 0 ⇒ direction = angle - spread; random 1 ⇒ angle + spread.
    const randoms = [0, 1];
    let i = 0;
    const deps: EmitDeps = {
      world: s.world,
      transform: s.transform,
      Particle: s.Particle,
      renderer: makeRenderer(makeStage()),
      state: s.state,
      config: s.config,
      // First call feeds direction, later calls feed speed/lifetime (variance 0 → unused).
      random: () => randoms[i++ % randoms.length] ?? 0
    };

    const angle = 0;
    const spread = 0.5;
    emitParticles(
      deps,
      0,
      0,
      {
        angle,
        spread,
        speed: 100,
        speedVariance: 0,
        lifetime: 1,
        lifetimeVariance: 0,
        startScale: 1,
        endScale: 0,
        radius: 2,
        color: 0xff_ff_ff,
        gravityX: 0,
        gravityY: 0,
        emitter: DEAD_ENTITY
      },
      1
    );

    const particle = s.world.query(s.Particle).first() as Entity;
    const p = s.world.get(particle, s.Particle);
    const direction = Math.atan2(p?.vy ?? 0, p?.vx ?? 0);
    expect(direction).toBeGreaterThanOrEqual(angle - spread - 1e-6);
    expect(direction).toBeLessThanOrEqual(angle + spread + 1e-6);
  });
});
