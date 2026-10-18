import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncAction } from './useAsyncAction';

describe('useAsyncAction', () => {
  it('is busy while the action runs and idle afterwards', async () => {
    const { result } = renderHook(() => useAsyncAction());
    let finish: () => void = () => undefined;
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.run(() => new Promise<void>((resolve) => (finish = resolve)));
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      finish();
      await pending;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('stores a failure, calls onError and clears the error on the next run', async () => {
    const { result } = renderHook(() => useAsyncAction());
    const failure = new Error('nope');
    const onError = vi.fn();
    await act(async () => {
      await result.current.run(() => Promise.reject(failure), onError);
    });
    expect(result.current.error).toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.run(() => Promise.resolve());
    });
    expect(result.current.error).toBeNull();
  });

  it('ignores a second run while one is in flight', async () => {
    const { result } = renderHook(() => useAsyncAction());
    const action = vi.fn(() => new Promise<void>(() => undefined));
    act(() => {
      void result.current.run(action);
      void result.current.run(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
  });
});
