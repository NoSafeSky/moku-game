/**
 * @file serialization plugin — on-load document migration skeleton.
 */
import type { Migration } from "../storage/types";
import type { SceneDocument } from "./types";

/**
 * Upgrades a `SceneDocument` forward through the migration chain to `targetVersion`
 * (reusing `storage`'s `Migration`/`Snapshot` contract); a downgrade is passed through with a warn.
 *
 * @param _doc - The document to upgrade.
 * @param _targetVersion - The version to upgrade to (`config.version`).
 * @param _migrations - The target-version → transform migration chain.
 * @param _log - Logger for the downgrade notice.
 * @throws {Error} Always in the skeleton — implemented during build.
 * @example
 * ```ts
 * upgradeDocument(doc, 3, migrations, log);
 * ```
 */
export function upgradeDocument(
  _doc: SceneDocument,
  _targetVersion: number,
  _migrations: Readonly<Record<number, Migration>>,
  _log: unknown
): SceneDocument {
  throw new Error("not implemented");
}
