import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPreferences, writePreferences } from './preferences';

const key = 'monopoly-bank-device-preferences';

describe('device preferences', () => {
  let stored: string | null;
  beforeEach(() => {
    stored = null;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => { stored = value; }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['light', 'dark', 'system'])('migrates legacy %s without resetting feedback settings', (theme) => {
    stored = JSON.stringify({ theme, sound: false, vibration: false });
    const preferences = readPreferences();
    expect(preferences).toEqual({ visualStyle: 'classic-bank', colorMode: theme, sound: false, vibration: false });
    writePreferences(preferences);
    expect(localStorage.setItem).toHaveBeenCalledWith(key, JSON.stringify(preferences));
    expect(readPreferences()).toEqual(preferences);
  });

  it('retains the new mode over a legacy theme and round-trips independent settings', () => {
    stored = JSON.stringify({ visualStyle: 'classic-bank', colorMode: 'light', theme: 'dark', sound: false, vibration: true });
    const preferences = readPreferences();
    writePreferences(preferences);
    expect(readPreferences()).toEqual({ visualStyle: 'classic-bank', colorMode: 'light', sound: false, vibration: true });
  });

  it('falls back for unknown styles and modes without resetting valid feedback settings', () => {
    stored = JSON.stringify({ visualStyle: 'liquid-glass', colorMode: 'sepia', sound: true, vibration: false });
    expect(readPreferences()).toEqual({ visualStyle: 'classic-bank', colorMode: 'system', sound: true, vibration: false });
  });

  it('can recover the legacy mode when a new mode is invalid', () => {
    stored = JSON.stringify({ colorMode: 'sepia', theme: 'dark' });
    expect(readPreferences().colorMode).toBe('dark');
  });

  it.each([null, 'null', '[]', '42', '"dark"', '{broken'])('uses defaults for malformed or absent storage: %s', (value) => {
    stored = value;
    expect(readPreferences()).toEqual({ visualStyle: 'classic-bank', colorMode: 'system', sound: true, vibration: true });
  });

  it('works when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage disabled'); },
      setItem: () => { throw new Error('Storage disabled'); },
    });
    const preferences = readPreferences();
    expect(preferences.colorMode).toBe('system');
    expect(() => writePreferences(preferences)).not.toThrow();
  });
});
