/**
 * @file serialization plugin — on-load document migration (internal).
 *
 * Reuses `storage`'s `Migration`/`Snapshot` contract (`(Snapshot) => Snapshot`) and mirrors its
 * `runMigrations` chain-walk semantics — but operates purely over an in-memory `SceneDocument`,
 * with no backend I/O. `storage`'s own runner reads/writes a persistence backend; a `SceneDocument`
 * reaching this module may never have touched `storage` at all (the `export`/`import` path). One
 * migration contract, two runners: `storage`'s walks a namespace snapshot against a backend, this
 * one walks a scene document already in memory.
 */
import type { Migration, Snapshot } from "../storage/types";
import type { SceneDocument, SceneEntity } from "./types";

/**
 * Minimal logger surface {@link upgradeDocument} needs (the downgrade notice). Shared structurally
 * with `api.ts`'s `SerializationApiContext.log` — both satisfy this same shape.
 */
export type Log = {
  /** Log at debug level. */
  debug(message: string): void;
  /** Log at info level. */
  info(message: string): void;
  /** Log a warning (the downgrade notice). */
  warn(message: string): void;
  /** Log an error. */
  error(message: string): void;
};

/**
 * Rebuild a typed `SceneDocument` from a migrated `Snapshot`, defensively falling back on a
 * malformed `name`/`entities` so a misbehaving migration function cannot corrupt the document's
 * shape on its way back out of the chain.
 *
 * @param snapshot - The migrated snapshot (a `SceneDocument`-shaped bag of data).
 * @param version - The version to stamp the rebuilt document at.
 * @returns The rebuilt {@link SceneDocument}.
 * @example
 * ```ts
 * toSceneDocument({ name: "level1", entities: [] }, 3); // → { version: 3, name: "level1", entities: [] }
 * ```
 */
const toSceneDocument = (snapshot: Snapshot, version: number): SceneDocument => ({
  version,
  name: typeof snapshot.name === "string" ? snapshot.name : "untitled",
  entities: Array.isArray(snapshot.entities) ? (snapshot.entities as SceneEntity[]) : []
});

/**
 * Upgrades a `SceneDocument` forward through the migration chain to `targetVersion` (reusing
 * `storage`'s `Migration`/`Snapshot` contract). A document already at `targetVersion` passes
 * through untouched (no migration function runs); a document **ahead** of `targetVersion` (a
 * downgrade — a future save opened by an older build) is left intact with a `log.warn`, exactly as
 * `storage`'s runner treats a downgrade. Pure — no I/O, never mutates `doc`.
 *
 * @param doc - The document to upgrade.
 * @param targetVersion - The version to upgrade to (`config.version`).
 * @param migrations - The target-version → transform migration chain.
 * @param log - Logger for the downgrade notice.
 * @returns The document upgraded to `targetVersion`, or passed through unchanged (current /
 *   downgrade cases).
 * @example
 * ```ts
 * upgradeDocument({ version: 1, name: "level1", entities: [] }, 3, { 2: bump, 3: rename }, log);
 * ```
 */
export function upgradeDocument(
  doc: SceneDocument,
  targetVersion: number,
  migrations: Readonly<Record<number, Migration>>,
  log: Log
): SceneDocument {
  if (doc.version === targetVersion) return doc;

  if (doc.version > targetVersion) {
    log.warn(
      `[serialization] scene '${doc.name}' version v${doc.version} is newer than app v${targetVersion}; leaving it untouched.`
    );
    return doc;
  }

  let snapshot: Snapshot = doc;
  for (let version = doc.version + 1; version <= targetVersion; version++) {
    const migrate = migrations[version];
    if (migrate) snapshot = migrate(snapshot);
  }

  return toSceneDocument(snapshot, targetVersion);
}
