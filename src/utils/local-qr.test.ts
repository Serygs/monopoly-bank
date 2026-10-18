import { describe, expect, it } from 'vitest';
import { createLocalQr, type QrMatrix } from './local-qr.js';

const SIZE = 49;
const DATA_CODEWORDS = 194;
const BLOCKS = 2;
const BLOCK_DATA = DATA_CODEWORDS / BLOCKS;
const EC_PER_BLOCK = 24;
const ALIGNMENT_CENTERS = [6, 24, 42];

const gfMultiply = (left: number, right: number): number => {
  let result = 0;
  let a = left;
  let b = right;
  while (b > 0) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return result;
};

const generator = (degree: number): number[] => {
  let coefficients = [1];
  let root = 1;
  for (let step = 0; step < degree; step += 1) {
    const next = new Array<number>(coefficients.length + 1).fill(0);
    coefficients.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= gfMultiply(coefficient, root);
    });
    coefficients = next;
    root = gfMultiply(root, 2);
  }
  return coefficients;
};

const errorCorrection = (data: readonly number[]): number[] => {
  const divisor = generator(EC_PER_BLOCK);
  const remainder = [...data, ...new Array<number>(EC_PER_BLOCK).fill(0)];
  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index] ?? 0;
    if (factor === 0) continue;
    divisor.forEach((coefficient, offset) => {
      remainder[index + offset] =
        (remainder[index + offset] ?? 0) ^ gfMultiply(coefficient, factor);
    });
  }
  return remainder.slice(data.length);
};

const bchRemainder = (value: number, polynomial: number): number => {
  const degree = 31 - Math.clz32(polynomial);
  let remainder = value;
  while (remainder !== 0 && 31 - Math.clz32(remainder) >= degree)
    remainder ^= polynomial << (31 - Math.clz32(remainder) - degree);
  return remainder;
};

const isFunctionModule = (row: number, column: number): boolean => {
  if (row <= 8 && column <= 8) return true;
  if (row <= 8 && column >= SIZE - 8) return true;
  if (row >= SIZE - 8 && column <= 8) return true;
  if (row === 6 || column === 6) return true;
  if (row <= 5 && column >= SIZE - 11 && column <= SIZE - 9) return true;
  if (column <= 5 && row >= SIZE - 11 && row <= SIZE - 9) return true;
  for (const centerRow of ALIGNMENT_CENTERS)
    for (const centerColumn of ALIGNMENT_CENTERS) {
      const overlapsFinder =
        (centerRow === 6 && centerColumn === 6) ||
        (centerRow === 6 && centerColumn === 42) ||
        (centerRow === 42 && centerColumn === 6);
      if (overlapsFinder) continue;
      if (Math.abs(row - centerRow) <= 2 && Math.abs(column - centerColumn) <= 2) return true;
    }
  return false;
};

const maskApplies = (mask: number, row: number, column: number): boolean => {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
};

const bit = (matrix: QrMatrix, row: number, column: number): number =>
  matrix[row]?.[column] === true ? 1 : 0;

const formatCopies = (matrix: QrMatrix): [number, number] => {
  let first = 0;
  let second = 0;
  for (let index = 0; index < 15; index += 1) {
    const one =
      index < 6
        ? bit(matrix, index, 8)
        : index === 6
          ? bit(matrix, 7, 8)
          : index === 7
            ? bit(matrix, 8, 8)
            : index === 8
              ? bit(matrix, 8, 7)
              : bit(matrix, 8, 14 - index);
    const two = index < 8 ? bit(matrix, 8, SIZE - 1 - index) : bit(matrix, SIZE - 15 + index, 8);
    first |= one << index;
    second |= two << index;
  }
  return [first, second];
};

const versionCopies = (matrix: QrMatrix): [number, number] => {
  let first = 0;
  let second = 0;
  for (let index = 0; index < 18; index += 1) {
    first |= bit(matrix, Math.floor(index / 3), SIZE - 11 + (index % 3)) << index;
    second |= bit(matrix, SIZE - 11 + (index % 3), Math.floor(index / 3)) << index;
  }
  return [first, second];
};

interface Decoded {
  mask: number;
  errorCorrectionLevel: number;
  bytes: number[];
  codewords: number[];
  dataCodewords: number[];
  padding: number[];
}

