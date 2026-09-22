export type ThemePreference = 'system' | 'light' | 'dark';
export interface DevicePreferences { theme: ThemePreference; sound: boolean; vibration: boolean; }

const key = 'monopoly-bank-device-preferences';
const defaults: DevicePreferences = { theme: 'system', sound: true, vibration: true };

export function readPreferences(): DevicePreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value !== null && typeof value === 'object') {
      const candidate = value as Partial<DevicePreferences>;
      return { theme: candidate.theme === 'light' || candidate.theme === 'dark' || candidate.theme === 'system' ? candidate.theme : defaults.theme, sound: candidate.sound !== false, vibration: candidate.vibration !== false };
    }
  } catch { /* Storage can be unavailable in privacy modes. */ }
  return defaults;
}

export function writePreferences(preferences: DevicePreferences): void {
  try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Non-essential device preferences. */ }
}

export type AmountUnit = 'THOUSANDS' | 'MILLIONS';

const amountUnitKey = 'monopoly-bank-amount-unit';

export function readAmountUnit(): AmountUnit {
  try {
    const value = localStorage.getItem(amountUnitKey);
    if (value === 'THOUSANDS' || value === 'MILLIONS') return value;
  } catch { /* Storage can be unavailable in privacy modes. */ }
  return 'THOUSANDS';
}

export function writeAmountUnit(unit: AmountUnit): void {
  try { localStorage.setItem(amountUnitKey, unit); } catch { /* Non-essential input preference. */ }
}

export function applyTheme(theme: ThemePreference): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
