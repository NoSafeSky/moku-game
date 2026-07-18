/** @file Menu bar — brand + top-level menus + scene readout. Static chrome; the menu-bar island (A4) wires it. */

/** One top-level menu-bar label; the menu-bar island (A4) opens its dropdown on click. */
function Menu({ label }: { label: string }) {
  return (
    <button type="button" data-menu={label.toLowerCase()} title={label}>
      {label}
    </button>
  );
}

/**
 * The top band: the brand mark, the GameObject / Edit / Window menus (opened by the A4 menu-bar island),
 * and a right-aligned open-scene readout with an amber dirty dot (toggled by the island when unsaved).
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
