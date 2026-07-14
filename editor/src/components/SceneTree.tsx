/** @file Scene-tree panel — the scene-tree island lists snapshot entities as selectable rows here. */
export function SceneTree() {
  return (
    <section data-island="scene-tree" data-panel="scene-tree" aria-label="Scene tree">
      <header data-panel-header>
        <h2>Scene</h2>
      </header>
      <ul data-tree aria-label="Entities" />
    </section>
  );
}
