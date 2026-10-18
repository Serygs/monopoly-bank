import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearDraft,
  defaultDraft,
  defaultPassGoReward,
  defaultStartingBalance,
  DRAFT_STORAGE_KEY,
  firstPlayerColor,
  isDraftDirty,
  readDraft,
  writeDraft,
  type CreateGameDraft,
} from './create-game-draft';

const userId = 'user-1';
const nickname = 'Ann';

const valid = (patch: Partial<CreateGameDraft> = {}): CreateGameDraft => ({
  ...defaultDraft(userId, nickname),
  name: 'Friday',
  step: 1,
  ...patch,
});
const store = (value: unknown) => sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(value));
const fresh = () => defaultDraft(userId, nickname);

describe('defaultDraft', () => {
  it('starts a private fast game on the first step with the owner as the only player', () => {
    expect(defaultDraft(userId, nickname)).toEqual({
      userId,
      step: 0,
      name: '',
      currency: 'USD',
      paymentMode: 'FAST',
      isPublic: false,
      startingBalance: String(defaultStartingBalance),
      passGoReward: String(defaultPassGoReward),
      rules: {
        doubleRewardOnExactGo: false,
        playerLoans: false,
        bankLoans: false,
        freeParkingJackpot: false,
        auctions: false,
      },
      board: 'none',
      players: [{ key: 1, name: nickname, color: firstPlayerColor }],
    });
    expect(defaultStartingBalance).toBe(15_000_000);
    expect(defaultPassGoReward).toBe(2_000_000);
  });
});

describe('readDraft', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('returns the defaults when nothing is stored', () => {
    expect(readDraft(userId, nickname)).toEqual(fresh());
  });

  it.each(['not json', '', '{', 'null', '5', '"text"', 'true', '[]'])(
    'returns the defaults for the stored text %j',
    (text) => {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, text);
      expect(readDraft(userId, nickname)).toEqual(fresh());
    },
  );

  it('returns a stored draft of this user unchanged', () => {
    const draft = valid({
      name: 'Mine',
      currency: 'EUR',
      isPublic: true,
      paymentMode: 'CONFIRMATION',
    });
    store(draft);
    expect(readDraft(userId, nickname)).toEqual(draft);
  });

  it('ignores the draft of another user', () => {
    store(valid({ userId: 'user-2' }));
    expect(readDraft(userId, nickname)).toEqual(fresh());
    store({ ...valid(), userId: undefined });
    expect(readDraft(userId, nickname)).toEqual(fresh());
  });

  it.each([
    ['step', 'one'],
    ['step', undefined],
    ['name', 5],
    ['name', undefined],
    ['startingBalance', 1500],
    ['startingBalance', undefined],
    ['passGoReward', 200],
    ['passGoReward', undefined],
    ['isPublic', 'yes'],
    ['isPublic', undefined],
    ['paymentMode', 'SLOW'],
    ['paymentMode', undefined],
    ['currency', 'K'],
    ['currency', 'GBP'],
    ['currency', undefined],
    ['rules', null],
    ['rules', 'on'],
    ['rules', undefined],
    ['players', []],
    ['players', 'Ann'],
    ['players', undefined],
    ['players', [null]],
    ['players', [{ key: '1', name: 'Ann', color: '#fff' }]],
    ['players', [{ key: 1, name: 5, color: '#fff' }]],
    ['players', [{ key: 1, name: 'Ann', color: 5 }]],
    ['players', [{ key: 1, name: 'Ann', color: '#fff' }, { key: 2 }]],
  ])('returns the defaults when %s is %j', (field, value) => {
    store({ ...valid(), [field]: value });
    expect(readDraft(userId, nickname)).toEqual(fresh());
  });

  it('accepts exactly 1 and exactly 6 players but not 7', () => {
    const players = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        key: index + 1,
        name: `P${index + 1}`,
        color: '#fff',
      }));
    store(valid({ players: players(1) }));
    expect(readDraft(userId, nickname).players).toHaveLength(1);
    store(valid({ players: players(6) }));
    expect(readDraft(userId, nickname).players).toHaveLength(6);
    store(valid({ players: players(7) }));
    expect(readDraft(userId, nickname)).toEqual(fresh());
  });

  it.each([
    [-3, 0],
    [0, 0],
    [1, 1],
    [1.9, 1],
    [2, 2],
    [2.9, 2],
    [5, 2],
  ])('keeps step %s on the form as %s', (stored, step) => {
    store(valid({ step: stored }));
    expect(readDraft(userId, nickname).step).toBe(step);
  });

  it('fills rules that were not stored with their defaults and keeps the ones that were', () => {
    store({ ...valid(), rules: { auctions: true } });
    expect(readDraft(userId, nickname).rules).toEqual({
      doubleRewardOnExactGo: false,
      playerLoans: false,
      bankLoans: false,
      freeParkingJackpot: false,
      auctions: true,
    });
  });

  it('keeps a known board and replaces an unknown one with none', () => {
    store(valid({ board: 'monopoly-ru-2012' }));
    expect(readDraft(userId, nickname).board).toBe('monopoly-ru-2012');
    store({ ...valid(), board: 'chess' });
    expect(readDraft(userId, nickname).board).toBe('none');
    store({ ...valid(), board: undefined });
    expect(readDraft(userId, nickname).board).toBe('none');
  });

  it('returns the defaults when the storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readDraft(userId, nickname)).toEqual(fresh());
  });
});

