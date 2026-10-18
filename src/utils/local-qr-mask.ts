export function masked(row: number, column: number, mask: number): boolean {
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
