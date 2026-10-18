import { ALIGNMENT, MODULES, VERSION } from './local-qr-constants.js';

export type Cells = Array<Array<boolean | null>>;

export function placePatterns(matrix: Cells) {
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

function finder(matrix: Cells, left: number, top: number) {
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

function alignment(matrix: Cells, centerRow: number, centerColumn: number) {
  for (let row = -2; row <= 2; row += 1)
    for (let column = -2; column <= 2; column += 1)
      matrix[centerRow + row][centerColumn + column] =
        Math.max(Math.abs(row), Math.abs(column)) !== 1;
}

function reserveVersion(matrix: Cells) {
  const value = bch(VERSION << 12, 0x1f25) | (VERSION << 12);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((value >>> index) & 1) === 1;
    matrix[Math.floor(index / 3)][MODULES - 11 + (index % 3)] = dark;
    matrix[MODULES - 11 + (index % 3)][Math.floor(index / 3)] = dark;
  }
}

export function placeFormat(matrix: Cells, mask: number) {
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
