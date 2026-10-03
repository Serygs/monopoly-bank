export async function cropAvatar(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Unsupported image');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side === 0) throw new Error('Empty image');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Image processing is unavailable');
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    for (const quality of [0.86, 0.76, 0.66, 0.56, 0.46]) {
      const result = canvas.toDataURL('image/jpeg', quality);
      if (result.length <= 100_000) return result;
    }
    throw new Error('Image could not be compressed');
  } finally {
    URL.revokeObjectURL(url);
  }
}
