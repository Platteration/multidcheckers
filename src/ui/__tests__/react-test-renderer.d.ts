/**
 * The corner of react-test-renderer the map's render test uses. The package
 * ships no types, and this repository keeps its dependencies to what Expo
 * brings, so the surface it touches is declared here rather than pulled in.
 */
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    type: string | object;
    props: { [key: string]: unknown };
    findAll(predicate: (node: ReactTestInstance) => boolean, options?: { deep?: boolean }): ReactTestInstance[];
    findAllByType(type: unknown): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    update(element: ReactElement): void;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void): void;

  const TestRenderer: { create: typeof create; act: typeof act };
  export default TestRenderer;
}
