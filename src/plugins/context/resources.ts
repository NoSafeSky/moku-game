/**
 * @file context plugin — well-known resource tokens (fixed keys, valid before start).
 */
import type { Api as AssetsApi } from "../assets/types";
import type { Resource } from "../ecs/types";
import type { GameContextValue } from "./types";

/** Well-known token: the assets API, bound at context.onStart. */
export const Assets: Resource<AssetsApi> = { __key: "ctx:assets" };

/** Well-known token: the curated game context, bound at context.onStart. */
export const GameContext: Resource<GameContextValue> = { __key: "ctx:game" };
