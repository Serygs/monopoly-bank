import { afterEach, describe, expect, it, vi } from 'vitest';

import { cropAvatar } from './avatar-image';

describe('cropAvatar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a source larger than 10 MB and compresses its centered square crop', async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn((_type: string, quality: number) => quality === 0.86 ? `data:image/jpeg;base64,${'A'.repeat(100_000)}` : 'data:image/jpeg;base64,compressed');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:avatar', revokeObjectURL });
    vi.stubGlobal('Image', class { src = ''; naturalWidth = 1200; naturalHeight = 800; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL }) });

    const result = await cropAvatar({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 } as File);

    expect(result).toBe('data:image/jpeg;base64,compressed');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 256, 256);
    expect(toDataURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });
});
