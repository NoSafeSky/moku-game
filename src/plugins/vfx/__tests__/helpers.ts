/**
 * @file vfx plugin — shared test helpers.
 *
 * Builds a REAL ecs world (via `createWorld`, as the ecs plugin's own tests do) so
 * system tests exercise genuine `query`/`spawn`/`despawn`/`get`/`set` behaviour,
 * paired with a recording mock renderer (a structural `RendererDep`). Not a test
 * file itself — vitest only collects `*.test.ts`.
 */
import type { Container } from "pixi.js";
import { vi } from "vitest";
import type { Component, Entity } from "../../ecs/types";
import { createWorld } from "../../ecs/world";
import type { TransformValue } from "../../renderer/types";
import { createState } from "../state";
import type {
  Config,
  EmitterComponent,
  EmitterValue,
  FloatingTextComponent,
  FloatingTextValue,
  ParticleComponent,
  ParticleValue,
  PopComponent,
  PopValue,
  State,
  TransformComponent
} from "../types";

/** Build a vfx config with optional overrides. */
export const makeConfig = (overrides: Partial<Config> = {}): Config => ({
  maxParticles: 1000,
  shakeDecay: 1.8,
  shakeMaxOffset: 24,
  defaultColor: 0xff_ff_ff,
  ...overrides
});

/** A logger whose four levels are vi spies. */
export const makeLog = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

/** A stage stub exposing only `position.set` (what the shake system writes). */
export const makeStage = () => ({ position: { set: vi.fn() } }) as unknown as Container;

/**
 * A recording mock renderer (structural `RendererDep`). `attachPrimitive` reports
 * success only when a stage is present (mirrors the real headless contract).
 */
export const makeRenderer = (stage?: Container) => ({
  attachPrimitive: vi.fn((_entity: Entity, _spec: unknown) => stage !== undefined),
  attach: vi.fn(),
  markDirty: vi.fn(),
  getStage: vi.fn((): Container | undefined => stage)
});

/** The real world + all vfx tokens + a state wired to them (the started shape). */
export type VfxSetup = {
  world: ReturnType<typeof createWorld>;
  transform: TransformComponent;
  Emitter: EmitterComponent;
  Particle: ParticleComponent;
  Pop: PopComponent;
  FloatingText: FloatingTextComponent;
  state: State;
  config: Config;
};

/**
 * Create a real world, define the Transform + the four named vfx components on
 * it, and return a state whose tokens are wired (i.e. the post-onStart shape).
 */
export const setup = (config: Config = makeConfig()): VfxSetup => {
  const world = createWorld({ initialCapacity: 1024, maxStructuralOpsWarn: 0 });

  const transform = world.defineComponent<TransformValue>(
    () => ({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
    { name: "Transform" }
  );
  const Emitter = world.defineComponent<EmitterValue>(
    () =>
      ({
        enabled: false,
        rate: 0,
        accumulator: 0,
        angle: 0,
        spread: 0,
        speed: 0,
        speedVariance: 0,
        lifetime: 0,
        lifetimeVariance: 0,
        startScale: 1,
        endScale: 0,
        radius: 2,
        color: config.defaultColor,
        gravityX: 0,
        gravityY: 0
      }) satisfies EmitterValue,
    { name: "Emitter" }
  );
  const Particle = world.defineComponent<ParticleValue>(
    () =>
      ({
        vx: 0,
        vy: 0,
        age: 0,
        lifetime: 1,
        startScale: 1,
        endScale: 0,
        gravityX: 0,
        gravityY: 0,
        emitter: -1 as Entity
      }) satisfies ParticleValue,
    { name: "Particle" }
  );
  const Pop = world.defineComponent<PopValue>(
    () => ({ age: 0, duration: 0, amplitude: 1, baseScaleX: 1, baseScaleY: 1 }) satisfies PopValue,
    { name: "Pop" }
  );
  const FloatingText = world.defineComponent<FloatingTextValue>(
    () =>
      ({
        age: 0,
        lifetime: 1,
        riseSpeed: 40,
        startAlpha: 1,
        endAlpha: 0
      }) satisfies FloatingTextValue,
    { name: "FloatingText" }
  );

  const state = createState({ global: {}, config });
  state.transform = transform;
  state.Emitter = Emitter;
  state.Particle = Particle;
  state.Pop = Pop;
  state.FloatingText = FloatingText;

  return { world, transform, Emitter, Particle, Pop, FloatingText, state, config };
};

/** Branded-entity helper for constructing raw handles in tests. */
export const asEntity = (n: number): Entity => n as Entity;

/** Narrow a component token for `world.get` in assertions (identity passthrough). */
export const token = <T extends object>(c: Component<T>): Component<T> => c;
