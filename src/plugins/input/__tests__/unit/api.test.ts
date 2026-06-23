import { describe, expect, expectTypeOf, it } from "vitest";

import { createApi } from "../../api";
import { createState } from "../../state";
import type { Config, InputContext, InputSnapshot } from "../../types";

// ─── helpers ──────────────────────────────────────────────────

const defaultConfig: Config = {
  target: "window",
  pointer: true,
  keyboard: true,
  preventDefault: false
};

const makeCtx = (config: Config = defaultConfig): InputContext => ({
  global: {},
  config,
  state: createState({ global: {} as Readonly<Record<string, unknown>>, config }),
  require: (() => {
    throw new Error("require not used by api");
  }) as InputContext["require"]
});

// ─── createApi ────────────────────────────────────────────────

describe("createApi", () => {
  describe("snapshot()", () => {
    it("returns an InputSnapshot", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);
      const snap = api.snapshot();

      expect(typeof snap.isDown).toBe("function");
      expect(typeof snap.justPressed).toBe("function");
      expect(typeof snap.justReleased).toBe("function");
      expect(snap.pointer).toBeDefined();
    });

    it("returns the same object on repeated calls within a frame", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      const snap1 = api.snapshot();
      const snap2 = api.snapshot();

      expect(snap1).toBe(snap2);
    });

    it("reflects updated snapshot after state.snapshot is replaced", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      const snap1 = api.snapshot();

      // Simulate system rolling a new snapshot
      ctx.state.down.add("ArrowLeft");
      ctx.state.pressed.add("ArrowLeft");
      const newSnap: InputSnapshot = {
        isDown: key => ctx.state.down.has(key),
        justPressed: key => ctx.state.pressed.has(key),
        justReleased: key => ctx.state.released.has(key),
        pointer: { ...ctx.state.pointer }
      };
      ctx.state.snapshot = newSnap;

      const snap2 = api.snapshot();
      expect(snap2).not.toBe(snap1);
      expect(snap2.isDown("ArrowLeft")).toBe(true);
    });
  });

  describe("types", () => {
    it("snapshot() returns InputSnapshot", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      expectTypeOf(api.snapshot).toMatchTypeOf<() => InputSnapshot>();
    });

    it("pointer fields are readonly", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);
      const snap = api.snapshot();

      expectTypeOf(snap.pointer.x).toEqualTypeOf<number>();
      expectTypeOf(snap.pointer.y).toEqualTypeOf<number>();
      expectTypeOf(snap.pointer.buttons).toEqualTypeOf<number>();
    });
  });
});
