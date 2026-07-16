# reflection

> Standard plugin — a field-schema registry for named ECS components: infer a `FieldDescriptor[]` from a live value, or register a typed schema built from the `field.*` builders; `validate` a partial value against its descriptors. **Phase-1 F1** added two schema-only reference kinds — `entity-ref` and `asset-ref` — so the inspector can render entity/asset picker controls.

`reflection` answers one read — `describe(componentName): FieldDescriptor[]` — via two paths: **inference** (the default, zero-author-burden path that reads a representative live component value and classifies each key by `typeof`) and an **opt-in typed schema** authored with `field.*` and installed with `register`. A registered schema always wins over inference for that name. `validate(componentName, partial)` checks a partial component value against its descriptors — this is the function `commands.setValidator` receives, wired by a higher plugin (`editor-bridge`/`serialization`), so `reflection` and `commands` stay siblings that both depend on `ecs` only.

The field-descriptor vocabulary follows Unity's `[SerializeField]`/`[Range]`/enum-dropdown model and the Leva/Tweakpane/dat.GUI "object of controls keyed by field name" shape.

Pure registry — no runtime resource, no scheduler system, no Pixi view. It resolves `ecs` lazily at call time (`ctx.require(ecsPlugin)`), exactly like `scheduler`, so it needs no `onInit`/`onStart`/`onStop`. Headless-safe: with no live entity carrying a component, inference simply returns `[]`. Emits no events.

## API

Accessed as `app.reflection.*` after `createApp()`:

### `describe(componentName: string): FieldDescriptor[]`

The field descriptors for a named component: a registered schema if one exists, else inferred from a live value (memoized), else `[]` (unknown/anonymous component, or a named component with no live instance and no registered schema).

```ts
app.reflection.describe("Enemy");
// => [{ kind: "number", key: "hp", label: "Hp" }, { kind: "boolean", key: "alive", label: "Alive" }, ...]
```

### `register(componentName: string, schema: Schema): void`

Registers a typed schema (a `Record<string, FieldSpec>` built from `field.*`) for a component name. It shadows inference for that name thereafter and clears any stale memoized inference.

```ts
import { field } from "./plugins/reflection";

app.reflection.register("Enemy", {
  hp: field.number({ min: 0, max: 100 }),
  state: field.select(["idle", "dead"])
});
```

### `validate(componentName: string, partial: Readonly<Record<string, unknown>>): ValidationResult`

Validates a partial component value against `describe(componentName)`'s descriptors — type, range, options, readonly, and vector shape. Pure over `(descriptors, partial)`. An empty descriptor set is **permissive** (`{ ok: true }`) — `commands` has already performed its own structural checks (entity alive, component known, value is an object).

```ts
app.reflection.validate("Enemy", { hp: 150 });
// => { ok: false, errors: [{ key: "hp", message: "above maximum 100" }] }

app.reflection.validate("Enemy", { hp: 50 });
// => { ok: true }
```

### `field: FieldBuilders`

The `field.*` builder set, also re-exported standalone (`import { field } from "./plugins/reflection"`) for module-scope schema authoring, before the app starts.

| Builder | Returns | Example |
|---|---|---|
| `field.number(opts?)` | `NumberFieldSpec` | `field.number({ min: 0, max: 1, step: 0.05 })` |
| `field.boolean()` | `BooleanFieldSpec` | `field.boolean()` |
| `field.string()` | `StringFieldSpec` | `field.string()` |
| `field.color()` | `ColorFieldSpec` | `field.color()` (value is a `#rrggbb`/`#rrggbbaa` string) |
| `field.select(options)` | `SelectFieldSpec` | `field.select(["idle", "run", "jump"])` |
| `field.vector2()` | `Vector2FieldSpec` | `field.vector2()` |
| `field.entityRef()` | `EntityRefFieldSpec` | `field.entityRef()` (value is an `EditorId`/`number`, or `undefined`) — **schema-only**, never inferred |
| `field.assetRef()` | `AssetRefFieldSpec` | `field.assetRef()` (value is an asset alias `string`, or `undefined`) — **schema-only**, never inferred |
| `field.readonly(inner)` | same kind as `inner`, `readonly: true` | `field.readonly(field.number())` |

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `humanizeLabels` | `boolean` | `true` | When `true`, an inferred/registered descriptor's `label` is a humanized Title Case form of its `key` (e.g. `scaleX` → "Scale X", `hit_points` → "Hit Points"); when `false`, `label` is the raw `key`. Only affects the display `label`, never the `key` used for reads/writes. |

