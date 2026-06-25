/**
 * @file context plugin — type definitions skeleton.
 */
import type { EnvApi, LogApi } from "@moku-labs/common";
import type { EmitFn } from "@moku-labs/core";
import type { Events as FrameworkEvents } from "../../config";
import type { Api as AssetsApi } from "../assets/types";
import type { Resource } from "../ecs/types";

/** context plugin configuration. */
export type Config = {
  /** Whether to bind the curated GameContext resource at start. `@default true` */
  bindGameContext: boolean;
};

/** context plugin state — none (tokens are module consts; values live in the ecs world). */
export type State = Record<never, never>;

/** Curated, hot-path-safe game context exposed to systems via the GameContext resource. */
export type GameContextValue = {
  /** Structured logger (ctx.log from the common logPlugin). */
  readonly log: LogApi;
  /** Emit a coarse framework event (assets:loaded | scene:loaded). */
  readonly emit: EmitFn<FrameworkEvents>;
  /** Validated environment accessor (ctx.env from the common envPlugin). */
  readonly env: EnvApi;
};

/** context plugin API — the well-known resource tokens. */
export type Api = {
  /** Resource token for the assets API. Read in a system: world.resource(assets). */
  readonly assets: Resource<AssetsApi>;
  /** Resource token for the curated game context. Read in a system: world.resource(game). */
  readonly game: Resource<GameContextValue>;
};
