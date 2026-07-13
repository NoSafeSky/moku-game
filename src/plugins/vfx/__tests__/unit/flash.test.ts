/**
 * @file vfx plugin — hit-flash system unit tests.
 *
 * Drives the flash system against a real world + mock renderer: the tint eases
 * from the flash color back toward the captured base, end-of-life restores the
 * EXACT captured base tint plus `Flash` removal, and headless (no view) still ages
 * the effect out without throwing. The `flash()` API (base capture, immediate
 * snap, refresh, dead-entity guard) is covered in `api.test.ts`.
 */
import type { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Entity } from "../../../ecs/types";
import { createFlashSystem } from "../../systems/flash";
import { makeRenderer, makeStage, setup } from "../helpers";

/** A minimal tintable view stub (only the `tint` the flash system reads/writes). */
const makeView = (tint = 0xff_ff_ff): Container => ({ tint }) as unknown as Container;

/** Read the current tint off a view stub. */
const tintOf = (view: Container): number => (view as unknown as { tint: number }).tint;

/** Spawn an entity, give it a Flash, and wire its view into a renderer + views map. */
const flashed = (
  s: ReturnType<typeof setup>,
  view: Container | undefined,
  flash: { duration: number; color: number; baseTint: number }
): { entity: Entity; renderer: ReturnType<typeof makeRenderer> } => {
  const entity = s.world.spawn(s.transform({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }));
  s.world.add(entity, s.Flash, { age: 0, ...flash });
  const views = view ? new Map<Entity, Container>([[entity, view]]) : undefined;
  return { entity, renderer: makeRenderer(makeStage(), views) };
};

describe("flash system", () => {
  it("eases the view tint from the flash color back toward the captured base", () => {
    const s = setup();
    const view = makeView(0xff_ff_ff); // base white
    const { renderer } = flashed(s, view, {
      duration: 0.2,
      color: 0xff_00_00,
      baseTint: 0xff_ff_ff
    });

    const flash = createFlashSystem({ world: s.world, Flash: s.Flash, renderer });
    flash(s.world, 0.1); // progress 0.5 → part-way back toward white

    const tint = tintOf(view);
    expect(tint).not.toBe(0xff_00_00); // moved off the pure flash color
    expect(tint).not.toBe(0xff_ff_ff); // not yet fully restored
    expect((tint >> 8) & 0xff).toBeGreaterThan(0); // green channel risen back up (red → white)
  });

  it("restores the EXACT captured base tint and removes the Flash at end of life", () => {
    const s = setup();
    const view = makeView(0x12_34_56); // arbitrary non-white base
    const { entity, renderer } = flashed(s, view, {
      duration: 0.2,
      color: 0xff_00_00,
      baseTint: 0x12_34_56
    });

    const flash = createFlashSystem({ world: s.world, Flash: s.Flash, renderer });
    flash(s.world, 0.2); // age 0.2 ≥ duration 0.2 → restore + remove

    expect(tintOf(view)).toBe(0x12_34_56);
    expect(s.world.has(entity, s.Flash)).toBe(false);
  });

  it("is headless-safe mid-flight: with no view a partial tick does not throw and keeps the Flash", () => {
    const s = setup();
    const { entity, renderer } = flashed(s, undefined, {
      duration: 0.2,
      color: 0xff_00_00,
      baseTint: 0xff_ff_ff
    });

    const flash = createFlashSystem({ world: s.world, Flash: s.Flash, renderer });
    expect(() => flash(s.world, 0.1)).not.toThrow(); // dt < duration → mid-flight ease branch, no view
    expect(s.world.has(entity, s.Flash)).toBe(true); // still flashing (not yet at end of life)
  });

  it("is headless-safe: with no view it still ages out and removes the Flash", () => {
    const s = setup();
    const { entity, renderer } = flashed(s, undefined, {
      duration: 0.2,
      color: 0xff_00_00,
      baseTint: 0xff_ff_ff
    });

    const flash = createFlashSystem({ world: s.world, Flash: s.Flash, renderer });
    expect(() => flash(s.world, 0.2)).not.toThrow(); // dt ≥ duration → terminal restore branch, no view
    expect(s.world.has(entity, s.Flash)).toBe(false);
  });
});
