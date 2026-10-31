import { describe, expect, it } from 'vitest';
import { buildGameSettings } from '../domain/game-rules.js';
import {
  boardModes,
  buildBoardSnapshot,
  getBoardPreset,
  isBoardMode,
  monopolyRu2012,
  scaleBoardAmount,
} from './index.js';

describe('board catalog', () => {
  it('accepts only the supported board modes', () => {
    expect(boardModes).toEqual(['none', 'monopoly-ru-2012', 'monopoly-ua-classic']);
    expect(isBoardMode('monopoly-ua-classic')).toBe(true);
    expect(isBoardMode('none')).toBe(true);
    expect(isBoardMode('monopoly-ru-2012')).toBe(true);
    expect(isBoardMode('custom')).toBe(false);
    expect(isBoardMode(undefined)).toBe(false);
  });

  it('has 28 unique property tiles whose group sizes match the tile counts', () => {
    const preset = getBoardPreset('monopoly-ru-2012');
    expect(preset.tiles).toHaveLength(28);
    expect(new Set(preset.tiles.map((tile) => tile.id)).size).toBe(28);
    expect(new Set(preset.tiles.map((tile) => tile.pos)).size).toBe(28);
    for (const [group, info] of Object.entries(preset.groups)) {
      expect(preset.tiles.filter((tile) => tile.group === group)).toHaveLength(info.size);
    }
  });

  it('is identical to the preset at the base starting balance', () => {
    const unit = monopolyRu2012.baseStartBalance / 150;
    const snapshot = buildBoardSnapshot(monopolyRu2012, unit);
    expect(snapshot.multiplier).toBe(1);
    expect(snapshot.tiles).toEqual(monopolyRu2012.tiles);
    expect(scaleBoardAmount(monopolyRu2012, unit, 123_456)).toBe(123_456);
    const taxes = monopolyRu2012.nonPropertyTiles.filter((tile) => tile.type === 'tax');
    expect([snapshot.incomeTax, snapshot.luxuryTax]).toEqual(
      taxes.map((tile) => (tile.type === 'tax' ? tile.amount : 0)),
    );
    const go = monopolyRu2012.nonPropertyTiles.find((tile) => tile.type === 'go');
    expect(snapshot.goReward).toBe(go?.type === 'go' ? go.reward : -1);
  });

  it('scales every amount to whole numbers for a smaller starting balance', () => {
    const settings = buildGameSettings(1_500_000, 'monopoly-ru-2012');
    const board = settings.board;
    expect(board).toBeDefined();
    expect(board?.multiplier).toBeCloseTo(0.1);
    for (const tile of board?.tiles ?? []) {
      expect(Number.isSafeInteger(tile.price)).toBe(true);
      expect(Number.isSafeInteger(tile.mortgage)).toBe(true);
      expect(tile.price).toBeGreaterThan(0);
      for (const rent of tile.rent ?? []) expect(Number.isSafeInteger(rent)).toBe(true);
    }
    expect(Number.isSafeInteger(board?.incomeTax)).toBe(true);
    expect(Number.isSafeInteger(board?.goReward)).toBe(true);
  });

  it('adds no board to a game created without one', () => {
    expect(buildGameSettings(15_000_000)).not.toHaveProperty('board');
    expect(buildGameSettings(15_000_000, 'none')).not.toHaveProperty('board');
  });
});
