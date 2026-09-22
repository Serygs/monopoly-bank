import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppearance, mountAppearance } from './appearance-controller';
import { visualStyles } from './visual-styles';

describe('root appearance controller', () => {
  let dataset: Record<string, string>;
  let systemDark: boolean;
  let listeners: Set<(event: { matches: boolean }) => void>;

  beforeEach(() => {
    dataset = {};
    systemDark = false;
    listeners = new Set();
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({
        get matches() { return systemDark; },
        addEventListener: (_event: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
        removeEventListener: (_event: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
      })),
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['light', 'dark'] as const)('applies explicit %s independently of system appearance without subscribing', (colorMode) => {
    systemDark = colorMode === 'light';
    const cleanup = mountAppearance({ visualStyle: 'classic-bank', colorMode });
    expect(dataset).toEqual({ visualStyle: 'classic-bank', colorMode });
    expect(window.matchMedia).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    cleanup();
  });

  it('applies system appearance before render and follows OS changes while mounted', () => {
    systemDark = true;
    applyAppearance({ visualStyle: 'classic-bank', colorMode: 'system' });
    expect(dataset.colorMode).toBe('dark');
    expect(listeners.size).toBe(0);
    const cleanup = mountAppearance({ visualStyle: 'classic-bank', colorMode: 'system' });
    listeners.forEach((listener) => listener({ matches: false }));
    expect(dataset).toEqual({ visualStyle: 'classic-bank', colorMode: 'light' });
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it('cleans up subscriptions and the style adapter on remount or preference change', () => {
    const cleanupEffects = vi.fn();
    vi.spyOn(visualStyles[0], 'mountEffects').mockReturnValue(cleanupEffects);
    const cleanup = mountAppearance({ visualStyle: 'classic-bank', colorMode: 'system' });
    cleanup();
    const cleanupAgain = mountAppearance({ visualStyle: 'classic-bank', colorMode: 'system' });
    expect(listeners.size).toBe(1);
    cleanupAgain();
    const cleanupExplicit = mountAppearance({ visualStyle: 'classic-bank', colorMode: 'light' });
    expect(listeners.size).toBe(0);
    expect(dataset.colorMode).toBe('light');
    cleanupExplicit();
    expect(cleanupEffects).toHaveBeenCalledTimes(3);
  });

  it('classic-bank has no reactive capabilities or effect side effects', () => {
    expect(visualStyles).toHaveLength(1);
    expect(visualStyles[0].supportedCapabilities).toEqual([]);
    const cleanup = visualStyles[0].mountEffects({
      root: document.documentElement,
      ownerDocument: document as Document,
      getReducedMotionPreference: () => window.matchMedia('(prefers-reduced-motion: reduce)'),
    });
    expect(window.matchMedia).not.toHaveBeenCalled();
    expect(dataset).toEqual({});
    cleanup();
  });
});
