/**
 * @file commands plugin — shared fake ECS world builder for unit tests.
 *
 * Builds a small but behaviourally real `World` double: `spawn`/`despawn` track
 * liveness, `componentByName` resolves from a seeded name → token map, and
 * `add`/`set`/`get`/`remove`/`componentsOf` read/write an in-memory
 * entity → component-name → value store. Every method is a `vi.fn()` spy so
 * tests can assert exact call behaviour ("no world write on validation
 * failure") while still getting genuine state transitions for round-trip
 * assertions (inverse generation, restore reseed). Not a test file itself —
 * vitest only collects `*.test.ts` under `__tests__/unit` and
 * `__tests__/integration`.
 */
import { vi } from "vitest";
import type { Component, Entity, World } from "../../ecs/types";
import type { EditorId } from "../types";

/** The subset of `World` the commands funnel actually touches. */
export type MockWorld = Pick<
  World,
  | "spawn"
  | "despawn"
  | "isAlive"
  | "add"
  | "remove"
  | "get"
  | "set"
  | "componentByName"
  | "componentsOf"
>;

/** Build a callable fake component token, structurally a `Component<Record<string, unknown>>`. */
const makeToken = (name: string): Component<Record<string, unknown>> => {
  const call = ((value: Record<string, unknown>) => ({
    component: call as unknown as Component<never>,
    value
  })) as unknown as Component<Record<string, unknown>> & { readonly __name: string };
  Object.defineProperty(call, "__id", { value: name, enumerable: true });
  Object.defineProperty(call, "__name", { value: name, enumerable: true });
  return call;
};

/** A logger whose four levels are `vi.fn()` spies. */
export const makeLog = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
});

/** Build a branded `EditorId` from a raw number — test-only convenience (mirrors `asEntity`). */
export const asEditorId = (n: number): EditorId => n as EditorId;

/** Build a branded `Entity` from a raw number — test-only convenience. */
export const asEntity = (n: number): Entity => n as Entity;

/**
 * Create a fake ECS world seeded with the given named components.
 *
 * @param namedComponents - Component names resolvable via `world.componentByName`.
 * @returns The fake `World` double plus its backing `alive` set and value `store`,
 *   so tests can simulate an external despawn/recycle (delete from `alive` directly)
 *   or assert on captured component values.
 * @example
 * ```ts
 * const { world, alive } = makeMockWorld(["Position"]);
 * const entity = world.spawn();
 * alive.delete(entity); // simulate a recycled/dead entity commands didn't despawn
 * ```
 */
export const makeMockWorld = (namedComponents: readonly string[] = []) => {
  const tokens = new Map(namedComponents.map(name => [name, makeToken(name)] as const));
  const alive = new Set<Entity>();
  const store = new Map<Entity, Map<string, Record<string, unknown>>>();
  let nextEntity = 1;

  const nameOf = (token: Component<Record<string, unknown>>): string | undefined => {
    for (const [name, candidate] of tokens) if (candidate === token) return name;
    return undefined;
  };

  // Not typed as `MockWorld` here — each spy's concrete `Component<Record<string,
  // unknown>>` parameter is narrower than `World`'s generic `Component<T>` methods,
  // so the object is built with its inferred (concrete) shape and cast once below.
  const world = {
    spawn: vi.fn((): Entity => {
      const entity = nextEntity++ as Entity;
      alive.add(entity);
      store.set(entity, new Map());
      return entity;
    }),
    despawn: vi.fn((entity: Entity): void => {
      alive.delete(entity);
      store.delete(entity);
    }),
    isAlive: vi.fn((entity: Entity): boolean => alive.has(entity)),
    add: vi.fn(
      (
        entity: Entity,
        token: Component<Record<string, unknown>>,
        value?: Record<string, unknown>
      ): void => {
        const name = nameOf(token);
        if (!name) return;
        const bag = store.get(entity) ?? new Map<string, Record<string, unknown>>();
        bag.set(name, { ...bag.get(name), ...value });
        store.set(entity, bag);
      }
    ),
    remove: vi.fn((entity: Entity, token: Component<Record<string, unknown>>): void => {
      const name = nameOf(token);
      if (!name) return;
      store.get(entity)?.delete(name);
    }),
    get: vi.fn(
      (
        entity: Entity,
        token: Component<Record<string, unknown>>
      ): Record<string, unknown> | undefined => {
        const name = nameOf(token);
        return name ? store.get(entity)?.get(name) : undefined;
      }
    ),
    set: vi.fn(
      (
        entity: Entity,
        token: Component<Record<string, unknown>>,
        value: Record<string, unknown>
      ): void => {
        const name = nameOf(token);
        if (!name) return;
        const bag = store.get(entity);
        const current = bag?.get(name);
        if (bag && current) bag.set(name, { ...current, ...value });
      }
    ),
    componentByName: vi.fn((name: string): Component<Record<string, unknown>> | undefined =>
      tokens.get(name)
    ),
    componentsOf: vi.fn(
      (entity: Entity): ReadonlyArray<{ name: string; value: unknown }> =>
        Array.from(
          store.get(entity) ?? new Map<string, Record<string, unknown>>(),
          ([name, value]) => ({
            name,
            value
          })
        )
    )
  };

  return { world: world as unknown as World, alive, store, tokens };
};
