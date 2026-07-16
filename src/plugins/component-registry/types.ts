/**
 * @file component-registry plugin — type definitions.
 *
 * The public catalog surface (`app["component-registry"]`) plus the closed value types the picker
 * and editor-bridge consume. Pure data — no ECS / Pixi / reflection imports leak in.
 */

/**
 * component-registry configuration — intentionally EMPTY. The registry owns no tunable behavior; the
 * catalog is supplied at runtime by domain plugins (graphics-2d) via `register`, not by config.
 */
export type Config = Record<string, never>;

/** The Add-Component picker's category sections (all six exist; some are empty until later phases). */
export type ComponentCategory =
  | "Transform"
  | "Rendering"
  | "Physics"
  | "Animation"
  | "Audio"
  | "Scripts";

/** One entry in the addable-component catalog — plain data the picker lists and the bridge adds. */
export type ComponentCatalogEntry = {
  /** Component name — matches the world/reflection registered name. */
  readonly name: string;
  /** The picker section this component appears under. */
  readonly category: ComponentCategory;
  /** Creation defaults merged by `editor-bridge.addComponent` into the `addComponent` command's value. */
  readonly defaults: Readonly<Record<string, unknown>>;
  /** Whether the picker offers it. `false` for Transform (implicit on every object, never "added"). */
  readonly addable: boolean;
};

/**
 * component-registry state — the one catalog map, keyed by component name. Created empty in
 * `createState`; populated at runtime by domain plugins' `register` calls.
 */
export type State = {
  /** Addable-component catalog: component name → its catalog entry. Insertion order is the list order. */
  readonly catalog: Map<string, ComponentCatalogEntry>;
};

/** Public API surface (`app["component-registry"]`). */
export type Api = {
  /**
   * Register (or replace) a catalog entry. Idempotent by `entry.name` — last-write wins, and a
   * replacement of an existing name logs a `ctx.log.warn`. Insertion order is preserved for `list`.
   */
  register(entry: ComponentCatalogEntry): void;
  /** All catalog entries in registration order. */
  list(): readonly ComponentCatalogEntry[];
  /**
   * The catalog grouped by category — a map keyed by EVERY `ComponentCategory` (empty categories
   * present with an empty array), each value ordered as `list`.
   */
  byCategory(): ReadonlyMap<ComponentCategory, readonly ComponentCatalogEntry[]>;
  /** The entry registered under `name`, or `undefined` if none. */
  get(name: string): ComponentCatalogEntry | undefined;
  /** Whether a component named `name` is registered. */
  has(name: string): boolean;
};
