/** @file The dataTransfer MIME type carrying an asset alias during an asset-browser → viewport drag (P2). */

/**
 * The custom `dataTransfer` MIME type an asset tile writes its alias under on `dragstart`; the viewport
 * drop target reads it back to know WHICH asset to instantiate. A dedicated type (not bare `text/plain`)
 * keeps an arbitrary text drop from spawning a sprite — the drop only acts when this type is present.
 */
export const ASSET_DND_TYPE = "application/x-moku-asset";
