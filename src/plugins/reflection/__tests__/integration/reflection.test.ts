import { describe, expect, it } from "vitest";

import { coreConfig } from "../../../../config";
import { ecsPlugin } from "../../../ecs";
import { field } from "../../field";
import { reflectionPlugin } from "../../index";

// ─── helpers ──────────────────────────────────────────────────

/** Per-plugin config overrides accepted by createTestApp. */
type TestPluginConfigs = { reflection?: { humanizeLabels?: boolean } };

/**
 * Create a minimal test app with only ecs + reflection. Avoids depending on other framework
 * plugins that may be stubs.
 *
 * @param pluginConfigs - Optional per-plugin config overrides.
 * @returns The synchronous app instance.
 */
const createTestApp = (pluginConfigs: TestPluginConfigs = {}) => {
  const { createApp } = coreConfig.createCore(coreConfig, {
    plugins: [ecsPlugin, reflectionPlugin]
  });
  return createApp({ pluginConfigs });
};

/** A representative "Enemy" live value used across the infer-path scenarios below. */
const enemyValue = () => ({ hp: 100, alive: true, name: "orc", pos: { x: 0, y: 0 } });

describe("reflection plugin — integration", () => {
  describe("lifecycle", () => {
    it("initialises and exposes app.reflection", () => {
      const app = createTestApp();

      expect(app.reflection).toBeDefined();
    });

    it("exposes the field builder set on app.reflection.field", () => {
      const app = createTestApp();

      expect(app.reflection.field).toBe(field);
    });
  });

  describe("infer path", () => {
    it("infers number/boolean/string/vector2 descriptors with humanized labels", () => {
      const app = createTestApp();
      const Enemy = app.ecs.defineComponent(enemyValue, { name: "Enemy" });
      app.ecs.spawn(Enemy(enemyValue()));

      const descriptors = app.reflection.describe("Enemy");

      expect(descriptors).toContainEqual({ kind: "number", key: "hp", label: "Hp" });
      expect(descriptors).toContainEqual({ kind: "boolean", key: "alive", label: "Alive" });
      expect(descriptors).toContainEqual({ kind: "string", key: "name", label: "Name" });
      expect(descriptors).toContainEqual({ kind: "vector2", key: "pos", label: "Pos" });
    });

    it("returns [] for an unregistered anonymous component", () => {
      const app = createTestApp();

      expect(app.reflection.describe("Ghost")).toStrictEqual([]);
    });
  });

  describe("registered schema wins over inference", () => {
    it("register(name, schema) then describe(name) returns the registered set", () => {
      const app = createTestApp();
      const Enemy = app.ecs.defineComponent(enemyValue, { name: "Enemy" });
      app.ecs.spawn(Enemy(enemyValue()));

      // Prime the inference cache first.
      app.reflection.describe("Enemy");

      app.reflection.register("Enemy", {
        hp: field.number({ min: 0, max: 100 }),
        state: field.select(["idle", "dead"])
      });

      expect(app.reflection.describe("Enemy")).toStrictEqual([
        { kind: "number", key: "hp", label: "Hp", min: 0, max: 100 },
        { kind: "select", key: "state", label: "State", options: ["idle", "dead"] }
      ]);
    });

    it("validate rejects an out-of-range value and accepts an in-range one", () => {
      const app = createTestApp();
      app.reflection.register("Enemy", { hp: field.number({ min: 0, max: 100 }) });

      expect(app.reflection.validate("Enemy", { hp: 150 })).toStrictEqual({
        ok: false,
        errors: [{ key: "hp", message: "above maximum 100" }]
      });
      expect(app.reflection.validate("Enemy", { hp: 50 })).toStrictEqual({ ok: true });
    });
  });

  describe("humanizeLabels: false config", () => {
    it("uses raw keys as labels when humanizeLabels is false", () => {
      const app = createTestApp({ reflection: { humanizeLabels: false } });
      const Enemy = app.ecs.defineComponent(enemyValue, { name: "Enemy" });
      app.ecs.spawn(Enemy(enemyValue()));

      const descriptors = app.reflection.describe("Enemy");

      expect(descriptors).toContainEqual({ kind: "number", key: "hp", label: "hp" });
    });
  });
});
