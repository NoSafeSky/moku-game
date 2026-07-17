/**
 * @file graphics-2d plugin — integration tests.
 *
 * Boots a real ecs + scheduler + renderer + reflection + component-registry + assets + graphics-2d
 * stack via `createApp` (headless — the renderer auto-detects no DOM in Node), with NO `pixi.js`
 * import or mock anywhere: graphics-2d only ever touches the render backend through the renderer's
 * plain-data API, so spying on that API is enough to observe the whole reconcile pipeline.
 *
 * Proves: `onStart` defines both components NAMED on the world, registers the two reflection
 * schemas (registered-wins-over-inferred) and the three catalog entries, injects an
 * `assets → renderer` texture resolver that resolves a loaded alias and yields `undefined` for an
 * unknown one, and registers a `sync`-stage system that attaches / rebuilds / detaches views as the
 * components come and go.
 */
import { describe, expect, it, vi } from "vitest";
import { coreConfig } from "../../../../config";
import { assetsPlugin } from "../../../assets";
import { componentRegistryPlugin } from "../../../component-registry";
import { ecsPlugin } from "../../../ecs";
import { reflectionPlugin } from "../../../reflection";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { createShape, createSpriteRenderer } from "../../components";
import { graphics2dPlugin } from "../../index";

/**
 * Dependency-ordered plugin array (`depends` is validation-only — order is explicit). graphics-2d
 * is registered LAST so its `sync` system runs after the renderer's own transform sync.
 */
const PLUGINS = [
  ecsPlugin,
  schedulerPlugin,
  rendererPlugin,
  reflectionPlugin,
  componentRegistryPlugin,
  assetsPlugin,
  graphics2dPlugin
];

/** Boot the headless graphics-2d stack. */
const bootApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, { plugins: PLUGINS });
  return createApp();
};

/** A default-ish Transform value, so a spawned entity is renderable. */
const transformValue = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };

describe("graphics-2d integration — component definition", () => {
  it("defines SpriteRenderer and Shape as NAMED components on the ecs world", async () => {
    const app = bootApp();
    await app.start();

    expect(app.ecs.componentNames()).toContain("SpriteRenderer");
    expect(app.ecs.componentNames()).toContain("Shape");

    await app.stop();
  });

  it("exposes the same token instance the world resolves by name", async () => {
    const app = bootApp();
    await app.start();

    expect(app["graphics-2d"].Shape).toBe(app.ecs.componentByName("Shape"));
    expect(app["graphics-2d"].SpriteRenderer).toBe(app.ecs.componentByName("SpriteRenderer"));

    await app.stop();
  });

  it("throws on a token getter read before start", () => {
    const app = bootApp();

    expect(() => app["graphics-2d"].Shape).toThrow(/accessed before start/);
  });

  it("spawns an entity carrying the Shape defaults through the callable token", async () => {
    const app = bootApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].Shape(createShape())
    );

    expect(app.ecs.get(entity, app["graphics-2d"].Shape)).toEqual(createShape());

    await app.stop();
  });
});

describe("graphics-2d integration — reflection schemas", () => {
  it("registers the SpriteRenderer schema, including the NEW asset-ref sprite field", async () => {
    const app = bootApp();
    await app.start();

    const byKey = Object.fromEntries(
      app.reflection.describe("SpriteRenderer").map(field => [field.key, field.kind])
    );

    expect(byKey.sprite).toBe("asset-ref");
    expect(byKey.tint).toBe("color");
    expect(byKey.flipX).toBe("boolean");
    expect(byKey.sortingLayer).toBe("select");
    expect(byKey.orderInLayer).toBe("number");

    await app.stop();
  });

  it("registers the Shape schema", async () => {
    const app = bootApp();
    await app.start();

    const byKey = Object.fromEntries(
      app.reflection.describe("Shape").map(field => [field.key, field.kind])
    );

    expect(byKey.kind).toBe("select");
    expect(byKey.width).toBe("number");
    expect(byKey.height).toBe("number");
    expect(byKey.radius).toBe("number");
    expect(byKey.fill).toBe("color");
    expect(byKey.stroke).toBe("color");
    expect(byKey.strokeWidth).toBe("number");

    await app.stop();
  });

  it("wins over inference — a live Shape instance does not downgrade fill to a plain string", async () => {
    const app = bootApp();
    await app.start();

    app.ecs.spawn(app["graphics-2d"].Shape(createShape()));
    const fill = app.reflection.describe("Shape").find(field => field.key === "fill");

    expect(fill?.kind).toBe("color");

    await app.stop();
  });

  it("validates a registered schema — rejecting an unknown sortingLayer and a negative width", async () => {
    const app = bootApp();
    await app.start();

    expect(app.reflection.validate("SpriteRenderer", { sortingLayer: "Nope" }).ok).toBe(false);
    expect(app.reflection.validate("SpriteRenderer", { sortingLayer: "Player" }).ok).toBe(true);
    expect(app.reflection.validate("Shape", { width: -1 }).ok).toBe(false);
    expect(app.reflection.validate("Shape", { width: 10 }).ok).toBe(true);

    await app.stop();
  });
});

