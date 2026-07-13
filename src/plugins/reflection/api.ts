/**
 * @file reflection plugin — API factory.
 *
 * Thin registry over field-schema inference (see `infer.ts`) and validation (see `validate.ts`).
 * Resolves the ecs world lazily at call time via `ctx.require(ecsPlugin)` — reflection has no
 * `onStart`, exactly like the scheduler's forwarding-facade pattern.
 */
import { ecsPlugin } from "../ecs";
import type { World } from "../ecs/types";
import { field } from "./field";
import { inferDescriptors, labelFor } from "./infer";
import type { Api, Config, FieldDescriptor, Schema, State, ValidationResult } from "./types";
import { validateAgainst } from "./validate";

/**
 * Finds a representative live value for a named component by scanning live entities in
 * registration order and returning the first component value whose name matches.
 *
 * @param world - The ecs world facade.
 * @param componentName - The named component to search for.
 * @returns The first matching live component value, or `undefined` if no live entity has it.
 * @example
 * ```ts
 * findRepresentativeValue(world, "Enemy"); // { hp: 100, ... } | undefined
 * ```
 */
const findRepresentativeValue = (world: World, componentName: string): unknown => {
  for (const entity of world.liveEntities()) {
    const match = world.componentsOf(entity).find(component => component.name === componentName);
    if (match !== undefined) return match.value;
  }
  return undefined;
};

/**
 * Structural context type required by `createApi` (mirrors the scheduler's no-`onStart`
 * pattern).
 *
 * Uses only the fields reflection actually accesses so unit tests can supply a minimal mock
 * without wiring the full kernel.
 */
export type ReflectionApiContext = {
  /** Resolved reflection configuration. */
  readonly config: Readonly<Config>;
  /** Reflection state (the `schemas` and `inferred` maps). */
  readonly state: State;
  /** Logger injected by `logPlugin`. */
  readonly log: {
    /** Log at debug level. */
    debug: (message: string) => void;
    /** Log at info level. */
    info: (message: string) => void;
    /** Log a warning. */
    warn: (message: string) => void;
    /** Log an error. */
    error: (message: string) => void;
  };
  /** Require a dependency's API by plugin instance. */
  require: (plugin: typeof ecsPlugin) => World;
};

/**
 * Creates the reflection plugin API surface.
 *
 * `describe`/`validate` resolve the ecs world lazily via `ctx.require(ecsPlugin)` at call time —
 * legitimate because they run at user-gesture frequency (an inspector edit / a scene load), well
 * after every dependency has started, never per-frame.
 *
 * @param ctx - Plugin context providing `config`, `state`, `log`, and `require`.
 * @returns The reflection API object `{ describe, register, validate, field }`.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.describe("Enemy"); // FieldDescriptor[]
 * ```
 */
export const createApi = (ctx: ReflectionApiContext): Api => {
  /**
   * The `FieldDescriptor[]` for a named component: a registered schema if one exists, else
   * inferred from a live value (memoized thereafter), else `[]`.
   *
   * @param componentName - The named component to describe.
   * @returns The component's field descriptors, or `[]` when unknown/anonymous, or named but
   *   never instantiated with no registered schema.
   * @example
   * ```ts
   * describe("Enemy"); // [{ kind: "number", key: "hp", label: "Hp" }, ...]
   * ```
   */
  const describe = (componentName: string): FieldDescriptor[] => {
    const registered = ctx.state.schemas.get(componentName);
    if (registered !== undefined) return registered;

    const cached = ctx.state.inferred.get(componentName);
    if (cached !== undefined) return cached;

    const world = ctx.require(ecsPlugin);
    if (world.componentByName(componentName) === undefined) {
      ctx.log.warn(`[reflection] describe("${componentName}") — no named component; returning [].`);
      return [];
    }

    const value = findRepresentativeValue(world, componentName);
    if (value === undefined) return [];

    const descriptors = inferDescriptors(value, ctx.config.humanizeLabels);
    ctx.state.inferred.set(componentName, descriptors);
    return descriptors;
  };

  /**
   * Registers a typed schema for a component name; it shadows inference for that name
   * thereafter and clears any stale memoized inference.
   *
   * @param componentName - The component name to register a schema for.
   * @param schema - The typed schema (field key → `field.*` spec).
   * @example
   * ```ts
   * register("Enemy", { hp: field.number({ min: 0, max: 100 }) });
   * ```
   */
  const register = (componentName: string, schema: Schema): void => {
    const descriptors: FieldDescriptor[] = [];
    for (const [key, spec] of Object.entries(schema)) {
      descriptors.push({ ...spec, key, label: labelFor(key, ctx.config.humanizeLabels) });
    }
    ctx.state.schemas.set(componentName, descriptors);
    ctx.state.inferred.delete(componentName);
  };

  /**
   * Validates a partial component value against its descriptors
   * (type / range / options / readonly / shape).
   *
   * @param componentName - The component name whose descriptors to validate against.
   * @param partial - The partial component value to check.
   * @returns `{ ok: true }` when every field passes, else `{ ok: false, errors }`.
   * @example
   * ```ts
   * validate("Enemy", { hp: 150 }); // { ok: false, errors: [{ key: "hp", message: "..." }] }
   * ```
   */
  const validate = (
    componentName: string,
    partial: Readonly<Record<string, unknown>>
  ): ValidationResult => validateAgainst(describe(componentName), partial);

  return { describe, register, validate, field };
};
