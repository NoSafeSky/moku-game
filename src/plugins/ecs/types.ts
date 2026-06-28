/**
 * @file ecs plugin — type definitions.
 */

/** Opaque generational entity handle (internally { index, generation }). */
export type Entity = number & { readonly __entity: unique symbol };

/** Per-component storage strategy. */
export type StorageStrategy = "archetype" | "sparse";

/**
 * Opaque component token from defineComponent.
 * Also callable: `Position({ x: 10, y: 5 })` produces a `ComponentInit` for use with `spawn`.
 */
export type Component<T> = {
  readonly __id: number;
  readonly __value: T;
  /** Bind a value to this token, producing a spawn payload. */
  (value: T): ComponentInit;
};

/** Presence-only marker component. */
export type Tag = Component<Record<never, never>>;

/**
 * Opaque world-resource token — a typed singleton handle (sibling to Component<T>).
 * Keyed by a stable string. `__value` is a phantom (type-level only); it is NEVER set at runtime.
 * Minted by `world.defineResource`, or constructed as a fixed-key const for framework well-known
 * resources (e.g. the context plugin's Assets/GameContext, the loop plugin's Time).
 */
export type Resource<T> = { readonly __key: string; readonly __value?: T };

/** Fixed, ordered execution stages. */
export type Stage = "input" | "update" | "physics" | "sync" | "render";

/** A system run each tick for its stage. */
export type System = (world: World, dt: number) => void;

/**
 * A component value bound to its token (spawn payload form).
 * `component` is typed as `Component<never>` so any `Component<T>` is assignable here.
 */
