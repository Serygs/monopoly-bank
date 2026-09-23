import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'migrations/0021_dice_rolls.sql'), 'utf8');

describe('0021 dice roll migration', () => {
  it('stores the last dice total additively and bounded to a two-dice range', () => {
    expect(source).toContain('ALTER TABLE players ADD COLUMN last_roll_total INTEGER');
    expect(source).toContain('CHECK (last_roll_total IS NULL OR last_roll_total BETWEEN 2 AND 12)');
    expect(source).not.toMatch(/ADD COLUMN last_roll_total[^;]*NOT NULL/i);
  });

  it('stores when the roll happened without adding turn-order state', () => {
    expect(source).toContain('ALTER TABLE players ADD COLUMN last_roll_at TEXT;');
    expect(source).not.toMatch(/ADD COLUMN last_roll_at[^;]*NOT NULL/i);
  });

  it('adds nothing but those two columns, so no board or turn state reaches D1', () => {
    const statements = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.startsWith('ALTER TABLE players ADD COLUMN')).toBe(true);
    }
  });
});