const decode = (matrix: QrMatrix): Decoded => {
  const [format] = formatCopies(matrix);
  const unmaskedFormat = format ^ 0x5412;
  const mask = (unmaskedFormat >> 10) & 7;
  const errorCorrectionLevel = (unmaskedFormat >> 13) & 3;
  const modules: number[] = [];
  let upward = true;
  for (let column = SIZE - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let offset = 0; offset < SIZE; offset += 1) {
      const row = upward ? SIZE - 1 - offset : offset;
      for (const target of [column, column - 1]) {
        if (isFunctionModule(row, target)) continue;
        modules.push(bit(matrix, row, target) ^ (maskApplies(mask, row, target) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let index = 0; index + 7 < modules.length; index += 8)
    codewords.push(modules.slice(index, index + 8).reduce((sum, value) => sum * 2 + value, 0));
  const dataBlocks = [0, 1].map((block) =>
    Array.from({ length: BLOCK_DATA }, (_, index) => codewords[index * BLOCKS + block] ?? 0),
  );
  const dataCodewords = dataBlocks.flat();
  const bits = dataCodewords.flatMap((value) =>
    Array.from({ length: 8 }, (_, index) => (value >> (7 - index)) & 1),
  );
  const read = (from: number, length: number) =>
    bits.slice(from, from + length).reduce((sum, value) => sum * 2 + value, 0);
  const mode = read(0, 4);
  if (mode !== 0b0100) throw new Error(`mode ${mode}`);
  const length = read(4, 8);
  const bytes = Array.from({ length }, (_, index) => read(12 + index * 8, 8));
  const usedBits = 12 + length * 8;
  const terminator = Math.min(4, DATA_CODEWORDS * 8 - usedBits);
  const padStart = Math.ceil((usedBits + terminator) / 8);
  return {
    mask,
    errorCorrectionLevel,
    bytes,
    codewords,
    dataCodewords,
    padding: dataCodewords.slice(padStart),
  };
};

const text = (decoded: Decoded) => new TextDecoder().decode(Uint8Array.from(decoded.bytes));
const sampleUrl = 'https://bank.example/games/join#invite=opaque-token';

describe('local invitation QR', () => {
  it('encodes an HTTPS invitation locally into a stable square matrix', () => {
    const matrix = createLocalQr(sampleUrl);
    expect(matrix).toHaveLength(SIZE);
    expect(matrix.every((row) => row.length === SIZE)).toBe(true);
    expect(matrix).toEqual(createLocalQr(sampleUrl));
  });

  it('decodes back to the exact text it was given', () => {
    expect(text(decode(createLocalQr(sampleUrl)))).toBe(sampleUrl);
  });

  it.each([
    '',
    'a',
    'https://bank.example/join#invite=0',
    'Привіт, Монополія! ✓',
    'x'.repeat(192),
    'https://bank.example/games/join?code=ABCD12#invite=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_',
  ])('decodes %j', (value) => {
    expect(text(decode(createLocalQr(value)))).toBe(value);
  });

  it('refuses 193 bytes and counts bytes, not characters', () => {
    expect(() => createLocalQr('x'.repeat(193))).toThrow(
      'Invitation URL is too long for the local QR code.',
    );
    expect(() => createLocalQr('я'.repeat(96))).not.toThrow();
    expect(() => createLocalQr('я'.repeat(97))).toThrow(
      'Invitation URL is too long for the local QR code.',
    );
    expect(() => createLocalQr(`https://bank.example/#${'a'.repeat(250)}`)).toThrow();
  });

  it('writes the three finder patterns with their white separators', () => {
    const matrix = createLocalQr(sampleUrl);
    const finderAt = (top: number, left: number) => {
      for (let row = 0; row < 7; row += 1)
        for (let column = 0; column < 7; column += 1) {
          const ring = Math.max(Math.abs(row - 3), Math.abs(column - 3));
          expect(bit(matrix, top + row, left + column)).toBe(ring === 2 ? 0 : 1);
        }
    };
    finderAt(0, 0);
    finderAt(0, SIZE - 7);
    finderAt(SIZE - 7, 0);
    for (let index = 0; index < 8; index += 1) {
      expect(bit(matrix, 7, index)).toBe(0);
      expect(bit(matrix, index, 7)).toBe(0);
      expect(bit(matrix, 7, SIZE - 1 - index)).toBe(0);
      expect(bit(matrix, index, SIZE - 8)).toBe(0);
      expect(bit(matrix, SIZE - 8, index)).toBe(0);
      expect(bit(matrix, SIZE - 1 - index, 7)).toBe(0);
    }
  });

  it('writes alternating timing patterns, alignment patterns and the dark module', () => {
    const matrix = createLocalQr(sampleUrl);
    for (let index = 8; index < SIZE - 8; index += 1) {
      expect(bit(matrix, 6, index)).toBe(index % 2 === 0 ? 1 : 0);
      expect(bit(matrix, index, 6)).toBe(index % 2 === 0 ? 1 : 0);
    }
    for (const [centerRow, centerColumn] of [
      [24, 24],
      [24, 6],
      [6, 24],
      [24, 42],
      [42, 24],
      [42, 42],
    ] as const)
      for (let row = -2; row <= 2; row += 1)
        for (let column = -2; column <= 2; column += 1)
          expect(bit(matrix, centerRow + row, centerColumn + column)).toBe(
            Math.max(Math.abs(row), Math.abs(column)) === 1 ? 0 : 1,
          );
    expect(bit(matrix, SIZE - 8, 8)).toBe(1);
  });

  it('writes the same valid format information twice: level L and a BCH-correct mask', () => {
    for (const value of [sampleUrl, 'a', 'x'.repeat(192)]) {
      const matrix = createLocalQr(value);
      const [first, second] = formatCopies(matrix);
      expect(first).toBe(second);
      const unmasked = first ^ 0x5412;
      expect(unmasked >> 13).toBe(0b01);
      expect(bchRemainder(unmasked, 0x537)).toBe(0);
      expect((unmasked >> 10) & 7).toBeLessThan(8);
    }
  });

  it('writes the same valid version 8 information twice', () => {
    const [first, second] = versionCopies(createLocalQr(sampleUrl));
    expect(first).toBe(second);
    expect(first >> 12).toBe(8);
    expect(bchRemainder(first, 0x1f25)).toBe(0);
  });

  it('protects each of the two blocks with Reed-Solomon codewords that an independent encoder reproduces', () => {
    for (const value of [sampleUrl, '', 'Привіт ✓', 'x'.repeat(192)]) {
      const { codewords, dataCodewords } = decode(createLocalQr(value));
      for (let block = 0; block < BLOCKS; block += 1) {
        const data = dataCodewords.slice(block * BLOCK_DATA, (block + 1) * BLOCK_DATA);
        const written = Array.from(
          { length: EC_PER_BLOCK },
          (_, index) => codewords[DATA_CODEWORDS + index * BLOCKS + block] ?? -1,
        );
        expect(written).toEqual(errorCorrection(data));
      }
      expect(codewords.length).toBeGreaterThanOrEqual(DATA_CODEWORDS + BLOCKS * EC_PER_BLOCK);
    }
  });

  it('pads the unused data codewords with the alternating 0xEC and 0x11 bytes', () => {
    const { padding, bytes } = decode(createLocalQr('a'));
    expect(bytes).toEqual([97]);
    expect(padding.length).toBe(DATA_CODEWORDS - 3);
    padding.forEach((value, index) => expect(value).toBe(index % 2 === 0 ? 0xec : 0x11));
  });

  it('leaves no padding when the payload fills every data codeword', () => {
    const { padding, dataCodewords } = decode(createLocalQr('x'.repeat(192)));
    expect(padding).toEqual([]);
    expect(dataCodewords).toHaveLength(DATA_CODEWORDS);
  });

  it('writes byte mode with the exact byte count in the header', () => {
    const { dataCodewords } = decode(createLocalQr('abc'));
    expect(dataCodewords.slice(0, 5)).toEqual([0x40, 0x36, 0x16, 0x26, 0x30]);
  });

  it('uses level L and gives different inputs different symbols', () => {
    expect(decode(createLocalQr(sampleUrl)).errorCorrectionLevel).toBe(1);
    expect(createLocalQr('https://bank.example/a')).not.toEqual(
      createLocalQr('https://bank.example/b'),
    );
  });

  it('decodes whichever of the eight masks it picks, and picks more than one over many inputs', () => {
    const masks = new Set<number>();
    for (let index = 0; index < 60; index += 1) {
      const value = `https://bank.example/games/join#invite=${index}-${'q'.repeat(index % 40)}`;
      const decoded = decode(createLocalQr(value));
      expect(text(decoded)).toBe(value);
      masks.add(decoded.mask);
    }
    expect(masks.size).toBeGreaterThan(1);
  });

  it('decodes six hundred varied payloads and uses every mask pattern the scorer picks', () => {
    const masks = new Set<number>();
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let index = 0; index < 600; index += 1) {
      const length = next() % 193;
      const value = Array.from({ length }, () => String.fromCharCode(33 + (next() % 90))).join('');
      const decoded = decode(createLocalQr(value));
      expect(text(decoded)).toBe(value);
      masks.add(decoded.mask);
    }
    expect(masks.size).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it('keeps a balanced share of dark modules, as the mask choice intends', () => {
    const matrix = createLocalQr(sampleUrl);
    const dark = matrix.flat().filter(Boolean).length;
    const share = (dark * 100) / (SIZE * SIZE);
    expect(share).toBeGreaterThan(35);
    expect(share).toBeLessThan(65);
  });
});
