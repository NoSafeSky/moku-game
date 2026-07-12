/**
 * @file tween plugin — integration tests.
 *
 * Boots the real ecs + scheduler + renderer (headless) + loop + tween stack and
 * drives tweens through `app.scheduler.tick` / `app.loop.step`. Proves: `app.tween`
 * is present with a correct easing/lerp surface; object + scalar tweens advance to
 * their targets across real ticks; `done` resolves; and — the pause-safe acceptance
 * — a tween only advances when the loop steps, so a paused loop freezes it with no
 * private clock and no `platform`/`loop` dependency edge.
 */
import { describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { loopPlugin } from "../../../loop";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { tweenPlugin } from "../../index";

/** Boot a headless ecs+scheduler+renderer+loop+tween app. */
const bootApp = async () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, loopPlugin, tweenPlugin]
  });
  const app = createApp();
  await app.start();
  return app;
};

describe("tween integration", () => {
  it("exposes app.tween with easing + lerp", async () => {
    const app = await bootApp();
    expect(app.tween).toBeDefined();
    expect(app.tween.lerp(0, 10, 0.5)).toBe(5);
    expect(app.tween.easing.linear(0.3)).toBeCloseTo(0.3, 6);
    await app.stop();
  });

  it("to advances a plain object to its target across scheduler ticks", async () => {
    const app = await bootApp();
    const obj = { x: 0, y: 0 };
    app.tween.to(obj, { x: 100, y: 50 }, { duration: 1, easing: "linear" });

    app.scheduler.tick(0.5);
    expect(obj.x).toBeCloseTo(50, 6);
    expect(obj.y).toBeCloseTo(25, 6);

    app.scheduler.tick(0.5);
    expect(obj.x).toBeCloseTo(100, 6);
    expect(obj.y).toBeCloseTo(50, 6);
    expect(app.tween.count()).toBe(0); // completed + dropped
    await app.stop();
  });

  it("resolves a value tween's done Promise once it settles", async () => {
    const app = await bootApp();
    let last = 0;
    const handle = app.tween.value(0, 1, {
      duration: 1,
      easing: "linear",
      onUpdate: v => {
        last = v;
      }
    });

    app.scheduler.tick(1);
    await expect(handle.done).resolves.toBeUndefined();
    expect(last).toBeCloseTo(1, 6);
    await app.stop();
  });

  it("freezes while the loop is not stepping and resumes when it steps (pause-safe)", async () => {
    const app = await bootApp();
    const obj = { x: 0 };
    app.tween.to(obj, { x: 100 }, { duration: 10, easing: "linear" });

    app.loop.step(); // the loop drives scheduler.tick → the tween advances
    const afterStep = obj.x;
    expect(afterStep).toBeGreaterThan(0);

    // "Ad break" — the loop is not stepping. A private rAF/timer would keep
    // mutating obj.x as real time passes; a scheduler-driven tween cannot.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(obj.x).toBe(afterStep); // frozen — advancement is step-driven only

    app.loop.step(); // resume stepping → advances further
    expect(obj.x).toBeGreaterThan(afterStep);
    await app.stop();
  });

  it("killAll drops every active tween", async () => {
    const app = await bootApp();
    app.tween.to({ x: 0 }, { x: 1 }, { duration: 5 });
    app.tween.value(0, 1, { duration: 5, onUpdate: () => undefined });
    expect(app.tween.count()).toBe(2);

    app.tween.killAll();
    expect(app.tween.count()).toBe(0);
    await app.stop();
  });
});