export type ComponentInit = { readonly component: Component<never>; readonly value: unknown };

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
  /**
   * Define a component with a default-value factory. Pass `opts.name` to make the
   * component discoverable by name through the introspection facet (`componentNames`,
   * `componentsOf`) — used by tooling such as the mcp plugin.
   */
  defineComponent<T extends object>(
    create: () => T,
    opts?: { storage?: StorageStrategy; name?: string }
  ): Component<T>;
  /** Define a presence-only tag. Pass `opts.name` to make it introspectable by name. */
  defineTag(opts?: { storage?: StorageStrategy; name?: string }): Tag;
  /** Create an entity with the given component values. */
  spawn(...parts: ComponentInit[]): Entity;
  /** Destroy an entity and recycle its index (generation bumped). */
  despawn(entity: Entity): void;
  /** True if the handle refers to a live entity. */
  isAlive(entity: Entity): boolean;
  /** Add a component to an entity (merges value). */
  add<T extends object>(entity: Entity, component: Component<T>, value?: Partial<T>): void;
  /** Remove a component from an entity. */
  remove<T extends object>(entity: Entity, component: Component<T>): void;
  /** True if the entity has the component. */
  has<T extends object>(entity: Entity, component: Component<T>): boolean;
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

  // ── Introspection (read-only — for tooling such as the mcp plugin) ──────────

  /**
   * Return a snapshot array of every currently-live entity handle.
   *
   * Order is unspecified. The array is a fresh copy — mutating it does not affect the world.
   * Includes entities with no components (bare `spawn()`).
   *
   * @returns A read-only array of live entity handles.
   * @example
   * ```ts
   * for (const entity of world.liveEntities()) console.log(world.componentsOf(entity));
   * ```
   */
  liveEntities(): readonly Entity[];

  /**
   * Return the number of currently-live entities (direct count — cheaper than `liveEntities().length`).
   *
   * @returns The count of live entities.
   * @example
   * ```ts
   * const n = world.entityCount(); // e.g. 42
   * ```
   */
  entityCount(): number;

  /**
   * Return the names of all components defined with an `opts.name` (registration order).
   * Anonymous components are not listed.
   *
   * @returns A read-only array of registered component names.
   * @example
   * ```ts
   * world.componentNames(); // ["Transform", "Velocity", "Paddle"]
   * ```
   */
  componentNames(): readonly string[];

  /**
   * Return the **named** components currently on an entity, paired with their live values.
   * Anonymous (unnamed) components are omitted; a dead or unknown entity yields `[]`.
   *
   * @param entity - The entity to inspect.
   * @returns A read-only array of `{ name, value }` for each named component the entity has.
   * @example
   * ```ts
   * world.componentsOf(ball); // [{ name: "Transform", value: { x: 10, y: 5, ... } }]
   * ```
   */
  componentsOf(entity: Entity): ReadonlyArray<{ name: string; value: unknown }>;

  /**
   * Resolve a component registered with `opts.name` to its callable component token.
   *
   * The token's value type is widened to `Record<string, unknown>` so callers can pass
   * partial values without per-component generics or inline casts. Use the returned token
   * with the existing `add` / `set` / `get` / `has` / `remove` methods.
   *
   * Returns `undefined` when:
   * - No component with that exact name has been registered.
   * - The component was defined without `opts.name` (anonymous).
   *
   * **Duplicate names:** if two components share the same `opts.name`, the first one
   * registered is returned. Prefer unique names to avoid ambiguity.
   *
   * @param name - The `opts.name` value passed to `defineComponent` or `defineTag`.
   * @returns The matching component token, widened to `Component<Record<string, unknown>>`,
   *   or `undefined` if no named component with that name is found.
   * @example
   * ```ts
   * const Position = world.defineComponent(() => ({ x: 0, y: 0 }), { name: "Position" });
   * const token = world.componentByName("Position"); // same token reference
   * if (token) world.add(entity, token, { x: 5 });
   * ```
   */
  componentByName(name: string): Component<Record<string, unknown>> | undefined;

  // ── Resources (typed singletons) ──────────────────────────────────────────

  /**
   * Define a world resource and return its typed token. An optional `create` factory lazily
   * initialises the value on the first read (memoized). The token carries a stable, auto-generated
   * key (`"res:N"`). Call once at module / setup scope.
   *
   * @param create - Optional factory called once on first read to produce the initial value.
   * @returns A `Resource<T>` token used to read/write the resource.
   * @example
   * ```ts
   * const Score = world.defineResource(() => ({ value: 0, combo: 1 }));
   * ```
   */
  defineResource<T>(create?: () => T): Resource<T>;

  /**
   * Store or replace a resource value. Applies IMMEDIATELY, even during iteration (never
   * command-buffered).
   *
   * @param resource - The resource token identifying which resource to set.
   * @param value - The value to store.
   * @example
   * ```ts
   * world.setResource(Score, { value: 100, combo: 3 });
   * ```
   */
  setResource<T>(resource: Resource<T>, value: T): void;

  /**
   * Read a resource value. Lazily initialises from `create` if the factory was registered and the
   * value is unset (memoized thereafter). Returns `undefined` if neither a value nor a factory
   * exists.
   *
   * @param resource - The resource token identifying which resource to read.
   * @returns The resource value, or `undefined` if unset with no factory.
   * @example
   * ```ts
   * const score = world.getResource(Score); // { value: 0, combo: 1 } | undefined
   * ```
   */
  getResource<T>(resource: Resource<T>): T | undefined;

  /**
   * Read a resource value. Throws a clear, actionable error if the resource is unset and no
   * factory was registered.
   *
   * @param resource - The resource token identifying which resource to read.
   * @returns The resource value (never `undefined`).
   * @throws {Error} When the resource is unset and no factory exists.
   * @example
   * ```ts
   * const score = world.resource(Score); // { value: 0, combo: 1 }
   * ```
   */
  resource<T>(resource: Resource<T>): T;

  /**
   * Return `true` if reading this resource would succeed — i.e. a value is set, OR a default
   * factory was registered.
   *
   * @param resource - The resource token to check.
   * @returns `true` if `getResource` would return a non-`undefined` value (or would initialise one).
   * @example
   * ```ts
   * world.hasResource(Score); // true if Score is set or has a factory
   * ```
   */
  hasResource<T>(resource: Resource<T>): boolean;

  /**
   * Clear the stored value for this resource. A factory, if any, will re-initialise the value on
   * the next read. Never command-buffered — applies immediately even during iteration.
   *
   * @param resource - The resource token to clear.
   * @example
   * ```ts
   * world.removeResource(Score);
   * ```
   */
  removeResource<T>(resource: Resource<T>): void;
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