describe("graphics-2d integration — component-registry catalog", () => {
  it("registers Transform as a non-addable Transform-category entry", async () => {
    const app = bootApp();
    await app.start();

    const transform = app["component-registry"].get("Transform");

    expect(transform?.addable).toBe(false);
    expect(transform?.category).toBe("Transform");
    expect(transform?.defaults).toEqual(transformValue);

    await app.stop();
  });

  it("registers SpriteRenderer and Shape as addable Rendering entries seeded from create()", async () => {
    const app = bootApp();
    await app.start();

    const registry = app["component-registry"];

    expect(registry.get("SpriteRenderer")).toEqual({
      name: "SpriteRenderer",
      category: "Rendering",
      addable: true,
      defaults: createSpriteRenderer()
    });
    expect(registry.get("Shape")).toEqual({
      name: "Shape",
      category: "Rendering",
      addable: true,
      defaults: createShape()
    });

    await app.stop();
  });

  it("offers exactly SpriteRenderer and Shape under the Rendering picker section", async () => {
    const app = bootApp();
    await app.start();

    const rendering = app["component-registry"].byCategory().get("Rendering") ?? [];

    expect(rendering.map(entry => entry.name)).toEqual(["SpriteRenderer", "Shape"]);

    await app.stop();
  });
});

describe("graphics-2d integration — texture resolver injection", () => {
  it("injects an assets → renderer resolver that resolves a loaded alias, and undefined otherwise", async () => {
    const app = bootApp();
    const setResolver = vi.spyOn(app.renderer, "setTextureResolver");

    // An opaque stand-in for a loaded texture: graphics-2d passes it straight through as the
    // renderer's TextureHandle and never dereferences it, so its shape is irrelevant.
    const loaded = { opaque: true } as unknown as ReturnType<typeof app.assets.get>;
    vi.spyOn(app.assets, "get").mockImplementation(alias =>
      alias === "ship" ? loaded : undefined
    );

    await app.start();

    expect(setResolver).toHaveBeenCalledTimes(1);
    const resolve = setResolver.mock.calls[0]?.[0];

    expect(resolve?.("ship")).toBe(loaded);
    expect(resolve?.("not-loaded")).toBeUndefined();

    await app.stop();
  });
});

describe("graphics-2d integration — render-sync system", () => {
  it("attaches a primitive on the sync tick after an entity gains a Shape", async () => {
    const app = bootApp();
    const attachPrimitive = vi.spyOn(app.renderer, "attachPrimitive");
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].Shape({ ...createShape(), fill: "#ff0000", width: 40, height: 20 })
    );
    app.ecs.tick(1 / 60);

    expect(attachPrimitive).toHaveBeenCalledWith(entity, {
      shape: "rect",
      width: 40,
      height: 20,
      fill: 0xff_00_00,
      strokeWidth: 0,
      label: "Shape"
    });

    await app.stop();
  });

  it("rebuilds the view when a Shape field is mutated on the world", async () => {
    const app = bootApp();
    const attachPrimitive = vi.spyOn(app.renderer, "attachPrimitive");
    const detach = vi.spyOn(app.renderer, "detach");
    const markDirty = vi.spyOn(app.renderer, "markDirty");
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].Shape(createShape())
    );
    app.ecs.tick(1 / 60);
    attachPrimitive.mockClear();

    app.ecs.set(entity, app["graphics-2d"].Shape, { kind: "circle", radius: 8 });
    app.ecs.tick(1 / 60);

    expect(detach).toHaveBeenCalledWith(entity);
    expect(attachPrimitive).toHaveBeenCalledWith(
      entity,
      expect.objectContaining({ shape: "circle", radius: 8 })
    );
    expect(markDirty).toHaveBeenCalledWith(entity);

    await app.stop();
  });

  it("attaches a sprite for a SpriteRenderer, forwarding alias/tint/flipX", async () => {
    const app = bootApp();
    const attachSprite = vi.spyOn(app.renderer, "attachSprite");
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].SpriteRenderer({ ...createSpriteRenderer(), sprite: "ship", flipX: true })
    );
    app.ecs.tick(1 / 60);

    expect(attachSprite).toHaveBeenCalledWith(entity, {
      alias: "ship",
      tint: "#ffffff",
      flipX: true
    });

    await app.stop();
  });

  it("detaches the view when the component is removed from a live entity", async () => {
    const app = bootApp();
    const detach = vi.spyOn(app.renderer, "detach");
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].Shape(createShape())
    );
    app.ecs.tick(1 / 60);
    detach.mockClear();

    app.ecs.remove(entity, app["graphics-2d"].Shape);
    app.ecs.tick(1 / 60);

    expect(detach).toHaveBeenCalledWith(entity);
    expect(app.ecs.isAlive(entity)).toBe(true);

    await app.stop();
  });

  it("detaches the view on despawn", async () => {
    const app = bootApp();
    const detach = vi.spyOn(app.renderer, "detach");
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].Shape(createShape())
    );
    app.ecs.tick(1 / 60);
    detach.mockClear();

    app.ecs.despawn(entity);
    app.ecs.tick(1 / 60);

    expect(detach).toHaveBeenCalledWith(entity);

    await app.stop();
  });

  it("stays inert on a tick with no world write (the changeEpoch gate)", async () => {
    const app = bootApp();
    const attachPrimitive = vi.spyOn(app.renderer, "attachPrimitive");
    await app.start();

    app.ecs.spawn(app.renderer.Transform(transformValue), app["graphics-2d"].Shape(createShape()));
    app.ecs.tick(1 / 60);
    attachPrimitive.mockClear();

    app.ecs.tick(1 / 60);
    app.ecs.tick(1 / 60);

    expect(attachPrimitive).not.toHaveBeenCalled();

    await app.stop();
  });

  it("is headless-tolerant — attach returning false never throws", async () => {
    const app = bootApp();
    await app.start();

    const entity = app.ecs.spawn(
      app.renderer.Transform(transformValue),
      app["graphics-2d"].Shape(createShape())
    );

    expect(() => {
      app.ecs.tick(1 / 60);
    }).not.toThrow();
    expect(app.renderer.getEntityView(entity)).toBeUndefined();

    await app.stop();
  });
});