## Events

None. `reflection` is a read/registry surface — schema registration and describe are pull, not push. Downstream reactivity (an inspector re-reading values) is poll-on-epoch via the `ecs` `changeEpoch`, owned by the consumer, not signalled here.

## Usage Example

```ts
import { createApp } from "./index";
import { field } from "./plugins/reflection";

const app = createApp();

const Enemy = app.ecs.defineComponent(
  () => ({ hp: 100, alive: true, name: "orc", pos: { x: 0, y: 0 } }),
  { name: "Enemy" }
);
app.ecs.spawn(Enemy({ hp: 100, alive: true, name: "orc", pos: { x: 0, y: 0 } }));

// Infer path — zero author effort, works the moment a named component has a live instance.
app.reflection.describe("Enemy");
// => number/boolean/string/vector2 descriptors with humanized labels

// Typed opt-in path — recovers what `typeof` can't (bounds, enums, readonly).
app.reflection.register("Enemy", {
  hp: field.number({ min: 0, max: 100 }),
  state: field.select(["idle", "dead"])
});
app.reflection.describe("Enemy"); // now returns the registered set

app.reflection.validate("Enemy", { hp: 150 }); // { ok: false, errors: [...] }

// Phase-1 F1 — reference kinds are schema-only; inference can never originate them.
app.reflection.register("Enemy", { target: field.entityRef(), icon: field.assetRef() });
app.reflection.validate("Enemy", { target: 42 }); // { ok: true } (an EditorId, or undefined)
app.reflection.validate("Enemy", { target: "x" }); // { ok: false } — not a number
app.reflection.validate("Enemy", { icon: "hero" }); // { ok: true } (an asset alias, or undefined)
app.reflection.validate("Enemy", { icon: 3 }); // { ok: false } — not a string
```

## Design Notes

- **Two type paths, no generics, no single mapped type.** `describe`/`register`/`validate` take/return plain, closed types. Inference produces `FieldDescriptor[]` at runtime tagged by `kind`; a typed schema is a hand-written `Record<string, FieldSpec>`. This sidesteps the strict-flag trap (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) of a `type FieldsOf<T> = { [K in keyof T]: Field<T[K]> }` mapped type.
- **Registered always wins.** `describe` checks `state.schemas` first, then the `state.inferred` memo, then falls back to inference. `register` clears the matching `inferred` entry so a subsequent `describe` doesn't resurrect a stale inferred set.
- **Conservative inference.** `inferField` (in `infer.ts`) classifies only `number`/`boolean`/`string`/a two-key `{x:number,y:number}` object; anything else (arrays, functions, nested non-vector objects) is skipped rather than guessed.
- **Reference kinds are schema-only (Phase-1 F1).** `entity-ref`/`asset-ref` can only be introduced via `register` — `inferField` never emits them because a bare `number`/`string` is ambiguous between a plain value and a reference (an `EditorId`/asset alias). `validate` accepts `number | undefined` for `entity-ref` and `string | undefined` for `asset-ref` (`undefined` means "unset").
- **`validate` is a pure seam function.** `validateAgainst(descriptors, partial)` (in `validate.ts`) has no world dependency — it is the function a higher plugin wires into `commands.setValidator`. `reflection` never imports `commands`; the dependency graph stays a clean tree.
- **No lifecycle hooks.** `reflection` owns no runtime resource and resolves `ecs` lazily inside `describe`/`validate` via `ctx.require(ecsPlugin)` — the same reason `scheduler` (also `depends: [ecs]`, also a forwarding facade) declares no `onStart`.
- **Structural context pattern.** `createApi` accepts a minimal structural `ReflectionApiContext` (`config`, `state`, `log`, `require`) rather than the full kernel context, so unit tests can supply a lightweight mock without wiring the whole framework.

## Dependencies

- **`ecs`** — declared via `depends: [ecsPlugin]` and resolved with `ctx.require(ecsPlugin)` lazily inside `describe`. Uses `world.componentByName` (confirm a name is a real named component), `world.liveEntities` + `world.componentsOf` (find a representative live value to infer from). No other edges — in particular no edge to `commands`; rich validation reaches `commands` through its `setValidator` seam, wired by a higher plugin (`editor-bridge`/`serialization`). No package dependencies beyond `@moku-labs/core`.
