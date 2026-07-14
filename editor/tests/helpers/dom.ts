/** @file Test-only DOM helper — query one element or throw, so island tests avoid non-null assertions. */

/** Query one element by selector, throwing a clear error if it is absent. */
export function query<E extends Element = HTMLElement>(root: ParentNode, selector: string): E {
  const element = root.querySelector<E>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}
