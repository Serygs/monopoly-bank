/**
 * Runs `load` once the browser is idle, so a chunk the user is likely to open next is already in
 * the cache by the time they tap. Skipped when the user asked to save data. Returns a cancel.
 */
export function preloadWhenIdle(load: () => Promise<unknown>): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData === true) return () => undefined;
  const run = () => void load().catch(() => undefined);
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 4_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = window.setTimeout(run, 1_500);
  return () => window.clearTimeout(timer);
}
