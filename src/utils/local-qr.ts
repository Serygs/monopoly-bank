/**
 * A deliberately small, local QR encoder for opaque invitation URLs.
 * It writes a standards-compliant version 8-L byte QR (49 modules), which
 * accepts URLs up to 194 UTF-8 bytes. No link data is sent to a QR service.
 */
import { DATA_CODEWORDS, MODULES } from './local-qr-constants.js';
import { interleave } from './local-qr-ecc.js';
import { masked } from './local-qr-mask.js';
import { placeFormat, placePatterns, type Cells } from './local-qr-patterns.js';
import { score, type QrMatrix } from './local-qr-score.js';

export type { QrMatrix };

export function createLocalQr(value: string): QrMatrix {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > DATA_CODEWORDS - 2)
    throw new Error('Invitation URL is too long for the local QR code.');
  const data = packData(bytes);
  const codewords = interleave(data);
  let best: QrMatrix | null = null;
  let lowestPenalty = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = buildMatrix(codewords, mask);
    const penalty = score(candidate);
    if (penalty < lowestPenalty) {
      best = candidate;
      lowestPenalty = penalty;
    }
  }
  return best as QrMatrix;
}

function packData(bytes: Uint8Array): Uint8Array {
  const bits: number[] = [0, 1, 0, 0];
  push(bits, bytes.length, 8);
  for (const byte of bytes) push(bits, byte, 8);
  const capacity = DATA_CODEWORDS * 8;
  for (let index = 0; index < 4 && bits.length < capacity; index += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const packed = new Uint8Array(DATA_CODEWORDS);
  for (let index = 0; index < bits.length; index += 1)
    packed[Math.floor(index / 8)] |= bits[index] << (7 - (index % 8));
  for (let index = Math.ceil(bits.length / 8), pad = 0; index < packed.length; index += 1, pad += 1)
    packed[index] = pad % 2 === 0 ? 0xec : 0x11;
  return packed;
}

function push(target: number[], value: number, length: number) {
  for (let bit = length - 1; bit >= 0; bit -= 1) target.push((value >>> bit) & 1);
}

function dataBit(codewords: Uint8Array, bit: number): boolean {
  return (
    bit < codewords.length * 8 && ((codewords[Math.floor(bit / 8)] >>> (7 - (bit % 8))) & 1) === 1
  );
}

function fillCodewords(matrix: Cells, codewords: Uint8Array, mask: number) {
  let bit = 0;
  let upward = true;
  for (let column = MODULES - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let offset = 0; offset < MODULES; offset += 1) {
      const row = upward ? MODULES - 1 - offset : offset;
      for (const target of [column, column - 1]) {
        if (matrix[row][target] !== null) continue;
        matrix[row][target] = dataBit(codewords, bit) !== masked(row, target, mask);
        bit += 1;
      }
    }
    upward = !upward;
  }
}

function buildMatrix(codewords: Uint8Array, mask: number): QrMatrix {
  const matrix: Cells = Array.from({ length: MODULES }, () =>
    Array.from({ length: MODULES }, () => null),
  );
  placePatterns(matrix);
  placeFormat(matrix, mask);
  fillCodewords(matrix, codewords, mask);
  return matrix.map((row) => row.map((cell) => cell === true));
}
