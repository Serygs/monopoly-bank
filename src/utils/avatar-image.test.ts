import { afterEach, describe, expect, it, vi } from 'vitest';

import { cropAvatar } from './avatar-image';

describe('cropAvatar', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a source larger than 10 MB and compresses its centered square crop', async () => {
    const drawImage = vi.fn();
    const toDataURL = vi.fn((_type: string, quality: number) =>
      quality === 0.86
        ? `data:image/jpeg;base64,${'A'.repeat(100_000)}`
        : 'data:image/jpeg;base64,compressed',
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:avatar', revokeObjectURL });
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = 1200;
        naturalHeight = 800;
        async decode() {}
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL }),
    });

    const result = await cropAvatar({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 } as File);

    expect(result).toBe('data:image/jpeg;base64,compressed');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 200, 0, 800, 800, 0, 0, 256, 256);
    expect(toDataURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });
});

describe('cropAvatar refusals and limits', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (options: {
    width?: number;
    height?: number;
    context?: { drawImage: () => void } | null;
    lengths?: number[];
  }) => {
    const revokeObjectURL = vi.fn();
    const drawImage = vi.fn();
    const created: string[] = [];
    const canvas = {
      width: 0,
      height: 0,
      contexts: [] as string[],
      getContext(kind: string) {
        this.contexts.push(kind);
        return options.context === undefined ? { drawImage } : options.context;
      },
      qualities: [] as Array<[string, number]>,
      toDataURL(type: string, quality: number) {
        this.qualities.push([type, quality]);
        const length = (options.lengths ?? [10])[this.qualities.length - 1] ?? 200_000;
        return 'x'.repeat(length);
      },
    };
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:avatar', revokeObjectURL });
    vi.stubGlobal(
      'Image',
      class {
        src = '';
        naturalWidth = options.width ?? 800;
        naturalHeight = options.height ?? 800;
        async decode() {}
      },
    );
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        created.push(tag);
        return canvas;
      },
    });
    return { revokeObjectURL, drawImage, canvas, created };
  };
  const file = (type: string) => ({ type, size: 1 }) as File;

  it.each(['image/gif', 'image/svg+xml', 'text/plain', ''])(
    'refuses a %j file before reading it',
    async (type) => {
      const createObjectURL = vi.fn();
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
      await expect(cropAvatar(file(type))).rejects.toThrow('Unsupported image');
      expect(createObjectURL).not.toHaveBeenCalled();
    },
  );

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts a %s file', async (type) => {
    stub({});
    await expect(cropAvatar(file(type))).resolves.toBe('x'.repeat(10));
  });

  it('refuses an image with no pixels and still frees the object URL', async () => {
    const { revokeObjectURL } = stub({ width: 0, height: 500 });
    await expect(cropAvatar(file('image/png'))).rejects.toThrow('Empty image');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });

  it('refuses when the browser gives no 2d drawing context', async () => {
    const { revokeObjectURL } = stub({ context: null });
    await expect(cropAvatar(file('image/png'))).rejects.toThrow('Image processing is unavailable');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });

  it('draws a 256 by 256 canvas from a 2d context', async () => {
    const { canvas, created } = stub({});
    await cropAvatar(file('image/png'));
    expect(created).toEqual(['canvas']);
    expect(canvas.contexts).toEqual(['2d']);
    expect([canvas.width, canvas.height]).toEqual([256, 256]);
  });

  it('crops a tall image from the middle of its height', async () => {
    const { drawImage } = stub({ width: 600, height: 1000 });
    await cropAvatar(file('image/png'));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 200, 600, 600, 0, 0, 256, 256);
  });

  it('keeps a result of exactly 100 000 characters and tries the next quality for one more', async () => {
    const exact = stub({ lengths: [100_000] });
    await expect(cropAvatar(file('image/png'))).resolves.toHaveLength(100_000);
    expect(exact.canvas.qualities).toEqual([['image/jpeg', 0.86]]);
    const over = stub({ lengths: [100_001, 5] });
    await expect(cropAvatar(file('image/png'))).resolves.toHaveLength(5);
    expect(over.canvas.qualities).toEqual([
      ['image/jpeg', 0.86],
      ['image/jpeg', 0.76],
    ]);
  });

  it('gives up after the lowest quality and frees the object URL', async () => {
    const { canvas, revokeObjectURL } = stub({ lengths: [] });
    await expect(cropAvatar(file('image/png'))).rejects.toThrow('Image could not be compressed');
    expect(canvas.qualities.map(([, quality]) => quality)).toEqual([0.86, 0.76, 0.66, 0.56, 0.46]);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avatar');
  });
});
