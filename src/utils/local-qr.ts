/**
 * A deliberately small, local QR encoder for opaque invitation URLs.
 * It writes a standards-compliant version 8-L byte QR (49 modules), which
 * accepts URLs up to 194 UTF-8 bytes. No link data is sent to a QR service.
 */
const VERSION = 8;
const MODULES = 49;
const DATA_CODEWORDS = 194;
const BLOCKS = 2;
const EC_CODEWORDS_PER_BLOCK = 24;
const ALIGNMENT = [6, 24, 42];
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

for (let index = 0, value = 1; index < 255; index += 1) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d;
}
for (let index = 255; index < EXP.length; index += 1) EXP[index] = EXP[index - 255];

export type QrMatrix = boolean[][];

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

function interleave(data: Uint8Array): Uint8Array {
  const blockLength = DATA_CODEWORDS / BLOCKS;
  const blocks = Array.from({ length: BLOCKS }, (_, index) =>
    data.slice(index * blockLength, (index + 1) * blockLength),
  );
  const ecc = blocks.map(reedSolomon);
  const result: number[] = [];
  for (let index = 0; index < blockLength; index += 1)
    for (const block of blocks) result.push(block[index]);
  for (let index = 0; index < EC_CODEWORDS_PER_BLOCK; index += 1)
    for (const block of ecc) result.push(block[index]);
  return Uint8Array.from(result);
}

function reedSolomon(data: Uint8Array): Uint8Array {
  const generator = polynomial(EC_CODEWORDS_PER_BLOCK);
  const remainder = new Uint8Array(EC_CODEWORDS_PER_BLOCK);
  for (const value of data) {
    const factor = value ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[EC_CODEWORDS_PER_BLOCK - 1] = 0;
    for (let index = 0; index < EC_CODEWORDS_PER_BLOCK; index += 1)
      remainder[index] ^= multiply(generator[index], factor);
  }
  return remainder;
}

function polynomial(degree: number): Uint8Array {
  let values = Uint8Array.of(1);
  for (let power = 0; power < degree; power += 1) {
    const next = new Uint8Array(values.length + 1);
    for (let index = 0; index < values.length; index += 1) {
      next[index] ^= values[index];
      next[index + 1] ^= multiply(values[index], EXP[power]);
    }
    values = next;
  }
  return values.slice(1);
}

function multiply(left: number, right: number): number {
  return left === 0 || right === 0 ? 0 : EXP[LOG[left] + LOG[right]];
}

function buildMatrix(codewords: Uint8Array, mask: number): QrMatrix {
  const matrix: Array<Array<boolean | null>> = Array.from({ length: MODULES }, () =>
    Array.from({ length: MODULES }, () => null),
  );
  placePatterns(matrix);
  placeFormat(matrix, mask);
  let bit = 0;
  let upward = true;
  for (let column = MODULES - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let offset = 0; offset < MODULES; offset += 1) {
      const row = upward ? MODULES - 1 - offset : offset;
      for (let side = 0; side < 2; side += 1) {
        const target = column - side;
        if (matrix[row][target] !== null) continue;
        const value =
          bit < codewords.length * 8
            ? ((codewords[Math.floor(bit / 8)] >>> (7 - (bit % 8))) & 1) === 1
            : false;
        matrix[row][target] = value !== masked(row, target, mask);
        bit += 1;
      }
    }
    upward = !upward;
  }
  return matrix.map((row) => row.map((cell) => cell === true));
}

function placePatterns(matrix: Array<Array<boolean | null>>) {
  finder(matrix, 0, 0);
  finder(matrix, MODULES - 7, 0);
  finder(matrix, 0, MODULES - 7);
  for (let index = 8; index < MODULES - 8; index += 1) {
    matrix[6][index] = index % 2 === 0;
    matrix[index][6] = index % 2 === 0;
  }
  for (const row of ALIGNMENT)
    for (const column of ALIGNMENT) {
      if (
        (row === 6 && column === 6) ||
        (row === 6 && column === MODULES - 7) ||
        (row === MODULES - 7 && column === 6)
      )
        continue;
      alignment(matrix, row, column);
    }
  matrix[MODULES - 8][8] = true;
  reserveVersion(matrix);
}

