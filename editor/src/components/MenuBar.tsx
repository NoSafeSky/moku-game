/** @file Menu bar — brand + top-level menus + scene readout. Static chrome; the menu-bar island wires it. */

/** One top-level menu-bar label; the menu-bar island opens its dropdown on click (a disabled one is inert). */
function Menu({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-menu={label.toLowerCase()}
      title={label}
      disabled={disabled === true}
      aria-haspopup="true"
      aria-expanded="false"
    >
      {label}
    </button>
  );
}

/**
 * The top band: the brand mark, the GameObject / Edit / Window menus (opened by the menu-bar island) with
 * a present-but-disabled Assets menu (import is a later phase), and a right-aligned open-scene readout with
 * an amber dirty dot the island shows once the scene has unsaved edits.
 *
 * @returns The menu-bar chrome.
 * @example
 * ```tsx
 * <MenuBar />
 * ```
 */
export function MenuBar() {
  return (
    <header data-island="menu-bar" data-band="menu">
      <strong data-brand>Moku Editor</strong>
      <nav data-menus aria-label="Application menus">
        <Menu label="GameObject" />
        <Menu label="Edit" />
        <Menu label="Assets" disabled />
        <Menu label="Window" />
      </nav>
      <div data-scene aria-live="polite">
        <span data-mono data-scene-name>
          untitled
        </span>
        <span data-dirty hidden>
          ●
        </span>
      </div>
    </header>
  );
}