describe('writeDraft and clearDraft', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('stores the draft under its key and reads it back', () => {
    writeDraft(valid({ name: 'Saved' }));
    expect(JSON.parse(sessionStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null')).toMatchObject({
      name: 'Saved',
    });
    expect(readDraft(userId, nickname).name).toBe('Saved');
    expect(DRAFT_STORAGE_KEY).toBe('mb.createGameDraft.v1');
  });

  it('removes the stored draft', () => {
    writeDraft(valid());
    clearDraft();
    expect(sessionStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('does not throw when the storage refuses to write or to remove', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeDraft(valid())).not.toThrow();
    expect(() => clearDraft()).not.toThrow();
  });
});

describe('isDraftDirty', () => {
  it('is false for a fresh form, whatever step it is on', () => {
    expect(isDraftDirty(fresh(), '', nickname)).toBe(false);
    expect(isDraftDirty({ ...fresh(), step: 2 }, '', nickname)).toBe(false);
  });

  it('is true as soon as a password is typed', () => {
    expect(isDraftDirty(fresh(), 'secret', nickname)).toBe(true);
    expect(isDraftDirty(fresh(), ' ', nickname)).toBe(true);
  });

  it.each<[string, Partial<CreateGameDraft>]>([
    ['name', { name: 'Friday' }],
    ['currency', { currency: 'EUR' }],
    ['payment mode', { paymentMode: 'CONFIRMATION' }],
    ['visibility', { isPublic: true }],
    ['starting balance', { startingBalance: '1500' }],
    ['pass GO reward', { passGoReward: '200' }],
    ['rules', { rules: { ...fresh().rules, auctions: true } }],
    ['board', { board: 'monopoly-ru-2012' }],
    ['the owner player name', { players: [{ key: 1, name: 'Other', color: firstPlayerColor }] }],
    ['the owner player colour', { players: [{ key: 1, name: nickname, color: '#000' }] }],
    [
      'the number of players',
      {
        players: [
          { key: 1, name: nickname, color: firstPlayerColor },
          { key: 2, name: 'Bob', color: '#000' },
        ],
      },
    ],
  ])('is true when the %s was changed', (_label, patch) => {
    expect(isDraftDirty({ ...fresh(), ...patch }, '', nickname)).toBe(true);
  });

  it('compares against a fresh form for the current nickname', () => {
    expect(isDraftDirty(fresh(), '', 'Renamed')).toBe(true);
  });
});
