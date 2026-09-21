import { DEFAULT_VISUAL_STYLE, isVisualStyleId, type VisualStyleId } from '../appearance/visual-styles';

export type ColorMode = 'light' | 'dark' | 'system';
export type ResolvedColorMode = Exclude<ColorMode, 'system'>;

export interface DevicePreferences {
  visualStyle: VisualStyleId;
  colorMode: ColorMode;
  sound: boolean;
  vibration: boolean;
}

const key = 'monopoly-bank-device-preferences';
const defaults: DevicePreferences = { visualStyle: DEFAULT_VISUAL_STYLE, colorMode: 'system', sound: true, vibration: true };

export function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readPreferences(): DevicePreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const candidate = value as Record<string, unknown>;
      return {
        visualStyle: isVisualStyleId(candidate.visualStyle) ? candidate.visualStyle : defaults.visualStyle,
        colorMode: isColorMode(candidate.colorMode) ? candidate.colorMode : isColorMode(candidate.theme) ? candidate.theme : defaults.colorMode,
        sound: candidate.sound !== false,
        vibration: candidate.vibration !== false,
      };
    }
  } catch { /* Storage can be unavailable in privacy modes. */ }
  return { ...defaults };
}

export function writePreferences(preferences: DevicePreferences): void {
  try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Non-essential device preferences. */ }
}
