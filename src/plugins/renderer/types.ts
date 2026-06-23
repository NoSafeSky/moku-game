/**
 * @file renderer plugin — type definitions.
 *
 * All Pixi types are confined to this file and the other renderer domain files.
 * Nothing leaks past the plugin boundary except HTMLCanvasElement (getView) and
 * Container (attach/getStage) — both are structural handles, not Pixi internals.
 */
import type { Application, Container } from "pixi.js";
import type { Component, Entity } from "../ecs/types";

/** Transform component value shape (renderer defines and reads it on the ecs world). */
export type TransformValue = {
  /** X position in world-space pixels. */
  x: number;
  /** Y position in world-space pixels. */
  y: number;
  /** Rotation in radians. */
  rotation: number;
  /** Horizontal scale factor. */
  scaleX: number;
  /** Vertical scale factor. */
  scaleY: number;
};

/** renderer plugin configuration. */
export type Config = {
  /** Canvas width in CSS pixels. Default: 800. */
  width: number;
  /** Canvas height in CSS pixels. Default: 600. */
  height: number;
  /** Background fill color (hex). Default: 0x000000. */
  background: number;
  /** Device-pixel-ratio resolution; 0 = window.devicePixelRatio. Default: 0. */
  resolution: number;
  /** Enable antialiasing. Default: true. */
  antialias: boolean;
  /** CSS selector for auto-mounting the canvas, or undefined for headless/manual. Default: undefined. */
  mount: string | undefined;
};

/** renderer plugin mutable state. */
export type State = {
  /** The Pixi Application, undefined until onStart completes. */
  app: Application | undefined;
  /**
   * The Transform component token, defined once in onStart and shared with
   * the API getter and the sync system. Undefined before onStart.
   */
  transformToken: Component<TransformValue> | undefined;
  /** Per-entity Pixi display objects, keyed by Entity handle. */
  readonly views: Map<Entity, Container>;
  /** Entities whose Transform changed since the last sync tick. */
  readonly dirty: Set<Entity>;
};

/** renderer plugin public API (exposed as app.renderer). */
export type Api = {
  /**
   * The Transform component this plugin defines on the ecs world.
   * Call `app.renderer.Transform({ x, y, rotation, scaleX, scaleY })` to spawn with a transform.
   */
  readonly Transform: Component<TransformValue>;
  /**
   * Attach a Pixi Container to an entity. The sync system will reposition it
   * each tick according to the entity's Transform component.
   *
   * @param entity - The entity to attach the view to.
   * @param view - A Pixi Container (or subclass) to display.
   */
  attach(entity: Entity, view: Container): void;
  /**
   * Detach and dispose the entity's Pixi Container. Idempotent.
   *
   * @param entity - The entity whose view should be removed.
   */
  detach(entity: Entity): void;
  /**
   * Draw the current frame. No-op before start. Called by the loop plugin.
   */
  render(): void;
  /**
   * Return the Pixi canvas for manual DOM mounting, or undefined before start.
   *
   * @returns The HTMLCanvasElement, or undefined.
   */
  getView(): HTMLCanvasElement | undefined;
  /**
   * Return the root Pixi stage Container, or undefined before start.
   *
   * @returns The root Container, or undefined.
   */
  getStage(): Container | undefined;
  /**
   * Mark an entity dirty so the sync system repositions its view on the next tick.
   *
   * @param entity - The entity whose Transform has changed.
   */
  markDirty(entity: Entity): void;
};

/**
 * Shape stored in the module-level WeakMap keyed on ctx.global.
 * onStop reads this because it only receives TeardownContext ({ global }).
 */
export type TeardownEntry = {
  /** The Pixi Application to destroy. */
  readonly app: Application;
  /** The views map, so onStop can dispose managed containers. */
  readonly views: Map<Entity, Container>;
};
