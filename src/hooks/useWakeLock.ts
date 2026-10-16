import { useEffect } from 'react';

/**
 * Holds a screen wake lock while `active`, so phones on the table do not dim between turns.
 * The browser releases the lock whenever the page is hidden, so it is requested again on return.
 * Unsupported browsers and refused requests (low battery, no user gesture) are ignored.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (sentinel !== null && !sentinel.released))
        return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (disposed) void next.release();
        else sentinel = next;
      } catch {
        /* Best effort: the game works the same without the lock. */
      }
    };
    const onVisibilityChange = () => void acquire();
    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel !== null && !sentinel.released) void sentinel.release();
    };
  }, [active]);
}
