import { describe, expect, it } from 'vitest';
import { acceptsLiveVersion } from './live-version';

describe('live state versions', () => {
  it('accepts duplicate and contiguous events but requires a snapshot after a gap', () => {
    expect(acceptsLiveVersion(7, 7)).toBe(true);
    expect(acceptsLiveVersion(7, 8)).toBe(true);
    expect(acceptsLiveVersion(7, 9)).toBe(false);
    expect(acceptsLiveVersion(7, 6)).toBe(false);
  });
});
