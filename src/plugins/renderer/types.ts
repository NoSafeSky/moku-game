/**
 * @file renderer plugin — type definitions.
 */
import type { Application, Container } from "pixi.js";
import type { Component, Entity } from "../ecs/types";

/** Transform component value shape (renderer defines/reads it on the ecs world). */
export type TransformValue = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

/** renderer plugin configuration. */
export type Config = {
  /** Canvas width (CSS px). `@default 800` */
  width: number;
  /** Canvas height (CSS px). `@default 600` */
  height: number;
  /** Background color (hex). `@default 0x000000` */
  background: number;
  /** DPR resolution; 0 = window.devicePixelRatio. `@default 0` */
  resolution: number;
  /** Antialiasing. `@default true` */
  antialias: boolean;
  /** DOM selector to auto-mount the canvas, or undefined for headless/manual. `@default undefined` */
  mount: string | undefined;
};

/** renderer plugin state. */
export type State = {
  /** The Pixi Application (created in onStart; also stored in the teardown WeakMap). Null until started. */
  app: Application | null;
  /** Per-entity Pixi display objects (keyed by entity index). */
  readonly views: Map<number, Container>;
  /** Entities whose transform changed since the last sync. */
  readonly dirty: Set<number>;
};

/** renderer plugin API. */
export type Api = {
  /** The Transform component this plugin defines on the ecs world. */
  readonly Transform: Component<TransformValue>;
  /** Attach a Pixi display object to an entity (positioned by the sync system). */
  attach(entity: Entity, view: Container): void;
  /** Detach and dispose the entity's display object. */
  detach(entity: Entity): void;
  /** Draw the current frame (called by the loop). */
  render(): void;
  /** The canvas for manual mounting, or null before start. */
  getView(): HTMLCanvasElement | null;
  /** The root Pixi stage, or null before start. */
  getStage(): Container | null;
  /** Mark an entity dirty so the next sync repositions its view. */
  markDirty(entity: Entity): void;
};