function finder(matrix: Array<Array<boolean | null>>, left: number, top: number) {
  for (let row = -1; row <= 7; row += 1)
    for (let column = -1; column <= 7; column += 1) {
      const y = top + row;
      const x = left + column;
      if (y < 0 || x < 0 || y >= MODULES || x >= MODULES) continue;
      matrix[y][x] =
        row >= 0 &&
        row <= 6 &&
        column >= 0 &&
        column <= 6 &&
        (row === 0 ||
          row === 6 ||
          column === 0 ||
          column === 6 ||
          (row >= 2 && row <= 4 && column >= 2 && column <= 4));
    }
}

function alignment(matrix: Array<Array<boolean | null>>, centerRow: number, centerColumn: number) {
  for (let row = -2; row <= 2; row += 1)
    for (let column = -2; column <= 2; column += 1)
      matrix[centerRow + row][centerColumn + column] =
        Math.max(Math.abs(row), Math.abs(column)) !== 1;
}

function reserveVersion(matrix: Array<Array<boolean | null>>) {
  const value = bch(VERSION << 12, 0x1f25) | (VERSION << 12);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((value >>> index) & 1) === 1;
    matrix[Math.floor(index / 3)][MODULES - 11 + (index % 3)] = dark;
    matrix[MODULES - 11 + (index % 3)][Math.floor(index / 3)] = dark;
  }
}

function placeFormat(matrix: Array<Array<boolean | null>>, mask: number) {
  // L error correction (01) with the QR format BCH and mandatory mask.
  const data = (1 << 3) | mask;
  const value = (bch(data << 10, 0x537) | (data << 10)) ^ 0x5412;
  for (let index = 0; index < 15; index += 1) {
    const dark = ((value >>> index) & 1) === 1;
    if (index < 6) matrix[index][8] = dark;
    else if (index < 8) matrix[index + 1][8] = dark;
    else matrix[MODULES - 15 + index][8] = dark;
    if (index < 8) matrix[8][MODULES - index - 1] = dark;
    else if (index < 9) matrix[8][15 - index] = dark;
    else matrix[8][15 - index - 1] = dark;
  }
}

function bch(value: number, polynomialValue: number): number {
  let result = value;
  const degree = Math.floor(Math.log2(polynomialValue));
  while (result !== 0 && Math.floor(Math.log2(result)) >= degree)
    result ^= polynomialValue << (Math.floor(Math.log2(result)) - degree);
  return result;
}
function masked(row: number, column: number, mask: number): boolean {
  return [
    () => (row + column) % 2 === 0,
    () => row % 2 === 0,
    () => column % 3 === 0,
    () => (row + column) % 3 === 0,
    () => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
    () => ((row * column) % 2) + ((row * column) % 3) === 0,
    () => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
    () => (((row * column) % 3) + ((row + column) % 2)) % 2 === 0,
  ][mask]();
}
function score(matrix: QrMatrix): number {
  let penalty = 0;
  const size = matrix.length;
  for (let axis = 0; axis < 2; axis += 1)
    for (let line = 0; line < size; line += 1) {
      let run = 1;
      let previous = axis === 0 ? matrix[line][0] : matrix[0][line];
      for (let index = 1; index < size; index += 1) {
        const current = axis === 0 ? matrix[line][index] : matrix[index][line];
        if (current === previous) run += 1;
        else {
          if (run >= 5) penalty += run - 2;
          run = 1;
          previous = current;
        }
      }
      if (run >= 5) penalty += run - 2;
    }
  for (let row = 0; row < size - 1; row += 1)
    for (let column = 0; column < size - 1; column += 1)
      if (
        matrix[row][column] === matrix[row + 1][column] &&
        matrix[row][column] === matrix[row][column + 1] &&
        matrix[row][column] === matrix[row + 1][column + 1]
      )
        penalty += 3;
  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark += 1;
  return penalty + Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
}
