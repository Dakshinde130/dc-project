/**
 * Process-wide singleton store. Route handlers are compiled as separate
 * chunks, so module-level state is not guaranteed to be shared — the
 * globalThis registry is.
 */
export function getGlobal<T>(key: string, init: () => T): T {
  const g = globalThis as unknown as Record<string, T>;
  if (!(key in g)) {
    g[key] = init();
  }
  return g[key];
}
