/**
 * @file vfx plugin — integration tests.
 *
 * Boots the real ecs + scheduler + renderer (headless auto-detected) + vfx stack
 * and drives effects through `app.scheduler.tick`. Proves: `app.vfx` is present;
 * emitters/particles/pop/floating text run end-to-end; MCP-name introspection sees
 * the vfx components; particle + floating lifecycles return to baseline; pop
 * mutates then restores a Transform's scale; and every path runs headless without
 * throwing (no Pixi views built).
 */
import { describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import type { Component } from "../../../ecs/types";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { vfxPlugin } from "../../index";

/** Boot a headless ecs+scheduler+renderer+vfx app (renderer headless auto-detected). */
const bootApp = async () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, vfxPlugin]
  });
  const app = createApp();
  await app.start();
  return app;
};

/** Count live entities carrying the named component (via ecs introspection). */
const countByName = (app: Awaited<ReturnType<typeof bootApp>>, name: string): number => {
  const token = app.ecs.componentByName(name);
  return token ? app.ecs.query(token).count() : 0;
};

describe("vfx integration", () => {
  it("exposes app.vfx with easing + lerp", async () => {
    const app = await bootApp();
    expect(app.vfx).toBeDefined();
    expect(app.vfx.lerp(0, 10, 0.5)).toBe(5);
    expect(app.vfx.easing.linear(0.3)).toBeCloseTo(0.3, 6);
    await app.stop();
  });

  it("defines the four vfx components by name (MCP-introspectable)", async () => {
    const app = await bootApp();
    const names = app.ecs.componentNames();
    for (const n of ["Emitter", "Particle", "Pop", "FloatingText"]) {
      expect(names).toContain(n);
    }
    await app.stop();
  });

  it("createEmitter yields a live entity whose named components are introspectable", async () => {
    const app = await bootApp();
    const emitter = app.vfx.createEmitter({ rate: 60, speed: 100, lifetime: 0.1 });

    expect(app.ecs.isAlive(emitter)).toBe(true);
    const names = app.ecs.componentsOf(emitter).map(c => c.name);
    expect(names).toContain("Emitter");
    expect(names).toContain("Transform");
    await app.stop();
  });

  it("emits particles over ticks and removeEmitter returns to baseline", async () => {
    const app = await bootApp();
    const emitter = app.vfx.createEmitter({ rate: 60, speed: 100, lifetime: 10 });

    app.scheduler.tick(1 / 60); // rate 60 → ≈1 particle
    expect(countByName(app, "Particle")).toBeGreaterThanOrEqual(1);

    app.vfx.removeEmitter(emitter);
    expect(countByName(app, "Particle")).toBe(0);
    expect(app.ecs.isAlive(emitter)).toBe(false);
    await app.stop();
  });

  it("burst raises the particle count, which returns to baseline after lifetimes", async () => {
    const app = await bootApp();
    app.vfx.burst(0, 0, { count: 5, speed: 0, lifetime: 0.05 });
    expect(countByName(app, "Particle")).toBe(5);

    // ~3 ticks of 1/60 s exceed the 0.05 s lifetime.
    for (let i = 0; i < 5; i++) app.scheduler.tick(1 / 60);
    expect(countByName(app, "Particle")).toBe(0);
    await app.stop();
  });

  it("pop mutates then restores a Transform's scale across ticks", async () => {
    const app = await bootApp();
    const Transform = app.renderer.Transform as Component<{
      x: number;
      y: number;
      rotation: number;
      scaleX: number;
      scaleY: number;
    }>;
    const entity = app.ecs.spawn(Transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));

    app.vfx.pop(entity, { scale: 1.5, duration: 0.1 });

    app.scheduler.tick(0.05); // near the apex → scaled up
    expect(app.ecs.get(entity, Transform)?.scaleX).toBeGreaterThan(1);

    app.scheduler.tick(0.06); // past the duration → restored + Pop removed
    expect(app.ecs.get(entity, Transform)?.scaleX).toBeCloseTo(1, 6);
    expect(app.ecs.isAlive(entity)).toBe(true);
    await app.stop();
  });

  it("shake + many ticks runs headless without throwing", async () => {
    const app = await bootApp();
    app.vfx.shake(0.6, 0.3);
    expect(() => {
      for (let i = 0; i < 60; i++) app.scheduler.tick(1 / 60);
    }).not.toThrow();
    app.vfx.stopShake();
    await app.stop();
  });

  it("floatText creates a headless entity that expires over ticks (no Pixi view)", async () => {
    const app = await bootApp();
    const entity = app.vfx.floatText(0, 0, "+10", { lifetime: 0.05 });
    expect(app.ecs.isAlive(entity)).toBe(true);
    expect(countByName(app, "FloatingText")).toBe(1);

    for (let i = 0; i < 5; i++) app.scheduler.tick(1 / 60);
    expect(countByName(app, "FloatingText")).toBe(0);
    await app.stop();
  });
});
