/**
 * @file ecs plugin — typed query construction over the archetype store.
 *
 * Query construction is handled entirely within `world.ts` (the `world.query()`
 * method). This file is retained for the Complex-tier flat layout but re-exports
 * the Query type for downstream use and provides the `buildQuery` helper used
 * internally by `createWorld`.
 *
 * The per-arity overloads (1–8) live in `types.ts` so that TypeScript can infer
 * the precise component-value tuple rather than degrading to `any` under
 * `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`.
 */
export type { Query } from "./types";
