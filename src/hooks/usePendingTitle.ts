import { useEffect } from 'react';

/**
 * Puts the number of requests waiting for the viewer in front of the page title, "(2) Monopoly
 * Bank", so a backgrounded tab shows it; also sets the app badge where the browser has one.
 */
export function usePendingTitle(count: number): void {
  useEffect(() => {
    const original = document.title;
    if (count > 0) document.title = `(${count}) ${original}`;
    const badge = navigator as Navigator & {
      setAppBadge?: (count: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) void badge.setAppBadge?.(count).catch(() => undefined);
    else void badge.clearAppBadge?.().catch(() => undefined);
    return () => {
      document.title = original;
      void badge.clearAppBadge?.().catch(() => undefined);
    };
  }, [count]);
}
