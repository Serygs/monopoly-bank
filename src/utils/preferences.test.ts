import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isColorMode,
  readAmountUnit,
  readPreferences,
  writeAmountUnit,
  writePreferences,
} from './preferences';

const key = 'monopoly-bank-device-preferences';

describe('device preferences', () => {
  let stored: string | null;
  beforeEach(() => {
    stored = null;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => {
        stored = value;
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['light', 'dark', 'system'])(
    'migrates legacy %s without resetting feedback settings',
    (theme) => {
      stored = JSON.stringify({ theme, sound: false, vibration: false });
      const preferences = readPreferences();
      expect(preferences).toEqual({
        visualStyle: 'classic-bank',
        colorMode: theme,
        sound: false,
        vibration: false,
        keepScreenAwake: true,
      });
      writePreferences(preferences);
      expect(localStorage.setItem).toHaveBeenCalledWith(key, JSON.stringify(preferences));
      expect(readPreferences()).toEqual(preferences);
    },
  );

  it('retains the new mode over a legacy theme and round-trips independent settings', () => {
    stored = JSON.stringify({
      visualStyle: 'classic-bank',
      colorMode: 'light',
      theme: 'dark',
      sound: false,
      vibration: true,
    });
    const preferences = readPreferences();
    writePreferences(preferences);
    expect(readPreferences()).toEqual({
      visualStyle: 'classic-bank',
      colorMode: 'light',
      sound: false,
      vibration: true,
      keepScreenAwake: true,
    });
  });

  it('falls back for unknown styles and modes without resetting valid feedback settings', () => {
    stored = JSON.stringify({
      visualStyle: 'unknown-style',
      colorMode: 'sepia',
      sound: true,
      vibration: false,
    });
    expect(readPreferences()).toEqual({
      visualStyle: 'classic-bank',
      colorMode: 'system',
      sound: true,
      vibration: false,
      keepScreenAwake: true,
    });
  });

  it('retains the independently persisted Liquid Glass style', () => {
    stored = JSON.stringify({
      visualStyle: 'liquid-glass',
      colorMode: 'dark',
      sound: true,
      vibration: false,
    });
    expect(readPreferences()).toEqual({
      visualStyle: 'liquid-glass',
      colorMode: 'dark',
      sound: true,
      vibration: false,
      keepScreenAwake: true,
    });
  });

  it('keeps the screen-awake choice and defaults it to on', () => {
    stored = JSON.stringify({ keepScreenAwake: false });
    expect(readPreferences().keepScreenAwake).toBe(false);
    stored = JSON.stringify({ keepScreenAwake: 'yes' });
    expect(readPreferences().keepScreenAwake).toBe(true);
  });

  it('can recover the legacy mode when a new mode is invalid', () => {
    stored = JSON.stringify({ colorMode: 'sepia', theme: 'dark' });
    expect(readPreferences().colorMode).toBe('dark');
  });

  it.each([null, 'null', '[]', '42', '"dark"', '{broken'])(
    'uses defaults for malformed or absent storage: %s',
    (value) => {
      stored = value;
      expect(readPreferences()).toEqual({
        visualStyle: 'classic-bank',
        colorMode: 'system',
        sound: true,
        vibration: true,
        keepScreenAwake: true,
      });
    },
  );

  it('works when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Storage disabled');
      },
      setItem: () => {
        throw new Error('Storage disabled');
      },
    });
    const preferences = readPreferences();
    expect(preferences.colorMode).toBe('system');
    expect(() => writePreferences(preferences)).not.toThrow();
  });
});

describe('amount unit preference', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (storageKey: string) => store.get(storageKey) ?? null,
      setItem: (storageKey: string, value: string) => {
        store.set(storageKey, value);
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to whole units when nothing is stored', () => {
    expect(readAmountUnit()).toBe('ONES');
  });
  it('defaults to whole units for an invalid stored value', () => {
    store.set('monopoly-bank-amount-unit', 'BILLIONS');
    expect(readAmountUnit()).toBe('ONES');
  });
  it('round-trips an amount unit under its own key', () => {
    writeAmountUnit('MILLIONS');
    expect(readAmountUnit()).toBe('MILLIONS');
    expect(store.get('monopoly-bank-amount-unit')).toBe('MILLIONS');
    expect(store.has('monopoly-bank-device-preferences')).toBe(false);
  });
  it('does not throw when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });
    expect(() => writeAmountUnit('MILLIONS')).not.toThrow();
    expect(readAmountUnit()).toBe('ONES');
  });
});

describe('device preference parsing', () => {
  let stored: string | null;
  beforeEach(() => {
    stored = null;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => {
        stored = value;
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const defaults = {
    visualStyle: 'classic-bank',
    colorMode: 'system',
    sound: true,
    vibration: true,
    keepScreenAwake: true,
  };

  it('returns the defaults when nothing is stored', () => {
    expect(readPreferences()).toEqual(defaults);
  });

  it.each(['not json', '[]', '"dark"', '5', 'true', 'null', '[{"sound":false}]'])(
    'returns the defaults for the stored text %s',
    (text) => {
      stored = text;
      expect(readPreferences()).toEqual(defaults);
    },
  );

  it('returns a fresh copy of the defaults each time', () => {
    const first = readPreferences();
    first.sound = false;
    expect(readPreferences().sound).toBe(true);
  });

  it('turns each switch off only when it is stored as exactly false', () => {
    for (const field of ['sound', 'vibration', 'keepScreenAwake'] as const) {
      stored = JSON.stringify({ [field]: false });
      expect(readPreferences()[field]).toBe(false);
      for (const value of [true, 0, null, 'false', 'no']) {
        stored = JSON.stringify({ [field]: value });
        expect(readPreferences()[field]).toBe(true);
      }
    }
  });

  it('accepts exactly the three colour modes and falls back to the legacy theme, then to system', () => {
    for (const colorMode of ['light', 'dark', 'system']) {
      stored = JSON.stringify({ colorMode });
      expect(readPreferences().colorMode).toBe(colorMode);
      expect(isColorMode(colorMode)).toBe(true);
    }
    for (const colorMode of ['sepia', '', null, 5]) {
      stored = JSON.stringify({ colorMode });
      expect(readPreferences().colorMode).toBe('system');
      expect(isColorMode(colorMode)).toBe(false);
    }
    stored = JSON.stringify({ colorMode: 'sepia', theme: 'dark' });
    expect(readPreferences().colorMode).toBe('dark');
    stored = JSON.stringify({ colorMode: 'sepia', theme: 'sepia' });
    expect(readPreferences().colorMode).toBe('system');
  });

  it('falls back to the default style for an unknown one', () => {
    stored = JSON.stringify({ visualStyle: 'neon-nonsense' });
    expect(readPreferences().visualStyle).toBe('classic-bank');
  });

  it('returns the defaults when the storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readPreferences()).toEqual(defaults);
    expect(readAmountUnit()).toBe('ONES');
  });

  it('does not throw when the storage refuses a write', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => writePreferences(readPreferences())).not.toThrow();
    expect(() => writeAmountUnit('MILLIONS')).not.toThrow();
  });

  it('reads back exactly the three amount units and defaults to ones', () => {
    for (const unit of ['ONES', 'THOUSANDS', 'MILLIONS'] as const) {
      writeAmountUnit(unit);
      expect(readAmountUnit()).toBe(unit);
    }
    stored = 'BILLIONS';
    expect(readAmountUnit()).toBe('ONES');
    stored = null;
    expect(readAmountUnit()).toBe('ONES');
  });
});
