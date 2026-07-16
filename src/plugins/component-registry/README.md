# component-registry

> Standard plugin — a pure enumerable catalog of addable components for the inspector's Add-Component picker (register / list / byCategory / get / has). No world access, no config, no lifecycle.

`component-registry` holds one `Map<string, ComponentCatalogEntry>` and exposes a five-method read/register API. It is the authoritative, enumerable list of the component **types** a user may add through the editor's Add-Component picker — each entry carries the component's `category`, creation `defaults`, and `addable` flag. It **never touches the ECS world**: an entry's `defaults` is plain data that `editor-bridge` merges into an `addComponent` command; the registry never spawns, reads, or validates an entity.

Population is a **runtime act of the plugins that own the components**, not of this plugin — `graphics-2d` registers `Transform`/`SpriteRenderer`/`Shape` at its own `onStart`. The registry itself has no lifecycle: its `Map` is ready the moment `createState` runs, and there is no external resource to release on stop.

## API

Accessed as `app["component-registry"].*` after `createApp()`:

### `register(entry: ComponentCatalogEntry): void`

Registers (or replaces) a catalog entry. Idempotent by `entry.name` — last-write wins. Re-registering an existing name logs a `ctx.log.warn` once before overwriting. Insertion order is preserved for `list()` (a `Map.set` on an existing key keeps the entry's original position).

```ts
app["component-registry"].register({
  name: "Shape",
  category: "Rendering",
  defaults: { kind: "rect" },
  addable: true
});
```

### `list(): readonly ComponentCatalogEntry[]`

All catalog entries in registration order.

```ts
app["component-registry"].list();
// => [{ name: "Transform", ... }, { name: "SpriteRenderer", ... }, { name: "Shape", ... }]
```

### `byCategory(): ReadonlyMap<ComponentCategory, readonly ComponentCatalogEntry[]>`

The catalog grouped by category — a map keyed by **every** `ComponentCategory` (all six sections are present, empty ones as `[]`, so the picker can render empty sections), each value ordered as `list()`.

```ts
app["component-registry"].byCategory().get("Physics"); // [] until a physics component registers
```

### `get(name: string): ComponentCatalogEntry | undefined`

The entry registered under `name`, or `undefined` if none.

### `has(name: string): boolean`

Whether a component named `name` is registered.

## Configuration

None. `Config` is `Record<string, never>` — the registry owns no tunable behavior; its contents come entirely from runtime `register` calls made by domain plugins.

## Events

None. The catalog is a synchronous read/register data structure — a change to it is a runtime setup act (a domain plugin registering at its `onStart`), not a user-observable state transition worth an `emit`. The picker reads the catalog on demand through `editor-bridge.listComponents()`.

## Usage Example

```ts
import { createApp } from "./index";

const app = createApp();

// A domain plugin (graphics-2d) registers its addable components at its own onStart:
app["component-registry"].register({
  name: "Transform",
  category: "Transform",
  defaults: { x: 0, y: 0 },
  addable: false // implicit on every object, never "added" through the picker
});
app["component-registry"].register({
  name: "Shape",
  category: "Rendering",
  defaults: { kind: "rect", width: 100, height: 100 },
  addable: true
});

// editor-bridge reads the catalog for the Add-Component picker:
app["component-registry"].list();
app["component-registry"].byCategory(); // Map<ComponentCategory, entries[]>, all six keys present
```

## Design Notes

- **A regular Standard plugin, not a core plugin.** The catalog is a narrow, opt-in capability only the editor path uses — not a cross-cutting concern every plugin's `ctx` needs (unlike `logPlugin`/`envPlugin`). It is reached the ordinary Moku way: a domain plugin lists it in `depends` and `ctx.require`s it to register; `editor-bridge` `ctx.require`s it to read.
- **Empty `depends` — no world access.** The registry stores and returns only plain data (`ComponentCatalogEntry`). It never resolves an `Entity`, reads a component value, or validates anything against the ECS. The direction of coupling is inward: plugins depend on the registry to write into it, not the reverse.
- **No lifecycle.** `onInit`/`onStart`/`onStop` are all absent. Population is a runtime act of the domain plugins (`graphics-2d.onStart`), not a config-time or start-time act of this plugin; there is no external resource for `onStop` to release.
- **`byCategory` always seeds all six categories.** Even before any domain plugin registers into `Physics`/`Animation`/`Audio`/`Scripts`, `byCategory()` returns those keys mapped to `[]` — the picker can render empty sections rather than omitting them.
- **`register` is last-write-wins, not merge.** Re-registering a name entirely replaces the entry (logging a warn) rather than shallow-merging fields — a double-registration is treated as a setup mistake worth surfacing, not a partial update.

## Dependencies

**None** (`depends: []`). `ctx` provides only `ctx.state` and `ctx.log` (the latter for the register-override warning). Consumers `require` **this** plugin: `graphics-2d` (to `register` its addable components), `editor-bridge` (to `list`/`byCategory`/`get` for the picker). No package dependencies beyond `@moku-labs/core`.
