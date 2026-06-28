import { describe, expect, expectTypeOf, it } from "vitest";

import type { World } from "../../../scheduler/types";
import { createApi } from "../../api";
import { createInputSystem } from "../../lifecycle";
import { createState } from "../../state";
import type { Config, InputContext, InputSnapshot } from "../../types";

/** A throwaway world handle — the input-stage system never reads it. */
const stubWorld = {} as unknown as World;

/** Roll one input-stage tick so api.snapshot() reflects injected state. */
const rollFrame = (ctx: InputContext) => createInputSystem(ctx.state)(stubWorld, 0);

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

  describe("injection", () => {
    it("keyDown marks the key held + just-pressed in the next snapshot", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      api.keyDown("ArrowRight");
      rollFrame(ctx);

      const snap = api.snapshot();
      expect(snap.isDown("ArrowRight")).toBe(true);
      expect(snap.justPressed("ArrowRight")).toBe(true);
    });

    it("keyDown stays held but justPressed clears on the following frame", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      api.keyDown("ArrowRight");
      rollFrame(ctx); // press frame
      rollFrame(ctx); // next frame — no new input injected

      const snap = api.snapshot();
      expect(snap.isDown("ArrowRight")).toBe(true);
      expect(snap.justPressed("ArrowRight")).toBe(false);
    });

    it("repeated keyDown does not re-flag justPressed while already held", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      api.keyDown("Space");
      api.keyDown("Space"); // repeat (e.g. OS key-repeat) — no new edge
      expect(ctx.state.pressed.size).toBe(1);
    });

    it("keyUp releases the key + flags just-released in the next snapshot", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      api.keyDown("ArrowRight");
      rollFrame(ctx);
      api.keyUp("ArrowRight");
      rollFrame(ctx);

      const snap = api.snapshot();
      expect(snap.isDown("ArrowRight")).toBe(false);
      expect(snap.justReleased("ArrowRight")).toBe(true);
    });

    it("keyPress is a one-frame tap (justPressed && justReleased, never stuck down)", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      // Cycle 5: "Space" normalises to " " before touching edge sets.
      api.keyPress("Space");
      rollFrame(ctx);

      const snap = api.snapshot();
      expect(snap.justPressed(" ")).toBe(true);
      expect(snap.justReleased(" ")).toBe(true);
      expect(snap.isDown(" ")).toBe(false);

      // The tap does not persist into the following frame.
      rollFrame(ctx);
      const next = api.snapshot();
      expect(next.justPressed(" ")).toBe(false);
      expect(next.isDown(" ")).toBe(false);
    });
  });

  describe("types", () => {
    it("snapshot() returns InputSnapshot", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      expectTypeOf(api.snapshot).toMatchTypeOf<() => InputSnapshot>();
    });

    it("injection methods take a key string and return void", () => {
      const ctx = makeCtx();
      const api = createApi(ctx);

      expectTypeOf(api.keyDown).toEqualTypeOf<(key: string) => void>();
      expectTypeOf(api.keyUp).toEqualTypeOf<(key: string) => void>();
      expectTypeOf(api.keyPress).toEqualTypeOf<(key: string) => void>();
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
