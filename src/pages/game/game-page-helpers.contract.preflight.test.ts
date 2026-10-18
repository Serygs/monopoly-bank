import { describe, expect, it } from 'vitest';
import type { Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import { t, alice, carol, players } from '../../test/game-page-fixtures';
import { formatMoney } from '../../utils/money';
import {
  insufficientMessage,
  isPositiveInteger,
  lobbyNeedsMorePlayers,
  MIN_PLAYERS_TO_START,
  preflightFundsError,
  preflightShortfall,
  type ActionType,
} from './game-page-helpers';

describe('isPositiveInteger', () => {
  it.each(['1', '10', '9007199254740991'])('accepts %j', (value) => {
    expect(isPositiveInteger(value)).toBe(true);
  });

  it.each(['', '0', '-1', '1.5', '12a', 'a12', ' 1', '1 ', '1e3', '+5', '9007199254740993', '٣'])(
    'rejects %j',
    (value) => {
      expect(isPositiveInteger(value)).toBe(false);
    },
  );
});

describe('preflight checks', () => {
  const funds = (action: ActionType | null, amount: number, who: Player = alice) =>
    preflightFundsError(action, who, players, amount, 'USD', t);
  const short = (action: ActionType | null, amount: number, who: Player = alice) =>
    preflightShortfall(action, who, players, amount);
  const spending: ActionType[] = [
    'PLAYER_TO_PLAYER',
    'PLAYER_TO_BANK',
    'MORTGAGE_REDEMPTION',
    'PROPERTY_PURCHASE',
    'PROPERTY_BUILD',
    'PAY_RENT',
    'LOAN_REPAYMENT',
  ];
  const message = (current: number, required: number) =>
    `${t('insufficientFunds')} ${t('balanceRequirement', {
      current: formatMoney(current, 'USD'),
      required: formatMoney(required, 'USD'),
    })}`;

  it.each(spending)('%s passes at exactly the balance and fails one unit above it', (action) => {
    expect(funds(action, 1_000)).toBeNull();
    expect(funds(action, 1_001)).toBe(message(1_000, 1_001));
    expect(short(action, 1_000)).toBeNull();
    expect(short(action, 1_001)).toBe(1);
    expect(short(action, 1_500)).toBe(500);
  });

  it.each([
    'BANK_TO_PLAYER',
    'PASS_GO',
    'MORTGAGE',
    'LOAN_ISSUE',
    'BANK_LOAN',
    'TO_JACKPOT',
    'JACKPOT_PAYOUT',
    'PROPERTY_SELL_BUILDING',
    null,
  ] as const)('does not check funds for %s', (action) => {
    expect(funds(action, 999_999)).toBeNull();
    expect(short(action, 999_999)).toBeNull();
  });

  it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'ignores the amount %s',
    (amount) => {
      expect(funds('PLAYER_TO_BANK', amount)).toBeNull();
      expect(funds('PLAYER_TO_ALL', amount)).toBeNull();
      expect(funds('ALL_TO_PLAYER', amount)).toBeNull();
      expect(short('PLAYER_TO_BANK', amount)).toBeNull();
    },
  );

  it('requires the payer of everyone to cover every other player', () => {
    expect(funds('PLAYER_TO_ALL', 500)).toBeNull();
    expect(funds('PLAYER_TO_ALL', 501)).toBe(message(1_000, 1_002));
    expect(short('PLAYER_TO_ALL', 501)).toBe(2);
    expect(short('PLAYER_TO_ALL', 500)).toBeNull();
  });

  it('names every other player who cannot cover their share', () => {
    expect(funds('ALL_TO_PLAYER', 100)).toBeNull();
    expect(funds('ALL_TO_PLAYER', 101)).toBe(
      t('cannotAfford', { names: 'Carol', amount: formatMoney(101, 'USD') }),
    );
    expect(funds('ALL_TO_PLAYER', 501)).toBe(
      t('cannotAfford', { names: 'Bob, Carol', amount: formatMoney(501, 'USD') }),
    );
    expect(funds('ALL_TO_PLAYER', 600, carol)).toBe(
      t('cannotAfford', { names: 'Bob', amount: formatMoney(600, 'USD') }),
    );
  });
});

describe('insufficientMessage details', () => {
  const failure = (code: string, details?: Record<string, unknown>) =>
    new MonopolyBankApiError({ code, message: 'x', ...(details === undefined ? {} : { details }) });
  const requirement = (current: number, required: number) =>
    t('balanceRequirement', {
      current: formatMoney(current, 'USD'),
      required: formatMoney(required, 'USD'),
    });

  it('reads the available and required amounts when cash is reserved for an auction bid', () => {
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_AVAILABLE_FUNDS', {
          playerId: 'p2',
          available: 40,
          required: 90,
          currentBalance: 1,
          requiredAmount: 2,
        }),
        players,
        'USD',
        t,
      ),
    ).toBe(`${t('playerInsufficientFunds', { name: 'Bob' })} ${requirement(40, 90)}`);
  });

  it('reads the balance and required amount for a plain shortage', () => {
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', {
          playerId: 'p1',
          currentBalance: 10,
          requiredAmount: 20,
          available: 1,
          required: 2,
        }),
        players,
        'USD',
        t,
      ),
    ).toBe(`${t('playerInsufficientFunds', { name: 'Alice' })} ${requirement(10, 20)}`);
  });

  it('falls back to the generic text without a known player or without numbers', () => {
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', {
          playerId: 'ghost',
          currentBalance: 10,
          requiredAmount: 20,
        }),
        players,
        'USD',
        t,
      ),
    ).toBe(`${t('insufficientFunds')} ${requirement(10, 20)}`);
    expect(
      insufficientMessage(failure('INSUFFICIENT_FUNDS', { playerId: 7 }), players, 'USD', t),
    ).toBe(t('insufficientFunds'));
    expect(insufficientMessage(failure('INSUFFICIENT_FUNDS'), players, 'USD', t)).toBe(
      t('insufficientFunds'),
    );
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', { playerId: 'p1', currentBalance: '10', requiredAmount: 20 }),
        players,
        'USD',
        t,
      ),
    ).toBe(t('playerInsufficientFunds', { name: 'Alice' }));
    expect(
      insufficientMessage(
        failure('INSUFFICIENT_FUNDS', { playerId: 'p1', currentBalance: 10 }),
        players,
        'USD',
        t,
      ),
    ).toBe(t('playerInsufficientFunds', { name: 'Alice' }));
  });
});

describe('lobbyNeedsMorePlayers', () => {
  it('asks for more players below the minimum and not from it', () => {
    expect(MIN_PLAYERS_TO_START).toBe(2);
    expect(lobbyNeedsMorePlayers(0)).toBe(true);
    expect(lobbyNeedsMorePlayers(1)).toBe(true);
    expect(lobbyNeedsMorePlayers(2)).toBe(false);
    expect(lobbyNeedsMorePlayers(6)).toBe(false);
  });
});
