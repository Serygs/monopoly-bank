import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadWhenIdle } from './idle-preload';

describe('preloadWhenIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads once the browser is idle and can be cancelled', () => {
    let callback: () => void = () => undefined;
    vi.stubGlobal('requestIdleCallback', (run: () => void) => {
      callback = run;
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancel);
    const load = vi.fn(() => Promise.resolve());
    const stop = preloadWhenIdle(load);
    expect(load).not.toHaveBeenCalled();
    callback();
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a timer and swallows a failed load', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const load = vi.fn(() => Promise.reject(new Error('offline')));
    preloadWhenIdle(load);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the user saves data', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const load = vi.fn(() => Promise.resolve());
    preloadWhenIdle(load);
    expect(load).not.toHaveBeenCalled();
  });
});
