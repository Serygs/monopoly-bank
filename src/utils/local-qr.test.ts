import { describe, expect, it } from 'vitest';
import { createLocalQr } from './local-qr.js';

describe('local invitation QR', () => {
  it('encodes an HTTPS invitation locally into a stable square matrix', () => {
    const value = 'https://bank.example/games/join#invite=opaque-token';
    const matrix = createLocalQr(value);
    expect(matrix).toHaveLength(49);
    expect(matrix.every((row) => row.length === 49)).toBe(true);
    expect(matrix).toEqual(createLocalQr(value));
  });
  it('rejects payloads outside the embedded QR capacity', () => expect(() => createLocalQr(`https://bank.example/#${'a'.repeat(250)}`)).toThrow());
});
