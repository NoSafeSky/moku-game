/**
 * @file ui plugin — integration tests.
 *
 * Boots the real ecs + scheduler + renderer + input + ui stack via `createApp`.
 * Proves: `app.ui` is wired with every method; the headless path (renderer
 * auto-headless in Node → no stage) builds nothing and every method is safe; and,
 * with a real (injected) stage, screens/HUD build under the root, the hit-test system
 * ticks without throwing, live widgets mutate, and pop tears the subtree down.
 *
 * The pointer-driven `onTap` firing + modal capture are covered by `system.test.ts`
 * (the input plugin exposes no public pointer-injection, and a real renderer stage
 * needs a GPU) — here the stage is injected by overriding `renderer.getStage()`.
 */
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { schedulerPlugin } from "../../../scheduler";
import { uiPlugin } from "../../index";

/** Boot an ecs+scheduler+renderer+input+ui app (renderer headless auto-detected). */
const bootApp = () => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, schedulerPlugin, rendererPlugin, inputPlugin, uiPlugin]
  });
  return createApp();
};

/** Whether any descendant Text node renders `target`. */
const hasText = (node: Container, target: string): boolean => {
  const view = node as unknown as { text?: unknown; children: Container[] };
  if (typeof view.text === "string" && view.text === target) return true;
  return view.children.some(child => hasText(child, target));
};

describe("ui integration", () => {
  // The input plugin resolves "window" → an EventTarget in onStart; provide one
  // (as the input plugin's own integration test does) so listeners attach in Node.
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = new EventTarget();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("boots headless: app.ui is present, builds no root, every method is safe", async () => {
    const app = bootApp();
    await app.start();

    expect(app.ui).toBeDefined();
    expect(app.ui.getRoot()).toBeUndefined(); // renderer headless → no stage → no root

    const screen = app.ui.pushScreen({
      widgets: [{ kind: "button", text: "Play", onTap: () => {} }]
    });
    expect(app.ui.screenCount()).toBe(0); // headless — built nothing
    const hud = app.ui.addHud({ kind: "label", text: "0" });

    expect(() => {
      for (let i = 0; i < 5; i++) app.scheduler.tick(1 / 60);
      app.ui.setText(hud, "9");
      app.ui.setValue(hud, 5);
      app.ui.setVisible(hud, false);
      app.ui.popScreen();
      app.ui.clearScreens();
      app.ui.getWidget(screen, "x");
    }).not.toThrow();

    await app.stop();
  });

  it("builds UI into an injected stage, ticks the hit-test system, and mutates widgets", async () => {
    const stage = new Container();
    const app = bootApp();
    app.renderer.getStage = () => stage; // inject a real, headless-safe stage before start
    await app.start();

    expect(app.ui.getRoot()).toBeDefined();

    const score = app.ui.addHud({ kind: "label", text: "0", x: 16, y: 16, anchor: { x: 0, y: 0 } });
    const hp = app.ui.addHud({
      kind: "bar",
      value: 100,
      max: 100,
      x: 16,
      y: 44,
      width: 160,
      height: 12
    });

    const title = app.ui.pushScreen({
      backdrop: {},
      widgets: [{ kind: "label", text: "ASCEND", x: 400, y: 200 }]
    });
    expect(app.ui.screenCount()).toBe(1);
    expect(app.ui.topScreen()?.id).toBe(title.id);

    // Ticking runs the ui hit-test system (pointer at rest) without throwing.
    expect(() => {
      for (let i = 0; i < 3; i++) app.scheduler.tick(1 / 60);
    }).not.toThrow();

    app.ui.setText(score, "1200");
    app.ui.setValue(hp, 40);
    expect(hasText(app.ui.getRoot() as Container, "1200")).toBe(true);

    app.ui.popScreen();
    expect(app.ui.screenCount()).toBe(0);

    await app.stop();
  });
});
