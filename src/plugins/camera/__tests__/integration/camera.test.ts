/**
 * @file camera plugin — integration tests.
 *
 * Boots the real ecs + scheduler + renderer (headless) + loop + tween + camera stack
 * via `createApp` and drives it through `app.scheduler.tick` / `app.loop.step`. Proves:
 * `app.camera` exposes the full surface; `setPosition`/`getPosition` round-trips; an
 * animated `moveTo` advances the centre toward its target across real ticks and its
 * `done` resolves; a paused loop FREEZES an in-flight `moveTo` (the pause-safe
 * acceptance, with no `platform`/`loop` dependency edge) and resuming continues it;
 * `follow` pulls the centre toward a moving target; `shake` starts an `app.tween` decay
 * that completes over ticks; and — with an injected stage — `camera.world` is a
 * `Container` parented under the stage at index 0 and the live transform round-trips.
 */
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { loopPlugin } from "../../../loop";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { tweenPlugin } from "../../../tween";
import { cameraPlugin } from "../../index";

/** Boot a headless ecs+scheduler+renderer+loop+tween+camera app. */
const bootApp = async () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, loopPlugin, tweenPlugin, cameraPlugin]
  });
  const app = createApp();
  await app.start();
  return app;
};

const SURFACE = [
  "addLayer",
  "layer",
  "follow",
  "setPosition",
  "moveTo",
  "getPosition",
  "setZoom",
  "zoomTo",
  "getZoom",
  "setRotation",
  "rotateTo",
  "getRotation",
  "shake",
  "screenToWorld",
  "worldToScreen"
] as const;

describe("camera integration", () => {
  it("exposes app.camera with the full surface; world is undefined headless", async () => {
    const app = await bootApp();
    const camera = app.camera as unknown as Record<string, unknown>;
    for (const method of SURFACE) expect(typeof camera[method]).toBe("function");
    expect("world" in app.camera).toBe(true);
    expect(app.camera.world).toBeUndefined(); // real headless boot → no stage → no world layer
    expect(app.camera.addLayer("bg", 0.5)).toBeUndefined(); // headless — no layer created
    await app.stop();
  });

  it("setPosition / getPosition round-trips (getPosition is a copy)", async () => {
    const app = await bootApp();
    app.camera.setPosition(120, -40);
    expect(app.camera.getPosition()).toEqual({ x: 120, y: -40 });

    const p = app.camera.getPosition();
    p.x = 999; // mutating the copy must not change camera state
    expect(app.camera.getPosition().x).toBe(120);
    await app.stop();
  });

  it("moveTo advances the centre toward the target across ticks and resolves done", async () => {
    const app = await bootApp();
    app.camera.setPosition(0, 0);
    const handle = app.camera.moveTo(100, 50, { duration: 1, easing: "linear" });

    app.scheduler.tick(0.5);
    expect(app.camera.getPosition().x).toBeCloseTo(50, 6);
    expect(app.camera.getPosition().y).toBeCloseTo(25, 6);

    app.scheduler.tick(0.5);
    expect(app.camera.getPosition().x).toBeCloseTo(100, 6);
    await expect(handle.done).resolves.toBeUndefined();
    await app.stop();
  });

  it("freezes an in-flight moveTo while the loop is not stepping (pause-safe)", async () => {
    const app = await bootApp();
    app.camera.setPosition(0, 0);
    app.camera.moveTo(1000, 0, { duration: 10, easing: "linear" });

    app.loop.step(); // the loop drives scheduler.tick → the pan advances
    const afterStep = app.camera.getPosition().x;
    expect(afterStep).toBeGreaterThan(0);

    // "Ad break" — the loop is not stepping. A private rAF/timer would keep panning;
    // a scheduler-driven tween cannot.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(app.camera.getPosition().x).toBe(afterStep); // frozen

    app.loop.step(); // resume stepping → advances further
    expect(app.camera.getPosition().x).toBeGreaterThan(afterStep);
    await app.stop();
  });

  it("follow pulls the centre toward a moving target over ticks", async () => {
    const app = await bootApp();
    app.camera.setPosition(0, 0);
    const target = { x: 100, y: 0 };
    app.camera.follow(target);

    for (let i = 0; i < 30; i++) app.scheduler.tick(1 / 60);
    const near = app.camera.getPosition().x;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThanOrEqual(100);

    target.x = 200; // the target keeps moving — the camera keeps chasing
    for (let i = 0; i < 60; i++) app.scheduler.tick(1 / 60);
    expect(app.camera.getPosition().x).toBeGreaterThan(near);
    await app.stop();
  });

  it("shake starts an app.tween decay that completes over ticks", async () => {
    const app = await bootApp();
    const before = app.tween.count();
    app.camera.shake(20, 0.5, { easing: "linear" });
    expect(app.tween.count()).toBe(before + 1); // a decay tween is active

    for (let i = 0; i < 40; i++) app.scheduler.tick(1 / 60); // > 0.5 s elapsed
    expect(app.tween.count()).toBe(before); // decay completed + dropped
    await app.stop();
  });

  it("with an injected stage, builds the world layer at stage index 0 and transforms it", async () => {
    const stage = new Container();
    const { createApp } = coreConfig.createCore(coreConfig, {
      plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, loopPlugin, tweenPlugin, cameraPlugin]
    });
    const app = createApp();
    app.renderer.getStage = () => stage; // inject a headless-safe stage before start
    await app.start();

    expect(app.camera.world).toBeInstanceOf(Container);
    expect(stage.children[0]).toBe(app.camera.world); // parented at the bottom (index 0)

    // addLayer stacks above `world` (index 0) and returns the same container `layer` resolves.
    const bg = app.camera.addLayer("bg", 0.5);
    expect(bg).toBeInstanceOf(Container);
    expect(app.camera.layer("bg")).toBe(bg);
    expect(stage.children[1]).toBe(bg); // stacked above world, below where the ui overlay would sit
    expect(app.camera.addLayer("bg", 0.9)).toBe(bg); // idempotent by name

    // The apply system writes the live transform to the world container each tick.
    app.camera.setPosition(50, 25);
    app.camera.setZoom(2);
    app.scheduler.tick(1 / 60);
    expect(app.camera.world?.pivot.x).toBe(50);
    expect(app.camera.world?.scale.x).toBe(2);

    // The screen↔world mapping is an exact inverse under a real transform.
    const round = app.camera.screenToWorld(app.camera.worldToScreen({ x: 10, y: 20 }));
    expect(round.x).toBeCloseTo(10, 6);
    expect(round.y).toBeCloseTo(20, 6);
    await app.stop();
  });
});
