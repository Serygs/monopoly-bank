import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAmountUnit, writeAmountUnit } from './preferences';

function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
  return store;
}

function stubBrokenStorage(): void {
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
  });
}

describe('amount unit preference', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults to thousands when nothing is stored', () => {
    stubStorage();
    expect(readAmountUnit()).toBe('THOUSANDS');
  });
  it('defaults to thousands for garbage stored values', () => {
    stubStorage({ 'monopoly-bank-amount-unit': 'BILLIONS' });
    expect(readAmountUnit()).toBe('THOUSANDS');
  });
  it('round-trips the written unit under its own key', () => {
    const store = stubStorage();
    writeAmountUnit('MILLIONS');
    expect(readAmountUnit()).toBe('MILLIONS');
    expect(store.get('monopoly-bank-amount-unit')).toBe('MILLIONS');
    expect(store.has('monopoly-bank-device-preferences')).toBe(false);
  });
  it('does not throw when storage is unavailable', () => {
    stubBrokenStorage();
    expect(() => writeAmountUnit('MILLIONS')).not.toThrow();
    expect(readAmountUnit()).toBe('THOUSANDS');
  });
  it('does not throw when storage is missing entirely', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => writeAmountUnit('MILLIONS')).not.toThrow();
    expect(readAmountUnit()).toBe('THOUSANDS');
  });
});
