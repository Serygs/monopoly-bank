import { describe, expect, it } from 'vitest';
import { QR_FIXTURES } from './local-qr.fixtures.js';
import { createLocalQr } from './local-qr.js';

const toRows = (matrix: boolean[][]): string[] =>
  matrix.map((row) => row.map((cell) => (cell ? '1' : '0')).join(''));

describe('local QR golden matrices', () => {
  it('covers every mask pattern', () => {
    expect(new Set(QR_FIXTURES.map((fixture) => fixture.mask)).size).toBe(8);
  });

  it.each(QR_FIXTURES.map((fixture) => [fixture.mask, fixture] as const))(
    'reproduces the exact module matrix for a mask %i fixture',
    (_mask, fixture) => {
      expect(toRows(createLocalQr(fixture.input))).toEqual(fixture.rows);
    },
  );
});
