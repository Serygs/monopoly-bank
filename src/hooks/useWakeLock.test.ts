import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

function stubWakeLock() {
  const sentinels: { released: boolean; release: ReturnType<typeof vi.fn> }[] = [];
  const request = vi.fn(() => {
    const sentinel = {
      released: false,
      release: vi.fn(() => {
        sentinel.released = true;
        return Promise.resolve();
      }),
    };
    sentinels.push(sentinel);
    return Promise.resolve(sentinel);
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, sentinels };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useWakeLock', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('requests the screen lock while active and releases it when turned off', async () => {
    const { request, sentinels } = stubWakeLock();
    const { rerender } = renderHook(({ active }) => useWakeLock(active), {
      initialProps: { active: true },
    });
    await vi.waitFor(() => expect(sentinels).toHaveLength(1));
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ active: false });
    expect(sentinels[0]?.release).toHaveBeenCalledOnce();
  });

  it('requests the lock again when the page becomes visible after the browser released it', async () => {
    const { request, sentinels } = stubWakeLock();
    renderHook(() => useWakeLock(true));
    await vi.waitFor(() => expect(sentinels).toHaveLength(1));
    const first = sentinels[0];
    if (first !== undefined) first.released = true;
    setVisibility('hidden');
    setVisibility('visible');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('does nothing when inactive or unsupported', () => {
    const { request } = stubWakeLock();
    renderHook(() => useWakeLock(false));
    expect(request).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, 'wakeLock');
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
