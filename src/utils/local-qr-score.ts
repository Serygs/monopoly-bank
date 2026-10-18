export type QrMatrix = boolean[][];

function runPenalty(run: number): number {
  return run >= 5 ? run - 2 : 0;
}

function linePenalty(cells: readonly boolean[]): number {
  let penalty = 0;
  let run = 1;
  for (let index = 1; index < cells.length; index += 1) {
    if (cells[index] === cells[index - 1]) {
      run += 1;
    } else {
      penalty += runPenalty(run);
      run = 1;
    }
  }
  return penalty + runPenalty(run);
}

function runsPenalty(matrix: QrMatrix): number {
  let penalty = 0;
  for (let line = 0; line < matrix.length; line += 1) {
    penalty += linePenalty(matrix[line]);
    penalty += linePenalty(matrix.map((row) => row[line]));
  }
  return penalty;
}

function isUniformBlock(matrix: QrMatrix, row: number, column: number): boolean {
  const cell = matrix[row][column];
  return (
    cell === matrix[row + 1][column] &&
    cell === matrix[row][column + 1] &&
    cell === matrix[row + 1][column + 1]
  );
}

function blocksPenalty(matrix: QrMatrix): number {
  let penalty = 0;
  for (let row = 0; row < matrix.length - 1; row += 1)
    for (let column = 0; column < matrix.length - 1; column += 1)
      if (isUniformBlock(matrix, row, column)) penalty += 3;
  return penalty;
}

function balancePenalty(matrix: QrMatrix): number {
  const size = matrix.length;
  const dark = matrix.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  return Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
}

export function score(matrix: QrMatrix): number {
  return runsPenalty(matrix) + blocksPenalty(matrix) + balancePenalty(matrix);
}
