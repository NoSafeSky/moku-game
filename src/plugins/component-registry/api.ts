/**
 * @file component-registry plugin — API factory.
 *
 * Five methods over the one `state.catalog` map — register / list / byCategory / get / has.
 * Pure data: no ECS / Pixi / reflection import, no lifecycle, no events. `register` is idempotent
 * by `entry.name` (last-write-wins) and warns via `ctx.log` once on an override; `byCategory`
 * always seeds all six {@link ComponentCategory} keys so the picker can render empty sections.
 */
import type { Api, ComponentCatalogEntry, ComponentCategory, State } from "./types";

/** All six Add-Component picker category sections — the fixed bucket set `byCategory` seeds. */
const ALL_CATEGORIES: readonly ComponentCategory[] = [
  "Transform",
  "Rendering",
  "Physics",
  "Animation",
  "Audio",
  "Scripts"
];

/**
 * Structural context required by {@link createApi}, so unit tests can pass a minimal mock without
 * wiring the full kernel (mirrors the reflection/storage `*ApiContext` pattern). No `emit`, no
 * `require`, no `global` — the registry reads/writes only `state.catalog` and warns via `log`.
 */
export type ComponentRegistryApiContext = {
  /** component-registry state (the one catalog map). */
  readonly state: State;
  /** Logger injected by `logPlugin` — used only for the register-override warning. */
  readonly log: {
    /** Log a warning (a component name re-registered — last write wins). */
    warn: (message: string) => void;
  };
};

/**
 * Creates the component-registry API surface (register / list / byCategory / get / has) over
 * `ctx.state.catalog`. Pure data — never resolves an entity or touches the ECS world.
 *
 * @param ctx - Plugin context (structural — only `state` and `log` are used).
 * @returns The component-registry {@link Api} object.
 * @example
 * ```ts
 * const api = createApi(ctx);
 * api.register({ name: "Shape", category: "Rendering", defaults: { kind: "rect" }, addable: true });
 * api.list(); // [{ name: "Shape", ... }]
 * ```
 */
export const createApi = (ctx: ComponentRegistryApiContext): Api => {
  const { catalog } = ctx.state;

  return {
    /**
     * Register (or replace) a catalog entry. Idempotent by `entry.name` — last-write wins.
     * Re-registering an existing name logs a `ctx.log.warn` once before overwriting.
     *
     * @param entry - The catalog entry to register.
     * @example
     * ```ts
     * api.register({ name: "Transform", category: "Transform", defaults: { x: 0, y: 0 }, addable: false });
     * ```
     */
    register(entry: ComponentCatalogEntry): void {
      if (catalog.has(entry.name)) {
        ctx.log.warn(`[component-registry] "${entry.name}" re-registered — last wins.`);
      }
      catalog.set(entry.name, entry);
    },

    /**
     * All catalog entries in registration order.
     *
     * @returns A readonly snapshot of every registered entry, in insertion order.
     * @example
     * ```ts
     * api.list(); // [{ name: "Transform", ... }, { name: "Shape", ... }]
     * ```
     */
    list(): readonly ComponentCatalogEntry[] {
      return [...catalog.values()];
    },

    /**
     * The catalog grouped by category — a map keyed by every {@link ComponentCategory}, each
     * value ordered as {@link list}. Empty categories are present with an empty array so the
     * picker can render empty sections.
     *
     * @returns A `ReadonlyMap` from category to its ordered entries.
     * @example
     * ```ts
     * api.byCategory().get("Physics"); // [] until a physics component registers
     * ```
     */
    byCategory(): ReadonlyMap<ComponentCategory, readonly ComponentCatalogEntry[]> {
      const buckets = new Map<ComponentCategory, ComponentCatalogEntry[]>(
        ALL_CATEGORIES.map(category => [category, []])
      );
      for (const entry of catalog.values()) {
        buckets.get(entry.category)?.push(entry);
      }
      return buckets;
    },

    /**
     * The entry registered under `name`, or `undefined` if none.
     *
     * @param name - The component name to look up.
     * @returns The registered entry, or `undefined`.
     * @example
     * ```ts
     * api.get("Shape"); // { name: "Shape", ... } | undefined
     * ```
     */
    get(name: string): ComponentCatalogEntry | undefined {
      return catalog.get(name);
    },

    /**
     * Whether a component named `name` is registered.
     *
     * @param name - The component name to check.
     * @returns `true` if registered.
     * @example
     * ```ts
     * api.has("Shape"); // true | false
     * ```
     */
    has(name: string): boolean {
      return catalog.has(name);
    }
  };
};
