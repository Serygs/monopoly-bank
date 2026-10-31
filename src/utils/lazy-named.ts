import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// `any` mirrors React's own `lazy<T extends ComponentType<any>>`: props stay those of the page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>;

/**
 * `React.lazy` for a named export, so a page keeps its named export and loads in its own chunk
 * the first time it renders. Wrap the result in `LazyBoundary`.
 */
export function lazyNamed<K extends string, M extends Record<K, AnyComponent>>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}
