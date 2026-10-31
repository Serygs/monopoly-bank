import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePendingTitle } from './usePendingTitle';

describe('usePendingTitle', () => {
  afterEach(() => {
    document.title = 'Monopoly Bank';
  });

  it('prefixes the title with the count and restores it', () => {
    document.title = 'Monopoly Bank';
    const { rerender, unmount } = renderHook(({ count }) => usePendingTitle(count), {
      initialProps: { count: 0 },
    });
    expect(document.title).toBe('Monopoly Bank');
    rerender({ count: 2 });
    expect(document.title).toBe('(2) Monopoly Bank');
    rerender({ count: 3 });
    expect(document.title).toBe('(3) Monopoly Bank');
    rerender({ count: 0 });
    expect(document.title).toBe('Monopoly Bank');
    rerender({ count: 1 });
    unmount();
    expect(document.title).toBe('Monopoly Bank');
  });
});
