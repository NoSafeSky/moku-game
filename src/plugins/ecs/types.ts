/**
 * @file ecs plugin — type definitions.
 */

/** Opaque generational entity handle (internally { index, generation }). */
export type Entity = number & { readonly __entity: unique symbol };

/** Per-component storage strategy. */
export type StorageStrategy = "archetype" | "sparse";

/** Opaque component token from defineComponent. */
export type Component<T> = { readonly __id: number; readonly __value: T };

/** Presence-only marker component. */
export type Tag = Component<Record<never, never>>;

/** Fixed, ordered execution stages. */
export type Stage = "input" | "update" | "physics" | "sync" | "render";

/** A system run each tick for its stage. */
export type System = (world: World, dt: number) => void;

/** A component value bound to its token (spawn payload form). */
export type ComponentInit = { readonly component: Component<unknown>; readonly value: unknown };

/** Query result over a tuple of component value types. */
export type Query<Values extends readonly object[]> = {
  /** Iterate matches; mutating a ref mutates storage. Structural ops are deferred to the command buffer. */
  updateEach(cb: (values: Values, entity: Entity) => void): void;
  /** Number of currently matching entities. */
  count(): number;
  /** First matching entity, or undefined. */
  first(): Entity | undefined;
  /** Iterate the matching entity handles. */
  [Symbol.iterator](): Iterator<Entity>;
};

/** The ECS world facade (also the plugin API). */
export type World = {
  /** Define a component with a default-value factory. */
  defineComponent<T extends object>(
    create: () => T,
    opts?: { storage?: StorageStrategy }
  ): Component<T>;
  /** Define a presence-only tag. */
  defineTag(opts?: { storage?: StorageStrategy }): Tag;
  /** Create an entity with the given component values. */
  spawn(...parts: ComponentInit[]): Entity;
  /** Destroy an entity and recycle its index (generation bumped). */
  despawn(entity: Entity): void;
  /** True if the handle refers to a live entity. */
  isAlive(entity: Entity): boolean;
  /** Add a component to an entity (merges value). */
  add<T extends object>(entity: Entity, component: Component<T>, value?: Partial<T>): void;
  /** Remove a component from an entity. */
  remove(entity: Entity, component: Component<unknown>): void;
  /** True if the entity has the component. */
  has(entity: Entity, component: Component<unknown>): boolean;
  /** Read a component value (undefined if absent/dead). */
  get<T extends object>(entity: Entity, component: Component<T>): T | undefined;
  /** Shallow-merge a patch into a component value. */
  set<T extends object>(entity: Entity, component: Component<T>, value: Partial<T>): void;
  /** Typed query — overloads for arities 1..8. */
  query<A extends object>(c1: Component<A>): Query<[A]>;
  query<A extends object, B extends object>(c1: Component<A>, c2: Component<B>): Query<[A, B]>;
  query<A extends object, B extends object, C extends object>(
    c1: Component<A>,
    c2: Component<B>,
    c3: Component<C>
  ): Query<[A, B, C]>;
  query<A extends object, B extends object, C extends object, D extends object>(
    c1: Component<A>,
    c2: Component<B>,
    c3: Component<C>,
    c4: Component<D>
  ): Query<[A, B, C, D]>;
  query<A extends object, B extends object, C extends object, D extends object, E extends object>(
    c1: Component<A>,
    c2: Component<B>,
    c3: Component<C>,
    c4: Component<D>,
    c5: Component<E>
  ): Query<[A, B, C, D, E]>;
  query<
    A extends object,
    B extends object,
    C extends object,
    D extends object,
    E extends object,
    F extends object
  >(
    c1: Component<A>,
    c2: Component<B>,
    c3: Component<C>,
    c4: Component<D>,
    c5: Component<E>,
    c6: Component<F>
  ): Query<[A, B, C, D, E, F]>;
  query<
    A extends object,
    B extends object,
    C extends object,
    D extends object,
    E extends object,
    F extends object,
    G extends object
  >(
    c1: Component<A>,
    c2: Component<B>,
    c3: Component<C>,
    c4: Component<D>,
    c5: Component<E>,
    c6: Component<F>,
    c7: Component<G>
  ): Query<[A, B, C, D, E, F, G]>;
  query<
    A extends object,
    B extends object,
    C extends object,
    D extends object,
    E extends object,
    F extends object,
    G extends object,
    H extends object
  >(
    c1: Component<A>,
    c2: Component<B>,
    c3: Component<C>,
    c4: Component<D>,
    c5: Component<E>,
    c6: Component<F>,
    c7: Component<G>,
    c8: Component<H>
  ): Query<[A, B, C, D, E, F, G, H]>;
  /** Register a system for a stage; returns an unsubscribe fn. */
  addSystem(stage: Stage, system: System): () => void;
  /** Advance one frame: run stages in order, flushing the command buffer between them. */
  tick(dt: number): void;
};

/** ecs plugin configuration. */
export type Config = {
  /** Pre-allocated entity index slots; grows automatically. `@default 1024` */
  initialCapacity: number;
  /** Warn (via ctx.log) past this many structural ops in one flush; 0 disables. `@default 0` */
  maxStructuralOpsWarn: number;
};

/** ecs plugin state — the single World instance. */
export type State = {
  /** The world facade returned as the plugin API. */
  readonly world: World;
};

/** The ecs plugin API surface (the World facade). */
export type Api = World; // eslint-disable-line sonarjs/redundant-type-aliases -- the ecs plugin API contract IS the World facade (spec/15 §7)
