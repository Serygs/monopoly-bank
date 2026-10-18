type MaskPredicate = (row: number, column: number) => boolean;

const MASK_PREDICATES: readonly MaskPredicate[] = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row * column) % 3) + ((row + column) % 2)) % 2 === 0,
];

export function masked(row: number, column: number, mask: number): boolean {
  return MASK_PREDICATES[mask](row, column);
}
