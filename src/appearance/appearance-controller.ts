import type { ColorMode, DevicePreferences, ResolvedColorMode } from '../utils/preferences';
import { getVisualStyle } from './visual-styles';

type AppearancePreferences = Pick<DevicePreferences, 'visualStyle' | 'colorMode'>;
const systemDarkQuery = '(prefers-color-scheme: dark)';
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export function resolveColorMode(mode: ColorMode, systemDark: boolean): ResolvedColorMode {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

/** Used before React renders and when root preferences change. */
export function applyAppearance(preferences: AppearancePreferences): void {
  const root = document.documentElement;
  root.dataset.visualStyle = getVisualStyle(preferences.visualStyle).id;
  root.dataset.colorMode = resolveColorMode(
    preferences.colorMode,
    preferences.colorMode === 'system' && window.matchMedia(systemDarkQuery).matches,
  );
}

/** One shell-owned subscription; no effects or listeners live in business pages. */
export function mountAppearance(preferences: AppearancePreferences): () => void {
  applyAppearance(preferences);
  const cleanupEffects = getVisualStyle(preferences.visualStyle).mountEffects({
    root: document.documentElement,
    ownerDocument: document,
    getReducedMotionPreference: () => window.matchMedia(reducedMotionQuery),
  });
  const query = preferences.colorMode === 'system' ? window.matchMedia(systemDarkQuery) : null;
  const onSystemChange = (event: MediaQueryListEvent) => {
    document.documentElement.dataset.colorMode = resolveColorMode('system', event.matches);
  };
  query?.addEventListener('change', onSystemChange);
  return () => {
    query?.removeEventListener('change', onSystemChange);
    cleanupEffects();
  };
}
